import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { PROJECT_USER_MODE } from './config/project';

// Keep the full LibreChat application out of the project-mode startup bundle.
const ProjectStandaloneApp = lazy(() => import('./components/ProjectStandaloneApp'));
const LegacyApp = lazy(() => import('./AppLegacy'));

const App = () => {
  if (PROJECT_USER_MODE) {
    return (
      <Suspense fallback={null}>
        <BrowserRouter>
          <Routes>
            <Route path="/chat/:conversationId" element={<ProjectStandaloneApp />} />
            <Route path="*" element={<Navigate to="/chat/new" replace />} />
          </Routes>
        </BrowserRouter>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={null}>
      <LegacyApp />
    </Suspense>
  );
};

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
