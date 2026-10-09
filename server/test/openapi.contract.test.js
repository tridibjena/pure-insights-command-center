// Contract test: every route mounted in Express is documented in docs/openapi.yaml,
// with the same permission, and nothing is documented that does not exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { REPO_ROOT } from '../src/config.js';
import { routeMounts } from '../src/app.js';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../src/auth/permissions.js';

const spec = YAML.parse(fs.readFileSync(path.join(REPO_ROOT, 'docs', 'openapi.yaml'), 'utf8'));
const stub = new Proxy({}, { get: () => () => {} });
const deps = { pool: stub, config: { auth: { loginRateLimit: 10, telemetryApiKey: 'x'.repeat(16) }, thresholds: {} }, hub: stub, ingest: stub, replayer: stub, metrics: stub };

function implemented() {
  const routes = new Set();
  for (const { prefix, router } of routeMounts(deps)) {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const p = (prefix + (layer.route.path === '/' ? '' : layer.route.path)).replace(/:(\w+)/g, '{$1}');
      for (const method of Object.keys(layer.route.methods)) routes.add(`${method.toUpperCase()} ${p}`);
    }
  }
  return routes;
}

function documented() {
  const routes = new Set();
  for (const [p, ops] of Object.entries(spec.paths)) {
    for (const method of Object.keys(ops)) routes.add(`${method.toUpperCase()} ${p}`);
  }
  return routes;
}

test('every Express route is documented in openapi.yaml and vice versa', () => {
  const impl = implemented();
  const docs = documented();
  assert.deepEqual([...impl].filter((r) => !docs.has(r)), [], 'undocumented routes');
  assert.deepEqual([...docs].filter((r) => !impl.has(r)), [], 'documented routes that do not exist');
  assert.ok(impl.size > 30, `only ${impl.size} routes found`);
});

// A route may document a narrower permission than its mount guard (e.g. alerts:ack under
// alerts:read): every role holding the narrower permission must also hold the guard.
const narrower = (perm, guard) =>
  perm in PERMISSIONS && Object.values(ROLE_PERMISSIONS).every((perms) => !perms.includes(perm) || perms.includes(guard));

test('documented permissions are consistent with the mount guards', () => {
  for (const { prefix, guard } of routeMounts(deps)) {
    if (['public', 'auth', 'health'].includes(guard)) continue;
    for (const [p, ops] of Object.entries(spec.paths)) {
      if (!p.startsWith(prefix)) continue;
      for (const op of Object.values(ops)) {
        const perm = op['x-permission'];
        assert.ok(perm === guard || narrower(perm, guard), `${p}: ${perm} is not ${guard} or narrower`);
      }
    }
  }
});

test('every operation declares a permission', () => {
  for (const [p, ops] of Object.entries(spec.paths)) {
    for (const [m, op] of Object.entries(ops)) assert.ok(op['x-permission'], `${m} ${p}`);
  }
});
