const SCOPE_VALUE = /^[A-Za-z0-9_-]{1,128}$/;

export class PlaneScopeError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}

export function normalizePlaneScope(input = {}) {
  const workspaceSlug = typeof input.workspaceSlug === 'string' ? input.workspaceSlug.trim() : '';
  const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
  if (!SCOPE_VALUE.test(workspaceSlug) || !SCOPE_VALUE.test(projectId)) {
    throw new PlaneScopeError('PLANE_SCOPE_INVALID', 'Select a valid Plane workspace and project.');
  }
  return { workspaceSlug, projectId };
}

function textPayload(result) {
  const text = result?.content?.find((item) => item?.type === 'text' && typeof item.text === 'string')?.text;
  try { return JSON.parse(text); } catch { throw new PlaneScopeError('PLANE_SCOPE_VALIDATION_FAILED', 'Plane project scope could not be validated.', 502); }
}

function throwPlaneMcpError(result) {
  const payload = textPayload(result);
  const code = payload?.error?.code;
  if (code === 'PLANE_AUTH_REQUIRED') throw new PlaneScopeError('PLANE_REAUTH_REQUIRED', 'Plane authorization is invalid or expired; reconnect is required.', 401);
  if (code === 'PLANE_OAUTH_SCOPE_REQUIRED') throw new PlaneScopeError('PLANE_OAUTH_SCOPE_REQUIRED', 'Plane OAuth needs an additional scope; reconnect Plane.', 403);
  if (code === 'PLANE_FORBIDDEN') throw new PlaneScopeError('PLANE_FORBIDDEN', 'Plane denied access to this workspace.', 403);
  if (code === 'PLANE_PROJECT_NOT_FOUND') throw new PlaneScopeError('PLANE_PROJECT_NOT_FOUND', 'The configured Plane project was not found or is unavailable.', 404);
  if (code === 'PLANE_UNAVAILABLE') throw new PlaneScopeError('PLANE_UNAVAILABLE', 'The Plane provider is unavailable.', 503);
  return payload;
}

export function projectsFromScopeResult(result) {
  const payload = throwPlaneMcpError(result);
  const projects = Array.isArray(payload) ? payload : payload?.results;
  if (!Array.isArray(projects)) throw new PlaneScopeError('PLANE_SCOPE_VALIDATION_FAILED', 'Plane project scope could not be validated.', 502);
  return projects.map((project) => ({ id: String(project?.id ?? ''), name: typeof project?.name === 'string' ? project.name : '' })).filter((project) => SCOPE_VALUE.test(project.id));
}

/** Backend-only scope discovery and validation. The browser never supplies headers. */
export class PlaneScopeService {
  constructor(client, integrations, credentialService = null) { if (!client || !integrations) throw new Error('PlaneScopeService requires MCP client and integrations.'); this.client = client; this.integrations = integrations; this.credentialService = credentialService; }

  async listProjects(userId, workspaceSlug) {
    if (typeof workspaceSlug !== 'string' || !SCOPE_VALUE.test(workspaceSlug.trim())) throw new PlaneScopeError('PLANE_SCOPE_INVALID', 'Provide a valid Plane workspace.');
    let integration = await this.integrations.getIntegration(userId, 'plane');
    if (!integration?.accessToken) throw new PlaneScopeError('PLANE_NOT_CONNECTED', 'Plane account is not connected for this user.');
    let credential = integration.accessToken;
    let authType = integration.credentialType === 'oauth' ? 'oauth' : 'pat';
    if (this.credentialService) {
      const resolved = await this.credentialService.resolve(userId, { operation: 'plane.list_projects', workspaceSlug: workspaceSlug.trim() });
      integration = resolved.integration;
      credential = resolved.credential;
      authType = resolved.authType;
    }
    try {
      const result = await this.client.callTool('list_projects', {}, undefined, {
        'x-mcp-user-id': String(userId), 'x-plane-credential': credential,
        'x-plane-auth-type': authType,
        'x-plane-workspace': workspaceSlug.trim(),
      });
      return projectsFromScopeResult(result);
    } catch (error) {
      if (error instanceof PlaneScopeError) throw error;
      throw new PlaneScopeError('PLANE_SCOPE_VALIDATION_FAILED', 'Plane workspace could not be validated.', 502);
    }
  }

  async saveScope(userId, input) {
    const scope = normalizePlaneScope(input);
    const projects = await this.listProjects(userId, scope.workspaceSlug);
    const project = projects.find((item) => item.id === scope.projectId);
    if (!project) throw new PlaneScopeError('PLANE_SCOPE_FORBIDDEN', 'The selected Plane project is not available in this workspace.', 403);
    const integration = await this.integrations.getIntegration(userId, 'plane');
    return this.integrations.saveIntegration(userId, 'plane', {
      workspaceSlug: scope.workspaceSlug,
      metadata: { ...(integration?.metadata ?? {}), defaultProjectId: project.id, defaultProjectName: project.name || null },
    });
  }

  /**
   * Mutations must never use a saved project blindly.  A user can lose access
   * or a project can be deleted between selecting it and the next task edit.
   * Clear only this user's stale default; never substitute another user's or
   * process-wide project.
   */
  async validateDefaultProject(userId, integration = null) {
    const current = integration ?? await this.integrations.getIntegration(userId, 'plane');
    const workspaceSlug = current?.workspaceSlug;
    const defaultProjectId = current?.metadata?.defaultProjectId;
    if (!workspaceSlug || !SCOPE_VALUE.test(workspaceSlug) || !defaultProjectId || !SCOPE_VALUE.test(String(defaultProjectId))) {
      throw new PlaneScopeError('PLANE_SCOPE_REQUIRED', 'Select a Plane workspace and project before changing work items.');
    }
    const projects = await this.listProjects(userId, workspaceSlug);
    if (projects.some((project) => project.id === defaultProjectId)) return { workspaceSlug, defaultProjectId, projects };
    const metadata = { ...(current.metadata ?? {}) };
    delete metadata.defaultProjectId;
    delete metadata.defaultProjectName;
    await this.integrations.saveIntegration(userId, 'plane', { workspaceSlug, metadata });
    throw new PlaneScopeError('PLANE_SCOPE_STALE', 'Your selected Plane project is no longer available. Select and save a project again.', 409);
  }
}
