import type { CapacitorConfig } from '@capacitor/cli';

// Static assets ship in the APK; API requests still use the existing first-party HTTPS origin.
const origin = process.env.WORKOUT_APP_ORIGIN ?? 'https://workout-one-mocha.vercel.app';
const signIn = process.env.WORKOUT_SIGN_IN_HOST ?? 'fitness-account-i47taxhzba-as.a.run.app';

const config: CapacitorConfig = {
  appId: 'com.workoutapp.phone',
  appName: 'Workout',
  webDir: 'dist',
  // The WebView's own colour before the page paints, so launch never flashes white.
  backgroundColor: '#0f1115',
  server: {
    hostname: new URL(origin).hostname,
    // Central sign-in is a navigation to FitnessAccount and back; it stays inside the app.
    allowNavigation: [new URL(origin).host, signIn],
    androidScheme: 'https'
  },
  android: {
    resolveServiceWorkerRequests: false,
    // The web app draws its own edge-to-edge chrome and reads safe-area insets.
    adjustMarginsForEdgeToEdge: 'disable'
  },
  plugins: {
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#0f1115' },
    StatusBar: { overlaysWebView: false, style: 'DARK', backgroundColor: '#0f1115' },
    LocalNotifications: { smallIcon: 'ic_stat_rest', iconColor: '#ffa056' }
  }
};

export default config;
