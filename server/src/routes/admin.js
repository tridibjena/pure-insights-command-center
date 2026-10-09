import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../auth/middleware.js';
import { PERMISSIONS, ROLE_PERMISSIONS, isOwnerScoped } from '../auth/permissions.js';
import { parse } from '../errors.js';

export function adminRouter({ pool }) {
  const router = Router();

  router.get('/users', requirePermission(pool, 'users:read'), async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT user_id, email, display_name, role, owner_email, is_active, created_at, last_login_at
         FROM app.users ORDER BY user_id`,
    );
    res.json({ users: rows });
  });

  router.get('/rbac', requirePermission(pool, 'users:read'), (_req, res) => {
    res.json({
      permissions: PERMISSIONS,
      roles: Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => ({ role, permissions, ownerScoped: isOwnerScoped(role) })),
    });
  });

  router.get('/audit', requirePermission(pool, 'audit:read'), async (req, res) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    const { rows } = await pool.query('SELECT * FROM app.audit_log ORDER BY audit_id DESC LIMIT $1', [limit]);
    res.json({ entries: rows });
  });

  return router;
}
