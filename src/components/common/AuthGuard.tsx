import React, { useState, useEffect } from 'react';
import { Lock, KeyRound, ShieldAlert, LogIn, CheckCircle2 } from 'lucide-react';
import { LogoTitle } from './LogoTitle';

const AUTH_STORAGE_KEY = 'kingfisher_auth_token_v1';

// SHA-256 Protected Hash
const TARGET_PASSWORD_HASH =
  import.meta.env.VITE_APP_PASSWORD_HASH ||
  '2cfbedf50a09b0767c5d4c17ecb94f4b81fc17a160ef609c0b7566f5fcea2974';

async function computeSha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface AuthGuardProps {
  children: React.ReactNode;
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    const savedToken = localStorage.getItem(AUTH_STORAGE_KEY);
    if (savedToken === TARGET_PASSWORD_HASH) {
      setIsAuthenticated(true);
    } else {
      setIsAuthenticated(false);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput.trim() || isVerifying) return;

    setIsVerifying(true);
    setErrorMsg('');

    try {
      const inputHash = await computeSha256(passwordInput.trim());

      if (inputHash === TARGET_PASSWORD_HASH) {
        localStorage.setItem(AUTH_STORAGE_KEY, TARGET_PASSWORD_HASH);
        setIsAuthenticated(true);
      } else {
        setErrorMsg('パスワードが正しくありません。');
        setPasswordInput('');
      }
    } catch (err) {
      setErrorMsg('認証処理中にエラーが発生しました。');
    } finally {
      setIsVerifying(false);
    }
  };

  // 初期読み込み中のフォールバック
  if (isAuthenticated === null) {
    return (
      <div className="h-screen w-screen bg-slate-950 flex flex-col items-center justify-center text-white">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-400 mb-3" />
        <span className="text-xs text-slate-400 font-mono">Verifying Authentication...</span>
      </div>
    );
  }

  // 認証済みの場合
  if (isAuthenticated) {
    return <>{children}</>;
  }

  // 未認証時のパスワードロック画面
  return (
    <div className="h-screen w-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center p-4 select-none z-[99999] relative overflow-hidden font-sans">
      {/* 背景ダイナミックエフェクト */}
      <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#3b82f6_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none" />

      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-md p-6 sm:p-8 w-full max-w-md animate-in fade-in zoom-in-95 duration-200 relative z-10 flex flex-col items-center">
        {/* ヘッダーロゴ */}
        <div className="mb-6 transform scale-110">
          <LogoTitle />
        </div>

        {/* パスワード入力フォーム */}
        <div className="w-full bg-slate-950/60 p-5 rounded-xl border border-slate-800/80 mb-4 flex flex-col items-center">
          <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-3 shadow-inner">
            <Lock className="w-5 h-5" />
          </div>

          <h2 className="text-sm font-bold text-slate-200 tracking-wide mb-1">
            パスワード保護エリア
          </h2>
          <p className="text-[11px] text-slate-400 text-center leading-relaxed mb-4">
            Kingfisher Paint アプリケーションを使用するには<br />指定の認証パスワードを入力してください
          </p>

          <form onSubmit={handleLogin} className="w-full space-y-3">
            <div className="relative w-full">
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="パスワードを入力..."
                autoFocus
                className={`w-full bg-slate-900 border ${
                  errorMsg ? 'border-red-500 ring-2 ring-red-500/30' : 'border-slate-700 focus:border-amber-500'
                } rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 outline-none transition-all pr-10 font-mono`}
              />
              <KeyRound className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {errorMsg && (
              <div className="flex items-center gap-1.5 text-red-400 text-xs font-semibold bg-red-950/40 p-2 rounded border border-red-800/60 animate-in fade-in duration-100">
                <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isVerifying || !passwordInput.trim()}
              className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 font-bold py-2.5 px-4 rounded-lg shadow-md transition-all flex items-center justify-center gap-2 text-xs active:scale-[0.98] cursor-pointer"
            >
              {isVerifying ? (
                <>
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-slate-950" />
                  <span>照合中...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>認証してログイン</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* フッターセキュリティインジケーター */}
        <div className="flex items-center gap-1 text-[10px] text-emerald-400/80 font-medium">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          <span>256-bit SHA Encrypted Authentication System</span>
        </div>
      </div>
    </div>
  );
};
