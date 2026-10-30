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
import { isNative } from './lib/platform';
// The first paint takes the theme outright; only a later change is cross-faded.
void applyTheme(initialTheme(), false);
// Styles that only the Android WebView needs (surfaces.css) key off this.
if (isNative()) document.documentElement.dataset.shell = 'android';
trackInputModality();
void prepareNativeShell().then(ready => {
  if (ready) ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
}).catch(() => {
  // A WebView with unavailable worker storage still has its bundled assets and native recovery.
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
});
