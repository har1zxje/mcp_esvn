/**
 * Work-management domain boundary.
 *
 * This module deliberately has no Plane response model. Provider-neutral
 * models are introduced in Phase 2. Until then it centralizes the mapping
 * from business operations to the existing Plane MCP transport so raw MCP
 * names do not spread through new application code.
 */

import { membersFromPlaneMcpResult, projectsFromPlaneMcpResult, statusesFromPlaneMcpResult, taskFromPlaneMcpResult, tasksFromPlaneMcpResult } from './workManagementModels.js';

const MODEL_CONTROLLED_CONTEXT_FIELDS = new Set([
  'userId', 'ownerId', 'apiKey', 'accessToken', 'refreshToken',
  'workspaceId', 'workspace', 'projectId', 'project',
]);

export class WorkManagementError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'WorkManagementError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function withRequiredScope(error, requiredScope) {
  if (requiredScope) error.requiredScope = requiredScope;
  return error;
}

function requireTrustedExecutionContext(executionContext) {
  if (!executionContext?.userId || typeof executionContext.userId !== 'string') {
    throw new WorkManagementError('WORK_CONTEXT_INVALID', 'Authenticated work-management context is required.', 401);
  }
  return executionContext;
}

function providerFailure(operation, result) {
  const error = result?.error ?? {};
  throw withRequiredScope(new WorkManagementError(
    error.code || 'WORK_PROVIDER_ERROR',
    error.message || `Work provider could not complete ${operation}.`,
  ), error.requiredScope);
}

function withoutModelControlledContext(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).filter(([key]) => !MODEL_CONTROLLED_CONTEXT_FIELDS.has(key)));
}

function externalPlaneId(value) {
  return typeof value === 'string' ? value.replace(/^plane:/, '') : value;
}

function requireExternalPlaneId(value, code, message) {
  const id = externalPlaneId(value);
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new WorkManagementError(code, message);
  }
  return id;
}

function safeUserId(value) {
  return typeof value === 'string' && value.length <= 128 ? value : null;
}

function safePlaneErrorCode(code) {
  if (['PLANE_NOT_CONNECTED', 'PLANE_SCOPE_REQUIRED', 'PLANE_SCOPE_STALE', 'PLANE_AUTH_REQUIRED', 'PLANE_OAUTH_SCOPE_REQUIRED', 'PLANE_FORBIDDEN', 'PLANE_PROJECT_NOT_FOUND', 'PLANE_WORK_ITEM_NOT_FOUND', 'PLANE_PROJECT_CONTEXT_REQUIRED', 'PLANE_UNAVAILABLE'].includes(code)) return code;
  if (code === 'WORK_PROVIDER_INVALID_RESPONSE') return 'INVALID_PROVIDER_RESPONSE';
  if (code === 'WORK_MEMBER_MAPPING_MISSING' || code === 'PLANE_IDENTITY_NOT_RESOLVED') return 'PLANE_IDENTITY_NOT_RESOLVED';
  return 'PLANE_UNAVAILABLE';
}

function normalizeStateLabel(value) {
  return typeof value === 'string'
    ? value.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[đĐ]/g, 'd').toLocaleLowerCase('vi').replace(/\s+/g, ' ').trim()
    : '';
}

