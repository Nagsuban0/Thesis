import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { Layout } from './components.jsx';
import Landing from './pages/landing.jsx';
import { CheckEmail, ForgotPassword, Login, Register, ResetPassword, VerifyEmail } from './pages/auth.jsx';
import { ClientDashboard, MyRequests, Profile, RequestDocument } from './pages/client.jsx';
import {
  AdminDashboard,
  AdminDocumentTypes,
  AdminRegistrars,
  AdminRequests,
  AdminStudents,
  RegistrarDashboard,
  RegistrarRequests,
} from './pages/admin.jsx';

const clientLinks = [
  { to: '/client', label: 'Dashboard', end: true },
  { to: '/client/new', label: 'Request documents' },
  { to: '/client/requests', label: 'My requests' },
  { to: '/client/profile', label: 'Profile' },
];

const adminLinks = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/requests', label: 'All requests' },
  { to: '/admin/registrars', label: 'Registrar accounts' },
  { to: '/admin/students', label: 'Students / alumni' },
  { to: '/admin/documents', label: 'Documents offered' },
];

const registrarLinks = [
  { to: '/registrar', label: 'Dashboard', end: true },
  { to: '/registrar/requests', label: 'Student requests' },
];

const homeFor = (user) =>
  user.role === 'admin' ? '/admin' : user.role === 'registrar' ? '/registrar' : '/client';

function Protected({ role, children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  return children;
}

// Visitors see the public front page; signed-in users go straight to their dashboard.
function Home() {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen">Loading…</div>;
  if (!user) return <Landing />;
  return <Navigate to={homeFor(user)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/check-email" element={<CheckEmail />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route
        path="/client"
        element={
          <Protected role="client">
            <Layout title="Student portal" links={clientLinks} />
          </Protected>
        }
      >
        <Route index element={<ClientDashboard />} />
        <Route path="new" element={<RequestDocument />} />
        <Route path="requests" element={<MyRequests />} />
        <Route path="profile" element={<Profile />} />
      </Route>

      <Route
        path="/admin"
        element={
          <Protected role="admin">
            <Layout title="Admin panel" links={adminLinks} />
          </Protected>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="requests" element={<AdminRequests />} />
        <Route path="registrars" element={<AdminRegistrars />} />
        <Route path="students" element={<AdminStudents />} />
        <Route path="documents" element={<AdminDocumentTypes />} />
      </Route>

      <Route
        path="/registrar"
        element={
          <Protected role="registrar">
            <Layout title="Registrar office" links={registrarLinks} />
          </Protected>
        }
      >
        <Route index element={<RegistrarDashboard />} />
        <Route path="requests" element={<RegistrarRequests />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
