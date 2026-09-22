import { useEffect } from 'react';
import { RecoilRoot } from 'recoil';
import { DndProvider } from 'react-dnd';
import { RouterProvider } from 'react-router-dom';
import * as RadixToast from '@radix-ui/react-toast';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query';
import { Toast, ThemeProvider, ToastProvider, useInputModality } from '@librechat/client';
import { ScreenshotProvider, useApiErrorBoundary } from './hooks';
import WakeLockManager from '~/components/System/WakeLockManager';
import QueryDevtoolsGate from '~/components/QueryDevtoolsGate';
import LanguageSync from '~/components/System/LanguageSync';
import { getThemeFromEnv } from './utils/getThemeFromEnv';
import { initializeFontSize } from '~/store/fontSize';
import { LiveAnnouncer } from '~/a11y';
import { router } from './routes';

function LegacyApp() {
  const { setError } = useApiErrorBoundary();
  useInputModality();

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { networkMode: 'always' },
      mutations: { networkMode: 'always' },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        if (error?.response?.status === 401) setError(error);
      },
    }),
  });

  useEffect(() => {
    initializeFontSize();
  }, []);

  const envTheme = getThemeFromEnv();

  return (
    <QueryClientProvider client={queryClient}>
      <RecoilRoot>
        <LanguageSync />
        <LiveAnnouncer>
          <ThemeProvider {...(envTheme && { initialTheme: 'system', themeRGB: envTheme })}>
            <RadixToast.Provider>
              <ToastProvider>
                <DndProvider backend={HTML5Backend}>
                  <RouterProvider router={router} useTransitions={false} />
                  <WakeLockManager />
                  <QueryDevtoolsGate />
                  <Toast />
                  <RadixToast.Viewport className="pointer-events-none fixed inset-x-0 top-0 z-[1000] mx-auto my-2 flex max-w-[560px] flex-col items-stretch justify-start" />
                </DndProvider>
              </ToastProvider>
            </RadixToast.Provider>
          </ThemeProvider>
        </LiveAnnouncer>
      </RecoilRoot>
    </QueryClientProvider>
  );
}

export default function AppLegacy() {
  return (
    <ScreenshotProvider>
      <LegacyApp />
    </ScreenshotProvider>
  );
}
