// Make sure PostgreSQL is reachable and both databases exist (idempotent).
// Uses the server named in .env (PGHOST/PGPORT/PGUSER/PGPASSWORD) when one is already running: a local install,
// a managed instance or a CI service container. Only when nothing answers does it start the bundled Docker container.
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { REPO_ROOT } from '../src/config.js';

const server = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'pic',
  password: process.env.PGPASSWORD ?? '',
};
const databases = [process.env.PGDATABASE ?? 'pure_insights', process.env.PGDATABASE_TEST ?? 'pure_insights_test'];
const where = `${server.host}:${server.port}`;

// Connect to a maintenance database, so the application databases need not exist yet.
// Returns null when nothing is answering; throws when a server answers but refuses (e.g. a wrong password).
async function connect() {
  for (const database of ['postgres', 'template1']) {
    const client = new pg.Client({ ...server, database, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      return client;
    } catch (err) {
      await client.end().catch(() => {});
      if (!(err instanceof pg.DatabaseError) || err.code === '57P03') return null; // unreachable, or still starting
      if (err.code !== '3D000') throw err; // 3D000: this maintenance database does not exist, try the next one
    }
  }
  return null;
}

async function connectWithRetry(attempts) {
  for (let i = 1; i <= attempts; i += 1) {
    const client = await connect();
    if (client || i === attempts) return client;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
}

let client;
try {
  client = await connect();
} catch (err) {
  console.error(`PostgreSQL at ${where} refused the connection: ${err.message}. Check PGUSER and PGPASSWORD in .env.`);
  process.exit(1);
}
if (!client) {
  console.log(`PostgreSQL is not reachable at ${where}; starting the bundled Docker container...`);
  const result = spawnSync('docker', ['compose', 'up', '-d', '--wait'], { cwd: REPO_ROOT, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(
      `\nCould not start PostgreSQL with Docker${result.error ? ` (${result.error.code})` : ''}.\n` +
        'Start Docker Desktop and re-run `npm run setup`, or point PGHOST, PGPORT, PGUSER and PGPASSWORD in .env\n' +
        'at an existing PostgreSQL 16 server (see "Without Docker" in the README).',
    );
    process.exit(1);
  }
  client = await connectWithRetry(10);
  if (!client) {
    console.error(`PostgreSQL is still not reachable at ${where}.`);
    process.exit(1);
  }
}

try {
  for (const name of databases) {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount) {
      console.log(`database ${name}: exists`);
      continue;
    }
    try {
      await client.query(`CREATE DATABASE ${client.escapeIdentifier(name)}`);
    } catch (err) {
      if (err.code !== '42501') throw err;
      console.error(`User ${server.user} may not create databases. Grant CREATEDB, or create it yourself: createdb ${name}`);
      process.exit(1);
    }
    console.log(`database ${name}: created`);
  }
} finally {
  await client.end();
}
