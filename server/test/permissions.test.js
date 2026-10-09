import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS, ROLE_PERMISSIONS, can, isOwnerScoped } from '../src/auth/permissions.js';

test('every granted permission is a defined permission', () => {
  for (const perms of Object.values(ROLE_PERMISSIONS)) for (const p of perms) assert.ok(p in PERMISSIONS, p);
});

test('role matrix', () => {
  assert.ok(can('ADMIN', 'owners:reassign'));
  assert.ok(!can('ADMIN', 'telemetry:ingest'));
  assert.ok(can('PLATFORM_ENGINEER', 'alerts:ack'));
  assert.ok(!can('PLATFORM_ENGINEER', 'costs:read'));
  assert.ok(can('FINOPS_ANALYST', 'costs:read'));
  assert.ok(!can('FINOPS_ANALYST', 'alerts:ack'));
  assert.ok(!can('REPORT_OWNER', 'health:read'));
  assert.ok(!can('REPORT_OWNER', 'alerts:ack'));
  assert.deepEqual(ROLE_PERMISSIONS.SERVICE, ['telemetry:ingest']);
  assert.ok(!can('NOBODY', 'reports:read'));
});

test('only report owners are row-scoped', () => {
  assert.ok(isOwnerScoped('REPORT_OWNER'));
  assert.ok(!isOwnerScoped('ADMIN'));
});