function resolveStateReference(statuses, reference) {
  const requested = typeof reference === 'string' ? reference.trim() : '';
  if (!requested) throw new WorkManagementError('WORK_STATUS_REQUIRED', 'A status name or state ID is required.');
  const normalized = normalizeStateLabel(requested);
  // These are display-name/group aliases, never state IDs. The actual ID is
  // always read from the current project's state list; do not hard-code UUIDs.
  const aliases = new Map([
    ['in progress', new Set(['in progress', 'dang thuc hien', 'dang lam'])],
    ['dang thuc hien', new Set(['in progress', 'dang thuc hien', 'dang lam'])],
    ['dang lam', new Set(['in progress', 'dang thuc hien', 'dang lam'])],
  ]);
  const acceptedNames = aliases.get(normalized) ?? new Set([normalized]);
  const exactIdMatches = statuses.filter((status) => status.externalId === requested);
  const nameMatches = statuses.filter((status) => acceptedNames.has(normalizeStateLabel(status.name)));
  // Plane's stable workflow group for an active item is normally `started`.
  // It is only a fallback: an explicitly named state always wins.
  const groupMatches = aliases.has(normalized)
    ? statuses.filter((status) => ['started', 'in progress', 'in_progress'].includes(normalizeStateLabel(status.category)))
    : [];
  const matches = exactIdMatches.length ? exactIdMatches : (nameMatches.length ? nameMatches : groupMatches);
  if (matches.length === 1) {
    const match = matches[0];
    console.info(JSON.stringify({
      event: 'plane.status.resolved', requestedStatus: requested,
      matchedStateName: match.name ?? null, matchedStateId: match.externalId,
    }));
    return match.externalId;
  }
  if (matches.length > 1) throw new WorkManagementError('WORK_STATUS_AMBIGUOUS', 'More than one Plane status matches the requested status.');
  throw new WorkManagementError('WORK_STATUS_NOT_FOUND', 'The requested Plane status was not found in the task project.', 404);
}

function planePayload(result, label) {
  const text = result?.content?.find((item) => item?.type === 'text' && typeof item.text === 'string')?.text;
  if (!text) throw new WorkManagementError('WORK_PROVIDER_INVALID_RESPONSE', `Plane returned no readable ${label}.`, 502);
  try { return JSON.parse(text); } catch { throw new WorkManagementError('WORK_PROVIDER_INVALID_RESPONSE', `Plane returned malformed ${label}.`, 502); }
}

function planeAccountId(result) {
  const payload = planePayload(result, 'account identity');
  const id = payload?.id ?? payload?.user?.id;
  if (typeof id !== 'string' || !id.trim()) throw new WorkManagementError('PLANE_IDENTITY_NOT_RESOLVED', 'Plane returned no authenticated account identity.', 400);
  return id;
}

// Plane's current project-members endpoint returns user records directly. The
// nested variants keep this adapter compatible with older/self-hosted shapes
// without ever falling back to an application user id or an email address.
function projectMemberIdForAccount(result, accountUserId) {
  const payload = planePayload(result, 'project members');
  const members = Array.isArray(payload) ? payload : payload?.results;
  if (!Array.isArray(members)) throw new WorkManagementError('WORK_PROVIDER_INVALID_RESPONSE', 'Plane returned an invalid project-member list.', 502);
  for (const member of members) {
    if (!member || typeof member !== 'object') continue;
    const ids = [member.id, member.user_id, member.member_id, member.user?.id, member.member?.id]
      .filter((id) => typeof id === 'string' && id.trim());
    if (ids.includes(accountUserId)) return accountUserId;
  }
  throw new WorkManagementError('PLANE_IDENTITY_NOT_RESOLVED', 'The connected Plane account is not a member of the selected project.', 403);
}

/**
 * Adapter for the legacy Plane MCP tool surface. This is the only new domain
 * code that knows Plane tool names or Plane's work-item argument names.
 */
export class PlaneWorkManagementProvider {
  constructor(toolRegistry) {
    if (!toolRegistry?.execute) throw new Error('PlaneWorkManagementProvider requires a tool registry');
    this.toolRegistry = toolRegistry;
  }

  async findTasks(criteria, { executionContext, signal, userText, projectId } = {}) {
    const safeCriteria = withoutModelControlledContext(criteria);
    if (!Object.values(safeCriteria).some((value) => value !== undefined && value !== null && value !== '')) safeCriteria.isDraft = false;
    const result = await this.call('findTasks', 'plane__find_work_items', safeCriteria, {
      executionContext, signal, userText, projectId,
    });
    return tasksFromPlaneMcpResult(result);
  }

