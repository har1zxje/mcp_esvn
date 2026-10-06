import { extractExplicitMcpTargets, validateMcpServerTarget } from './mcpTarget.js';
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
    this.workManagementService = null;
    this.crossDomainService = null;
    this.mutationConfirmationService = null;
    this.planeEnabled = true;
    this.hrmEnabled = true;
  }

  setWorkManagementService(service) {
    this.workManagementService = service;
    return this;
  }

  setCrossDomainService(service) { this.crossDomainService = service; return this; }

  setMutationConfirmationService(service) {
    if (!service?.createPreview) throw new TypeError('A mutation confirmation service is required.');
    this.mutationConfirmationService = service;
    return this;
  }

  async refresh(allowedServers = null, signal, executionContext = {}) {
    this.tools.clear();
    this.planeEnabled = this.clients.has('plane') && (!Array.isArray(allowedServers) || allowedServers.includes('plane'));
    this.hrmEnabled = this.clients.has('hrm') && (!Array.isArray(allowedServers) || allowedServers.includes('hrm'));
    for (const [server, client] of this.clients) {
      // The project chat sends an empty array when the user has explicitly
      // selected no MCP server. That must mean "no MCP tools", not "all tools".
      // `null` remains the backwards-compatible value for allowing every
      // configured server.
      if (Array.isArray(allowedServers) && !allowedServers.includes(server)) continue;
      try {
        const headers = server === 'hrm' ? await this.hrmHeaders(executionContext, 'tools/list') : {};
        for (const tool of await client.listTools(signal, headers)) {
          const name = `${server}.${tool.name}`;
          this.tools.set(name, { ...tool, name, server, remoteName: tool.name });
        }
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        const errorCode = server === 'hrm' && error.code === 'MCP_SERVER_UNREACHABLE' ? 'HRM_MCP_UNREACHABLE' : error.code || 'MCP_LIST_TOOLS_FAILED';
        console.error(JSON.stringify({ event: 'mcp.list_tools.failed', requestId: null, server, operation: 'mcp.list_tools', hostname: error.hostname || safeHostname(this.clients.get(server)?.server?.url), errorName: error.name, errorCode, httpStatus: error.statusCode || null }));
      }
    }
    return this.tools;
  }

  definitions() {
    const rawDefinitions = [...this.tools.values()]
      // Plane tools remain available to the internal Plane adapter, but are
      // deliberately not exposed to the model after Phase 3.
      .filter((tool) => tool.server !== 'plane')
      .map((tool) => ({
      name: `${tool.server}__${tool.remoteName}`.replace(/[^a-zA-Z0-9_]/g, '_'),
      description: `[${tool.server}] ${tool.description ?? ''}`,
      parameters: toGeminiSchema(tool.inputSchema),
      }));
    return [...rawDefinitions, ...(this.workManagementService && this.planeEnabled ? workManagementDefinitions() : []), ...(this.crossDomainService && this.planeEnabled && this.hrmEnabled ? crossDomainDefinitions() : [])];
  }

  resolve(name) {
    const normalized = name.replace('__', '.');
    return this.tools.get(name) ?? this.tools.get(normalized) ?? [...this.tools.values()].find((tool) => tool.remoteName === name);
  }

  async execute(name, args, userText, signal, executionContext = {}) {
    if (this.workManagementService && WORK_MANAGEMENT_TOOLS.has(name)) {
      return this.executeWorkManagement(name, args, userText, signal, executionContext);
    }
    if (this.crossDomainService && CROSS_DOMAIN_TOOLS.has(name)) return this.executeCrossDomain(name, userText, signal, executionContext);
    const startedAt = Date.now();
    const tool = this.resolve(name);
    if (!tool) return { success: false, error: { code: 'TOOL_NOT_FOUND', message: `Tool "${name}" is not registered` } };
    console.info(JSON.stringify({ event: 'mcp.tool_call.started', requestId: executionContext.requestId || null, userId: safeUserId(executionContext.userId), server: tool.server, tool: tool.remoteName, stage: 'mcp_transport' }));
    const targetError = validateMcpServerTarget(userText, tool.server, [...this.clients.keys()]);
    if (targetError) return { success: false, error: { code: 'MCP_TARGET_MISMATCH', message: targetError } };
    const isDestructive = /delete|remove|drop|destroy/i.test(tool.remoteName);
    const isPlaneDeletePreview = tool.server === 'plane' && /delete[_-]?work[_-]?item/i.test(tool.remoteName);
    if (isDestructive && !isPlaneDeletePreview && args?.confirm !== true) {
      return { success: false, error: { code: 'TOOL_CONFIRMATION_REQUIRED', message: 'This destructive tool requires confirm=true.' } };
    }
    try {
      let headers = {};
      let trustedContext = null;
      if (tool.server === 'plane' || tool.server === 'discord' || tool.server === 'hrm') {
        if (!config.mcpInternalToken) {
          const code = tool.server === 'discord' ? 'DISCORD_CONTEXT_INVALID' : tool.server === 'hrm' ? 'HRM_UNAVAILABLE' : 'PLANE_CONTEXT_INVALID';
          return { success: false, error: { code, message: `${tool.server} MCP trust configuration is missing.` } };
        }
        const context = await this.resolveExecutionContext(executionContext.userId, tool, executionContext);
        trustedContext = context;
        if (tool.server === 'hrm' && (!context?.userId || !executionContext.requestId)) return { success: false, error: { code: 'HRM_CONTEXT_REQUIRED', message: 'An authenticated HRM context is required.' } };
        if (process.env.NODE_ENV !== 'production') console.info(JSON.stringify({ event: 'mcp.credential_context', server: tool.server, userId: safeUserId(executionContext.userId), contextUserId: safeUserId(context.userId), authType: context.authType || null, hasCredential: Boolean(context.credential), hasDiscordDestination: Boolean(context.guildId && context.channelId) }));
        if (tool.server === 'plane' && tool.remoteName === 'find_work_items' && !hasPlaneSearchCriteria(args)) {
          return this.failure({ tool, executionContext, code: 'PLANE_QUERY_REQUIRED', message: 'Provide at least one Plane work-item search field.' });
        }
        // Set only by the business resolver after resolving the work item;
        // never accept a project scope directly from model-controlled args.
        const effectiveProjectId = tool.server === 'plane'
          ? (safePlaneScopeValue(executionContext.planeEffectiveProjectId) || context.projectId || null)
          : null;
        if (tool.server === 'plane' && isPlaneProjectMutation(tool.remoteName) && !effectiveProjectId) {
          return this.failure({ tool, executionContext, code: 'PLANE_PROJECT_CONTEXT_REQUIRED', message: 'Resolve the Plane work item project before changing it.' });
        }
        headers = {
          'x-mcp-user-id': context.userId,
          ...(tool.server === 'hrm'
            ? { 'x-mcp-request-id': executionContext.requestId }
            : (executionContext.requestId ? { 'x-request-id': executionContext.requestId } : {})),
          ...(context.credential ? { 'x-plane-credential': context.credential } : {}),
          ...(context.authType ? { 'x-plane-auth-type': context.authType } : {}),
          ...(context.workspaceSlug ? { 'x-plane-workspace': context.workspaceSlug } : {}),
          ...(effectiveProjectId ? { 'x-plane-project-id': effectiveProjectId } : {}),
          ...(context.guildId ? { 'x-discord-guild-id': context.guildId } : {}),
          ...(context.channelId ? { 'x-discord-channel-id': context.channelId } : {}),
        };
        if (tool.server === 'plane' && tool.remoteName === 'update_work_item') {
          console.info(JSON.stringify({
            event: 'plane.update_work_item.context',
            requestId: executionContext.requestId || null,
            userId: safeUserId(context.userId),
            workspaceSlug: context.workspaceSlug || null,
            configuredProjectId: context.defaultProjectId || context.projectId || null,
            defaultProjectId: context.defaultProjectId || context.projectId || null,
            effectiveProjectId: effectiveProjectId || null,
            workItemId: typeof args?.workItemId === 'string' ? args.workItemId : null,
            workItemProjectId: safePlaneScopeValue(executionContext.planeEffectiveProjectId),
            operation: tool.remoteName,
          }));
        }
      }
      // Preview input is user intent, not trusted identity. Strip every field
      // outside the strict capability schema before it crosses the MCP hop.
      const argumentsForTool = tool.server === 'hrm' && tool.remoteName === 'preview_my_leave_request'
        ? leavePreviewArguments(args)
        : args;
      const result = await this.clients.get(tool.server).callTool(tool.remoteName, argumentsForTool, signal, headers);
      if (tool.server === 'hrm') {
        const hrmError = safeHrmMcpError(result);
        // The adapter's upstream error body must never be returned to the
        // model/browser. The contract code is enough to produce a safe result.
        if (hrmError) return this.failure({ tool, executionContext, ...hrmError });
        if (tool.remoteName === 'preview_my_leave_request') {
          return await this.createLeavePreviewConfirmation({ tool, result, executionContext, trustedContext });
        }
      }
      if (tool.server === 'plane') {
        const planeError = safePlaneMcpError(result);
        if (planeError) return this.failure({ tool, executionContext, ...planeError }, result);
      }
      if (result?.isError) {
        const hrmError = tool.server === 'hrm' ? safeHrmMcpError(result) : null;
        const planeError = tool.server === 'plane' ? safePlaneMcpError(result) : null;
        return this.failure({ tool, executionContext, code: hrmError?.code ?? planeError?.code ?? 'MCP_TOOL_ERROR', message: hrmError?.message ?? planeError?.message ?? safeToolErrorMessage(result) }, tool.server === 'hrm' ? undefined : result);
      }
      console.info(JSON.stringify({ event: 'mcp.tool_call.success', requestId: executionContext.requestId || null, userId: safeUserId(executionContext.userId), server: tool.server, tool: tool.remoteName, stage: 'mcp_transport', durationMs: Date.now() - startedAt }));
      console.info(JSON.stringify({ event: 'mcp.tool.completed', requestId: executionContext.requestId || null, userId: safeUserId(executionContext.userId), server: tool.server, toolName: tool.remoteName, success: true, durationMs: Date.now() - startedAt }));
      return { success: true, result };
    } catch (error) {
      const safeCode = tool.server === 'hrm' && error.code === 'MCP_SERVER_UNREACHABLE' ? 'HRM_MCP_UNREACHABLE'
        : tool.server === 'hrm' && error.code === 'MCP_SERVER_ERROR' ? 'MCP_TOOL_CALL_FAILED'
        : error.code === 'PLANE_NOT_CONNECTED' ? 'PLANE_NOT_CONNECTED'
        : error.code === 'PLANE_RECONNECT_REQUIRED' || error.code === 'PLANE_OAUTH_REFRESH_FAILED' ? 'PLANE_RECONNECT_REQUIRED'
        : error.code === 'PLANE_SCOPE_STALE' ? 'PLANE_SCOPE_STALE'
        : error.code === 'PLANE_SCOPE_REQUIRED' ? 'PLANE_SCOPE_REQUIRED'
        : error.code === 'DISCORD_NOT_CONNECTED' ? 'DISCORD_NOT_CONNECTED'
          : error.code === 'DISCORD_CONTEXT_INVALID' ? 'DISCORD_CONTEXT_INVALID'
        : error.code === 'PLANE_CONTEXT_INVALID' ? 'PLANE_CONTEXT_INVALID'
          : error.code === 'HRM_CONTEXT_REQUIRED' || error.code === 'HRM_COMPANY_REQUIRED' ? 'HRM_COMPANY_REQUIRED'
          : tool.server === 'hrm' ? 'HRM_UNAVAILABLE'
          : 'MCP_TOOL_UNAVAILABLE';
      const safeMessage = safeCode === 'PLANE_NOT_CONNECTED'
        ? 'Plane account is not connected for this user.'
        : safeCode === 'PLANE_RECONNECT_REQUIRED'
          ? 'Plane authorization expired; reconnect is required.'
          : safeCode === 'PLANE_SCOPE_REQUIRED'
            ? 'Select a Plane workspace and project in Integration settings before using Plane tools.'
          : safeCode === 'PLANE_SCOPE_STALE'
            ? 'Your selected Plane project is no longer available. Select and save a project again.'
        : safeCode === 'DISCORD_NOT_CONNECTED'
          ? 'Discord destination is not configured for this user.'
          : safeCode === 'DISCORD_CONTEXT_INVALID'
            ? 'Discord execution context is invalid.'
        : safeCode === 'PLANE_CONTEXT_INVALID'
          ? 'Plane execution context is invalid.'
        : safeCode === 'HRM_COMPANY_REQUIRED'
          ? 'An HRM company context is required.'
          : safeCode === 'HRM_MCP_UNREACHABLE'
            ? 'The HRM MCP server is unavailable.'
          : safeCode === 'MCP_TOOL_CALL_FAILED'
            ? 'The HRM MCP tool call failed.'
          : safeCode === 'HRM_UNAVAILABLE'
            ? 'The HRM provider is unavailable.'
          : 'The requested MCP tool is unavailable.';
      console.error(JSON.stringify({ event: 'mcp.call.failed', requestId: executionContext.requestId || null, userId: safeUserId(executionContext.userId), server: tool.server, tool: tool.remoteName, operation: `${tool.server}.${tool.remoteName}`, hostname: error.hostname || safeHostname(this.clients.get(tool.server)?.server?.url), errorName: error.name, httpStatus: error.statusCode || null, code: safeCode, durationMs: Date.now() - startedAt }));
      console.error(JSON.stringify({ event: 'mcp.tool_call.failure', requestId: executionContext.requestId || null, userId: safeUserId(executionContext.userId), server: tool.server, tool: tool.remoteName, stage: 'mcp_transport', errorCode: safeCode, durationMs: Date.now() - startedAt }));
      return { success: false, error: { code: safeCode, message: safeMessage } };
    }
  }

  async hrmHeaders(executionContext, operation) {
    const context = await this.resolveExecutionContext(executionContext.userId, { server: 'hrm', remoteName: operation }, executionContext);
    if (!context?.userId || !executionContext.requestId) {
      const error = new Error('Authenticated HRM context is required.');
      error.code = 'HRM_CONTEXT_REQUIRED';
      throw error;
    }
    return {
      'x-mcp-user-id': context.userId,
      'x-mcp-request-id': executionContext.requestId,
    };
  }

  async createLeavePreviewConfirmation({ tool, result, executionContext, trustedContext }) {
    if (!this.mutationConfirmationService || !executionContext?.conversationId) {
      return this.failure({ tool, executionContext, code: 'HRM_PREVIEW_UNAVAILABLE', message: 'Leave preview confirmation is unavailable.' });
    }
    const preview = safeLeavePreview(result);
    if (!preview) return this.failure({ tool, executionContext, code: 'HRM_INVALID_RESPONSE', message: 'HRM service returned an invalid preview.' });
    try {
      const confirmation = await this.mutationConfirmationService.createPreview({
        executionContext: {
          userId: executionContext.userId,
          companyId: preview.companyId,
          conversationId: executionContext.conversationId,
        },
        mutationKind: 'leave.request',
        targetIds: { leaveTypeCode: preview.leaveTypeCode },
        // This is the exact user intent revalidated by HRM at preview time;
        // future execute must still revalidate all state in its own transaction.
        resolvedPayload: {
          leaveTypeCode: preview.leaveTypeCode,
          startDate: preview.startDate,
          endDate: preview.endDate,
          requestedDays: preview.requestedDays,
          reason: preview.reason,
        },
      });
      return {
        success: true,
        result: {
          preview: (({ companyId: _companyId, ...safePreview }) => safePreview)(preview),
          confirmationRequired: true,
          confirmation: {
            id: confirmation.confirmationId,
            expiresAt: confirmation.expiresAt,
            instruction: `To confirm this leave request, reply exactly: CONFIRM ${confirmation.confirmationId}`,
          },
        },
      };
    } catch {
      return this.failure({ tool, executionContext, code: 'HRM_PREVIEW_UNAVAILABLE', message: 'Leave preview confirmation is unavailable.' });
    }
  }

  async executeWorkManagement(name, args = {}, userText, signal, executionContext) {
    if (!this.planeEnabled) return { success: false, error: { code: 'WORK_PROVIDER_NOT_SELECTED', message: 'Select the Plane work-management provider before using this tool.' } };
    const targetError = validateMcpServerTarget(userText, 'plane', [...this.clients.keys()]);
    if (targetError) return { success: false, error: { code: 'MCP_TARGET_MISMATCH', message: targetError } };
    if (name === 'get_my_tasks') console.info(JSON.stringify({ event: 'work_management.get_my_tasks.started', requestId: executionContext.requestId || null, userId: safeUserId(executionContext.userId) }));
    let stage = 'execution_context';
    try {
      const planeContext = await this.resolveExecutionContext(executionContext.userId, {
        server: 'plane',
        remoteName: planeRemoteOperationForWorkManagementTool(name),
      });
      const businessContext = { ...executionContext, planeAccountUserId: planeContext.externalUserId ?? null };
      if (name === 'get_my_tasks') console.info(JSON.stringify({ event: 'work_management.get_my_tasks.plane_call.started', requestId: executionContext.requestId || null, userId: safeUserId(executionContext.userId), stage: 'business_service' }));
      stage = 'business_service';
      let result;
      if (name === 'get_project_tasks') result = await this.workManagementService.getProjectTasks(args, { executionContext: businessContext, signal, userText });
      if (name === 'get_my_tasks') result = await this.workManagementService.getMyTasks(args, { executionContext: businessContext, signal, userText });
      if (name === 'get_overdue_tasks') result = await this.workManagementService.getOverdueTasks(args, { executionContext: businessContext, signal, userText });
      if (name === 'get_project_progress') result = await this.workManagementService.getProjectProgress(args, { executionContext: businessContext, signal, userText });
      if (name === 'get_team_workload') result = await this.workManagementService.getTeamWorkload(args, { executionContext: businessContext, signal, userText });
      if (name === 'get_projects') result = await this.workManagementService.getProjects({ executionContext: businessContext, signal, userText });
      if (name === 'get_project_statuses') result = await this.workManagementService.getProjectStatuses(args.projectId, { executionContext: businessContext, signal, userText });
      if (name === 'get_project_members') result = await this.workManagementService.getProjectMembers(args.projectId, { executionContext: businessContext, signal, userText });
      if (name === 'create_task') result = await this.workManagementService.createTask(args, { executionContext: businessContext, signal, userText });
      if (name === 'update_task') result = await this.workManagementService.updateTask(args.taskId, args, { executionContext: businessContext, signal, userText });
      if (name === 'delete_task') {
        if (args.confirm !== true) return { success: false, error: { code: 'TOOL_CONFIRMATION_REQUIRED', message: 'Confirm deletion before removing a task.' } };
        result = await this.workManagementService.deleteTask(args.taskId, args, { executionContext: businessContext, signal, userText });
      }
      if (name === 'get_my_tasks') console.info(JSON.stringify({ event: 'work_management.get_my_tasks.completed', requestId: executionContext.requestId || null, userId: safeUserId(executionContext.userId), stage: 'business_service' }));
      return { success: true, result };
    } catch (error) {
      const code = error?.code === 'WORK_MEMBER_MAPPING_MISSING' ? 'PLANE_IDENTITY_NOT_RESOLVED'
        : error?.code === 'WORK_PROVIDER_INVALID_RESPONSE' ? 'INVALID_PROVIDER_RESPONSE'
          : error?.code === 'MCP_TOOL_ERROR' ? 'PLANE_UNAVAILABLE'
            : error?.code || 'PLANE_UNAVAILABLE';
      const message = code === 'PLANE_NOT_CONNECTED' ? 'Plane account is not connected for this user.'
        : code === 'PLANE_SCOPE_REQUIRED' ? (error?.message?.includes('projects.states:read')
          ? 'Plane OAuth needs projects.states:read. Reconnect Plane to grant the updated scope.'
          : 'Select a Plane workspace and project in Integration settings before using Plane tools.')
        : code === 'PLANE_SCOPE_STALE' ? 'Your selected Plane project is no longer available. Select and save a project again.'
        : code === 'PLANE_AUTH_REQUIRED' ? 'Plane authorization is invalid or expired; reconnect is required.'
        : code === 'PLANE_OAUTH_SCOPE_REQUIRED' ? 'Plane OAuth needs projects.members:read. Reconnect Plane to grant the updated scope.'
        : code === 'PLANE_IDENTITY_NOT_RESOLVED' ? 'The connected Plane account is not a member of the selected project.'
          : code === 'PLANE_FORBIDDEN' ? 'The connected Plane account cannot access the selected project.'
            : code === 'PLANE_PROJECT_NOT_FOUND' ? 'The configured Plane project was not found or is unavailable to this account.'
              : code === 'PLANE_WORK_ITEM_NOT_FOUND' ? 'The Plane work item was not found in the resolved project.'
                : code === 'PLANE_PROJECT_CONTEXT_REQUIRED' ? 'Resolve the Plane work item project before changing it.'
            : code === 'INVALID_PROVIDER_RESPONSE' ? 'Plane returned invalid work-management data.'
        : code === 'WORK_CONTEXT_INVALID' ? 'Authenticated work-management context is required.'
          : 'The work-management provider is unavailable.';
      if (name === 'get_my_tasks') console.error(JSON.stringify({ event: 'work_management.get_my_tasks.failed', requestId: executionContext.requestId || null, userId: safeUserId(executionContext.userId), stage, errorCode: code }));
      const requiredScope = error?.requiredScope || (code === 'PLANE_SCOPE_REQUIRED' && error?.message?.includes('projects.states:read') ? 'projects.states:read' : null);
      return { success: false, error: { code, message, ...(requiredScope ? { requiredScope } : {}) } };
    }
  }

  async executeCrossDomain(name, userText, signal, executionContext) {
    if (!this.planeEnabled || !this.hrmEnabled) return { success: false, error: { code: 'CROSS_DOMAIN_PROVIDERS_NOT_SELECTED', message: 'Select both Plane and HRM before using this tool.' } };
    const targets = extractExplicitMcpTargets(userText, [...this.clients.keys(), 'hrm']);
    if (targets.some((target) => target !== 'plane' && target !== 'hrm')) return { success: false, error: { code: 'MCP_TARGET_MISMATCH', message: 'This cross-domain tool can use only the selected Plane and HRM providers.' } };
    try {
      const options = { executionContext, signal, userText };
      const result = name === 'get_workforce_overview' ? await this.crossDomainService.getWorkforceOverview(options) : null;
      return { success: true, result };
    } catch (error) {
      const code = error?.code === 'PLANE_NOT_CONNECTED' ? 'PLANE_NOT_CONNECTED'
        : error?.code === 'PLANE_SCOPE_REQUIRED' ? 'PLANE_SCOPE_REQUIRED'
        : error?.code === 'HRM_CONTEXT_INVALID' ? 'HRM_CONTEXT_INVALID'
          : 'CROSS_DOMAIN_UNAVAILABLE';
      const message = code === 'PLANE_NOT_CONNECTED' ? 'Plane account is not connected for this user.'
        : code === 'PLANE_SCOPE_REQUIRED' ? 'Select a Plane workspace and project in Integration settings before using Plane tools.'
        : code === 'HRM_CONTEXT_INVALID' ? 'Authenticated HRM context is required.'
          : 'The cross-domain overview is unavailable.';
      return { success: false, error: { code, message } };
    }
  }

  failure({ tool, executionContext, code, message, requiredScope }, result = undefined) {
    console.error(JSON.stringify({ event: 'mcp.call.failed', requestId: executionContext.requestId || null, userId: safeUserId(executionContext.userId), server: tool.server, tool: tool.remoteName, operation: `${tool.server}.${tool.remoteName}`, hostname: safeHostname(this.clients.get(tool.server)?.server?.url), errorName: 'ToolValidationError', httpStatus: null, code }));
    console.error(JSON.stringify({ event: 'mcp.tool_call.failure', requestId: executionContext.requestId || null, userId: safeUserId(executionContext.userId), server: tool.server, tool: tool.remoteName, stage: 'mcp_result', errorCode: code }));
    return { success: false, ...(result ? { result } : {}), error: { code, message, ...(requiredScope ? { requiredScope } : {}) } };
  }
}

