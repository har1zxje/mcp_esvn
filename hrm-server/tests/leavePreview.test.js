import assert from 'node:assert/strict';
import test from 'node:test';

import { HrmDomainError, HrmService } from '../src/services.js';

const context = {
  chatUserId: 'chat-user-a',
  companyId: 'company-a',
  employeeId: 'employee-a',
  permissions: ['leave.request.self'],
};

function previewService(overrides = {}) {
  const calls = [];
  const leave = {
    async typeByCode(...args) { calls.push(['typeByCode', ...args]); return { id: 'annual-id', code: 'ANNUAL', name: 'Annual leave', requires_balance: true }; },
    async hasOverlap(...args) { calls.push(['hasOverlap', ...args]); return false; },
    async balanceSnapshot(...args) { calls.push(['balanceSnapshot', ...args]); return { allocated_days: '12', used_days: '3' }; },
    ...overrides,
  };
  return { calls, service: new HrmService({ leave }) };
}

test('leave preview resolves a company-local business code without writing HRM state', async () => {
  const { service, calls } = previewService();
  const preview = await service.previewMyLeaveRequest(context, {
    leaveTypeCode: 'ANNUAL', startDate: '2026-10-01', endDate: '2026-10-02', requestedDays: 2, reason: 'Family event', leaveTypeId: 'model-native-id', employeeId: 'model-employee-id', companyId: 'model-company-id',
  });
  assert.deepEqual(preview, {
    companyId: 'company-a',
    leaveTypeCode: 'ANNUAL', leaveTypeName: 'Annual leave', requiresBalance: true,
    startDate: '2026-10-01', endDate: '2026-10-02', requestedDays: 2, reason: 'Family event',
    remainingDaysBefore: 9, remainingDaysAfter: 7, hasConflict: false,
  });
  assert.deepEqual(calls, [
    ['typeByCode', 'company-a', 'ANNUAL'],
    ['hasOverlap', 'company-a', 'employee-a', '2026-10-01', '2026-10-02'],
    ['balanceSnapshot', 'company-a', 'employee-a', 'annual-id', 2026],
  ]);
  assert.equal(calls.some(([name]) => ['create', 'approve', 'reject', 'cancel'].includes(name)), false);
});

test('leave preview fails closed for overlap, insufficient balance, and missing permission', async () => {
  const overlapping = previewService({ async hasOverlap() { return true; } });
  await assert.rejects(
    overlapping.service.previewMyLeaveRequest(context, { leaveTypeCode: 'ANNUAL', startDate: '2026-10-01', endDate: '2026-10-02', requestedDays: 2 }),
    (error) => error instanceof HrmDomainError && error.code === 'HRM_CONFLICT',
  );
  assert.equal(overlapping.calls.some(([name]) => name === 'balanceSnapshot'), false);

  const insufficient = previewService({ async balanceSnapshot() { return { allocated_days: '2', used_days: '1' }; } });
  await assert.rejects(
    insufficient.service.previewMyLeaveRequest(context, { leaveTypeCode: 'ANNUAL', startDate: '2026-10-01', endDate: '2026-10-02', requestedDays: 2 }),
    (error) => error instanceof HrmDomainError && error.code === 'HRM_CONFLICT',
  );
  await assert.rejects(
    insufficient.service.previewMyLeaveRequest({ ...context, permissions: [] }, { leaveTypeCode: 'ANNUAL', startDate: '2026-10-01', endDate: '2026-10-02', requestedDays: 1 }),
    (error) => error instanceof HrmDomainError && error.code === 'HRM_FORBIDDEN',
  );
});
