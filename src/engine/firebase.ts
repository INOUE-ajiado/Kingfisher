import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// Firebase configuration for project kingfisher-paint-2026
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyD9BhCdyGWfchjMrI3J7SkCbgi0sHRWeG4",
  authDomain: "kingfisher-paint-2026.firebaseapp.com",
  projectId: "kingfisher-paint-2026",
  storageBucket: "kingfisher-paint-2026.firebasestorage.app",
  messagingSenderId: "274734495597",
  appId: "1:274734495597:web:e1d3bca484e279c2abcc64"
};

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Custom parameters to suggest account selection
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

/**
 * Checks if the given email belongs to the strictly required '@ajiado.co.jp' domain.
 */
export function isAjiadoDomain(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith('@ajiado.co.jp');
}