const WORK_MANAGEMENT_TOOLS = new Set(['get_project_tasks', 'get_my_tasks', 'get_overdue_tasks', 'get_project_progress', 'get_team_workload', 'get_projects', 'get_project_statuses', 'get_project_members', 'create_task', 'update_task', 'delete_task']);
const CROSS_DOMAIN_TOOLS = new Set(['get_workforce_overview']);

function workManagementDefinitions() {
  return [
    { name: 'get_my_tasks', description: 'Get tasks assigned to the authenticated connected Plane member. Returns provider-neutral tasks.', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'get_overdue_tasks', description: 'Get overdue non-completed work-management tasks for the configured project.', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'get_project_progress', description: 'Get completed-task progress for the configured project.', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'get_team_workload', description: 'Get task and overdue-task counts grouped by assigned member for the configured project.', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'get_projects', description: 'List available work-management projects as provider-neutral projects.', parameters: { type: 'OBJECT', properties: {} } },
    { name: 'get_project_statuses', description: 'List workflow statuses for a project. Each result preserves the Plane state UUID as externalId, plus name and category (Plane group). For a requested state change, resolve exactly one result, then call update_task; do not end the workflow after this tool.', parameters: { type: 'OBJECT', properties: { projectId: { type: 'STRING' } }, required: ['projectId'] } },
    { name: 'get_project_members', description: 'List members of a project as provider-neutral members.', parameters: { type: 'OBJECT', properties: { projectId: { type: 'STRING' } }, required: ['projectId'] } },
    {
      name: 'get_project_tasks', description: 'Get work-management tasks using optional title, status, priority, assignee, label, or external-id criteria. Returns provider-neutral tasks.',
      parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' }, description: { type: 'STRING' }, priority: { type: 'STRING', enum: ['none', 'urgent', 'high', 'medium', 'low'] }, stateId: { type: 'STRING' }, assigneeId: { type: 'STRING' }, labelId: { type: 'STRING' }, externalId: { type: 'STRING' } } },
    },
    {
      name: 'create_task', description: 'Create a work-management task. Returns a provider-neutral task.',
      parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' }, description: { type: 'STRING' }, statusId: { type: 'STRING' }, priority: { type: 'STRING', enum: ['none', 'urgent', 'high', 'medium', 'low'] }, assigneeIds: { type: 'ARRAY', items: { type: 'STRING' } }, dueDate: { type: 'STRING' } }, required: ['title'] },
    },
    {
      name: 'update_task', description: 'Update a work-management task by its provider-neutral external task ID. For a status change, call this after resolving the unique project state: pass the state externalId in statusId (a human label is accepted only as a safe fallback and is resolved against the current project states). This tool performs the Plane update and verifies the resulting state.',
      parameters: { type: 'OBJECT', properties: { taskId: { type: 'STRING' }, projectId: { type: 'STRING', description: 'Project ID returned with the resolved task. Include it whenever available.' }, title: { type: 'STRING' }, description: { type: 'STRING' }, statusId: { type: 'STRING', description: 'Resolved project-state externalId. For Vietnamese active-work requests, use the unique state matching đang thực hiện, đang làm, or In Progress.' }, priority: { type: 'STRING', enum: ['none', 'urgent', 'high', 'medium', 'low'] }, assigneeIds: { type: 'ARRAY', items: { type: 'STRING' } }, dueDate: { type: 'STRING' } }, required: ['taskId'] },
    },
    {
      name: 'delete_task', description: 'Delete a resolved work-management task only after explicit confirmation.',
      parameters: { type: 'OBJECT', properties: { taskId: { type: 'STRING' }, projectId: { type: 'STRING' }, confirm: { type: 'BOOLEAN' } }, required: ['taskId', 'confirm'] },
    },
  ];
}

