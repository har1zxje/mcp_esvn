import { validateMcpServerTarget } from './mcpTarget.js';
import { config } from './config.js';

function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'OBJECT', properties: {} };
  const rawType = Array.isArray(schema.type)
    ? schema.type.find((type) => type !== 'null')
    : schema.type;
  const normalized = {
    type: String(rawType || 'object').toUpperCase(),
    ...(schema.description ? { description: schema.description } : {}),
    ...(Array.isArray(schema.required) && schema.required.length ? { required: schema.required } : {}),
    ...(Array.isArray(schema.enum) ? { enum: schema.enum } : {}),
  };
  if (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
    normalized.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, value]) => [name, toGeminiSchema(value)]),
    );
  }
  if (schema.items) normalized.items = toGeminiSchema(schema.items);
  return normalized;
}

export class ToolRegistry {
  constructor(clients, resolveExecutionContext = async () => null) {
    this.clients = clients;
    this.resolveExecutionContext = resolveExecutionContext;
    this.tools = new Map();
  }

  async refresh(allowedServers = null, signal) {
    this.tools.clear();
    for (const [server, client] of this.clients) {
      // The project chat sends an empty array when the user has explicitly
      // selected no MCP server. That must mean "no MCP tools", not "all tools".
      // `null` remains the backwards-compatible value for allowing every
      // configured server.
      if (Array.isArray(allowedServers) && !allowedServers.includes(server)) continue;
      try {
        for (const tool of await client.listTools(signal)) {
          const name = `${server}.${tool.name}`;
          this.tools.set(name, { ...tool, name, server, remoteName: tool.name });
        }
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        console.error(JSON.stringify({ event: 'mcp.list_tools.failed', requestId: null, server, operation: 'mcp.list_tools', hostname: error.hostname || safeHostname(this.clients.get(server)?.server?.url), errorName: error.name, errorCode: error.code || 'MCP_LIST_TOOLS_FAILED', httpStatus: error.statusCode || null }));
      }
    }
    return this.tools;
  }

  definitions() {
    return [...this.tools.values()].map((tool) => ({
      name: `${tool.server}__${tool.remoteName}`.replace(/[^a-zA-Z0-9_]/g, '_'),
      description: `[${tool.server}] ${tool.description ?? ''}`,
      parameters: toGeminiSchema(tool.inputSchema),
    }));
  }

  resolve(name) {
    const normalized = name.replace('__', '.');
    return this.tools.get(name) ?? this.tools.get(normalized) ?? [...this.tools.values()].find((tool) => tool.remoteName === name);
  }

