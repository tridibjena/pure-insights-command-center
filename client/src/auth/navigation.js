// Navigation mirrors the server's permission matrix. The server is still the
// authority — hiding a link is a convenience, not access control.
export const NAV = [
  { to: '/health', label: 'System Health', permission: 'health:read', section: 'Operate' },
  { to: '/alerts', label: 'Alerts', permission: 'alerts:read', section: 'Operate' },
  { to: '/reports', label: 'Reports', permission: 'reports:read', section: 'Operate' },
  { to: '/orphans', label: 'Orphaned Reports', permission: 'orphans:read', section: 'Operate' },
  { to: '/costs', label: 'Cost Allocation', permission: 'costs:read', section: 'Govern' },
  { to: '/data-quality', label: 'Data Quality', permission: 'dq:read', section: 'Govern' },
  { to: '/admin', label: 'Administration', permission: 'users:read', section: 'Govern' },
];

export function navFor(user) {
  if (!user) return [];
  return NAV.filter((item) => user.permissions.includes(item.permission));
}

export function homePathFor(user) {
  return navFor(user)[0]?.to ?? '/forbidden';
}