  async resolveMyMember({ executionContext, signal, userText } = {}) {
    const trustedContext = requireTrustedExecutionContext(executionContext);
    console.info(JSON.stringify({ event: 'plane_identity.resolve.started', requestId: trustedContext.requestId || null, userId: safeUserId(trustedContext.userId) }));
    try {
      let accountUserId = trustedContext.planeAccountUserId;
      if (!accountUserId) {
        const account = await this.call('resolvePlaneAccount', 'plane__get_authenticated_user', {}, { executionContext: trustedContext, signal, userText });
        accountUserId = planeAccountId(account);
      }
      // Plane work-item assignees are Plane user UUIDs.  The OAuth callback
      // stores this UUID, so the normal path neither needs a member-list scope
      // nor resolves identity from an email/name.  List members remains only
      // for the explicit project-members feature.
      console.info(JSON.stringify({ event: 'plane_identity.resolve.success', requestId: trustedContext.requestId || null, userId: safeUserId(trustedContext.userId), source: trustedContext.planeAccountUserId ? 'integration' : 'plane_account' }));
      return accountUserId;
    } catch (error) {
      const code = safePlaneErrorCode(error?.code);
      console.error(JSON.stringify({ event: 'plane_identity.resolve.failed', requestId: trustedContext.requestId || null, userId: safeUserId(trustedContext.userId), code }));
      if (error instanceof WorkManagementError && error.code === code) throw error;
      throw new WorkManagementError(code, 'Plane identity could not be resolved for this user.', error?.statusCode || 502);
    }
  }

  async listProjects({ executionContext, signal, userText } = {}) {
    const result = await this.call('listProjects', 'plane__list_projects', {}, { executionContext, signal, userText });
    return projectsFromPlaneMcpResult(result);
  }

  async listProjectStates(projectId, { executionContext, signal, userText } = {}) {
    const externalProjectId = requireExternalPlaneId(projectId, 'PLANE_PROJECT_CONTEXT_REQUIRED', 'Resolve the Plane task project before looking up statuses.');
    const result = await this.call('listProjectStates', 'plane__list_project_states', { projectId: externalProjectId }, { executionContext, signal, userText, projectId: externalProjectId });
    return statusesFromPlaneMcpResult(result);
  }

  async listProjectMembers(projectId, { executionContext, signal, userText } = {}) {
    const result = await this.call('listProjectMembers', 'plane__list_project_members', { projectId: externalPlaneId(projectId) }, { executionContext, signal, userText });
    return membersFromPlaneMcpResult(result);
  }

  async createTask(input, { executionContext, signal, userText } = {}) {
    const task = withoutModelControlledContext(input);
    const result = await this.call('createTask', 'plane__create_work_item', {
      name: task.title ?? task.name,
      description: task.description,
      stateId: task.statusId ?? task.stateId,
      priority: task.priority,
      assigneeIds: task.assigneeIds,
      labelIds: task.labelIds,
      startDate: task.startDate,
      targetDate: task.dueDate ?? task.targetDate,
    }, { executionContext, signal, userText });
    return taskFromPlaneMcpResult(result);
  }

  async updateTask(taskId, changes, { executionContext, signal, userText } = {}) {
    const externalTaskId = requireExternalPlaneId(taskId, 'WORK_TASK_ID_REQUIRED', 'A task identifier is required.');
    // projectId is trusted only as a locator hint: the work item is read from
    // that project before mutation, so taskId/projectId mismatches are
    // rejected instead of PATCHing the integration default project.
    const requestedProjectId = changes?.projectId ?? changes?.externalProjectId;
    const resolvedTask = await this.resolveTask(externalTaskId, requestedProjectId, { executionContext, signal, userText });
    const task = withoutModelControlledContext(changes);
    // A state change is a two-step operation. Never pass a human label or an
    // unvalidated ID to PATCH: state lookup must succeed first, otherwise the
    // update fails closed and no mutation is attempted.
    const requestedState = task.statusId ?? task.stateId;
    const resolvedStateId = requestedState == null
      ? null
      : resolveStateReference(
        await this.listProjectStates(resolvedTask.externalProjectId, { executionContext, signal, userText }),
        requestedState,
      );
    console.info(JSON.stringify({
      event: 'updateWorkItem.started', requestId: executionContext?.requestId || null,
      requestedStatus: requestedState ?? null, workItemId: resolvedTask.externalId,
      matchedStateId: resolvedStateId,
    }));
    try {
      const result = await this.call('updateTask', 'plane__update_work_item', {
        workItemId: resolvedTask.externalId,
        newName: task.title ?? task.name,
        newDescription: task.description,
        newStateId: resolvedStateId,
        newPriority: task.priority,
        newAssigneeIds: task.assigneeIds,
        newLabelIds: task.labelIds,
        newStartDate: task.startDate,
        newTargetDate: task.dueDate ?? task.targetDate,
      }, { executionContext, signal, userText, projectId: resolvedTask.externalProjectId });
      const updatedTask = taskFromPlaneMcpResult(result);
      if (resolvedStateId) await this.verifyUpdatedState(resolvedTask, resolvedStateId, { executionContext, signal, userText, updatedTask });
      console.info(JSON.stringify({ event: 'updateWorkItem.success', requestId: executionContext?.requestId || null, workItemId: resolvedTask.externalId, matchedStateId: resolvedStateId }));
      return updatedTask;
    } catch (error) {
      console.error(JSON.stringify({ event: 'updateWorkItem.failed', requestId: executionContext?.requestId || null, workItemId: resolvedTask.externalId, matchedStateId: resolvedStateId, code: safePlaneErrorCode(error?.code) }));
      throw error;
    }
  }

