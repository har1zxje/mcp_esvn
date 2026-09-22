import { config } from './config.js';

const timeout = (ms) => AbortSignal.timeout(ms);

export class McpClient {
  constructor(name, server) {
    this.name = name;
    this.server = server;
    this.sessionId = null;
    this.requestId = 0;
  }

  async rpc(method, params = {}) {
    const isNotification = method.startsWith('notifications/');
    const response = await fetch(this.server.url, {
      method: 'POST',
      signal: timeout(Number(process.env.MCP_TIMEOUT_MS ?? 30000)),
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

  async initialize() {
    if (this.sessionId) return;
    await this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'project-chat-agent', version: '1.0.0' },
    });
    await this.rpc('notifications/initialized');
  }

  async listTools() { await this.initialize(); return (await this.rpc('tools/list')).tools ?? []; }
  async callTool(name, arguments_) { await this.initialize(); return this.rpc('tools/call', { name, arguments: arguments_ ?? {} }); }
}

export function createMcpClients() {
  return new Map(Object.entries(config.mcpServers).filter(([, server]) => server.enabled && server.url)
    .map(([name, server]) => [name, new McpClient(name, server)]));
}
