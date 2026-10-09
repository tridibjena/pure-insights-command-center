import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { Forbidden } from '../pages/Forbidden.jsx';

export function RequirePermission({ permission, children }) {
  const { user, can } = useAuth();
  const location = useLocation();
  if (user === null) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (permission && !can(permission)) return <Forbidden permission={permission} />;
  return children;
}