  async verifyUpdatedState(resolvedTask, expectedStateId, { executionContext, signal, userText, updatedTask } = {}) {
    if (updatedTask?.status?.externalId === expectedStateId) return;
    const verified = await this.findTasks({ workItemId: resolvedTask.externalId }, {
      executionContext, signal, userText, projectId: resolvedTask.externalProjectId,
    });
    if (verified.length === 1 && verified[0].status?.externalId === expectedStateId) return;
    throw new WorkManagementError('WORK_STATUS_UPDATE_UNVERIFIED', 'Plane did not confirm the requested task status after update.', 502);
  }

  async deleteTask(taskId, changes, { executionContext, signal, userText } = {}) {
    const externalTaskId = requireExternalPlaneId(taskId, 'WORK_TASK_ID_REQUIRED', 'A task identifier is required.');
    const requestedProjectId = changes?.projectId ?? changes?.externalProjectId;
    const resolvedTask = await this.resolveTask(externalTaskId, requestedProjectId, { executionContext, signal, userText });
    const result = await this.call('deleteTask', 'plane__delete_work_item', {
      workItemId: resolvedTask.externalId,
      confirm: true,
      confirmationPhrase: 'DELETE',
    }, { executionContext, signal, userText, projectId: resolvedTask.externalProjectId });
    return planePayload(result, 'delete confirmation');
  }

  async resolveTask(taskId, requestedProjectId, { executionContext, signal, userText } = {}) {
    const projects = await this.listProjects({ executionContext, signal, userText });
    const requested = requestedProjectId == null ? null : requireExternalPlaneId(requestedProjectId, 'PLANE_PROJECT_CONTEXT_REQUIRED', 'Resolve the Plane work item project before changing it.');
    const candidateProjectIds = requested ? [requested] : projects.map((project) => project.externalId);
    if (requested && !projects.some((project) => project.externalId === requested)) {
      throw new WorkManagementError('PLANE_PROJECT_NOT_FOUND', 'The specified Plane project is not available to this account.', 404);
    }
    for (const projectId of candidateProjectIds) {
      const matches = await this.findTasks({ workItemId: taskId }, { executionContext, signal, userText, projectId });
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) throw new WorkManagementError('WORK_PROVIDER_INVALID_RESPONSE', 'Plane returned ambiguous work-item data.', 502);
    }
    throw new WorkManagementError('PLANE_WORK_ITEM_NOT_FOUND', 'The Plane work item was not found in a project available to this account.', 404);
  }

  async call(operation, toolName, arguments_, { executionContext, signal, userText, projectId } = {}) {
    const trustedContext = requireTrustedExecutionContext(executionContext);
    const effectiveProjectId = projectId == null ? null : requireExternalPlaneId(projectId, 'PLANE_PROJECT_CONTEXT_REQUIRED', 'Resolve the Plane work item project before changing it.');
    const scopedContext = effectiveProjectId ? { ...trustedContext, planeEffectiveProjectId: effectiveProjectId } : trustedContext;
    const startedAt = Date.now();
    console.info(JSON.stringify({ event: 'plane_mcp.call.started', requestId: trustedContext.requestId || null, userId: safeUserId(trustedContext.userId), operation, tool: toolName, ...(effectiveProjectId ? { effectiveProjectId } : {}) }));
    try {
      const result = await this.toolRegistry.execute(toolName, arguments_, userText, signal, scopedContext);
      if (!result?.success) providerFailure(operation, result);
      console.info(JSON.stringify({ event: 'plane_mcp.call.success', requestId: trustedContext.requestId || null, userId: safeUserId(trustedContext.userId), operation, tool: toolName, durationMs: Date.now() - startedAt }));
      return result.result;
    } catch (error) {
      console.error(JSON.stringify({ event: 'plane_mcp.call.failed', requestId: trustedContext.requestId || null, userId: safeUserId(trustedContext.userId), operation, tool: toolName, code: safePlaneErrorCode(error?.code), durationMs: Date.now() - startedAt }));
      throw error;
    }
  }
}