function crossDomainDefinitions() {
  return [{ name: 'get_workforce_overview', description: 'Summarize selected Plane work progress and HRM counts side by side. Does not map Plane members to HRM employees.', parameters: { type: 'OBJECT', properties: {} } }];
}

function safeHostname(url) { try { return url ? new URL(url).hostname : null; } catch { return null; } }
function safeUserId(userId) { return typeof userId === 'string' && userId.length <= 128 ? userId : null; }
function leavePreviewArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  return Object.fromEntries(['leaveTypeCode', 'startDate', 'endDate', 'requestedDays', 'reason']
    .filter((key) => Object.hasOwn(args, key))
    .map((key) => [key, args[key]]));
}
function safeLeavePreview(result) {
  const text = result?.content?.find((item) => item?.type === 'text')?.text;
  let preview;
  try { preview = JSON.parse(text)?.data; } catch { return null; }
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) return null;
  const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const code = typeof preview.leaveTypeCode === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(preview.leaveTypeCode);
  const companyId = typeof preview.companyId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(preview.companyId);
  const name = typeof preview.leaveTypeName === 'string' && preview.leaveTypeName.length > 0 && preview.leaveTypeName.length <= 200;
  const days = Number.isFinite(preview.requestedDays) && preview.requestedDays > 0;
  const balance = (value) => value === null || (Number.isFinite(value) && value >= 0);
  if (!companyId || !code || !name || !date(preview.startDate) || !date(preview.endDate) || !days || typeof preview.requiresBalance !== 'boolean' || !balance(preview.remainingDaysBefore) || !balance(preview.remainingDaysAfter) || preview.hasConflict !== false || !(preview.reason === null || (typeof preview.reason === 'string' && preview.reason.length <= 1000))) return null;
  return {
    companyId: preview.companyId,
    leaveTypeCode: preview.leaveTypeCode,
    leaveTypeName: preview.leaveTypeName,
    requiresBalance: preview.requiresBalance,
    startDate: preview.startDate,
    endDate: preview.endDate,
    requestedDays: preview.requestedDays,
    reason: preview.reason,
    remainingDaysBefore: preview.remainingDaysBefore,
    remainingDaysAfter: preview.remainingDaysAfter,
    hasConflict: false,
  };
}
function hasPlaneSearchCriteria(args = {}) { return ['workItemId', 'name', 'description', 'priority', 'stateId', 'assigneeId', 'labelId', 'externalId', 'isDraft'].some((key) => args[key] !== undefined && args[key] !== null && (typeof args[key] !== 'string' || args[key].trim() !== '')); }
function safePlaneScopeValue(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null; }
function isPlaneProjectMutation(remoteName) { return remoteName === 'update_work_item' || remoteName === 'delete_work_item'; }
function safeToolErrorMessage(result) { const text = result?.content?.find((item) => item.type === 'text')?.text; return typeof text === 'string' && text.length <= 500 ? text : 'MCP tool returned an error.'; }
function safeHrmMcpError(result) {
  const text = safeToolErrorMessage(result);
  let code = /^\[(EMPLOYEE_NOT_FOUND|DEPARTMENT_NOT_FOUND|ATTENDANCE_NOT_FOUND|LEAVE_DATA_NOT_FOUND|INVALID_REQUEST|HRM_INVALID_RESPONSE|HRM_UNAUTHENTICATED|HRM_IDENTITY_NOT_LINKED|HRM_COMPANY_REQUIRED|HRM_COMPANY_FORBIDDEN|HRM_RESOURCE_NOT_FOUND|HRM_FORBIDDEN|HRM_NOT_FOUND|HRM_VALIDATION_FAILED|HRM_CONFLICT|HRM_API_UNREACHABLE|HRM_UNAVAILABLE|HRM_INTERNAL)\]/.exec(text)?.[1];
  try { code ??= JSON.parse(text)?.error?.code; } catch { /* MCP text may not be JSON. */ }
  if (!['EMPLOYEE_NOT_FOUND', 'DEPARTMENT_NOT_FOUND', 'ATTENDANCE_NOT_FOUND', 'LEAVE_DATA_NOT_FOUND', 'INVALID_REQUEST', 'HRM_INVALID_RESPONSE', 'HRM_UNAUTHENTICATED', 'HRM_IDENTITY_NOT_LINKED', 'HRM_COMPANY_REQUIRED', 'HRM_COMPANY_FORBIDDEN', 'HRM_RESOURCE_NOT_FOUND', 'HRM_FORBIDDEN', 'HRM_NOT_FOUND', 'HRM_VALIDATION_FAILED', 'HRM_CONFLICT', 'HRM_API_UNREACHABLE', 'HRM_UNAVAILABLE', 'HRM_INTERNAL'].includes(code)) return null;
  const messages = {
    EMPLOYEE_NOT_FOUND: 'Employee was not found.', DEPARTMENT_NOT_FOUND: 'Department was not found.', ATTENDANCE_NOT_FOUND: 'Attendance data was not found.', LEAVE_DATA_NOT_FOUND: 'Leave data was not found.', INVALID_REQUEST: 'HRM request is invalid.', HRM_INVALID_RESPONSE: 'HRM service returned an invalid response.', HRM_UNAUTHENTICATED: 'HRM request is not authorized.', HRM_IDENTITY_NOT_LINKED: 'HRM identity is not linked to this account.', HRM_COMPANY_REQUIRED: 'An HRM company context is required.', HRM_COMPANY_FORBIDDEN: 'The selected HRM company is not available.', HRM_RESOURCE_NOT_FOUND: 'The requested HRM resource was not found.', HRM_FORBIDDEN: 'You do not have permission to perform this action.', HRM_NOT_FOUND: 'The requested HRM resource was not found.', HRM_VALIDATION_FAILED: 'HRM request is invalid.', HRM_CONFLICT: 'HRM request conflicts with the current state.', HRM_API_UNREACHABLE: 'The HRM API is unavailable.', HRM_UNAVAILABLE: 'The HRM provider is unavailable.', HRM_INTERNAL: 'The HRM provider is unavailable.',
  };
  return { code, message: messages[code] };
}
function safePlaneMcpError(result) {
  const text = safeToolErrorMessage(result);
  let payload;
  try { payload = JSON.parse(text); } catch { return null; }
  const code = payload?.error?.code;
  if (!['PLANE_AUTH_REQUIRED', 'PLANE_SCOPE_REQUIRED', 'PLANE_OAUTH_SCOPE_REQUIRED', 'PLANE_FORBIDDEN', 'PLANE_PROJECT_NOT_FOUND', 'PLANE_WORK_ITEM_NOT_FOUND', 'PLANE_UNAVAILABLE', 'PLANE_API_ERROR'].includes(code)) return null;
  const messages = {
    PLANE_AUTH_REQUIRED: 'Plane authorization is invalid or expired; reconnect is required.',
    PLANE_SCOPE_REQUIRED: payload?.error?.requiredScope === 'projects.states:read'
      ? 'Plane OAuth needs projects.states:read. Reconnect Plane to grant the updated scope.'
      : 'Select a Plane workspace and project in Integration settings before using Plane tools.',
    PLANE_OAUTH_SCOPE_REQUIRED: 'Plane OAuth needs projects.members:read. Reconnect Plane to grant the updated scope.',
    PLANE_FORBIDDEN: 'The connected Plane account cannot access the selected project.',
    PLANE_PROJECT_NOT_FOUND: 'The configured Plane project was not found or is unavailable to this account.',
    PLANE_WORK_ITEM_NOT_FOUND: 'The Plane work item was not found in the resolved project.',
    PLANE_UNAVAILABLE: 'The Plane provider is unavailable.',
    PLANE_API_ERROR: 'Plane rejected the request.',
  };
  return { code, message: messages[code], ...(typeof payload?.error?.requiredScope === 'string' ? { requiredScope: payload.error.requiredScope } : {}) };
}

function planeRemoteOperationForWorkManagementTool(name) {
  return {
    get_project_tasks: 'find_work_items',
    get_my_tasks: 'find_work_items',
    get_overdue_tasks: 'find_work_items',
    get_project_progress: 'find_work_items',
    get_team_workload: 'find_work_items',
    get_projects: 'list_projects',
    get_project_statuses: 'list_project_states',
    get_project_members: 'list_project_members',
    create_task: 'create_work_item',
    update_task: 'update_work_item',
    delete_task: 'delete_work_item',
  }[name] ?? 'request';
}
