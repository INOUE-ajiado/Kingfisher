import { StateCreator } from 'zustand';
import { signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, googleProvider, isAjiadoDomain } from '../../engine/firebase';
import { PaintStore, AuthSlice } from '../types';

export const createAuthSlice: StateCreator<PaintStore, [], [], AuthSlice> = (set) => ({
  user: null,
  isAuthenticated: false,
  isAuthChecking: true,
  authError: null,

  setUser: (user: User | null) => {
    if (!user) {
      set({ user: null, isAuthenticated: false, isAuthChecking: false });
      return;
    }

    if (isAjiadoDomain(user.email)) {
      set({ user, isAuthenticated: true, isAuthChecking: false, authError: null });
    } else {
      // Sign out immediately if email domain is not @ajiado.co.jp
      signOut(auth).catch(() => {});
      set({
        user: null,
        isAuthenticated: false,
        isAuthChecking: false,
        authError: '許可されていないドメインです。@ajiado.co.jp の組織アカウントでログインしてください。'
      });
    }
  },

  setAuthChecking: (isChecking: boolean) => set({ isAuthChecking: isChecking }),
  setAuthError: (error: string | null) => set({ authError: error }),

  loginWithGoogle: async (): Promise<boolean> => {
    set({ authError: null, isAuthChecking: true });
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      if (!isAjiadoDomain(user.email)) {
        await signOut(auth);
        set({
          user: null,
          isAuthenticated: false,
          isAuthChecking: false,
          authError: 'アクセスが拒否されました。@ajiado.co.jp のドメインアカウントのみ利用可能です。'
        });
        return false;
      }

      set({ user, isAuthenticated: true, isAuthChecking: false, authError: null });
      return true;
    } catch (err: any) {
      console.error('Google Sign-In Error:', err);
      // Popup closed by user or standard auth error
      if (err.code === 'auth/popup-closed-by-user') {
        set({ isAuthChecking: false, authError: null });
      } else {
        set({
          user: null,
          isAuthenticated: false,
          isAuthChecking: false,
          authError: err.message || 'ログイン中にエラーが発生しました。'
        });
      }
      return false;
    }
  },

  logout: async (): Promise<void> => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      set({ user: null, isAuthenticated: false, isAuthChecking: false, authError: null });
    }
  }
});