  async execute(name, args, userText, signal, executionContext = {}) {
    const startedAt = Date.now();
    const tool = this.resolve(name);
    if (!tool) return { success: false, error: { code: 'TOOL_NOT_FOUND', message: `Tool "${name}" is not registered` } };
    const targetError = validateMcpServerTarget(userText, tool.server, [...this.clients.keys()]);
    if (targetError) return { success: false, error: { code: 'MCP_TARGET_MISMATCH', message: targetError } };
    const isDestructive = /delete|remove|drop|destroy/i.test(tool.remoteName);
    const isPlaneDeletePreview = tool.server === 'plane' && /delete[_-]?work[_-]?item/i.test(tool.remoteName);
    if (isDestructive && !isPlaneDeletePreview && args?.confirm !== true) {
      return { success: false, error: { code: 'TOOL_CONFIRMATION_REQUIRED', message: 'This destructive tool requires confirm=true.' } };
    }
    try {
      let headers = {};
      if (tool.server === 'plane' || tool.server === 'discord') {
        if (!config.mcpInternalToken) {
          const code = tool.server === 'discord' ? 'DISCORD_CONTEXT_INVALID' : 'PLANE_CONTEXT_INVALID';
          return { success: false, error: { code, message: `${tool.server} MCP trust configuration is missing.` } };
        }
        const context = await this.resolveExecutionContext(executionContext.userId, tool);
        if (process.env.NODE_ENV !== 'production') console.info(JSON.stringify({ event: 'mcp.credential_context', server: tool.server, userId: safeUserId(executionContext.userId), contextUserId: safeUserId(context.userId), authType: context.authType || null, hasApiKey: Boolean(context.apiKey), hasDiscordDestination: Boolean(context.guildId && context.channelId) }));
        if (tool.server === 'plane' && tool.remoteName === 'find_work_items' && !hasPlaneSearchCriteria(args)) {
          return this.failure({ tool, executionContext, code: 'PLANE_QUERY_REQUIRED', message: 'Provide at least one Plane work-item search field.' });
        }
        headers = {
          'x-mcp-user-id': context.userId,
          ...(executionContext.requestId ? { 'x-request-id': executionContext.requestId } : {}),
          ...(context.apiKey ? { 'x-plane-api-key': context.apiKey } : {}),
          ...(context.authType ? { 'x-plane-auth-type': context.authType } : {}),
          ...(context.guildId ? { 'x-discord-guild-id': context.guildId } : {}),
          ...(context.channelId ? { 'x-discord-channel-id': context.channelId } : {}),
        };
      }
      const result = await this.clients.get(tool.server).callTool(tool.remoteName, args, signal, headers);
      if (result?.isError) return this.failure({ tool, executionContext, code: 'MCP_TOOL_ERROR', message: safeToolErrorMessage(result) }, result);
      console.info(JSON.stringify({ event: 'mcp.tool.completed', requestId: executionContext.requestId || null, userId: safeUserId(executionContext.userId), server: tool.server, toolName: tool.remoteName, success: true, durationMs: Date.now() - startedAt }));
      return { success: true, result };
    } catch (error) {
      const safeCode = error.code === 'PLANE_NOT_CONNECTED' ? 'PLANE_NOT_CONNECTED'
        : error.code === 'PLANE_RECONNECT_REQUIRED' || error.code === 'PLANE_OAUTH_REFRESH_FAILED' ? 'PLANE_RECONNECT_REQUIRED'
        : error.code === 'DISCORD_NOT_CONNECTED' ? 'DISCORD_NOT_CONNECTED'
          : error.code === 'DISCORD_CONTEXT_INVALID' ? 'DISCORD_CONTEXT_INVALID'
        : error.code === 'PLANE_CONTEXT_INVALID' ? 'PLANE_CONTEXT_INVALID'
          : 'MCP_TOOL_UNAVAILABLE';
      const safeMessage = safeCode === 'PLANE_NOT_CONNECTED'
        ? 'Plane account is not connected for this user.'
        : safeCode === 'PLANE_RECONNECT_REQUIRED'
          ? 'Plane authorization expired; reconnect is required.'
        : safeCode === 'DISCORD_NOT_CONNECTED'
          ? 'Discord destination is not configured for this user.'
          : safeCode === 'DISCORD_CONTEXT_INVALID'
            ? 'Discord execution context is invalid.'
        : safeCode === 'PLANE_CONTEXT_INVALID'
          ? 'Plane execution context is invalid.'
          : 'The requested MCP tool is unavailable.';
      console.error(JSON.stringify({ event: 'mcp.call.failed', requestId: executionContext.requestId || null, userId: safeUserId(executionContext.userId), server: tool.server, tool: tool.remoteName, operation: `${tool.server}.${tool.remoteName}`, hostname: error.hostname || safeHostname(this.clients.get(tool.server)?.server?.url), errorName: error.name, httpStatus: error.statusCode || null, code: safeCode, durationMs: Date.now() - startedAt }));
      return { success: false, error: { code: safeCode, message: safeMessage } };
    }
  }

  failure({ tool, executionContext, code, message }, result = undefined) {
    console.error(JSON.stringify({ event: 'mcp.call.failed', requestId: executionContext.requestId || null, userId: safeUserId(executionContext.userId), server: tool.server, tool: tool.remoteName, operation: `${tool.server}.${tool.remoteName}`, hostname: safeHostname(this.clients.get(tool.server)?.server?.url), errorName: 'ToolValidationError', httpStatus: null, code }));
    return { success: false, ...(result ? { result } : {}), error: { code, message } };
  }
}

function safeHostname(url) { try { return url ? new URL(url).hostname : null; } catch { return null; } }
function safeUserId(userId) { return typeof userId === 'string' && userId.length <= 128 ? userId : null; }
function hasPlaneSearchCriteria(args = {}) { return ['name', 'description', 'priority', 'stateId', 'assigneeId', 'labelId', 'externalId', 'isDraft'].some((key) => args[key] !== undefined && args[key] !== null && (typeof args[key] !== 'string' || args[key].trim() !== '')); }
function safeToolErrorMessage(result) { const text = result?.content?.find((item) => item.type === 'text')?.text; return typeof text === 'string' && text.length <= 500 ? text : 'MCP tool returned an error.'; }
