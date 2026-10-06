import { config } from './config.js';
import { GeminiClient } from './geminiClient.js';

const SYSTEM = `You are the project assistant. Use available tools when they are needed. Never invent tool results. Explain tool failures briefly and safely. If the user names a platform or MCP server, it is a hard target: never substitute another server. If that target is unavailable, report it clearly and do not perform the operation elsewhere. For an HRM request about the authenticated user themself ("my information", "my profile", "about me", or equivalent Vietnamese phrasing), use get_my_profile; never use list_employees for that intent. For the minimal HRM learning slice, use get_employee_profile only with a known employeeId. Never put a person's name into employeeId. When the user asks for a named employee and search_employees is available, call search_employees with that name. If it returns exactly one employee, call get_employee_profile with that result's id. If it returns several employees, ask the user to choose from the returned candidates; if none, say that no employee was found.

For a Plane task status-change request, complete the mutation in this same turn. Resolve the project and task, call get_project_statuses for that task's project, match the requested label to exactly one status using its name/category, then call update_task with taskId, projectId, and that status externalId in statusId. Do not stop or answer success after get_project_statuses. The active-work labels "đang thực hiện", "đang làm", and "in progress" may match an actual In Progress name or a uniquely matching active/started group; never invent or hard-code a state UUID. Ask the user to choose only when more than one state matches. update_task verifies the update; report success only after it succeeds.

For an HRM leave-request preview, use preview_my_leave_request only after the user has supplied an explicit leave-type business code, dates, and requested days. The preview does not create leave. When it returns a confirmation instruction, show its safe preview and exact phrase to the user; never generate that confirmation phrase as if you were the user, never report the leave as created, and never call an execute or generic confirm tool.`;

function normalizeLabel(value) {
  return typeof value === 'string'
    ? value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/đ/g, 'd').replace(/\s+/g, ' ').trim()
    : '';
}

function statusChangeRequest(text) {
  if (typeof text !== 'string') return null;
  const match = /(?:đổi|chuyển|cập nhật|đặt)\s+(?:trạng thái|status)\s+(.+?)\s+(?:sang|thành|to)\s+(.+?)(?:[.!?]|$)/iu.exec(text);
  if (!match) return null;
  const taskName = match[1].trim();
  const requestedStatus = match[2].trim();
  return taskName && requestedStatus ? { taskName, requestedStatus } : null;
}

function resultItems(result) {
  const value = result?.result;
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.results)) return value.results;
  return [];
}

function matchingStatuses(statuses, requestedStatus) {
  const requested = normalizeLabel(requestedStatus);
  const activeAliases = new Set(['dang thuc hien', 'dang lam', 'in progress']);
  const acceptsActive = activeAliases.has(requested);
  const byName = statuses.filter((state) => activeAliases.has(requested)
    ? activeAliases.has(normalizeLabel(state?.name))
    : normalizeLabel(state?.name) === requested);
  const byGroup = acceptsActive
    ? statuses.filter((state) => ['started', 'in progress', 'in_progress'].includes(normalizeLabel(state?.category)))
    : [];
  return byName.length ? byName : byGroup;
}

function matchingTask(tasks, taskName) {
  const requested = normalizeLabel(taskName);
  const exact = tasks.filter((task) => normalizeLabel(task?.title) === requested);
  const partial = tasks.filter((task) => normalizeLabel(task?.title).includes(requested));
  const matches = exact.length ? exact : partial;
  return matches.length === 1 ? matches[0] : null;
}

function requiresUserConfirmation(value) {
  if (value == null) return false;
  if (typeof value === 'string') {
    try { return requiresUserConfirmation(JSON.parse(value)); } catch { return false; }
  }
  if (Array.isArray(value)) return value.some(requiresUserConfirmation);
  if (typeof value !== 'object') return false;
  if (value.confirmationRequired === true) return true;
  return Object.values(value).some(requiresUserConfirmation);
}

function leavePreviewConfirmationText(result) {
  const value = result?.result;
  const confirmationId = value?.confirmation?.id;
  const preview = value?.preview;
  if (value?.confirmationRequired !== true
    || typeof confirmationId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(confirmationId)
    || !preview || typeof preview !== 'object' || Array.isArray(preview)) return null;

  // Do not ask the model to restate a server-issued confirmation token. Keep
  // only the previously validated preview fields and derive the exact phrase
  // from the opaque ID held in the tool response.
  const safePreview = {};
  for (const key of ['leaveTypeCode', 'leaveTypeName', 'startDate', 'endDate', 'requestedDays', 'reason', 'remainingDaysBefore', 'remainingDaysAfter', 'hasConflict']) {
    const field = preview[key];
    if (field === null || typeof field === 'string' || typeof field === 'number' || typeof field === 'boolean') safePreview[key] = field;
  }
  if (!Object.keys(safePreview).length) return null;
  return `Leave request preview:\n${JSON.stringify(safePreview)}\n\nTo confirm this leave request, reply exactly: CONFIRM ${confirmationId}`;
}

export class AgentService {
  constructor(registry, gemini = new GeminiClient()) { this.registry = registry; this.gemini = gemini; }

