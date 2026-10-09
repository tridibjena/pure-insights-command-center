import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { login, startTestServer } from './helpers.js';

let ctx;
before(async () => {
  ctx = await startTestServer({ LOGIN_RATE_LIMIT: '3' });
});
after(() => ctx.close());

test('login is rate limited per IP', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await login(ctx, 'admin', 'wrong')).res.status, 401);
  const { res, body } = await login(ctx, 'admin');
  assert.equal(res.status, 429);
  assert.equal(body.error.code, 'TOO_MANY_ATTEMPTS');
});
