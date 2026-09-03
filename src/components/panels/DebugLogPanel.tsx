import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Bug,
  ClipboardCopy,
  Check,
  Trash2,
  ArrowDownToLine,
  Link,
  AlertTriangle,
  ChevronsLeftRight,
  Pin,
  X,
} from 'lucide-react';
import { usePaintStore } from '../../store/usePaintStore';
import { useFloatingWindow } from '../../hooks/useFloatingWindow';
import { DockPlaceholder } from '../common/DockPlaceholder';
import { FloatingPortal } from '../common/FloatingPortal';
import { CornerResizeHandles } from '../common/CornerResizeHandles';
import { isSyncPairConsistent } from '../../store/types';
import { describeBuild, describeEnvironment, readBuildEnv } from '../../engine/buildInfo';
import {
  DebugLogCategory,
  clearDebugLog,
  formatDebugLog,
  formatLogTime,
  getDebugLog,
  subscribeDebugLog,
} from '../../engine/debugLog';

/** 「広げる」で使う幅。1 行がだいたい折り返さずに読める */
const WIDE_WIDTH = 760;

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
  /** ⚠️ 「コピーしました」の表示を消すタイマー。閉じたあとに触らないよう片づける */
  const noticeTimer = useRef<number | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const [follow, setFollow] = useState(true);
  /** 2 画面の連動を追うときは、セルの移動と連動の行だけに絞る */
  const [syncOnly, setSyncOnly] = useState(false);
  /** ログの一覧そのもの。追従はこの中だけで行う */
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => { if (noticeTimer.current) window.clearTimeout(noticeTimer.current); }, []);

  // ⚠️ まとめて 1 つのオブジェクトで購読しないこと。毎回新しい参照になり描き直しが止まらない
  const isSplitView = usePaintStore((s) => s.isSplitView);
  const syncMode = usePaintStore((s) => s.syncMode);
  const syncFrameOffset = usePaintStore((s) => s.syncFrameOffset);
  const currentFileIndex = usePaintStore((s) => s.currentFileIndex);
  const splitFileIndex = usePaintStore((s) => s.splitFileIndex);
  const unifiedCount = usePaintStore((s) => s.unifiedFileList.length);
  const resolveFileNameForView = usePaintStore((s) => s.resolveFileNameForView);
  const roll = usePaintStore((s) => s.roll);
  const folderNameA = usePaintStore((s) => s.folderNameA);
  const folderNameB = usePaintStore((s) => s.folderNameB);
  const fileListA = usePaintStore((s) => s.fileListA);
  const fileListB = usePaintStore((s) => s.fileListB);
  const rootFolderName = usePaintStore((s) => s.rootFolderName);
  const canvasTransform = usePaintStore((s) => s.canvasTransform);
  const pegOptions = usePaintStore((s) => s.pegStabilizer.options);
  const pegReference = usePaintStore((s) => s.pegStabilizer.reference);
  const currentImageSize = usePaintStore((s) =>
    s.currentImage ? `${s.currentImage.width}x${s.currentImage.height}` : ''
  );

  /**
   * 版と環境。
   * ⚠️ 描くたびに読み直さないこと。変わらない値なので 1 回で足りる。
   */
  const buildEnvRef = useRef<ReturnType<typeof readBuildEnv> | null>(null);
  if (!buildEnvRef.current) buildEnvRef.current = readBuildEnv();
  const buildEnv = buildEnvRef.current;
  const rightSidebarWidth = usePaintStore((s) => s.rightSidebarWidth);
  const isFloating = usePaintStore((s) => s.isDebugLogFloating);
  const toggleFloating = usePaintStore((s) => s.toggleDebugLogFloating);
  const closeWindow = usePaintStore((s) => s.toggleDebugLogWindow);

  /**
   * 引きはがし・移動・リサイズ・ドッキング復帰。
   *
   * ⚠️ 独立中は右サイドバー (overflow-y-auto) の外へ逃がすこと。
   * 中に置いたままだと動かすたびに再描画が起きて重くなる (FloatingPortal のコメント参照)。
   */
  const {
    targetRef,
    windowStyle,
    handleHeaderPointerDown,
    getResizeHandler,
    isOverDockTarget,
    bringToFront,
  } = useFloatingWindow<HTMLDivElement>({
    id: 'debugLog',
    isFloating,
    getIsFloating: () => usePaintStore.getState().isDebugLogFloating,
    toggleFloating,
    dockTargetId: 'debugLog-dock-target',
    minWidth: 420,
    minHeight: 220,
    contentOverflow: 'hidden',
  });
  const setRightSidebarWidth = usePaintStore((s) => s.setRightSidebarWidth);

  /**
   * ログを読むあいだだけ右パネルを広げる。
   * ⚠️ 戻すときのために、広げる前の幅を覚えておくこと。
   * 既定へ戻すと、自分で決めた幅が消えてしまう。
   */
  const widthBeforeRef = useRef<number | null>(null);
  const isWide = rightSidebarWidth >= WIDE_WIDTH - 1;
  const toggleWide = () => {
    if (isWide) {
      setRightSidebarWidth(widthBeforeRef.current ?? 420);
      widthBeforeRef.current = null;
      return;
    }
    widthBeforeRef.current = rightSidebarWidth;
    setRightSidebarWidth(WIDE_WIDTH);
  };

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

  /**
   * コピーにも添える「今の状態」。行だけ貼られても前提が分からないため。
   *
   * ⚠️ 版と環境を必ず先頭に置くこと。「直した版で試したのか」「担当を立てられる環境か」が
   * 分からないと、ログを読んでも原因にたどり着けない (2026-09-03 のユーザー指定)。
   */
  const statusLines = [
    describeBuild(buildEnv),
    describeEnvironment(buildEnv),
    `開いているもの: Win A=${folderNameA || '(なし)'} ${fileListA.length} 枚` +
      ` / Win B=${folderNameB || '(なし)'} ${fileListB.length} 枚` +
      `${rootFolderName ? ` / ルート ${rootFolderName}` : ''}`,
    `表示倍率: Win A ${Math.round(canvasTransform.scale * 100)}%` +
      `${currentImageSize ? ` / 画像 ${currentImageSize}` : ''}`,
    `タップ補正の設定: しきい値 ${pegOptions.autoThreshold ? '自動' : pegOptions.threshold}` +
      ` / 探索範囲 端から ${pegOptions.searchPercent}%` +
      ` / 詳しい解析ログ ${pegOptions.detailLog ? 'ON' : 'OFF'}` +
      `${pegReference ? ` / 基準あり (間隔 ${Math.round(pegReference.spacing)}px)` : ' / 基準なし'}`,
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
      noticeTimer.current = window.setTimeout(() => setCopyFailed(false), 4000);
      return;
    }
    setCopied(true);
    noticeTimer.current = window.setTimeout(() => setCopied(false), 1500);
  }, [entries, statusLines]);

  return (
    <>
      {/* 切り離した跡地。ここへ落とすと右サイドバーへ戻る */}
      {isFloating && (
        // ⚠️ 細い帯にすること。跡地が右サイドバーの高さを食うと、
        // わざわざ切り離した意味がなくなる
        <DockPlaceholder
          id="debugLog-dock-target"
          label="DEBUG ログ"
          onRestore={toggleFloating}
          isActive={isOverDockTarget}
          variant="strip-h"
        />
      )}

    <FloatingPortal enabled={isFloating}>
    <div
      ref={targetRef}
      style={windowStyle}
      onPointerDownCapture={bringToFront}
      className={
        isFloating
          ? 'bg-white dark:bg-slate-900 border-2 border-rose-500 shadow-2xl rounded-lg flex flex-col select-none p-1.5 animate-in fade-in duration-100'
          : 'bg-white dark:bg-slate-900 flex flex-col select-none p-1.5 min-h-[100px] h-full'
      }
    >
      <div
        onPointerDown={handleHeaderPointerDown}
        title={isFloating ? 'ドラッグで移動 / 跡地へドロップで戻す' : 'ドラッグで切り離して独立ウィンドウ化'}
        className={`text-[11px] font-semibold text-slate-700 dark:text-slate-300 pb-1 border-b border-slate-200 dark:border-slate-700 mb-1 flex items-center justify-between gap-1 cursor-grab active:cursor-grabbing touch-none ${
          isFloating ? 'bg-slate-100 dark:bg-slate-800 -mx-1.5 -mt-1.5 px-2 py-1 rounded-t-md' : ''
        }`}
      >
        <div className="flex items-center gap-1.5 truncate">
          {isFloating && <Pin className="w-3 h-3 text-rose-500 flex-shrink-0" />}
          <Bug className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 flex-shrink-0" />
          <span className="truncate">DEBUG ログ ({entries.length})</span>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* ⚠️ 独立中に「右パネルを広げる」は意味がないので出さない */}
          {!isFloating && (
          <button
            onClick={toggleWide}
            title={isWide ? '右パネルの幅を元に戻す' : 'ログを読むために右パネルを広げる'}
            className={`p-0.5 rounded border transition-colors ${
              isWide
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <ChevronsLeftRight className="w-3 h-3" />
          </button>
          )}

          {isFloating && (
            <button
              onClick={closeWindow}
              title="閉じる (ヘッダーの DEBUG ボタンでまた開けます)"
              className="p-0.5 rounded border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}

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

      {/* ⚠️ 広げたときは折り返さない。1 行に前後がまとまっている方が追いやすい。
          その代わり横へスクロールできるようにしておく */}
      <div
        ref={listRef}
        className={`flex-1 overflow-y-auto font-mono text-[10px] leading-relaxed min-h-0 ${
          isWide ? 'overflow-x-auto' : ''
        }`}
      >
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
                    className={`${isWide ? 'whitespace-nowrap' : 'break-all'} ${
                      entry.level === 'warn'
                        ? 'text-amber-700 dark:text-amber-300 font-bold'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {entry.message}
                  </span>
                </div>
                {entry.detail && (
                  <div
                    className={`pl-[52px] text-slate-500 dark:text-slate-400 ${
                      isWide ? 'whitespace-nowrap' : 'break-all'
                    }`}
                  >
                    {entry.detail}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {isFloating && <CornerResizeHandles getResizeHandler={getResizeHandler} topOffset={28} />}
    </div>
    </FloatingPortal>
    </>
  );
};
