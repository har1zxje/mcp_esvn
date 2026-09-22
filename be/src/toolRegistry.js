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
  constructor(clients) { this.clients = clients; this.tools = new Map(); }

  async refresh(allowedServers = null) {
    this.tools.clear();
    for (const [server, client] of this.clients) {
      // The project chat sends an empty array when the user has explicitly
      // selected no MCP server. That must mean "no MCP tools", not "all tools".
      // `null` remains the backwards-compatible value for allowing every
      // configured server.
      if (Array.isArray(allowedServers) && !allowedServers.includes(server)) continue;
      try {
        for (const tool of await client.listTools()) {
          const name = `${server}.${tool.name}`;
          this.tools.set(name, { ...tool, name, server, remoteName: tool.name });
        }
      } catch (error) { console.error(JSON.stringify({ event: 'mcp.list_tools.failed', server, error: error.message })); }
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

  async execute(name, args) {
    const tool = this.resolve(name);
    if (!tool) return { success: false, error: { code: 'TOOL_NOT_FOUND', message: `Tool "${name}" is not registered` } };
    const isDestructive = /delete|remove|drop|destroy/i.test(tool.remoteName);
    const isPlaneDeletePreview = tool.server === 'plane' && /delete[_-]?work[_-]?item/i.test(tool.remoteName);
    if (isDestructive && !isPlaneDeletePreview && args?.confirm !== true) {
      return { success: false, error: { code: 'TOOL_CONFIRMATION_REQUIRED', message: 'This destructive tool requires confirm=true.' } };
    }
    try {
      const result = await this.clients.get(tool.server).callTool(tool.remoteName, args);
      return { success: !result?.isError, result, ...(result?.isError ? { error: { code: 'MCP_TOOL_ERROR', message: 'MCP tool returned an error' } } : {}) };
    } catch (error) {
      console.error(JSON.stringify({ event: 'mcp.call.failed', server: tool.server, tool: tool.remoteName, error: error.message }));
      return { success: false, error: { code: 'MCP_TOOL_UNAVAILABLE', message: error.message } };
    }
  }
}
