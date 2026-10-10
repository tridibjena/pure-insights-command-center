import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App.jsx';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { SeverityBadge } from '../components/Severity.jsx';

class FakeSocket {
  constructor() {
    setTimeout(() => this.onopen?.(), 0);
  }
  close() {}
}

function mockApi(user) {
  return vi.fn(async (url) => {
    const body = url.startsWith('/api/auth/me')
      ? user
        ? { user }
        : { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }
      : url.startsWith('/api/alerts')
        ? { alerts: [], serverTime: new Date().toISOString() }
        : {};
    const ok = !(url.startsWith('/api/auth/me') && !user);
    return new Response(JSON.stringify(body), { status: ok ? 200 : 401, headers: { 'content-type': 'application/json' } });
  });
}

const owner = {
  email: 'user_7@company.com',
  displayName: 'Report Owner',
  role: 'REPORT_OWNER',
  ownerEmail: 'user_7@company.com',
  ownerScoped: true,
  permissions: ['reports:read', 'alerts:read'],
};

describe('routing and RBAC in the UI', () => {
  beforeEach(() => vi.stubGlobal('WebSocket', FakeSocket));
  afterEach(() => vi.unstubAllGlobals());

  it('shows a 403 page when a report owner opens the cost page directly', async () => {
    vi.stubGlobal('fetch', mockApi(owner));
    render(
      <MemoryRouter initialEntries={['/costs']}>
        <AuthProvider><App /></AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('403 · Access denied')).toBeInTheDocument();
    expect(screen.getByText('costs:read')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cost Allocation' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reports' })).toBeInTheDocument();
  });

  it('sends signed-out users to the login page', async () => {
    vi.stubGlobal('fetch', mockApi(null));
    render(
      <MemoryRouter initialEntries={['/health']}>
        <AuthProvider><App /></AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('users without permissions', () => {
  beforeEach(() => vi.stubGlobal('WebSocket', FakeSocket));
  afterEach(() => vi.unstubAllGlobals());

  it('land on a no-access page instead of a 404', async () => {
    vi.stubGlobal('fetch', mockApi({ ...owner, role: 'NONE', ownerScoped: false, permissions: [] }));
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider><App /></AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Your account has no permissions yet')).toBeInTheDocument();
  });
});

describe('severity is never colour-only', () => {
  it('renders an icon and a text label', () => {
    const { container } = render(<SeverityBadge severity="CRITICAL" />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
