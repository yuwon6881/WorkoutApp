import type { CapacitorConfig } from '@capacitor/cli';

// The Android app is a native shell around the deployed web app. Loading the production origin
// (rather than files bundled into the APK) keeps the session cookie first-party with the API,
// keeps FitnessAccount's server-side code exchange unchanged, and lets the service worker keep
// the shell usable offline exactly as the installed PWA does. The bundled dist/ is the fallback
// page Capacitor shows only if the origin cannot load. Override the origin for a staging build
// with WORKOUT_APP_ORIGIN.
const origin = process.env.WORKOUT_APP_ORIGIN ?? 'https://workout-one-mocha.vercel.app';
const signIn = process.env.WORKOUT_SIGN_IN_HOST ?? 'fitness-account-i47taxhzba-as.a.run.app';

const config: CapacitorConfig = {
  appId: 'com.workoutapp.phone',
  appName: 'Workout',
  webDir: 'dist',
  // The WebView's own colour before the page paints, so launch never flashes white.
  backgroundColor: '#0b0e14',
  server: {
    url: origin,
    // Central sign-in is a navigation to FitnessAccount and back; it stays inside the app.
    allowNavigation: [new URL(origin).host, signIn],
    androidScheme: 'https'
  },
  android: {
    // The web app draws its own edge-to-edge chrome and reads safe-area insets.
    adjustMarginsForEdgeToEdge: 'disable'
  },
  plugins: {
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#0b0e14' },
    StatusBar: { overlaysWebView: false, style: 'DARK', backgroundColor: '#0b0e14' },
    LocalNotifications: { smallIcon: 'ic_stat_rest', iconColor: '#e6b450' }
  }
};

export default config;
