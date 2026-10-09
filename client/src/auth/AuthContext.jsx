import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthenticatedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    setUnauthenticatedHandler(() => setUser(null));
    api('/api/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, login, logout, can: (p) => Boolean(user?.permissions.includes(p)) }),
    [user, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
