import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import { homePathFor } from './auth/navigation.js';
import { RequirePermission } from './auth/RequirePermission.jsx';
import { Layout } from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import { Admin } from './pages/Admin.jsx';
import { Alerts } from './pages/Alerts.jsx';
import { Costs } from './pages/Costs.jsx';
import { DataQuality } from './pages/DataQuality.jsx';
import { NoAccess, NotFound } from './pages/Forbidden.jsx';
import { Health } from './pages/Health.jsx';
import { Login } from './pages/Login.jsx';
import { Orphans } from './pages/Orphans.jsx';
import { ReportDetail } from './pages/ReportDetail.jsx';
import { Reports } from './pages/Reports.jsx';
import { AlertStreamProvider } from './realtime/AlertStream.jsx';

const guarded = (permission, element) => <RequirePermission permission={permission}>{element}</RequirePermission>;

export function App() {
  const { user } = useAuth();
  if (user === undefined) return <Loading what="session" />;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequirePermission>
            <AlertStreamProvider>
              <Layout />
            </AlertStreamProvider>
          </RequirePermission>
        }
      >
        <Route index element={<Navigate to={user ? homePathFor(user) : '/login'} replace />} />
        <Route path="/health" element={guarded('health:read', <Health />)} />
        <Route path="/alerts" element={guarded('alerts:read', <Alerts />)} />
        <Route path="/reports" element={guarded('reports:read', <Reports />)} />
        <Route path="/reports/:reportId" element={guarded('reports:read', <ReportDetail />)} />
        <Route path="/orphans" element={guarded('orphans:read', <Orphans />)} />
        <Route path="/costs" element={guarded('costs:read', <Costs />)} />
        <Route path="/data-quality" element={guarded('dq:read', <DataQuality />)} />
        <Route path="/admin" element={guarded('users:read', <Admin />)} />
        <Route path="/forbidden" element={<NoAccess />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
