// Loaded only by the isolated Chat Backend E2E process. Inspect model payloads
// without printing text, fixture rows, provider credentials or session tokens.
const nativeFetch = globalThis.fetch;
function findValue(value, key, depth = 0) {
  if (depth > 12 || value == null) return undefined;
  if (typeof value === 'string') {
    try { return findValue(JSON.parse(value), key, depth + 1); } catch { return undefined; }
  }
  if (typeof value !== 'object') return undefined;
  if (Object.hasOwn(value, key)) return value[key];
  for (const child of Object.values(value)) {
    const found = findValue(child, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname !== 'generativelanguage.googleapis.com') return nativeFetch(input, init);
  const expectedModel = process.env.DQE_E2E_MODEL;
  if (!expectedModel) throw new Error('E2E payload guard requires DQE_E2E_MODEL.');
  if (decodeURIComponent(url.pathname) !== `/v1beta/models/${expectedModel}:streamGenerateContent`) throw new Error('E2E payload guard found an unexpected Gemini model endpoint.');
  const body = JSON.parse(String(init?.body ?? '{}'));
  // The normal AgentService includes a broad product prompt and all HRM tools.
  // This isolated test sends only its fixture question, DQE schema, and the
  // DQE tool exchange to the external provider.
  if (!Array.isArray(body.contents) || body.contents[0]?.parts?.[0]?.text?.startsWith('You are the project assistant.') !== true) {
    throw new Error('E2E payload guard expected the standard AgentService prompt.');
  }
  body.contents = body.contents.slice(1);
  const definitions = body.tools?.flatMap((tool) => tool.functionDeclarations ?? []) ?? [];
  const dqe = definitions.filter((tool) => tool.name === 'hrm__query_hrm_data');
  if (dqe.length !== 1) throw new Error('E2E payload guard expected one DQE schema.');
  body.tools = [{ functionDeclarations: dqe }];
  for (const content of body.contents) {
    for (const part of content.parts ?? []) {
      if (!part.functionResponse) continue;
      const response = part.functionResponse.response;
      const code = findValue(response, 'code');
      if (code !== 'HRM_FORBIDDEN') throw new Error('E2E payload guard found an unexpected aggregate result.');
      part.functionResponse.response = { success: false, error: { code } };
    }
  }
  const serialized = JSON.stringify(body);
  const forbidden = [process.env.DATABASE_URL, process.env.DB_PASSWORD, process.env.HRM_INTERNAL_TOKEN, process.env.MCP_INTERNAL_TOKEN, process.env.E2E_FORBIDDEN_PASSWORD, process.env.GOOGLE_KEY].filter(Boolean);
  if (forbidden.some((value) => serialized.includes(value)) || /postgres(?:ql)?:\/\/|project_session|session_token_hash/i.test(serialized)) {
    throw new Error('E2E payload guard blocked a credential or session value.');
  }
  const emails = serialized.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  if (emails.some((email) => !email.endsWith('@example.invalid'))) throw new Error('E2E payload guard blocked an unexpected email address.');
  const parts = body.contents?.flatMap((content) => content.parts ?? []) ?? [];
  const textParts = body.contents.filter((content) => content.role === 'user').flatMap((content) => content.parts ?? []).map((part) => part.text).filter((value) => typeof value === 'string');
  const allowedQuestions = JSON.parse(process.env.E2E_ALLOWED_QUESTIONS ?? '[]');
  if (!allowedQuestions.some((question) => textParts.includes(question)) || textParts.some((part) => !allowedQuestions.includes(part))
    || body.contents.some((content) => content.role !== 'user' && content.role !== 'model'
      && !(content.role === undefined && content.parts?.some((part) => part.functionCall?.name === 'hrm__query_hrm_data')))) throw new Error('E2E payload guard found unapproved prompt text.');
  const toolCount = body.tools?.flatMap((tool) => tool.functionDeclarations ?? []).length ?? 0;
  if (toolCount !== 1) throw new Error('E2E payload guard found unexpected tool schemas.');
  if (parts.some((part) => part.functionCall && part.functionCall.name !== 'hrm__query_hrm_data') || parts.some((part) => part.functionResponse && part.functionResponse.name !== 'hrm__query_hrm_data')) throw new Error('E2E payload guard found an unexpected tool exchange.');
  const functionResponses = parts.filter((part) => part.functionResponse).length;
  if (functionResponses > 1) throw new Error('E2E payload guard found unexpected extra tool responses.');
  console.log(JSON.stringify({ event: 'gemini.payload.inspected', model: expectedModel, contentCount: body.contents?.length ?? 0, toolSchemaCount: toolCount, functionResponses, allowedQuestionPresent: true, credentialOrRealEmailPresent: false }));
  if (process.env.E2E_DRY_RUN === 'true') {
    const response = functionResponses === 0
      ? { candidates: [{ content: { parts: [{ functionCall: { name: 'hrm__query_hrm_data', args: { query: { dataset: 'employees', filters: [{ field: 'employment_status', operator: 'eq', value: 'active' }], aggregations: [{ function: 'count', alias: 'total' }] } } } }] } }] }
      : { candidates: [{ content: { parts: [{ text: 'Không thể cung cấp số liệu tổng hợp này.' }] } }] };
    return new Response(`data: ${JSON.stringify(response)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  const providerResponse = await nativeFetch(input, { ...init, body: JSON.stringify(body) });
  if (providerResponse.status === 429) { const error = new Error('Gemini provider quota (HTTP 429)'); error.statusCode = 429; throw error; }
  return providerResponse;
};