  async run(conversation, mapping, signal, onText, executionContext = {}) {
    await this.registry.refresh(mapping.mcpServers, signal, executionContext);
    const messages = [{ role: 'user', parts: [{ text: SYSTEM }] }, ...this.toGeminiMessages(conversation.messages)];
    const latestUserMessage = [...conversation.messages].reverse().find((item) => item.role === 'user')?.text;
    const pendingStatusChange = statusChangeRequest(latestUserMessage);
    const workflow = { tasks: [], statusesByProject: new Map(), updateAttempted: false };
    const usage = {};
    const addUsage = (metadata) => {
      if (!metadata) return;
      for (const key of ['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount', 'thoughtsTokenCount']) {
        if (Number.isFinite(metadata[key])) usage[key] = (usage[key] || 0) + metadata[key];
      }
    };
    for (let iteration = 0; iteration < config.maxToolIterations; iteration += 1) {
      if (signal?.aborted) throw new DOMException('The request was aborted', 'AbortError');
      const response = await this.gemini.generate({ model: mapping.model, messages, tools: this.registry.definitions(), signal, onText });
      addUsage(response.usage);
      messages.push(response.content);
      if (!response.toolCalls.length) {
        const completion = await this.completePendingStatusChange(pendingStatusChange, workflow, latestUserMessage, signal, executionContext, conversation);
        if (completion) return { text: completion, usage: Object.keys(usage).length ? usage : null };
        return { text: response.text, usage: Object.keys(usage).length ? usage : null };
      }
      for (const call of response.toolCalls) {
        if (signal?.aborted) throw new DOMException('The request was aborted', 'AbortError');
        const result = await this.registry.execute(call.name, call.args ?? {}, latestUserMessage, signal, executionContext);
        this.recordStatusChangeToolResult(workflow, call, result);
        console.log(JSON.stringify({ event: 'agent.tool', conversationId: conversation.id, tool: call.name, success: result.success }));
        messages.push({ role: 'user', parts: [{ functionResponse: { name: call.name, response: result } }] });
        conversation.messages.push({ role: 'tool_result', name: call.name, text: JSON.stringify(result), createdAt: Date.now() });

        /** A destructive tool may first return a read-only preview. Stop the
         * current orchestration turn here so the model cannot approve its own
         * deletion by calling the same tool again before the user responds. */
        if (requiresUserConfirmation(result)) {
          const leavePreviewText = leavePreviewConfirmationText(result);
          if (leavePreviewText) return { text: leavePreviewText, usage: Object.keys(usage).length ? usage : null };
          const confirmationResponse = await this.gemini.generate({ model: mapping.model, messages, tools: [], signal, onText });
          addUsage(confirmationResponse.usage);
          return { text: confirmationResponse.text || 'Tôi đã tìm thấy kết quả phù hợp. Bạn có xác nhận thực hiện thao tác xóa không?', usage: Object.keys(usage).length ? usage : null };
        }
      }
    }
    const error = new Error('Agent loop limit reached'); error.statusCode = 508; throw error;
  }

  toGeminiMessages(history) {
    return history.slice(-config.contextMessageLimit).filter((item) => item.role === 'user' || item.role === 'assistant').map((item) => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.text }] }));
  }

  recordStatusChangeToolResult(workflow, call, result) {
    if (!result?.success) return;
    if (call.name === 'get_project_tasks') workflow.tasks.push(...resultItems(result));
    if (call.name === 'get_project_statuses' && typeof call.args?.projectId === 'string') {
      workflow.statusesByProject.set(call.args.projectId.replace(/^plane:/, ''), resultItems(result));
    }
    if (call.name === 'update_task') workflow.updateAttempted = true;
  }

  async completePendingStatusChange(request, workflow, userText, signal, executionContext, conversation) {
    if (!request || workflow.updateAttempted) return null;
    let task = matchingTask(workflow.tasks, request.taskName);
    if (!task) {
      const found = await this.registry.execute('get_project_tasks', { name: request.taskName }, userText, signal, executionContext);
      if (!found.success) return null;
      workflow.tasks.push(...resultItems(found));
      task = matchingTask(workflow.tasks, request.taskName);
    }
    if (!task?.externalId || !task?.externalProjectId) return null;
    const projectId = task.externalProjectId.replace(/^plane:/, '');
    let statuses = workflow.statusesByProject.get(projectId);
    if (!statuses) {
      const listed = await this.registry.execute('get_project_statuses', { projectId }, userText, signal, executionContext);
      if (!listed.success) return null;
      statuses = resultItems(listed);
      workflow.statusesByProject.set(projectId, statuses);
    }
    const states = matchingStatuses(statuses, request.requestedStatus);
    if (states.length > 1) {
      const choices = states.map((state) => state?.name || state?.externalId).filter(Boolean).join(', ');
      return `Có nhiều trạng thái khớp với “${request.requestedStatus}”: ${choices}. Bạn muốn chọn trạng thái nào?`;
    }
    const state = states[0];
    if (!state?.externalId) return null;
    console.info(JSON.stringify({
      event: 'agent.status_change.resolved', requestId: executionContext.requestId || null,
      requestedStatus: request.requestedStatus, matchedStateName: state.name ?? null,
      matchedStateId: state.externalId,
    }));
    workflow.updateAttempted = true;
    const update = await this.registry.execute('update_task', {
      taskId: task.externalId, projectId, statusId: state.externalId,
    }, userText, signal, executionContext);
    if (!update.success) return null;
    console.info(JSON.stringify({ event: 'agent.status_change.completed', requestId: executionContext.requestId || null, workItemId: task.externalId, matchedStateId: state.externalId }));
    conversation.messages.push({ role: 'tool_result', name: 'update_task', text: JSON.stringify(update), createdAt: Date.now() });
    return `Đã đổi trạng thái “${task.title || request.taskName}” sang “${state.name || request.requestedStatus}”.`;
  }
}
