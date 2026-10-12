import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import '@fontsource-variable/plus-jakarta-sans/index.css';
import {applyTheme, initialTheme} from './lib/theme';
import {trackInputModality} from './lib/inputModality';
import './index.css';
import './layout.css';
import './overview-layout.css';
import './motion.css';
import './workout.css';
import './surfaces.css';
import { prepareNativeShell } from './lib/nativeShellMigration';
applyTheme(initialTheme());
trackInputModality();
void prepareNativeShell().then(ready => {
  if (ready) ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
}).catch(() => {
  // A WebView with unavailable worker storage still has its bundled assets and native recovery.
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
});
