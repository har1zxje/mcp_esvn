import test from 'node:test';
import assert from 'node:assert/strict';
import { extractExplicitMcpTarget, extractExplicitMcpTargets, validateMcpServerTarget } from '../src/mcpTarget.js';

const servers = ['plane', 'clickhouse', 'discord'];

test('parses Vietnamese Plane requests without absorbing the conjunction', () => {
  assert.equal(extractExplicitMcpTarget('tạo công việc trên plane', servers), 'plane');
  assert.equal(extractExplicitMcpTarget('tạo công việc trên plane và đặt tên abc', servers), 'plane');
  assert.equal(extractExplicitMcpTarget('thêm task vào plane với tên abc', servers), 'plane');
  assert.equal(extractExplicitMcpTarget('dùng plane tạo task abc', servers), 'plane');
  assert.equal(extractExplicitMcpTarget('tạo task bằng plane', servers), 'plane');
});

test('parses registered targets in connector phrases', () => {
  assert.equal(extractExplicitMcpTarget('lấy dữ liệu từ clickhouse', servers), 'clickhouse');
  assert.deepEqual(
    extractExplicitMcpTargets('lấy dữ liệu clickhouse và gửi sang discord', servers),
    ['clickhouse', 'discord'],
  );
});

test('allows the selected target and rejects a real mismatch', () => {
  assert.equal(
    validateMcpServerTarget('tạo công việc mới trên plane và đặt tên là dcm pubg', 'plane', servers),
    undefined,
  );
  assert.match(validateMcpServerTarget('gửi thông báo qua discord', 'plane', servers), /discord/);
});
