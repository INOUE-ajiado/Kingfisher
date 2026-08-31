import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Bug, ClipboardCopy, Check, Trash2, ArrowDownToLine, Link, AlertTriangle } from 'lucide-react';
import { usePaintStore } from '../../store/usePaintStore';
import { isSyncPairConsistent } from '../../store/types';
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
  view: { label: '表示', className: 'bg-cyan-600 text-white' },
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
  const all = useSyncExternalStore(subscribeDebugLog, getDebugLog, getDebugLog);

  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [follow, setFollow] = useState(true);
  /** 2 画面の連動を追うときは、セルの移動と連動の行だけに絞る */
  const [syncOnly, setSyncOnly] = useState(false);
  /** ログの一覧そのもの。追従はこの中だけで行う */
  const listRef = useRef<HTMLDivElement | null>(null);

  // ⚠️ まとめて 1 つのオブジェクトで購読しないこと。毎回新しい参照になり描き直しが止まらない
  const isSplitView = usePaintStore((s) => s.isSplitView);
  const syncMode = usePaintStore((s) => s.syncMode);
  const syncFrameOffset = usePaintStore((s) => s.syncFrameOffset);
  const currentFileIndex = usePaintStore((s) => s.currentFileIndex);
  const splitFileIndex = usePaintStore((s) => s.splitFileIndex);
  const unifiedCount = usePaintStore((s) => s.unifiedFileList.length);
  const resolveFileNameForView = usePaintStore((s) => s.resolveFileNameForView);
  const roll = usePaintStore((s) => s.roll);

  // ⚠️ 絞り込みに 'view' も入れること。「コマを送ったら倍率が変わった」の前後関係は
  // この 3 つが並んでいないと追えない
  // ⚠️ ロールも含めること。セルとロールの連動は同じ「2 画面の連携」で、
  // 片方だけ見えても前後関係が追えない
  const entries = syncOnly
    ? all.filter(
        (e) =>
          e.category === 'cell' || e.category === 'sync' || e.category === 'view' || e.category === 'roll'
      )
    : all;

  const offsetText = syncFrameOffset > 0 ? `+${syncFrameOffset}` : String(syncFrameOffset);
  const nameA = resolveFileNameForView(currentFileIndex, 0) ?? '実体なし';
  const nameB = resolveFileNameForView(splitFileIndex, 1) ?? '実体なし';
  const expectedB = Math.max(0, Math.min(Math.max(0, unifiedCount - 1), currentFileIndex + syncFrameOffset));
  // 端で切り詰められた並びは食い違いではない (isSyncPairConsistent が両方向で見る)
  const mismatched =
    syncMode && isSplitView && !isSyncPairConsistent(currentFileIndex, splitFileIndex, syncFrameOffset, unifiedCount);

  /** ロールの面が 1 つでも開いていれば、その並びも添える */
  const rollOpen = roll.views.rollA.isOpen || roll.views.rollB.isOpen;
  const rollPosition = (id: 'rollA' | 'rollB') => {
    const view = roll.views[id];
    if (!view.isOpen && view.files.length === 0) return '未使用';
    const at = view.currentPath ? view.files.findIndex((v) => v.path === view.currentPath) + 1 : 0;
    return `${at}/${view.files.length} (${view.fileName || '未読み込み'})`;
  };
  const rollStatus =
    `ロール: 選択連動=${roll.fileSync ? `ON (ずれ ${roll.fileSyncOffset})` : 'OFF'}` +
    ` / 再生連動=${roll.sync ? `ON (時刻差 ${roll.syncOffset.toFixed(3)}s)` : 'OFF'}` +
    ` / A=${rollPosition('rollA')} / B=${rollPosition('rollB')}`;

  /** コピーにも添える「今の状態」。行だけ貼られても前提が分からないため */
  const statusLines = [
    `表示: ${syncOnly ? '2 画面の連動のみ (セル・ロール・連動・表示倍率)' : 'すべて'}`,
    `状態: 2 画面=${isSplitView ? 'ON' : 'OFF'} / 左右連動=${syncMode ? `ON (コマ差 ${offsetText})` : 'OFF'}` +
      ` / Win A=${currentFileIndex} (${nameA}) / Win B=${splitFileIndex} (${nameB}) / 全 ${unifiedCount} コマ`,
    ...(mismatched ? [`⚠️ コマ差の食い違い: 本来 Win B は ${expectedB} のはず`] : []),
    ...(rollOpen ? [rollStatus] : []),
  ];

  /**
   * 追従が入っているときだけ、新しい行へスクロールする。
   *
   * ⚠️ scrollIntoView を使わないこと。祖先 (右サイドパネルの下段) まで一緒に
   * スクロールし、ツールオプションが画面の外へ押し出される (2026-09-01 に実測)。
   * 自分の一覧の scrollTop だけを動かす。
   */
  useEffect(() => {
    if (!follow) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
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
    const text = formatDebugLog({ entries, notes: statusLines });
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
  }, [entries, statusLines]);

  return (
    <div className="bg-white dark:bg-slate-900 flex flex-col select-none p-1.5 min-h-[100px] h-full">
      <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 pb-1 border-b border-slate-200 dark:border-slate-700 mb-1 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 truncate">
          <Bug className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 flex-shrink-0" />
          <span className="truncate">DEBUG ログ ({entries.length})</span>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setSyncOnly((v) => !v)}
            title={
              syncOnly
                ? '2 画面の連動 (セル・ロールの移動・連動・表示倍率) だけを表示中。押すとすべて表示'
                : 'すべて表示中。押すと 2 画面の連動 (セル・ロール) に関する行だけに絞る'
            }
            className={`px-1 py-0.5 rounded text-[9px] font-bold border flex items-center gap-0.5 transition-colors ${
              syncOnly
                ? 'bg-rose-600 border-rose-600 text-white'
                : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Link className="w-3 h-3" />
            <span>連動のみ</span>
          </button>

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

      {/* 2 画面の今の状態。ログを読む前提になるので常に出す */}
      <div
        className={`text-[9px] font-mono px-1 py-0.5 mb-1 rounded border flex-shrink-0 ${
          mismatched
            ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-400 text-amber-700 dark:text-amber-300'
            : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
        }`}
      >
        <div className="flex items-center gap-1 flex-wrap">
          {mismatched && <AlertTriangle className="w-3 h-3 flex-shrink-0" />}
          <span>
            2 画面={isSplitView ? 'ON' : 'OFF'} / 連動={syncMode ? `ON (${offsetText})` : 'OFF'} / 全 {unifiedCount} コマ
          </span>
        </div>
        <div className="break-all">A={currentFileIndex} {nameA}</div>
        <div className="break-all">B={splitFileIndex} {nameB}</div>
        {rollOpen && <div className="break-all pt-0.5 border-t border-slate-200 dark:border-slate-700">{rollStatus}</div>}
        {mismatched && <div className="break-all">⚠️ 本来 Win B は {expectedB} のはず (「差を揃える」で直せます)</div>}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto font-mono text-[10px] leading-relaxed min-h-0">
        {entries.length === 0 ? (
          <div className="text-[10px] text-slate-400 dark:text-slate-500 py-2 px-1 leading-relaxed font-sans">
            {syncOnly ? '2 画面の連動に関する記録はまだありません。' : 'まだ記録がありません。'}
            <br />
            フォルダを開く / コマを送る / 窓を開閉すると、ここに残ります。
          </div>
        ) : (
          entries.map((entry) => {
            const style = CATEGORY_STYLE[entry.category];
            return (
              <div
                key={entry.seq}
                className={`py-0.5 px-1 border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                  entry.level === 'warn' ? 'bg-amber-50 dark:bg-amber-950/40' : ''
                }`}
              >
                <div className="flex items-start gap-1">
                  <span className="text-slate-400 dark:text-slate-500 flex-shrink-0 tabular-nums">
                    {formatLogTime(entry.at)}
                  </span>
                  <span className={`flex-shrink-0 px-1 rounded text-[8px] font-bold ${style.className}`}>
                    {style.label}
                  </span>
                  {/* ⚠️ 折り返して全部見せる。切り詰めると肝心の数字が消える */}
                  <span
                    className={`break-all ${
                      entry.level === 'warn'
                        ? 'text-amber-700 dark:text-amber-300 font-bold'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {entry.message}
                  </span>
                </div>
                {entry.detail && (
                  <div className="pl-[52px] text-slate-500 dark:text-slate-400 break-all">{entry.detail}</div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
