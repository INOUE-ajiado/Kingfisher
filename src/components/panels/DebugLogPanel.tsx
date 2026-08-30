import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Bug, ClipboardCopy, Check, Trash2, ArrowDownToLine } from 'lucide-react';
import {
  DebugLogCategory,
  clearDebugLog,
  formatDebugLog,
  formatLogTime,
  getDebugLog,
  subscribeDebugLog,
} from '../../engine/debugLog';

/** 種別ごとの色。パッと見て「どの系統の操作か」を追えるようにする */
const CATEGORY_STYLE: Record<DebugLogCategory, { label: string; className: string }> = {
  cell: { label: 'セル', className: 'bg-blue-600 text-white' },
  roll: { label: 'ロール', className: 'bg-indigo-600 text-white' },
  folder: { label: 'フォルダ', className: 'bg-amber-500 text-white' },
  window: { label: '窓', className: 'bg-emerald-600 text-white' },
  sync: { label: '連動', className: 'bg-rose-600 text-white' },
  file: { label: 'ファイル', className: 'bg-slate-600 text-white' },
};

/**
 * 操作ログ (DEBUG ウィンドウ)。
 *
 * ⚠️ ログはストアではなく engine/debugLog が持つ。ストアへ入れると 1 行足すたびに
 * 購読している全パネルが再描画されるため。ここだけが useSyncExternalStore で購読する。
 * ⚠️ 全文コピーを必ず用意すること。この機能の目的は、起きた操作をそのまま
 * 解析へ渡せるようにすること。画面を目で追わせるためではない。
 */
export const DebugLogPanel: React.FC = () => {
  const entries = useSyncExternalStore(subscribeDebugLog, getDebugLog, getDebugLog);

  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [follow, setFollow] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // 追従が入っているときだけ、新しい行へスクロールする
  useEffect(() => {
    if (follow) bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [entries, follow]);

  /**
   * 全文をクリップボードへ。
   *
   * ⚠️ navigator.clipboard は http や権限しだいで使えない。落ちたまま黙らないよう、
   * 隠しテキストエリア経由の従来手段へ必ず落とすこと。
   * ⚠️ 応答を待ち続けないこと。権限のダイアログが出ない環境では writeText が
   * 解決も拒否もせず、押しても何も起きないまま終わる。期限を切って次の手へ移る。
   * ⚠️ 失敗しても alert を出さないこと。ダイアログはページの実行を止めるので、
   * ログを見ながら操作を続けられなくなる (ヘッドレスでの検証中に実際に踏んだ)。
   * ボタンの表示で知らせ、本文はコンソールへ出して手で拾えるようにする。
   */
  const handleCopy = useCallback(async () => {
    const text = formatDebugLog();
    let ok = false;

    try {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error('clipboard timeout')), 1500)),
      ]);
      ok = true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        console.error('Failed to copy debug log:', e);
      }
      document.body.removeChild(area);
    }

    if (!ok) {
      // 手で拾えるように本文を残す (ここまで来るのはクリップボードが使えない環境)
      console.error('操作ログをコピーできませんでした。以下を手動でコピーしてください:');
      console.log(text);
      setCopyFailed(true);
      window.setTimeout(() => setCopyFailed(false), 4000);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, []);

  return (
    <div className="bg-white dark:bg-slate-900 flex flex-col select-none p-1.5 min-h-[100px] h-full">
      <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 pb-1 border-b border-slate-200 dark:border-slate-700 mb-1 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 truncate">
          <Bug className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 flex-shrink-0" />
          <span className="truncate">DEBUG ログ ({entries.length})</span>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setFollow((v) => !v)}
            title={follow ? '新しいログに自動で追従中 (押すと止める)' : '自動追従は止まっています (押すと再開)'}
            className={`p-0.5 rounded border transition-colors ${
              follow
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <ArrowDownToLine className="w-3 h-3" />
          </button>

          <button
            onClick={handleCopy}
            title={
              copyFailed
                ? 'クリップボードが使えませんでした。ブラウザのコンソールに全文を出しています'
                : 'ログを全文コピーする (解析へそのまま渡せます)'
            }
            className={`px-1.5 py-0.5 rounded text-[9px] font-bold border flex items-center gap-0.5 transition-colors ${
              copied
                ? 'bg-emerald-600 border-emerald-600 text-white'
                : copyFailed
                ? 'bg-red-600 border-red-600 text-white'
                : 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600'
            }`}
          >
            {copied ? <Check className="w-3 h-3" /> : <ClipboardCopy className="w-3 h-3" />}
            <span>{copied ? 'コピーしました' : copyFailed ? 'コピー失敗 (コンソール参照)' : '全文コピー'}</span>
          </button>

          <button
            onClick={clearDebugLog}
            title="ログを消す"
            className="p-0.5 rounded border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-red-600 hover:text-white hover:border-red-600 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto font-mono text-[10px] leading-relaxed min-h-0">
        {entries.length === 0 ? (
          <div className="text-[10px] text-slate-400 dark:text-slate-500 py-2 px-1 leading-relaxed font-sans">
            まだ記録がありません。
            <br />
            フォルダを開く / コマを送る / 窓を開閉すると、ここに残ります。
          </div>
        ) : (
          entries.map((entry) => {
            const style = CATEGORY_STYLE[entry.category];
            return (
              <div
                key={entry.seq}
                className="py-0.5 px-1 border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <div className="flex items-start gap-1">
                  <span className="text-slate-400 dark:text-slate-500 flex-shrink-0 tabular-nums">
                    {formatLogTime(entry.at)}
                  </span>
                  <span className={`flex-shrink-0 px-1 rounded text-[8px] font-bold ${style.className}`}>
                    {style.label}
                  </span>
                  {/* ⚠️ 折り返して全部見せる。切り詰めると肝心の数字が消える */}
                  <span className="text-slate-700 dark:text-slate-200 break-all">{entry.message}</span>
                </div>
                {entry.detail && (
                  <div className="pl-[52px] text-slate-500 dark:text-slate-400 break-all">{entry.detail}</div>
                )}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
