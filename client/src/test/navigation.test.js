import { describe, expect, it } from 'vitest';
import { homePathFor, navFor } from '../auth/navigation.js';

const user = (permissions) => ({ permissions });

describe('permission-gated navigation', () => {
  it('shows every page to an administrator', () => {
    const admin = user(['health:read', 'reports:read', 'orphans:read', 'owners:reassign', 'alerts:read', 'alerts:ack', 'costs:read', 'dq:read', 'replay:control', 'users:read', 'audit:read']);
    expect(navFor(admin).map((n) => n.to)).toEqual(['/health', '/alerts', '/reports', '/orphans', '/costs', '/data-quality', '/admin']);
  });

  it('limits a report owner to reports and alerts', () => {
    const owner = user(['reports:read', 'alerts:read']);
    expect(navFor(owner).map((n) => n.to)).toEqual(['/alerts', '/reports']);
    expect(homePathFor(owner)).toBe('/alerts');
  });

  it('hides costs from platform engineers and admin from FinOps', () => {
    expect(navFor(user(['health:read', 'alerts:read', 'dq:read'])).some((n) => n.to === '/costs')).toBe(false);
    expect(navFor(user(['costs:read', 'health:read'])).some((n) => n.to === '/admin')).toBe(false);
  });

  it('handles signed-out and permissionless users', () => {
    expect(navFor(null)).toEqual([]);
    expect(homePathFor(user([]))).toBe('/forbidden');
  });
});
