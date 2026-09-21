export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  messagingSenderId: string;
  appId: string;
}

export function getFirebaseConfig(): FirebaseWebConfig | null {
  // Vite replaces direct property access in the production build. Keep it explicit.
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID;
  if (!apiKey || !authDomain || !projectId || !messagingSenderId || !appId) return null;
  return { apiKey, authDomain, projectId, messagingSenderId, appId };
}

export function getVapidKey(): string | null {
  return import.meta.env.VITE_FIREBASE_VAPID_KEY || null;
}

export function isFirebasePushConfigured(): boolean {
  return getFirebaseConfig() !== null && getVapidKey() !== null;
}
