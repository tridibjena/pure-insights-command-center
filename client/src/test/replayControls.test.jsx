import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../auth/AuthContext.jsx', () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock('../realtime/AlertStream.jsx', () => ({
  useAlertStream: () => ({ replay: { running: false, progress: 0, snapshotsTotal: 20, eventsSent: 0 }, setReplay: () => {} }),
}));

const { ReplayControls } = await import('../components/ReplayControls.jsx');

describe('ReplayControls', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tells the user when a replay request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Unexpected server error' } }), { status: 500 })));
    render(<ReplayControls />);
    await userEvent.click(screen.getByRole('button', { name: 'Start replay' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Replay start failed: Unexpected server error');
  });
});
