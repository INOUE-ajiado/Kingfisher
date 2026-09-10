import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// Firebase configuration for project kingfisher-paint-2026
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDummyKeyForKingfisherPaint2026",
  authDomain: "kingfisher-paint-2026.firebaseapp.com",
  projectId: "kingfisher-paint-2026",
  storageBucket: "kingfisher-paint-2026.firebasestorage.app",
  messagingSenderId: "367332219782",
  appId: "1:367332219782:web:a61d19859f518a4a4b5bf7"
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
