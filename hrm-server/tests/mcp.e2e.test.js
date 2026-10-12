import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import net from 'node:net';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../src/database.js';
import { createHrmService, createServer } from '../src/app.js';

const integration = process.env.TEST_DATABASE_URL && process.env.DQE_TEST_DATABASE_URL && process.env.MCP_E2E_DLL ? test : test.skip;
const e2eModel = process.env.DQE_E2E_MODEL ?? 'gemini-3.5-flash-lite';
if (!['gemini-2.5-flash', 'gemini-3.5-flash-lite'].includes(e2eModel)) throw new Error('DQE_E2E_MODEL must be an approved Gemini E2E model.');

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function runChatHttpE2E({ suffix, company, department, role, db, api, mcpPort, mcpToken, hrmToken, observedQueries }) {
  assert.equal(new URL(process.env.CHAT_TEST_DATABASE_URL).pathname, '/chat_dqe_e2e_test');
  const chatDb = createDatabase(process.env.CHAT_TEST_DATABASE_URL);
  const backendPort = await freePort();
  const question = 'Công ty tôi có bao nhiêu nhân viên đang làm việc?';
  const deniedQuestion = 'Hãy dùng query_hrm_data để đếm toàn bộ nhân viên đang làm việc của công ty tôi.';
  const authPassword = randomBytes(24).toString('base64url');
  const chatUrl = new URL(process.env.CHAT_TEST_DATABASE_URL);
  const backend = spawn(process.execPath, [
    '--import', new URL('./geminiPayloadGuard.mjs', import.meta.url).href,
    fileURLToPath(new URL('../../be/src/server.js', import.meta.url)),
  ], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: chatUrl.href, DB_HOST: chatUrl.hostname, DB_PORT: String(chatUrl.port || 5432), DB_NAME: 'chat_dqe_e2e_test', DB_USER: chatUrl.username, DB_PASSWORD: chatUrl.password,
      PORT: String(backendPort), HOST: '127.0.0.1', NODE_ENV: 'production',
      DQE_E2E_MODEL: e2eModel,
      CHAT_DEFAULT_MODEL_ID: 'dqe_e2e', CHAT_MODEL_MAP_JSON: JSON.stringify({ dqe_e2e: { label: 'DQE E2E', agentId: 'dqe-e2e', provider: 'google', model: e2eModel } }),
      MCP_SERVERS_JSON: JSON.stringify({ hrm: { url: `http://127.0.0.1:${mcpPort}/mcp`, transport: 'streamable-http' } }), MCP_ENABLED_SERVERS: 'hrm', MCP_INTERNAL_TOKEN: mcpToken,
      HRM_API_BASE_URL: `http://127.0.0.1:${api.address().port}`, HRM_INTERNAL_TOKEN: hrmToken,
      INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      E2E_ALLOWED_QUESTIONS: JSON.stringify([question, deniedQuestion]), E2E_FORBIDDEN_PASSWORD: authPassword,
    },
  });
  const events = [];
  const startupErrors = [];
  const capture = (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      try { const event = JSON.parse(line); if (event.event) events.push({ event: event.event, status: event.status ?? null, code: event.code ?? null, tool: event.tool ?? null }); }
      catch {
        if (/error|failed|exception|cannot|denied/i.test(line)) startupErrors.push(line.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database-url-redacted]').replace(/key=[^\s&]+/gi, 'key=[redacted]').slice(0, 300));
      }
    }
  };
  backend.stdout.on('data', capture);
  backend.stderr.on('data', capture);
  const users = [];
  const fixtureEmployees = [];
  const base = `http://127.0.0.1:${backendPort}`;
  const register = async (index) => {
    const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `dqe-chat-${index}-${suffix}@example.invalid`, password: authPassword, displayName: `Fixture Chat User ${index}` }) });
    assert.equal(response.status, 201);
    const user = (await response.json()).user;
    users.push(user.id);
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie?.startsWith('project_session='));
    return { user, cookie };
  };
  const ask = async (cookie, text) => {
    const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ modelId: 'dqe_e2e', mcpServers: ['hrm'], message: text }), signal: AbortSignal.timeout(60000) });
    const body = await response.text();
    const events = body.split(/\r?\n\r?\n/).map((block) => block.split(/\r?\n/).find((line) => line.startsWith('data:'))?.slice(5).trim()).filter(Boolean).filter((line) => line !== '[DONE]').map((line) => JSON.parse(line));
    return { status: response.status, final: events.findLast((event) => event.conversation) ?? null, eventTypes: events.map((event) => ({ type: event.type ?? event.event ?? null, code: event.code ?? event.error?.code ?? null })) };
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { const response = await fetch(`${base}/health`); if (response.ok) { ready = true; break; } }
      catch { /* Wait for isolated backend startup. */ }
      if (backend.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.equal(ready, true, `Isolated Chat Backend did not start (exit ${backend.exitCode}): ${startupErrors.slice(-4).join(' | ')}`);
    const manager = await register(0);
    const managerEmployee = `mcp-dqe-chat-manager-${suffix}`;
    fixtureEmployees.push(managerEmployee);
    await db.query('INSERT INTO employees (id,company_id,department_id,email,display_name,title,employment_status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [managerEmployee, company, department, `${managerEmployee}@example.invalid`, 'Fixture Manager', 'Tester', 'active']);
    await db.query('INSERT INTO employee_roles (company_id,employee_id,role_id) VALUES ($1,$2,$3)', [company, managerEmployee, role]);
    await db.query('INSERT INTO hrm_identity_links (company_id,chat_user_id,employee_id) VALUES ($1,$2,$3)', [company, manager.user.id, managerEmployee]);
    const expectedCount = Number((await db.query("SELECT count(*) AS total FROM employees WHERE company_id=$1 AND employment_status='active'", [company])).rows[0].total);
    assert.equal(expectedCount, 3);
    const valid = await ask(manager.cookie, question);
    assert.equal(valid.status, 200);
    assert.ok(valid.final, `Chat response did not finish. Backend event codes: ${events.map((event) => event.code ?? event.event).slice(-8).join(', ')}; HTTP events: ${JSON.stringify(valid.eventTypes)}; queries: ${JSON.stringify(observedQueries.slice(-2))}`);
    const validTool = valid.final.conversation.messages.filter((message) => message.role === 'tool_result');
    const managerDqe = validTool.find((message) => message.name === 'hrm__query_hrm_data');
    assert.ok(managerDqe, `Gemini selected: ${validTool.map((message) => message.name).join(', ')}`);
    assert.equal(JSON.parse(managerDqe.text).error.code, 'HRM_FORBIDDEN');
    assert.doesNotMatch(valid.final.text, /\b3\b/u);
    const managerQueries = observedQueries.filter((entry) => entry.actor === manager.user.id);
    assert.ok(managerQueries.some((entry) => entry.query.dataset === 'employees' && entry.query.filters?.some((filter) => filter.field === 'employment_status' && filter.operator === 'eq' && filter.value === 'active') && entry.query.aggregations?.some((aggregation) => aggregation.function === 'count')));
    console.log(JSON.stringify({ event: 'chat.agent.dqe.privacy_denied.pass', httpStatus: valid.status, selectedTool: 'hrm__query_hrm_data', errorCode: 'HRM_FORBIDDEN', independentFixtureCount: expectedCount, answer: valid.final.text }));

    const restricted = await register(1);
    const restrictedEmployee = `mcp-dqe-chat-restricted-${suffix}`;
    fixtureEmployees.push(restrictedEmployee);
    await db.query('INSERT INTO employees (id,company_id,department_id,email,display_name,title,employment_status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [restrictedEmployee, company, department, `${restrictedEmployee}@example.invalid`, 'Fixture Restricted', 'Tester', 'active']);
    await db.query('INSERT INTO hrm_identity_links (company_id,chat_user_id,employee_id) VALUES ($1,$2,$3)', [company, restricted.user.id, restrictedEmployee]);
    const denied = await ask(restricted.cookie, deniedQuestion);
    assert.equal(denied.status, 200);
    assert.ok(denied.final, `Restricted chat did not finish. Backend event codes: ${events.map((event) => event.code ?? event.event).slice(-8).join(', ')}`);
    const deniedTools = denied.final.conversation.messages.filter((message) => message.role === 'tool_result');
    const deniedDqe = deniedTools.find((message) => message.name === 'hrm__query_hrm_data');
    assert.ok(deniedDqe, `Gemini selected: ${deniedTools.map((message) => message.name).join(', ')}`);
    assert.equal(JSON.parse(deniedDqe.text).error.code, 'HRM_FORBIDDEN');
    assert.doesNotMatch(denied.final.text, /\b4\b/u);
    const inspected = events.filter((event) => event.event === 'gemini.payload.inspected');
    assert.ok(inspected.length >= 2, 'Gemini payload guard did not inspect both conversations.');
    console.log(JSON.stringify({ event: 'chat.agent.dqe.denied.pass', httpStatus: denied.status, selectedTool: 'hrm__query_hrm_data', errorCode: 'HRM_FORBIDDEN', inspectedModelRequests: inspected.length, answer: denied.final.text }));
  } finally {
    backend.kill();
    await new Promise((resolve) => { if (backend.exitCode !== null) resolve(); else { backend.once('exit', resolve); setTimeout(resolve, 2000); } });
    for (const employee of fixtureEmployees) await db.query('DELETE FROM employees WHERE company_id=$1 AND id=$2', [company, employee]).catch(() => {});
    for (const user of users) await chatDb.query('DELETE FROM users WHERE id=$1', [user]).catch(() => {});
    await chatDb.close();
  }
}

integration('real MCP initialize, tools/list, scoped list and aggregate privacy denial', { timeout: process.env.RUN_FLEX_AGENT_E2E === 'true' ? 1800000 : process.env.RUN_AGENT_HTTP_E2E === 'true' ? 180000 : 30000 }, async () => {
  if (process.env.RUN_FLEX_AGENT_E2E === 'true') {
    throw new Error('The historical Gemini aggregate-answer matrix must be updated for the pending privacy policy before rerun.');
  }
  const suffix = randomUUID().replaceAll('-', '');
  const company = `mcp-dqe-company-${suffix}`;
  const department = `mcp-dqe-dept-${suffix}`;
  const role = `mcp-dqe-role-${suffix}`;
  const employees = [`mcp-dqe-owner-${suffix}`, `mcp-dqe-peer-${suffix}`];
  const actor = `mcp-dqe-actor-${suffix}`;
  const db = createDatabase(process.env.TEST_DATABASE_URL);
  const queryDb = createDatabase(process.env.DQE_TEST_DATABASE_URL);
  const sqlTraces = [];
  if (process.env.RUN_FLEX_AGENT_E2E === 'true' || process.env.RUN_AGENT_HTTP_E2E === 'true') {
    const originalTransaction = queryDb.transaction.bind(queryDb);
    queryDb.transaction = (callback) => originalTransaction(async (client) => {
      const originalQuery = client.query.bind(client);
      const tracedClient = { ...client, query: (sql, params) => {
        if (typeof sql === 'string' && sql.startsWith('SELECT ') && sql.includes(' LIMIT ')) sqlTraces.push({ sql, parameters: params });
        return originalQuery(sql, params);
      } };
      return callback(tracedClient);
    });
  }
  const hrmToken = randomBytes(32).toString('hex');
  const mcpToken = randomBytes(32).toString('hex');
  const observedQueries = [];
  const service = createHrmService(db, queryDb);
  const originalQueryData = service.queryData.bind(service);
  service.queryData = async (context, query) => { observedQueries.push({ actor: context.userId, query }); return originalQueryData(context, query); };
  const api = createServer(service, { internalToken: hrmToken });
  let mcp;
  let childOutput = '';
  const createdPermissions = [];
  try {
    await db.query('INSERT INTO companies (id,name,code) VALUES ($1,$2,$3)', [company, 'MCP DQE Test', `MCPDQE${suffix.slice(0, 12)}`]);
    await db.query('INSERT INTO departments (id,company_id,name,code) VALUES ($1,$2,$3,$4)', [department, company, 'MCP DQE Department', 'DQE']);
    for (const [index, employee] of employees.entries()) await db.query('INSERT INTO employees (id,company_id,department_id,email,display_name,title,employment_status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [employee, company, department, `${employee}@example.test`, `MCP DQE Employee ${index}`, 'Tester', 'active']);
    await db.query('INSERT INTO roles (id,code,name) VALUES ($1,$2,$3)', [role, `MCP_DQE_${suffix}`, 'MCP DQE']);
    for (const [index, code] of ['employee.profile.read.any', 'employee.profile.read.self', 'attendance.read.team'].entries()) {
      const permissionId = `mcp-dqe-permission-${index}-${suffix}`;
      await db.query('INSERT INTO permissions (id,code,description) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING', [permissionId, code, 'MCP DQE test']);
      createdPermissions.push(permissionId);
      const actualId = (await db.query('SELECT id FROM permissions WHERE code=$1', [code])).rows[0].id;
      await db.query('INSERT INTO role_permissions (role_id,permission_id) VALUES ($1,$2)', [role, actualId]);
    }
    await db.query('INSERT INTO employee_roles (company_id,employee_id,role_id) VALUES ($1,$2,$3)', [company, employees[0], role]);
    await db.query('INSERT INTO hrm_identity_links (company_id,chat_user_id,employee_id) VALUES ($1,$2,$3)', [company, actor, employees[0]]);
    for (const [index, minutes] of [[0, 480], [1, 300]]) await db.query('INSERT INTO attendance_records (company_id,employee_id,work_date,status,minutes_worked) VALUES ($1,$2,$3,$4,$5)', [company, employees[index], '2026-09-21', 'present', minutes]);
    await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
    const port = await freePort();
    mcp = spawn('dotnet', [process.env.MCP_E2E_DLL], {
      env: { ...process.env, MCP_INTERNAL_TOKEN: mcpToken, HRM_INTERNAL_TOKEN: hrmToken, HRM_API_BASE_URL: `http://127.0.0.1:${api.address().port}`, MCP_ENABLED_SERVERS: 'hrm', McpPort: String(port), DOTNET_NOLOGO: '1' },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    for (const stream of [mcp.stdout, mcp.stderr]) stream.on('data', (chunk) => { childOutput = (childOutput + chunk.toString()).slice(-3000); });
    const base = `http://127.0.0.1:${port}/mcp`;
    let session;
    let rpcId = 0;
    const rpc = async (method, params = {}) => {
      const response = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18', 'x-mcp-internal-token': mcpToken, 'x-mcp-user-id': actor, 'x-mcp-request-id': `mcp-dqe-${suffix}`, ...(session ? { 'mcp-session-id': session } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', ...(method.startsWith('notifications/') ? {} : { id: ++rpcId }), method, params }),
      });
      session = response.headers.get('mcp-session-id') ?? session;
      const body = await response.text();
      if (method.startsWith('notifications/') && !body.trim()) return {};
      const payload = response.headers.get('content-type')?.includes('text/event-stream')
        ? body.split(/\r?\n\r?\n/).flatMap((block) => block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5).trim()))).find((event) => event.result !== undefined || event.error !== undefined)
        : JSON.parse(body);
      assert.equal(response.status, 200, JSON.stringify(payload?.error ?? { status: response.status }));
      assert.equal(payload?.error, undefined, JSON.stringify(payload?.error));
      return payload.result;
    };
    let initialized = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dqe-e2e-test', version: '1.0.0' } }); initialized = true; break; }
      catch (error) { if (mcp.exitCode !== null) throw new Error(`MCP process exited: ${childOutput}`); await new Promise((resolve) => setTimeout(resolve, 150)); }
    }
    assert.equal(initialized, true, `MCP did not initialize: ${childOutput}`);
    await rpc('notifications/initialized');
    const tools = (await rpc('tools/list')).tools;
    assert.ok(tools.some((tool) => tool.name === 'query_hrm_data'));
    const inputSchema = tools.find((tool) => tool.name === 'query_hrm_data').inputSchema;
    const querySchema = inputSchema.properties.query;
    assert.deepEqual(inputSchema.required, ['query']);
    assert.ok(querySchema.required.includes('dataset'));
    assert.deepEqual(querySchema.properties.dataset.enum, ['employees', 'attendance_records', 'leave_requests']);
    assert.deepEqual(querySchema.properties.filters.items.required, ['field', 'operator', 'value']);
    assert.deepEqual(querySchema.properties.filters.items.properties.operator.enum, ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'between', 'contains']);
    assert.deepEqual(querySchema.properties.aggregations.items.required, ['function', 'alias']);
    assert.deepEqual(querySchema.properties.aggregations.items.properties.function.enum, ['count', 'sum', 'avg', 'min', 'max']);
    console.log(JSON.stringify({ event: 'mcp.dqe.schema.pass', datasets: querySchema.properties.dataset.enum, operators: querySchema.properties.filters.items.properties.operator.enum, aggregations: querySchema.properties.aggregations.items.properties.function.enum }));
    assert.ok(tools.some((tool) => tool.name === 'get_my_profile')); // existing catalog remains
    const legacy = await rpc('tools/call', { name: 'get_my_profile', arguments: {} });
    assert.equal(JSON.parse(legacy.content.find((item) => item.type === 'text').text).data.id, employees[0]);
    const call = async (query) => {
      const result = await rpc('tools/call', { name: 'query_hrm_data', arguments: { query } });
      const content = result.content?.find((item) => item.type === 'text')?.text;
      assert.ok(content, JSON.stringify(result));
      const envelope = JSON.parse(content);
      assert.equal(envelope.error, undefined, JSON.stringify(envelope.error));
      return envelope.data;
    };
    const active = await call({ dataset: 'employees', select: ['id', 'display_name'], filters: [{ field: 'employment_status', operator: 'eq', value: 'active' }], sort: [{ field: 'display_name', direction: 'asc' }] });
    const grouped = await rpc('tools/call', { name: 'query_hrm_data', arguments: { query: { dataset: 'employees', filters: [{ field: 'employment_status', operator: 'eq', value: 'active' }], groupBy: ['department_id'], aggregations: [{ function: 'count', alias: 'total' }] } } });
    const attendance = await rpc('tools/call', { name: 'query_hrm_data', arguments: { query: { dataset: 'attendance_records', filters: [{ field: 'work_date', operator: 'between', value: ['2026-09-21', '2026-09-21'] }], aggregations: [{ function: 'sum', field: 'minutes_worked', alias: 'minutes' }] } } });
    const invalid = await rpc('tools/call', { name: 'query_hrm_data', arguments: { query: { dataset: 'employees', select: ['salary'] } } });
    const invalidBody = JSON.parse(invalid.content.find((item) => item.type === 'text').text);
    assert.equal(invalidBody.error.code, 'HRM_VALIDATION_FAILED');
    assert.equal(JSON.stringify(invalidBody).includes('SELECT'), false);
    const spoofed = await rpc('tools/call', { name: 'query_hrm_data', arguments: { query: { dataset: 'employees', companyId: 'foreign-company' } } });
    assert.equal(JSON.parse(spoofed.content.find((item) => item.type === 'text').text).error.code, 'HRM_VALIDATION_FAILED');
    const badAggregate = await rpc('tools/call', { name: 'query_hrm_data', arguments: { query: { dataset: 'employees', aggregations: [{ function: 'count', alias: 'total', func: 'count' }] } } });
    assert.equal(JSON.parse(badAggregate.content.find((item) => item.type === 'text').text).error.code, 'HRM_VALIDATION_FAILED');
    assert.equal(active.rows.length, 2);
    assert.equal(JSON.parse(grouped.content.find((item) => item.type === 'text').text).error.code, 'HRM_FORBIDDEN');
    assert.equal(JSON.parse(attendance.content.find((item) => item.type === 'text').text).error.code, 'HRM_FORBIDDEN');
    const sql = await db.query('SELECT count(*)::int AS employees, sum(minutes_worked)::int AS minutes FROM attendance_records WHERE company_id=$1', [company]);
    assert.equal(sql.rows[0].employees, 2);
    assert.equal(sql.rows[0].minutes, 780);
    console.log(JSON.stringify({ event: 'mcp.dqe.e2e.pass', initialize: true, toolsListed: tools.length, legacyProfile: true, activeEmployees: active.rows.length, aggregateDenied: true }));
    process.env.CHAT_MODEL_MAP_JSON ??= JSON.stringify({ dqe_e2e: { agentId: 'dqe-e2e', provider: 'google', model: e2eModel } });
    process.env.MCP_INTERNAL_TOKEN = mcpToken;
    process.env.MCP_SERVERS_JSON = JSON.stringify({ hrm: { url: base, transport: 'streamable-http' } });
    process.env.MCP_ENABLED_SERVERS = 'hrm';
    const [{ McpClient }, { ToolRegistry }, { AgentService }] = await Promise.all([
      import('../../be/src/mcpClient.js'), import('../../be/src/toolRegistry.js'), import('../../be/src/agentService.js'),
    ]);
    const registry = new ToolRegistry(new Map([['hrm', new McpClient('hrm', { url: base, internalToken: mcpToken })]]), async (userId) => ({ userId }));
    const conversation = { id: `dqe-agent-${suffix}`, messages: [{ role: 'user', text: 'Công ty tôi có bao nhiêu nhân viên đang làm việc?' }] };
    let modelCalls = 0;
    const deterministicModel = {
      async generate({ messages }) {
        modelCalls++;
        if (modelCalls === 1) return { content: { parts: [] }, text: '', toolCalls: [{ name: 'hrm__query_hrm_data', args: { query: { dataset: 'employees', filters: [{ field: 'employment_status', operator: 'eq', value: 'active' }], aggregations: [{ function: 'count', alias: 'total' }] } } }] };
        const toolResult = messages.at(-1)?.parts?.[0]?.functionResponse?.response;
        assert.equal(toolResult.success, false);
        assert.equal(toolResult.error.code, 'HRM_FORBIDDEN');
        return { content: { parts: [{ text: 'Không thể cung cấp số liệu tổng hợp này.' }] }, text: 'Không thể cung cấp số liệu tổng hợp này.', toolCalls: [] };
      },
    };
    const agent = new AgentService(registry, deterministicModel);
    const answer = await agent.run(conversation, { model: 'test-model', mcpServers: ['hrm'] }, AbortSignal.timeout(15000), undefined, { userId: actor, requestId: `dqe-agent-${suffix}` });
    assert.ok(conversation.messages.some((message) => message.role === 'tool_result' && message.name === 'hrm__query_hrm_data'));
    assert.match(answer.text, /Không thể cung cấp/u);
    console.log(JSON.stringify({ event: 'agent.dqe.orchestration.pass', model: 'deterministic-test-double', tool: 'hrm__query_hrm_data', aggregateDenied: true }));
    if (process.env.RUN_FLEX_AGENT_E2E === 'true') {
      const [{ GeminiClient }, { config }, { writeFile, mkdir }] = await Promise.all([import('../../be/src/geminiClient.js'), import('../../be/src/config.js'), import('node:fs/promises')]);
      if (!config.googleKey) throw new Error('RUN_FLEX_AGENT_E2E requires a GOOGLE_KEY resolved by the Chat Backend configuration.');
      const productionCatalog = registry.definitions();
      assert.equal(productionCatalog.length, 15);
      assert.ok(productionCatalog.every((tool) => tool.name.startsWith('hrm__')));
      const catalogPayload = JSON.stringify(productionCatalog);
      const catalogSecrets = [config.googleKey, process.env.TEST_DATABASE_URL, process.env.CHAT_TEST_DATABASE_URL, hrmToken, mcpToken].filter(Boolean);
      if (catalogSecrets.some((secret) => catalogPayload.includes(secret)) || /(?:postgres(?:ql)?:\/\/|https?:\/\/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|project_session|session_token_hash)/i.test(catalogPayload)) throw new Error('Production HRM catalog contains an external address, credential, session, or email.');
      console.log(JSON.stringify({ event: 'dqe.flex.catalog.audit.pass', toolCount: productionCatalog.length, fixtureOrSecretContent: false }));
      const restrictedActor = `mcp-dqe-restricted-actor-${suffix}`;
      const restrictedEmployee = `mcp-dqe-restricted-employee-${suffix}`;
      const inactiveEmployee = `mcp-dqe-inactive-employee-${suffix}`;
      await db.query('INSERT INTO employees (id,company_id,department_id,email,display_name,title,employment_status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [restrictedEmployee, company, department, `${restrictedEmployee}@example.invalid`, 'Fixture Restricted', 'Restricted', 'active']);
      await db.query('INSERT INTO employees (id,company_id,department_id,email,display_name,title,employment_status) VALUES ($1,$2,$3,$4,$5,$6,$7)', [inactiveEmployee, company, department, `${inactiveEmployee}@example.invalid`, 'Fixture Inactive', 'Archive', 'inactive']);
      await db.query('INSERT INTO hrm_identity_links (company_id,chat_user_id,employee_id) VALUES ($1,$2,$3)', [company, restrictedActor, restrictedEmployee]);
      const cases = [
        { id: 'count', question: 'Có bao nhiêu nhân viên đang làm việc trong công ty?', expected: { total: 3 }, sql: "SELECT count(*)::int AS total FROM employees WHERE company_id=$1 AND employment_status='active'" },
        { id: 'select_filter', question: 'Liệt kê tên các nhân viên đang làm việc.', expected: { names: ['Fixture Restricted', 'MCP DQE Employee 0', 'MCP DQE Employee 1'] }, sql: "SELECT display_name FROM employees WHERE company_id=$1 AND employment_status='active' ORDER BY display_name" },
        { id: 'search', question: 'Tìm nhân viên có tên chứa MCP DQE Employee 1 bằng truy vấn HRM.', expected: { names: ['MCP DQE Employee 1'] }, sql: "SELECT display_name FROM employees WHERE company_id=$1 AND display_name ILIKE '%MCP DQE Employee 1%'" },
        { id: 'group_count_order', question: 'Nhóm nhân viên theo trạng thái làm việc, đếm từng nhóm và sắp xếp số lượng giảm dần.', expected: { groups: [{ employment_status: 'active', total: 3 }, { employment_status: 'inactive', total: 1 }] }, sql: 'SELECT employment_status, count(*)::int AS total FROM employees WHERE company_id=$1 GROUP BY employment_status ORDER BY total DESC' },
        { id: 'sum', question: 'Tổng số phút làm việc của nhóm trong ngày 2026-09-21 là bao nhiêu?', expected: { minutes: 780 }, sql: "SELECT sum(a.minutes_worked)::int AS minutes FROM attendance_records a JOIN employees e ON e.company_id=a.company_id AND e.id=a.employee_id WHERE a.company_id=$1 AND e.department_id=$2 AND a.work_date='2026-09-21'" },
        { id: 'multi_filter', question: 'Có bao nhiêu nhân viên đang làm việc và có chức danh Tester?', expected: { total: 2 }, sql: "SELECT count(*)::int AS total FROM employees WHERE company_id=$1 AND employment_status='active' AND title='Tester'" },
        { id: 'empty', question: 'Tìm nhân viên có tên chứa Nobody Fixture XYZ bằng truy vấn HRM.', expected: { names: [] }, sql: "SELECT display_name FROM employees WHERE company_id=$1 AND display_name ILIKE '%Nobody Fixture XYZ%'" },
        { id: 'forbidden', question: 'Có bao nhiêu nhân viên đang làm việc trong công ty?', expected: { error: 'HRM_FORBIDDEN' }, actor: restrictedActor },
      ];
      for (const entry of cases) if (entry.sql) {
        const params = entry.id === 'sum' ? [company, department] : [company];
        const rows = (await db.query(entry.sql, params)).rows;
        if (entry.expected.total !== undefined) assert.equal(Number(rows[0].total), entry.expected.total);
        if (entry.expected.minutes !== undefined) assert.equal(Number(rows[0].minutes), entry.expected.minutes);
        if (entry.expected.names) assert.deepEqual(rows.map((row) => row.display_name), entry.expected.names);
        if (entry.expected.groups) assert.deepEqual(rows.map((row) => ({ ...row, total: Number(row.total) })), entry.expected.groups);
      }
      const nativeFetch = globalThis.fetch;
      const matrix = [];
      const selectedCaseIds = (process.env.E2E_CASE_IDS ?? '').split(',').filter(Boolean);
      const selectedModes = (process.env.E2E_PROMPT_MODES ?? 'minimal,production').split(',').filter(Boolean);
      const selectedEntries = cases.filter((item) => !selectedCaseIds.length || selectedCaseIds.includes(item.id));
      const delayMs = Number(process.env.E2E_DELAY_MS ?? 25000);
      if (!selectedModes.every((mode) => ['minimal', 'production'].includes(mode)) || !selectedEntries.length || selectedCaseIds.some((id) => !cases.some((item) => item.id === id)) || !Number.isInteger(delayMs) || delayMs < 0 || delayMs > 120000) throw new Error('Invalid E2E selection or pacing.');
      try {
        caseLoop: for (const mode of selectedModes) for (const entry of selectedEntries) {
          if (matrix.length) await new Promise((resolve) => setTimeout(resolve, delayMs));
          const calls = [];
          const question = entry.question;
          const allowedToolNames = new Set(mode === 'production' ? productionCatalog.map((tool) => tool.name) : ['hrm__query_hrm_data']);
          globalThis.fetch = async (input, init) => {
            const url = new URL(typeof input === 'string' ? input : input.url);
            if (url.hostname !== 'generativelanguage.googleapis.com') return nativeFetch(input, init);
            assert.equal(decodeURIComponent(url.pathname), `/v1beta/models/${e2eModel}:streamGenerateContent`, 'Unexpected Gemini E2E model endpoint');
            const body = JSON.parse(String(init?.body ?? '{}'));
            assert.ok(body.contents?.[0]?.parts?.[0]?.text?.startsWith('You are the project assistant.'), 'Production Agent prompt missing');
            const declarations = body.tools?.flatMap((tool) => tool.functionDeclarations ?? []) ?? [];
            assert.equal(declarations.filter((tool) => tool.name === 'hrm__query_hrm_data').length, 1);
            assert.equal(declarations.length, 15, 'Production HRM catalog changed');
            for (const content of body.contents) for (const part of content.parts ?? []) if (part.functionCall) calls.push({ name: part.functionCall.name, args: part.functionCall.args });
            if (mode === 'minimal') {
              body.contents = body.contents.slice(1);
              body.tools = [{ functionDeclarations: declarations.filter((tool) => tool.name === 'hrm__query_hrm_data') }];
            }
            const serialized = JSON.stringify(body);
            const secretValues = [config.googleKey, process.env.TEST_DATABASE_URL, process.env.CHAT_TEST_DATABASE_URL, hrmToken, mcpToken].filter(Boolean);
            if (secretValues.some((secret) => serialized.includes(secret)) || /postgres(?:ql)?:\/\/|project_session|session_token_hash/i.test(serialized)) throw new Error('Gemini payload guard blocked a secret or session.');
            const emails = serialized.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
            if (emails.some((email) => !email.endsWith('@example.invalid') && !email.endsWith('@example.test'))) throw new Error('Gemini payload guard blocked a nonfixture email.');
            const userTexts = body.contents.filter((content) => content.role === 'user').flatMap((content) => content.parts ?? []).map((part) => part.text).filter((value) => typeof value === 'string');
            if (!userTexts.includes(question) || userTexts.some((value) => value !== question && !(mode === 'production' && value.startsWith('You are the project assistant.')))
              || body.contents.some((content) => content.role !== 'user' && content.role !== 'model'
                && !(content.role === undefined && content.parts?.some((part) => allowedToolNames.has(part.functionCall?.name))))) throw new Error('Gemini payload guard blocked unexpected text.');
            if (body.contents.some((content) => (content.parts ?? []).some((part) => (part.functionCall && !allowedToolNames.has(part.functionCall.name))
              || (part.functionResponse && !allowedToolNames.has(part.functionResponse.name))))) throw new Error('Gemini payload guard blocked unexpected tool exchange.');
            // A model may return its own text before a function call. The
            // credential/email checks above still inspect that text.
            const providerResponse = await nativeFetch(input, { ...init, body: serialized });
            if (providerResponse.status === 429) { const error = new Error('Gemini provider quota (HTTP 429)'); error.statusCode = 429; throw error; }
            return providerResponse;
          };
          const geminiAgent = new AgentService(registry, new GeminiClient());
          const chat = { id: `dqe-flex-${mode}-${entry.id}-${suffix}`, messages: [{ role: 'user', text: question }] };
          const previousQueries = observedQueries.length;
          const previousTraces = sqlTraces.length;
          const record = { model: e2eModel, mode, case: entry.id, question, expected: entry.expected, verificationSql: entry.sql ?? null, selectedTools: [], arguments: [], validator: null, sql: null, parameters: null, result: null, answer: null, status: 'FAIL', failureLayer: null };
          try {
            const response = await geminiAgent.run(chat, { model: e2eModel, mcpServers: ['hrm'] }, AbortSignal.timeout(60000), undefined, { userId: entry.actor ?? actor, requestId: chat.id });
            record.answer = response.text;
            record.selectedTools = [...new Set(calls.map((call) => call.name))];
            record.arguments = calls;
            const dqeResult = chat.messages.filter((message) => message.role === 'tool_result' && message.name === 'hrm__query_hrm_data').at(-1);
            const envelope = dqeResult && JSON.parse(dqeResult.text);
            const data = envelope?.result?.content?.find((part) => part.type === 'text')?.text;
            const parsed = data && JSON.parse(data);
            const toolError = parsed?.error ?? envelope?.error;
            record.result = parsed?.data ?? toolError ?? null;
            record.validator = toolError?.code === 'HRM_VALIDATION_FAILED' ? 'REJECTED' : toolError?.code === 'HRM_FORBIDDEN' ? 'AUTHORIZATION_DENIED' : toolError ? 'ERROR' : parsed ? 'ACCEPTED' : 'NOT_REACHED';
            const searchToolResult = chat.messages.filter((message) => message.role === 'tool_result' && message.name === 'hrm__search_employees').at(-1);
            const searchEnvelope = searchToolResult && JSON.parse(searchToolResult.text);
            const searchText = searchEnvelope?.result?.content?.find((part) => part.type === 'text')?.text;
            const searchRows = searchText && JSON.parse(searchText)?.data;
            const specializedSearch = mode === 'production' && entry.id === 'search' && record.selectedTools.includes('hrm__search_employees') && !record.selectedTools.includes('hrm__query_hrm_data');
            if (specializedSearch) { record.route = 'hrm__search_employees'; record.result = Array.isArray(searchRows) ? { names: searchRows.map((row) => row.displayName ?? row.display_name) } : null; record.validator = searchEnvelope?.error ? 'ERROR' : Array.isArray(searchRows) ? 'ACCEPTED' : 'NOT_REACHED'; }
            const query = observedQueries.slice(previousQueries).at(-1)?.query;
            if (query) {
              const trace = sqlTraces.slice(previousTraces).at(-1);
              record.sql = trace?.sql ?? null;
              record.parameters = trace?.parameters ?? null;
            }
            const expectedValue = entry.expected;
            const answer = response.text ?? '';
            const rows = parsed?.data?.rows ?? [];
            const firstNumbers = Object.values(rows[0] ?? {}).filter((value) => typeof value === 'number');
            const forbiddenToolResults = expectedValue.error ? chat.messages.filter((message) => message.role === 'tool_result').every((message) => JSON.parse(message.text)?.error?.code === expectedValue.error) : false;
            const matches = expectedValue.error ? toolError?.code === expectedValue.error && forbiddenToolResults && sqlTraces.length === previousTraces && !/\b[23]\b/u.test(answer)
              : specializedSearch ? Array.isArray(searchRows) && searchRows.length === expectedValue.names.length && expectedValue.names.every((name) => searchRows.some((row) => (row.displayName ?? row.display_name) === name) && answer.includes(name))
              : expectedValue.total !== undefined ? firstNumbers.includes(expectedValue.total) && answer.includes(String(expectedValue.total))
              : expectedValue.minutes !== undefined ? firstNumbers.includes(expectedValue.minutes) && answer.includes(String(expectedValue.minutes))
              : expectedValue.names?.length ? expectedValue.names.every((name) => rows.some((row) => row.display_name === name) && answer.includes(name)) && rows.length === expectedValue.names.length
              : expectedValue.names ? rows.length === 0 && /không|khong|no /iu.test(answer)
              : expectedValue.groups ? rows.length === expectedValue.groups.length && expectedValue.groups.every((group, index) => rows[index].employment_status === group.employment_status && Object.values(rows[index]).includes(group.total) && answer.includes(String(group.total))) : false;
            if ((record.selectedTools.includes('hrm__query_hrm_data') || specializedSearch) && matches) record.status = 'PASS';
            else record.failureLayer = !record.selectedTools.length ? 'Agent intent/tool selection' : !record.selectedTools.includes('hrm__query_hrm_data') ? 'Agent tool selection' : record.validator === 'REJECTED' ? 'Agent JSON / MCP schema' : !matches ? 'Agent result interpretation or query shape' : 'Unknown';
          } catch (error) {
            record.selectedTools = [...new Set(calls.map((call) => call.name))];
            record.arguments = calls;
            const trace = sqlTraces.slice(previousTraces).at(-1);
            if (observedQueries.length > previousQueries && trace) { record.sql = trace.sql; record.parameters = trace.parameters; }
            record.providerHttpStatus = Number.isInteger(error.statusCode) ? error.statusCode : null;
            record.failureLayer = /quota|rate limit|429/iu.test(error.message) ? 'Gemini provider quota' : /payload guard/u.test(error.message) ? 'Payload guard' : /GOOGLE|Gemini|fetch|HTTP|503/u.test(error.message) ? 'Gemini provider' : 'Agent/MCP transport';
            record.error = String(error.message).replaceAll(config.googleKey, '[redacted]').slice(0, 200);
            if (record.failureLayer === 'Gemini provider quota') record.status = 'BLOCKED_QUOTA';
          }
          matrix.push(record);
          console.log(JSON.stringify({ event: 'dqe.flex.case', mode, case: entry.id, status: record.status, selectedTools: record.selectedTools, failureLayer: record.failureLayer }));
          if (record.failureLayer === 'Gemini provider quota') break caseLoop;
        }
      } finally { globalThis.fetch = nativeFetch; }
      const attempted = new Set(matrix.map((item) => `${item.mode}:${item.case}`));
      const finalMatrix = [...matrix, ...selectedModes.flatMap((mode) => selectedEntries.filter((entry) => !attempted.has(`${mode}:${entry.id}`)).map((entry) => ({ model: e2eModel, mode, case: entry.id, status: 'NOT_RUN', selectedTools: [], answer: null, verificationSql: entry.sql ?? null })))];
      const reportDir = fileURLToPath(new URL('../test-results/', import.meta.url));
      const reportName = process.env.E2E_REPORT_NAME ?? 'dqe-flex-gemini.json';
      if (!/^dqe-flex-[a-z0-9-]+\.json$/.test(reportName)) throw new Error('Invalid E2E report filename.');
      await mkdir(reportDir, { recursive: true });
      await writeFile(fileURLToPath(new URL(`../test-results/${reportName}`, import.meta.url)), JSON.stringify({ fixtureOnly: true, model: e2eModel, cases: finalMatrix }, null, 2));
      console.log(JSON.stringify({ event: 'dqe.flex.summary', model: e2eModel, pass: finalMatrix.filter((item) => item.status === 'PASS').length, fail: finalMatrix.filter((item) => item.status === 'FAIL').length, blockedQuota: finalMatrix.filter((item) => item.status === 'BLOCKED_QUOTA').length, notRun: finalMatrix.filter((item) => item.status === 'NOT_RUN').length, report: `hrm-server/test-results/${reportName}` }));
      assert.ok(finalMatrix.every((item) => item.status === 'PASS'), `Gemini E2E incomplete; see hrm-server/test-results/${reportName}`);
    }
    if (process.env.RUN_AGENT_HTTP_E2E === 'true') await runChatHttpE2E({ suffix, company, department, role, db, api, mcpPort: port, mcpToken, hrmToken, observedQueries });
  } finally {
    if (mcp) { mcp.kill(); await new Promise((resolve) => { if (mcp.exitCode !== null) resolve(); else { mcp.once('exit', resolve); setTimeout(resolve, 2000); } }); }
    if (api.listening) await new Promise((resolve) => api.close(resolve));
    await db.query('DELETE FROM companies WHERE id=$1', [company]).catch(() => {});
    await db.query('DELETE FROM roles WHERE id=$1', [role]).catch(() => {});
    await db.query('DELETE FROM permissions WHERE id = ANY($1::text[])', [createdPermissions]).catch(() => {});
    await db.close();
    await queryDb.close();
  }
});
