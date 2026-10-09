// Role-based access control: the single source of truth for who may do what.
// The React app mirrors this matrix for navigation, but every route is enforced here.

export const ROLES = Object.freeze(['ADMIN', 'PLATFORM_ENGINEER', 'FINOPS_ANALYST', 'REPORT_OWNER']);

export const PERMISSIONS = Object.freeze({
  'health:read': 'View system health KPIs and platform self-health',
  'reports:read': 'View report inventory and drill-downs',
  'orphans:read': 'View orphaned reports and their cost exposure',
  'owners:reassign': 'Assign an owner to an orphaned report',
  'alerts:read': 'View alerts and receive real-time notifications',
  'alerts:ack': 'Acknowledge or resolve alerts',
  'costs:read': 'View Snowflake/AWS cost allocation and unit costs',
  'dq:read': 'View the data-quality anomaly register',
  'replay:control': 'Start, stop and reset the telemetry replay',
  'users:read': 'View users and the role/permission matrix',
  'audit:read': 'View the audit log',
  'telemetry:ingest': 'Push telemetry events (service accounts only)',
});

const ALL_USER_PERMISSIONS = Object.keys(PERMISSIONS).filter((p) => p !== 'telemetry:ingest');

export const ROLE_PERMISSIONS = Object.freeze({
  ADMIN: ALL_USER_PERMISSIONS,
  PLATFORM_ENGINEER: [
    'health:read', 'reports:read', 'orphans:read', 'alerts:read', 'alerts:ack', 'dq:read', 'replay:control',
  ],
  FINOPS_ANALYST: ['health:read', 'reports:read', 'orphans:read', 'alerts:read', 'costs:read', 'dq:read'],
  // Row-scoped: only reports (and their alerts) the user currently owns.
  REPORT_OWNER: ['reports:read', 'alerts:read'],
  SERVICE: ['telemetry:ingest'],
});

// Roles whose data access is limited to the reports they own.
export const OWNER_SCOPED_ROLES = new Set(['REPORT_OWNER']);

export function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function can(role, permission) {
  return permissionsFor(role).includes(permission);
}

export function isOwnerScoped(role) {
  return OWNER_SCOPED_ROLES.has(role);
}
