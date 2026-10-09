// Seed the demo accounts (idempotent). Password comes from SEED_DEMO_PASSWORD in .env.
import bcrypt from 'bcryptjs';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';

export const DEMO_USERS = [
  { email: 'admin@pureinsights.local', displayName: 'Avery Admin', role: 'ADMIN' },
  { email: 'sre@pureinsights.local', displayName: 'Sam Reliability', role: 'PLATFORM_ENGINEER' },
  { email: 'finops@pureinsights.local', displayName: 'Fin Ops', role: 'FINOPS_ANALYST' },
  { email: 'user_7@company.com', displayName: 'Report Owner (user_7)', role: 'REPORT_OWNER', ownerEmail: 'user_7@company.com' },
];

export async function seedUsers(pool, password) {
  const hash = await bcrypt.hash(password, 12);
  for (const u of DEMO_USERS) {
    await pool.query(
      `INSERT INTO app.users (email, display_name, password_hash, role, owner_email)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash,
                                         role = EXCLUDED.role, owner_email = EXCLUDED.owner_email, is_active = TRUE`,
      [u.email, u.displayName, hash, u.role, u.ownerEmail ?? null],
    );
  }
  return DEMO_USERS.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const password = process.env.SEED_DEMO_PASSWORD;
  const config = loadConfig();
  if (!password || password.length < 10) {
    console.error('SEED_DEMO_PASSWORD must be set (>= 10 characters) in .env');
    process.exit(1);
  }
  const pool = createPool(config.db);
  const n = await seedUsers(pool, password);
  await pool.end();
  console.log(`Seeded ${n} demo users into ${config.db.database}`);
}
