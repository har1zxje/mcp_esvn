import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { PROJECT_USER_MODE } from './config/project';
import { ProjectAuthProvider, ProjectLogin, ProjectRegister, useProjectAuth } from './project-auth';

// Keep the full LibreChat application out of the project-mode startup bundle.
const ProjectStandaloneApp = lazy(() => import('./components/ProjectStandaloneApp'));
const LegacyApp = lazy(() => import('./AppLegacy'));

const App = () => {
  if (PROJECT_USER_MODE) {
    return (
      <Suspense fallback={null}>
        <ProjectAuthProvider><ProjectAuthenticatedApp /></ProjectAuthProvider>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={null}>
      <LegacyApp />
    </Suspense>
  );
};

function ProjectAuthenticatedApp() {
  const auth = useProjectAuth();
  if (auth.status === 'loading') return <div className="project-auth-loading">Checking session…</div>;
  return <BrowserRouter><ProjectRoutes auth={auth} /></BrowserRouter>;
}

function ProjectRoutes({ auth }) {
  const location = useLocation();

  if (auth.status !== 'authenticated') {
    if (location.pathname === '/login') return <ProjectLogin />;
    if (location.pathname === '/register') return <ProjectRegister />;
    if (location.pathname === '/') return <Navigate to={`/login${location.search}`} replace />;

    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <Routes>
    <Route path="/login" element={<Navigate to="/chat/new" replace />} />
    <Route path="/register" element={<Navigate to="/chat/new" replace />} />
    <Route path="/chat/:conversationId" element={<ProjectStandaloneApp />} />
    <Route path="*" element={<Navigate to="/chat/new" replace />} />
  </Routes>;
}

export default () => (
  <>
    <App />
    <iframe
      src="assets/silence.mp3"
      allow="autoplay"
      id="audio"
      title="audio-silence"
      style={{ display: 'none' }}
    />
  </>
);
