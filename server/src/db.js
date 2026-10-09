import pg from 'pg';

// NUMERIC → JS number. Values here are money/credits/seconds well inside double precision.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));
// DATE stays a 'YYYY-MM-DD' string (no timezone shifting).
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export function createPool(dbConfig) {
  return new pg.Pool({ ...dbConfig, max: 10, idleTimeoutMillis: 30_000 });
}

export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
