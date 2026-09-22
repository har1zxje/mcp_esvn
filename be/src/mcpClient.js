import { config } from './config.js';

export class McpClient {
  constructor(name, server) {
    this.name = name;
    this.server = server;
    this.sessionId = null;
    this.requestId = 0;
  }

  async rpc(method, params = {}, signal) {
    const isNotification = method.startsWith('notifications/');
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(config.mcpTimeoutMs)])
      : AbortSignal.timeout(config.mcpTimeoutMs);
    const response = await fetch(this.server.url, {
      method: 'POST',
      signal: requestSignal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        ...(isNotification ? {} : { id: ++this.requestId }),
        method,
        params,
      }),
    });
    const session = response.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    const text = await response.text();
    if (!text.trim() && method.startsWith('notifications/')) return {};
    let payload;
    try {
      // Streamable HTTP servers may return either application/json or an SSE
      // envelope containing one or more `data: {json}` messages.
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream') || text.trimStart().startsWith('event:')) {
        const data = text
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .filter(Boolean)
          .join('');
        payload = JSON.parse(data);
      } else {
        payload = JSON.parse(text);
      }
    } catch { throw new Error(`MCP ${this.name} returned invalid JSON/SSE`); }
    if (!response.ok || payload.error) throw new Error(payload.error?.message || `MCP ${this.name} HTTP ${response.status}`);
    return payload.result;
  }

  async initialize(signal) {
    if (this.sessionId) return;
    await this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'project-chat-agent', version: '1.0.0' },
    }, signal);
    await this.rpc('notifications/initialized', {}, signal);
  }

  async listTools(signal) { await this.initialize(signal); return (await this.rpc('tools/list', {}, signal)).tools ?? []; }
  async callTool(name, arguments_, signal) { await this.initialize(signal); return this.rpc('tools/call', { name, arguments: arguments_ ?? {} }, signal); }
}

export function createMcpClients() {
  return new Map(Object.entries(config.mcpServers).filter(([, server]) => server.enabled && server.url)
    .map(([name, server]) => [name, new McpClient(name, server)]));
}
