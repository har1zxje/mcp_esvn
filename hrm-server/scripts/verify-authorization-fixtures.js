import { readFile } from 'node:fs/promises';

const env = Object.fromEntries((await readFile(new URL('../.env', import.meta.url), 'utf8')).split(/\r?\n/)
  .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
  .filter(Boolean)
  .map(([, key, value]) => [key, value.trim().replace(/^['"]|['"]$/g, '')]));
const baseUrl = `http://127.0.0.1:${env.HRM_PORT ?? '3010'}`;
const token = env.HRM_INTERNAL_TOKEN;
if (!token) throw new Error('HRM_INTERNAL_TOKEN is required.');
const accounts = {
  a1: { userId: '10000000-0000-4000-8000-0000000000a1', companyId: 'hrm-test-company-a', foreignEmployeeId: 'hrm-test-employee-b1' },
  a2: { userId: '10000000-0000-4000-8000-0000000000a2', companyId: 'hrm-test-company-a' },
  b1: { userId: '20000000-0000-4000-8000-0000000000b1', companyId: 'hrm-test-company-b', foreignEmployeeId: 'hrm-test-employee-a1' },
  b2: { userId: '20000000-0000-4000-8000-0000000000b2', companyId: 'hrm-test-company-b' },
};
const request = async (account, path) => {
  const response = await fetch(`${baseUrl}${path}`, { headers: { 'x-hrm-internal-token': token, 'x-hrm-contract-version': '1', 'x-company-id': account.companyId, 'x-actor-user-id': account.userId, 'x-request-id': `fixture-${crypto.randomUUID()}` } });
  return { status: response.status, body: await response.json() };
};
const requestWithCompany = (account, companyId, path) => request({ ...account, companyId }, path);
const results = {
  a1CompanyList: (await request(accounts.a1, '/api/employees')).status,
  a1ForeignEmployee: (await request(accounts.a1, `/api/employees/${accounts.a1.foreignEmployeeId}`)).status,
  a1SpoofedCompany: (await requestWithCompany(accounts.a1, accounts.b1.companyId, '/api/employees')).status,
  a2CompanyList: (await request(accounts.a2, '/api/employees')).status,
  b1CompanyList: (await request(accounts.b1, '/api/employees')).status,
  b1ForeignEmployee: (await request(accounts.b1, `/api/employees/${accounts.b1.foreignEmployeeId}`)).status,
  b1SpoofedCompany: (await requestWithCompany(accounts.b1, accounts.a1.companyId, '/api/employees')).status,
  b2CompanyList: (await request(accounts.b2, '/api/employees')).status,
  unmappedIdentity: (await request({ userId: '30000000-0000-4000-8000-0000000000ff', companyId: 'hrm-test-company-a' }, '/api/employees')).body.error?.code,
};
const expected = { a1CompanyList: 200, a1ForeignEmployee: 404, a1SpoofedCompany: 401, a2CompanyList: 403, b1CompanyList: 200, b1ForeignEmployee: 404, b1SpoofedCompany: 401, b2CompanyList: 403, unmappedIdentity: 'HRM_IDENTITY_NOT_LINKED' };
if (JSON.stringify(results) !== JSON.stringify(expected)) throw new Error(`Fixture authorization verification failed: ${JSON.stringify(results)}`);
console.log(JSON.stringify({ event: 'hrm.authorization_fixtures.verified', results }, null, 2));
