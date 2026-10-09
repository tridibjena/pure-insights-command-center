export async function audit(pool, { req, actor, action, target = null, outcome = 'SUCCESS', detail = null }) {
  const user = actor ?? req?.user;
  try {
    await pool.query(
      `INSERT INTO app.audit_log (actor_email, actor_role, action, target, outcome, ip, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user?.email ?? null, user?.role ?? null, action, target, outcome, req?.ip ?? null, detail],
    );
  } catch (err) {
    req?.log?.error({ err }, 'audit write failed');
  }
}
