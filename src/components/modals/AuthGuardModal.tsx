import React from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { LogIn, ShieldAlert, CheckCircle2, Lock } from 'lucide-react';

export const AuthGuardModal: React.FC = () => {
  const { isAuthenticated, isAuthChecking, authError, loginWithGoogle } = usePaintStore();

  // If fully authenticated, don't show the guard modal
  if (isAuthenticated) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-slate-950/80 backdrop-blur-xl p-4 select-none">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-slate-700/60 bg-slate-900/90 p-8 shadow-2xl shadow-indigo-950/50 text-slate-100 transition-all duration-300">
        
        {/* Background glow effects */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center text-center">
          
          {/* App Logo & Icon Header */}
          <div className="relative mb-6">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 shadow-lg shadow-indigo-500/30 ring-4 ring-slate-800">
              <Lock className="h-10 w-10 text-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-slate-950 ring-2 ring-slate-900">
              <CheckCircle2 className="h-4 w-4 stroke-[3]" />
            </div>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-white mb-2">
            Kingfisher Paint
          </h1>
          <p className="text-sm text-slate-400 mb-6 leading-relaxed">
            本システムは社内専用ツールです。<br />
            <span className="font-semibold text-indigo-300">@ajiado.co.jp</span> ドライブ・アカウントでログインしてください。
          </p>

          {/* Domain Restriction Notice Badge */}
          <div className="w-full mb-6 rounded-xl border border-indigo-500/30 bg-indigo-950/40 p-3 text-xs text-indigo-200 flex items-center justify-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 text-indigo-400" />
            <span>アクセス制限: @ajiado.co.jp ドメイン限定</span>
          </div>

          {/* Error Banner */}
          {authError && (
            <div className="w-full mb-6 rounded-xl border border-rose-500/40 bg-rose-950/60 p-4 text-xs text-rose-200 text-left flex items-start gap-3 animate-shake">
              <ShieldAlert className="h-5 w-5 shrink-0 text-rose-400 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-rose-300">アクセスエラー</p>
                <p className="leading-snug">{authError}</p>
              </div>
            </div>
          )}

          {/* Google Sign-In Action Button */}
          <button
            onClick={() => loginWithGoogle()}
            disabled={isAuthChecking}
            className="group relative w-full flex items-center justify-center gap-3 rounded-2xl bg-white hover:bg-slate-100 text-slate-800 font-semibold py-3.5 px-6 shadow-xl transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:pointer-events-none disabled:hover:scale-100"
          >
            {isAuthChecking ? (
              <div className="flex items-center gap-3 text-slate-600">
                <svg className="animate-spin h-5 w-5 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-sm font-medium">認証確認中...</span>
              </div>
            ) : (
              <>
                {/* Google Icon SVG */}
                <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span className="text-sm font-semibold text-slate-900">
                  Google でログイン (@ajiado.co.jp)
                </span>
                <LogIn className="h-4 w-4 ml-auto text-slate-400 group-hover:text-slate-600 transition-colors" />
              </>
            )}
          </button>

          <p className="text-[11px] text-slate-500 mt-6">
            認証完了後、ファイルの全機能（読み込み・編集・保存）が有効化されます。
          </p>
        </div>
      </div>
    </div>
  );
};