/** Business-level facade used by future agent tools and HTTP/domain callers. */
export class WorkManagementService {
  constructor(provider) {
    if (!provider) throw new Error('WorkManagementService requires a provider');
    this.provider = provider;
  }

  async getProjectTasks(criteria, options) {
    return this.provider.findTasks(criteria, options);
  }

  async getTasks(criteria, options) {
    return this.getProjectTasks(criteria, options);
  }

  async getMyTasks(criteria = {}, options = {}) {
    const trustedContext = requireTrustedExecutionContext(options.executionContext);
    console.info(JSON.stringify({ event: 'plane_provider.get_my_tasks.started', requestId: trustedContext.requestId || null, userId: safeUserId(trustedContext.userId) }));
    if (typeof this.provider.resolveMyMember !== 'function') throw new WorkManagementError('PLANE_IDENTITY_NOT_RESOLVED', 'The connected Plane account has no usable member mapping.', 400);
    const planeMemberId = await this.provider.resolveMyMember(options);
    return this.provider.findTasks({ ...criteria, assigneeId: planeMemberId }, options);
  }

  async getOverdueTasks(criteria = {}, options = {}) {
    const tasks = await this.getProjectTasks({ ...criteria, isDraft: false }, options);
    const now = Date.now();
    return tasks.filter((task) => task.dueDate && Date.parse(task.dueDate) < now && !['completed', 'cancelled'].includes(task.status?.category));
  }

  async getProjectProgress(criteria = {}, options = {}) {
    const tasks = await this.getProjectTasks({ ...criteria, isDraft: false }, options);
    const completed = tasks.filter((task) => task.status?.category === 'completed').length;
    return { totalTasks: tasks.length, completedTasks: completed, progressPercent: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 };
  }

  async getTeamWorkload(criteria = {}, options = {}) {
    const tasks = await this.getProjectTasks({ ...criteria, isDraft: false }, options);
    const workload = new Map();
    for (const task of tasks) for (const member of task.assignees) {
      const current = workload.get(member.id) ?? { member, taskCount: 0, overdueTaskCount: 0 };
      current.taskCount += 1;
      if (task.dueDate && Date.parse(task.dueDate) < Date.now() && !['completed', 'cancelled'].includes(task.status?.category)) current.overdueTaskCount += 1;
      workload.set(member.id, current);
    }
    return [...workload.values()];
  }

  async getProjects(options) {
    return this.provider.listProjects(options);
  }

  async getProjectStatuses(projectId, options) {
    return this.provider.listProjectStates(projectId, options);
  }

  async getProjectMembers(projectId, options) {
    return this.provider.listProjectMembers(projectId, options);
  }

  async createTask(input, options) {
    return this.provider.createTask(input, options);
  }

  async updateTask(taskId, changes, options) {
    return this.provider.updateTask(taskId, changes, options);
  }

  async deleteTask(taskId, changes, options) {
    return this.provider.deleteTask(taskId, changes, options);
  }
}

export { withoutModelControlledContext, requireTrustedExecutionContext };
