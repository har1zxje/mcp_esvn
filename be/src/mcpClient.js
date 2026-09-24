import { config } from './config.js';

export class McpClient {
  constructor(name, server) {
    this.name = name;
    this.server = server;
    this.sessionId = null;
    this.requestId = 0;
  }

  async rpc(method, params = {}, signal, extraHeaders = {}) {
    const isNotification = method.startsWith('notifications/');
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(config.mcpTimeoutMs)])
      : AbortSignal.timeout(config.mcpTimeoutMs);
    let response;
    try {
      response = await fetch(this.server.url, {
      method: 'POST',
      signal: requestSignal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        ...(this.server.internalToken ? { 'x-mcp-internal-token': this.server.internalToken } : {}),
        ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
        ...extraHeaders,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        ...(isNotification ? {} : { id: ++this.requestId }),
        method,
        params,
      }),
      });
    } catch (error) {
      const wrapped = new Error(`MCP ${this.name} is unreachable`);
      wrapped.code = 'MCP_SERVER_UNREACHABLE';
      wrapped.cause = error;
      try { wrapped.hostname = new URL(this.server.url).hostname; } catch { wrapped.hostname = null; }
      logRpcFailure(this, method, {
        phase: 'fetch',
        errorName: error?.name || 'Error',
        errorCode: classifyTransportError(error),
        message: safeErrorMessage(error),
      });
      throw wrapped;
    }
    const session = response.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    const text = await response.text();
    if (!text.trim() && method.startsWith('notifications/')) return {};
    const contentType = response.headers.get('content-type') ?? '';
    if (process.env.NODE_ENV !== 'production') console.info(JSON.stringify({ event: 'mcp.rpc.response', server: this.name, method, httpStatus: response.status, contentType, mcpSessionIdPresent: Boolean(session), mcpProtocolVersion: response.headers.get('mcp-protocol-version'), cacheControl: response.headers.get('cache-control'), rawBodyPreview: sanitizeMcpPreview(text) }));
    if (!isMcpContentType(contentType, text)) {
      const error = new Error(`MCP ${this.name} returned an unsupported Content-Type`);
      error.code = 'MCP_INVALID_CONTENT_TYPE'; error.statusCode = response.status;
      logRpcFailure(this, method, { phase: 'content_type', httpStatus: response.status, contentType, errorCode: error.code });
      throw error;
    }
    let payload;
    try {
      // Streamable HTTP may return JSON or one or more SSE events. Parse each
      // SSE event independently; concatenating all data lines can create an
      // invalid JSON document when a response contains multiple events.
      if (contentType.includes('text/event-stream') || text.trimStart().startsWith('event:')) {
        const events = text.split(/\r?\n\r?\n/).map((block) => block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n')).filter(Boolean);
        const parsedEvents = events.map((event) => JSON.parse(event));
        payload = parsedEvents.find((event) => event && (event.result !== undefined || event.error !== undefined)) ?? parsedEvents[parsedEvents.length - 1];
      } else {
        payload = JSON.parse(text);
      }
    } catch (error) {
      const wrapped = new Error(`MCP ${this.name} returned invalid JSON/SSE`);
      wrapped.code = 'MCP_INVALID_JSON'; wrapped.cause = error;
      logRpcFailure(this, method, { phase: 'parse', errorName: error?.name || 'Error', errorCode: wrapped.code, message: safeErrorMessage(error) });
      throw wrapped;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || (payload.result === undefined && payload.error === undefined)) {
      const error = new Error(`MCP ${this.name} returned an invalid JSON-RPC response`);
      error.code = 'MCP_INVALID_JSON_RPC'; error.statusCode = response.status;
      logRpcFailure(this, method, { phase: 'json_rpc', httpStatus: response.status, errorCode: error.code });
      throw error;
    }
    if (!response.ok || payload.error) {
      const error = new Error(payload.error?.message || `MCP ${this.name} HTTP ${response.status}`);
      error.code = 'MCP_SERVER_ERROR'; error.statusCode = response.status;
      try { error.hostname = new URL(this.server.url).hostname; } catch { error.hostname = null; }
      logRpcFailure(this, method, { phase: 'protocol', httpStatus: response.status, errorCode: error.code, protocolError: payload.error ? true : false });
      throw error;
    }
    return payload.result;
  }

  async initialize(signal) {
    if (this.sessionId) return;
    if (process.env.NODE_ENV !== 'production') console.info(JSON.stringify({ event: 'mcp.initialize.started', server: this.name, url: this.server.url }));
    try {
      await this.rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'project-chat-agent', version: '1.0.0' },
      }, signal);
      await this.rpc('notifications/initialized', {}, signal);
      if (process.env.NODE_ENV !== 'production') console.info(JSON.stringify({ event: 'mcp.initialize.success', server: this.name }));
    } catch (error) {
      console.error(JSON.stringify({ event: 'mcp.initialize.failed', server: this.name, errorCode: error?.code || 'MCP_INITIALIZE_FAILED', errorName: error?.name || 'Error', causeCode: error?.cause?.code || error?.cause?.cause?.code || null, httpStatus: error?.statusCode || null }));
      throw error;
    }
  }

  async listTools(signal) { await this.initialize(signal); const tools = (await this.rpc('tools/list', {}, signal)).tools ?? []; if (process.env.NODE_ENV !== 'production') console.info(JSON.stringify({ event: 'mcp.list_tools.success', server: this.name, toolCount: tools.length })); return tools; }
  async callTool(name, arguments_, signal, extraHeaders = {}) {
    await this.initialize(signal);
    return this.rpc('tools/call', { name, arguments: arguments_ ?? {} }, signal, extraHeaders);
  }
}

function sanitizeMcpPreview(value) {
  return String(value ?? '').replace(/("(?:access_token|refresh_token|client_secret|api[_-]?key|authorization|token|secret)"\s*:\s*")[^"]*(")/gi, '$1[redacted]$2').slice(0, 500);
}

function isMcpContentType(contentType, text) {
  return contentType.includes('application/json') || contentType.includes('text/event-stream') || text.trimStart().startsWith('event:');
}

function safeErrorMessage(error) {
  return String(error?.cause?.message || error?.message || 'Unknown MCP transport error').slice(0, 240);
}

function classifyTransportError(error) {
  const message = safeErrorMessage(error);
  if (/ByteString|header value|invalid character/i.test(message)) return 'ERR_INVALID_HEADER_VALUE';
  if (error?.cause?.code || error?.code) return error.cause?.code || error.code;
  if (error?.name === 'TimeoutError') return 'ETIMEDOUT';
  if (error?.name === 'AbortError') return 'ABORT_ERR';
  if (/fetch failed/i.test(message)) return 'FETCH_FAILED';
  return 'MCP_TRANSPORT_FAILED';
}

function logRpcFailure(client, method, details) {
  console.error(JSON.stringify({ event: 'mcp.rpc.failed', server: client.name, method, hostname: safeHostname(client.server.url), ...details }));
}

function safeHostname(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

export function createMcpClients() {
  return new Map(Object.entries(config.mcpServers).filter(([, server]) => server.enabled && server.url)
    .map(([name, server]) => [name, new McpClient(name, { ...server, internalToken: config.mcpInternalToken })]));
}
