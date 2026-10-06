const TASK_PRIORITIES = new Set(['none', 'urgent', 'high', 'medium', 'low']);

export class WorkManagementModelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkManagementModelError';
    this.code = 'WORK_PROVIDER_INVALID_RESPONSE';
    this.statusCode = 502;
  }
}

function value(object, ...keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object?.[key] !== null) return object[key];
  }
  return null;
}

function normalizeMember(member) {
  if (typeof member === 'string') return { id: `plane:${member}`, externalId: member, name: null, email: null };
  if (!member || typeof member !== 'object') return null;
  const externalId = value(member, 'id', 'member_id', 'user_id');
  if (externalId === null) return null;
  return {
    id: `plane:${externalId}`,
    externalId: String(externalId),
    name: value(member, 'display_name', 'name', 'username'),
    email: value(member, 'email'),
  };
}

/** Provider-neutral Project model mapper, ready for future project discovery. */
export function projectFromPlaneProject(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new WorkManagementModelError('Plane returned an invalid project.');
  }
  const externalId = value(project, 'id');
  if (externalId === null || String(externalId).trim() === '') {
    throw new WorkManagementModelError('Plane returned a project without an identifier.');
  }
  return {
    id: `plane:${externalId}`,
    externalId: String(externalId),
    provider: 'plane',
    name: String(value(project, 'name') ?? ''),
    description: value(project, 'description'),
    status: normalizeStatus(value(project, 'state')),
    startDate: value(project, 'start_date', 'startDate'),
    dueDate: value(project, 'target_date', 'due_date', 'dueDate'),
  };
}

export function memberFromPlaneMember(member) {
  const normalized = normalizeMember(member);
  if (!normalized) throw new WorkManagementModelError('Plane returned an invalid member.');
  return { ...normalized, provider: 'plane' };
}

export function assignmentFromPlaneAssignee(assignee, taskExternalId) {
  if (typeof taskExternalId !== 'string' || !taskExternalId.trim()) {
    throw new WorkManagementModelError('A task identifier is required for an assignment.');
  }
  const member = memberFromPlaneMember(assignee);
  return {
    id: `plane:${taskExternalId}:${member.externalId}`,
    provider: 'plane',
    taskId: `plane:${taskExternalId}`,
    externalTaskId: taskExternalId,
    memberId: member.id,
    externalMemberId: member.externalId,
  };
}

function normalizeStatus(state) {
  if (typeof state === 'string') return { id: state, externalId: state, name: null, category: null };
  if (!state || typeof state !== 'object') return null;
  const externalId = value(state, 'id');
  return {
    id: externalId === null ? null : `plane:${externalId}`,
    externalId: externalId === null ? null : String(externalId),
    name: value(state, 'name'),
    category: value(state, 'group', 'type'),
  };
}

export function taskFromPlaneWorkItem(workItem) {
  if (!workItem || typeof workItem !== 'object' || Array.isArray(workItem)) {
    throw new WorkManagementModelError('Plane returned an invalid work item.');
  }
  const externalId = value(workItem, 'id');
  if (externalId === null || String(externalId).trim() === '') {
    throw new WorkManagementModelError('Plane returned a work item without an identifier.');
  }
  const project = value(workItem, 'project');
  const projectExternalId = value(workItem, 'project_id') ?? (project && typeof project === 'object' ? value(project, 'id') : project);
  const rawAssignees = Array.isArray(workItem.assignees) ? workItem.assignees : [];
  const rawPriority = String(value(workItem, 'priority') ?? 'none').toLowerCase();
  return {
    id: `plane:${externalId}`,
    externalId: String(externalId),
    provider: 'plane',
    projectId: projectExternalId === null ? null : `plane:${projectExternalId}`,
    externalProjectId: projectExternalId === null ? null : String(projectExternalId),
    title: String(value(workItem, 'name') ?? ''),
    description: value(workItem, 'description_stripped', 'description_html', 'description'),
    assignees: rawAssignees.map(normalizeMember).filter(Boolean),
    status: normalizeStatus(value(workItem, 'state')),
    priority: TASK_PRIORITIES.has(rawPriority) ? rawPriority : 'none',
    startDate: value(workItem, 'start_date', 'startDate'),
    dueDate: value(workItem, 'target_date', 'due_date', 'dueDate'),
    createdAt: value(workItem, 'created_at', 'createdAt'),
    updatedAt: value(workItem, 'updated_at', 'updatedAt'),
  };
}

export function parsePlaneMcpResult(result) {
  const text = result?.content?.find((item) => item?.type === 'text' && typeof item.text === 'string')?.text;
  if (!text) throw new WorkManagementModelError('Plane returned no readable work-item data.');
  try {
    return JSON.parse(text);
  } catch {
    throw new WorkManagementModelError('Plane returned malformed work-item data.');
  }
}

export function tasksFromPlaneMcpResult(result) {
  const payload = parsePlaneMcpResult(result);
  const items = Array.isArray(payload) ? payload : payload?.results;
  if (!Array.isArray(items)) throw new WorkManagementModelError('Plane returned an invalid work-item list.');
  return items.map(taskFromPlaneWorkItem);
}

export function taskFromPlaneMcpResult(result) {
  return taskFromPlaneWorkItem(parsePlaneMcpResult(result));
}

function listPayload(result, label) {
  const payload = parsePlaneMcpResult(result);
  const items = Array.isArray(payload) ? payload : payload?.results;
  if (!Array.isArray(items)) throw new WorkManagementModelError(`Plane returned an invalid ${label} list.`);
  return items;
}

export function projectsFromPlaneMcpResult(result) {
  return listPayload(result, 'project').map(projectFromPlaneProject);
}

export function membersFromPlaneMcpResult(result) {
  return listPayload(result, 'member').map(memberFromPlaneMember);
}

export function statusesFromPlaneMcpResult(result) {
  return listPayload(result, 'state').map((state) => {
    const normalized = normalizeStatus(state);
    if (!normalized?.externalId) throw new WorkManagementModelError('Plane returned a state without an identifier.');
    return { ...normalized, provider: 'plane' };
  });
}
