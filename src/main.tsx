import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
import { registerServiceWorker } from './lib/pwa';
import { APP_VERSION } from './constants/version';

// Create a QueryClient instance for React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);

// Register service worker for PWA and offline support
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  console.log('🚀 FreedomCamp Manager v' + APP_VERSION);
  
  registerServiceWorker().then((registration) => {
    if (registration) {
      console.log('✅ PWA enabled: Offline scanning capability available');
    }
  }).catch((error) => {
    console.error('❌ Service worker registration failed:', error);
  });
}
