import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { AuthGuard } from './components/common/AuthGuard.tsx';
import { logDebug } from './engine/debugLog.ts';
import './index.css';

/**
 * 握られなかった例外を DEBUG ログへ流す。
 *
 * ⚠️ これが無いと、await の先で投げた例外が画面にもログにも出ないまま操作が消える。
 * 実際に「まとめる: 要求 42 件」の次が 1 行も無い、という形で起きた
 * (書き込み許可の要求が期限切れで例外になっていた / 2026-09-02)。
 * ⚠️ コンソールへも必ず出すこと。DEBUG ログは 500 行で流れる。
 */
window.addEventListener('unhandledrejection', (e) => {
  const reason: any = e.reason;
  logDebug(
    'window',
    `握られなかったエラー: ${reason?.name ? `${reason.name}: ` : ''}${reason?.message || reason}`,
    String(reason?.stack || '').split('\n').slice(0, 3).join(' / '),
    'warn'
  );
  console.error('Unhandled rejection:', reason);
});

window.addEventListener('error', (e) => {
  logDebug('window', `画面のエラー: ${e.message}`, `${e.filename}:${e.lineno}`, 'warn');
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGuard>
      <App />
    </AuthGuard>
  </React.StrictMode>,
);
