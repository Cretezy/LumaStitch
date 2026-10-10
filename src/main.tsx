// SPDX-License-Identifier: GPL-3.0-or-later
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

// Offline support: precache the built app (production only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .catch((err) => console.warn('Service worker registration failed', err));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Dev/test hook: lets the e2e suite and devtools drive the app without file pickers.
if (
  import.meta.env.DEV ||
  import.meta.env.MODE === 'test' ||
  new URLSearchParams(location.search).has('testHooks')
) {
  void Promise.all([
    import('@/store/actions'),
    import('@/store/documentStore'),
    import('@/store/uiStore'),
    import('@/store/planStore'),
    import('@/store/commands'),
    import('@/io/pes'),
    import('@/store/commands/autoDigitize'),
  ]).then(([actions, doc, ui, plan, commands, pes, auto]) => {
    (window as any).__lumastitch = {
      actions,
      commands,
      pes,
      autoDigitize: auto.autoDigitize,
      useDoc: doc.useDoc,
      useUi: ui.useUi,
      usePlan: plan.usePlan,
      waitForPlan: plan.waitForPlan,
    };
  });
}
