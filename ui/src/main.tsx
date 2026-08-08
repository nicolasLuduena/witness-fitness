import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Global error logging: anything that escapes the UI's catches (module-eval
// failures, unhandled rejections, runtime errors) lands in the browser
// console tagged [wf] — the UI shows errors, the console is where WHY lives.
window.addEventListener('unhandledrejection', (event) => {
  console.error('[wf] unhandled rejection:', event.reason);
});
window.addEventListener('error', (event) => {
  console.error('[wf] uncaught error:', event.error ?? event.message);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
