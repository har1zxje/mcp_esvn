/**
 * Small typed wrapper for the current HrmMCPServer capability surface.
 *
 * It is intentionally not registered as a cross-domain aggregator: Plane and
 * HRM identities have no approved mapping. Callers must supply only trusted
 * Backend execution context; HRM tool arguments never select the actor or
 * company.
 */
export class HrmMcpService {
  constructor(client) {
    if (!client) throw new Error('HrmMcpService requires an MCP client.');
    this.client = client;
  }

  getMyProfile(options = {}) { return this.call('get_my_profile', {}, options); }
  getMyTeam(options = {}) { return this.call('get_my_team', {}, options); }
  findEmployee(query, options = {}) { return this.call('find_employee', { query }, options); }
  getMyAttendance(from, to, options = {}) { return this.call('get_my_attendance', { from, to }, options); }
  getTeamAttendance(from, to, options = {}) { return this.call('get_team_attendance', { from, to }, options); }

  async call(name, args, options = {}) {
    const context = options.executionContext;
    if (!context?.userId || !context?.requestId) {
      throw Object.assign(new Error('Authenticated HRM context is required.'), { code: 'HRM_COMPANY_REQUIRED' });
    }
    const result = await this.client.callTool(name, args, options.signal, {
      'x-mcp-user-id': context.userId,
      'x-mcp-request-id': context.requestId,
    });
    const text = result?.content?.find((item) => item.type === 'text')?.text;
    try {
      const payload = JSON.parse(text);
      if (payload?.error?.code) throw Object.assign(new Error('HRM MCP returned an error.'), { code: payload.error.code });
      if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'data')) throw new Error('Invalid HRM result.');
      return payload.data;
    } catch (error) {
      const safeCodes = new Set(['HRM_UNAUTHENTICATED', 'HRM_IDENTITY_NOT_LINKED', 'HRM_COMPANY_REQUIRED', 'HRM_COMPANY_FORBIDDEN', 'HRM_RESOURCE_NOT_FOUND', 'HRM_FORBIDDEN', 'HRM_NOT_FOUND', 'HRM_VALIDATION_FAILED', 'HRM_CONFLICT', 'HRM_UNAVAILABLE']);
      throw Object.assign(new Error('HRM response is unavailable.'), { code: safeCodes.has(error?.code) ? error.code : 'HRM_UNAVAILABLE' });
    }
  }
}
