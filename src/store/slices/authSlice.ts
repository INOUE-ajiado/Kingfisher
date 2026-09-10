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
        authError: `許可されていないアカウント (${user.email || '不明'}) です。@ajiado.co.jp の組織アカウントでログインしてください。`
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
          authError: `アクセスが拒否されました (${user.email})。@ajiado.co.jp の組織アカウントのみアクセス可能です。`
        });
        return false;
      }

      set({ user, isAuthenticated: true, isAuthChecking: false, authError: null });
      return true;
    } catch (err: any) {
      console.error('Google Sign-In Error:', err);

      let errorMessage = 'ログイン中にエラーが発生しました。';
      if (err.code === 'auth/popup-closed-by-user') {
        set({ isAuthChecking: false, authError: null });
        return false;
      } else if (err.code === 'auth/invalid-api-key' || err.message?.includes('API key')) {
        errorMessage = 'Firebase APIキーが未設定または無効です。Firebase Consoleのプロジェクト設定から有効なWeb APIキーを設定してください。';
      } else if (err.code === 'auth/operation-not-allowed') {
        errorMessage = 'Firebase Consoleで「Google認証プロバイダ」が有効化されていません。Authentication > Sign-in method でGoogleを有効にしてください。';
      } else if (err.code === 'auth/unauthorized-domain') {
        errorMessage = '現在のドメインがFirebase Consoleの「承認済みドメイン (Authorized domains)」に追加されていません。';
      } else if (err.code === 'auth/popup-blocked') {
        errorMessage = 'ブラウザのポップアップがブロックされました。ポップアップを許可して再度お試しください。';
      } else if (err.message) {
        errorMessage = `認証エラー [${err.code || 'UNKNOWN'}]: ${err.message}`;
      }

      set({
        user: null,
        isAuthenticated: false,
        isAuthChecking: false,
        authError: errorMessage
      });
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
