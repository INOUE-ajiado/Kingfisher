import React, { useRef, useState, useMemo, useEffect } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { collectImageFilesRecursively, isSupportedImageFile } from '../../engine/fileSystemPath';
import { scanCutRootFolder } from '../../engine/cutFolder';
import { sortNatural } from '../../engine/naturalOrder';
import { FileTreeNode, buildTreeFromPaths } from '../../engine/fileTree';
import { RenameModal } from '../modals/RenameModal';
import { ContextMenu, ContextMenuItem } from '../common/ContextMenu';
import { FolderOpen, Link, Link2Off, AlertTriangle, ChevronRight, ChevronDown, Folder, FileImage, Film, List, Network, Type, Copy, ClipboardCopy, Trash2, Anchor, FolderPlus } from 'lucide-react';
import { RollId, ROLL_IDS } from '../../store/types';
import { logDebug } from '../../engine/debugLog';
import { buildMoveToFolderPlan, invalidFolderName } from '../../engine/folderPlan';

/**
 * 選択中ファイルの色。Win A は青 / Win B は緑、ロールはウィンドウの枠と同じ
 * 藍 / 紫。⚠️ Tailwind は文字列を切り出して拾うので、クラス名は必ずここに
 * 丸ごと書くこと (`bg-${tone}-600` のような組み立ては消える)。
 */
type SelectionTone = 'blue' | 'emerald' | 'indigo' | 'violet';

const TONE_CLASS: Record<SelectionTone, { bg: string; icon: string }> = {
  blue: { bg: 'bg-blue-600', icon: 'text-blue-400' },
  emerald: { bg: 'bg-emerald-600', icon: 'text-emerald-400' },
  indigo: { bg: 'bg-indigo-600', icon: 'text-indigo-400' },
  violet: { bg: 'bg-violet-600', icon: 'text-violet-400' },
};

/** ツリー内のフォルダのパスを、階層の深さに関係なくすべて集める */
function collectFolderPaths(nodes: FileTreeNode[], acc: Set<string> = new Set()): Set<string> {
  nodes.forEach((node) => {
    if (node.isFolder) {
      acc.add(node.path);
      if (node.children) collectFolderPaths(node.children, acc);
    }
  });
  return acc;
}

export interface FlatNodeItem {
  node: FileTreeNode;
  depth: number;
  parentPath: string | null;
}

function getFlatVisibleNodes(
  nodes: FileTreeNode[],
  expandedPaths: Set<string>,
  depth = 0,
  parentPath: string | null = null
): FlatNodeItem[] {
  let result: FlatNodeItem[] = [];

  for (const node of nodes) {
    result.push({ node, depth, parentPath });

    if (node.isFolder && expandedPaths.has(node.path) && node.children) {
      result.push(...getFlatVisibleNodes(node.children, expandedPaths, depth + 1, node.path));
    }
  }

  return result;
}

const TreeItemNode: React.FC<{
  node: FileTreeNode;
  depth: number;
  expandedPaths: Set<string>;
  focusedPath: string | null;
  togglePath: (path: string, forceState?: boolean) => void;
  onSelectFile: (idx: number) => void;
  /** もう一方のウィンドウが表示中の位置 (単一ツリー表示時の副次ハイライト) */
  secondaryIdx?: number;
  /** 選択中ファイルのハイライト色 */
  selectionTone?: SelectionTone;
  /** ファイル行のアイコン。ロールの一覧はセルと見分けが付くようフィルムにする */
  fileIcon?: 'image' | 'film';
  /** 左右連動中であることを示す 🔗 を選択中ファイルに付ける */
  showSyncBadge?: boolean;
  onFocusNode: (path: string) => void;
  currentIdx: number;
  /** リネーム対象として選択されているパス (Ctrl / Shift クリック) */
  markedPaths?: Set<string>;
  /** 修飾キー付きクリック。true を返したら通常の移動は行わない */
  onMarkFile?: (path: string, modifiers: { ctrl: boolean; shift: boolean }) => boolean;
  /** 右クリック。選択に入っていなければ、その 1 件だけを選び直してから開く */
  onContextFile?: (path: string, position: { x: number; y: number }) => void;
}> = ({
  node,
  depth,
  expandedPaths,
  focusedPath,
  togglePath,
  onSelectFile,
  onFocusNode,
  currentIdx,
  secondaryIdx,
  selectionTone = 'blue',
  fileIcon = 'image',
  showSyncBadge = false,
  markedPaths,
  onMarkFile,
  onContextFile,
}) => {
  const itemRef = useRef<HTMLDivElement | null>(null);
  const isExpanded = expandedPaths.has(node.path);
  const isFocused = focusedPath === node.path;
  const isSelected = !node.isFolder && node.fileIndex === currentIdx;
  const isMarked = !node.isFolder && !!markedPaths?.has(node.path);
  const isSecondary = !node.isFolder && secondaryIdx !== undefined && node.fileIndex === secondaryIdx;

  // ⚠️ フォーカス/選択中アイテムがウィンドウ外へ出た場合、自動追従スクロール
  useEffect(() => {
    if ((isFocused || isSelected) && itemRef.current) {
      itemRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [isFocused, isSelected]);

  if (node.isFolder) {
    return (
      <div>
        <div
          ref={itemRef}
          onClick={() => {
            onFocusNode(node.path);
            togglePath(node.path);
          }}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          className={`flex items-center gap-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800/60 cursor-pointer text-[11px] font-semibold transition-colors select-none ${
            isFocused
              ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-400/50 rounded-xs'
              : 'text-slate-700 dark:text-slate-300'
          }`}
        >
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          )}
          <Folder className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
          <span className="truncate">{node.name}</span>
        </div>

        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeItemNode
                key={child.path}
                node={child}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                focusedPath={focusedPath}
                togglePath={togglePath}
                onSelectFile={onSelectFile}
                secondaryIdx={secondaryIdx}
                selectionTone={selectionTone}
                fileIcon={fileIcon}
                showSyncBadge={showSyncBadge}
                onFocusNode={onFocusNode}
                currentIdx={currentIdx}
                markedPaths={markedPaths}
                onMarkFile={onMarkFile}
                onContextFile={onContextFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={itemRef}
      onClick={(e) => {
        onFocusNode(node.path);
        // Ctrl / Shift クリックはリネーム対象の選択。表示コマは動かさない
        if (onMarkFile && onMarkFile(node.path, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })) {
          return;
        }
        if (node.fileIndex !== undefined) onSelectFile(node.fileIndex);
      }}
      onContextMenu={(e) => {
        if (!onContextFile) return;
        e.preventDefault();
        e.stopPropagation();
        onContextFile(node.path, { x: e.clientX, y: e.clientY });
      }}
      style={{ paddingLeft: `${depth * 12 + 16}px` }}
      className={`flex items-center gap-1.5 py-1 px-1 cursor-pointer text-[11px] transition-colors select-none ${
        // 複数選択したファイルは、表示中のコマと同じ色で塗る
        isSelected && isSecondary
          ? 'bg-gradient-to-r from-blue-600 to-emerald-600 text-white font-bold rounded shadow-xs'
          : isSelected || isMarked
          ? `${TONE_CLASS[selectionTone].bg} text-white font-bold rounded shadow-xs`
          : isSecondary
          ? 'bg-emerald-600 text-white font-bold rounded shadow-xs'
          : isFocused
          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-400/50 rounded-xs'
          : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
      }`}
    >
      {/* 左右連動中は、連動しているファイルであることを 🔗 で示す */}
      {showSyncBadge && (isSelected || isSecondary) && (
        <Link className="w-3 h-3 flex-shrink-0 text-white" />
      )}
      {React.createElement(fileIcon === 'film' ? Film : FileImage, {
        className: `w-3.5 h-3.5 flex-shrink-0 ${
          isSelected || isSecondary || isMarked ? 'text-white' : TONE_CLASS[selectionTone].icon
        }`,
      })}
      <span className="truncate">{node.name}</span>
    </div>
  );
};

export const FileBrowser: React.FC = () => {
  const fileInputRefA = useRef<HTMLInputElement | null>(null);
  const fileInputRefB = useRef<HTMLInputElement | null>(null);

  const [viewMode, setViewMode] = useState<'tree' | 'merge'>('tree');
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  /**
   * リネーム対象として選んだファイル (Ctrl / Shift クリック)。
   * 表示中のコマ (currentFileIndex) とは別の概念なので混ぜないこと。
   * ビューをまたぐ選択は連番の意味が壊れるため、片方だけを保持する。
   */
  const [markedView, setMarkedView] = useState<0 | 1>(0);
  const [markedPaths, setMarkedPaths] = useState<string[]>([]);
  const [markAnchor, setMarkAnchor] = useState<string | null>(null);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  /** メニューの項目を選んだかどうか (閉じただけなのかを見分ける) */
  const menuUsedRef = useRef(false);

  const {
    rootFolderName,
    availableSubDirectories,
    selectedSubDirA,
    selectedSubDirB,
    mergedFrameNumbers,
    mergedFrameMap,
    setCutRootFolder,
    setSelectedSubDirA,
    setSelectedSubDirB,
    folderNameA,
    folderNameB,
    fileListA,
    fileListB,
    unifiedFileList,
    currentFileIndex,
    splitFileIndex,
    setCurrentFileIndex,
    setSplitFileIndex,
    activeViewIndex,
    roll,
    selectRollFile,
    toggleRollFileSync,
    alignRollFiles,
    setFolderHandleA,
    setFolderHandleB,
    setFolderFilesA,
    setFolderFilesB,
    syncMode,
    toggleSyncMode,
    syncFrameOffset,
    alignSyncFrames,
    isSplitView,
    resolveFileNameForView,
    indexOfFileForView,
    duplicateFiles,
    deleteFiles,
    moveFilesToNewFolder,
    pegStabilizer,
    applyPegCorrectionToFiles,
  } = usePaintStore();

  const togglePath = (path: string, forceState?: boolean) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (forceState !== undefined) {
        if (forceState) next.add(path);
        else next.delete(path);
      } else {
        if (next.has(path)) next.delete(path);
        else next.add(path);
      }
      return next;
    });
  };

  // ファイルリストから階層ツリー構造を動的作成
  const fileTreeNodes = useMemo(() => buildTreeFromPaths(unifiedFileList), [unifiedFileList]);

  /**
   * 撮影ロールのツリー。面ごとに 1 本ずつ、セルのツリーとは別の区画に並べる。
   *
   * ⚠️ 映像を fileListA / unifiedFileList へ混ぜないこと。あちらはフレーム番号で
   * 対応づける連番の器で、映像名が混ざるとコマの対応がおかしくなる。
   * ⚠️ 以前は連番リストの後ろへ足して 1 本のツリーに同居させていたため、
   * ロールを 2 面開いても一覧は 1 つしか出ず、どちらの面のものか分からなかった。
   *
   * 開いている面と、まだ開いていなくても一覧を持つ面 (フォルダを落とした直後) を出す。
   */
  const rollPanes = useMemo(() => {
    const shown = ROLL_IDS.filter((id) => roll.views[id].isOpen || roll.views[id].files.length > 0);
    return shown.map((id) => {
      const view = roll.views[id];
      const paths = view.files.map((v) => v.path);
      return {
        id,
        label: id === 'rollA' ? 'ロール A' : 'ロール B',
        folderName: view.folderName,
        tone:
          id === 'rollA'
            ? 'text-indigo-600 dark:text-indigo-400 border-indigo-500/40'
            : 'text-violet-600 dark:text-violet-400 border-violet-500/40',
        selectionTone: (id === 'rollA' ? 'indigo' : 'violet') as SelectionTone,
        paths,
        nodes: buildTreeFromPaths(paths),
        activeIdx: view.currentPath ? paths.indexOf(view.currentPath) : -1,
      };
    });
  }, [roll.views]);

  /**
   * 2画面分割中は Win A / Win B のツリーを並べて表示する。
   *
   * 各ツリーは自分のフォルダのファイル一覧から組み立てるため、
   * ノードが持つ index はそのリスト内の位置になる。
   * 選択時はファイル名からフレーム番号を取り出し、
   * 統合リスト上の位置へ読み替えてから反映する。
   */
  /**
   * ⚠️ 「両方にファイルがあるとき」を条件にしてはいけない。
   *
   * 片側だけフォルダを開いた状態 (Win B にだけ D&D した直後など) では
   * 統合ツリーが 1 本だけ表示されるが、そのツリーの選択は
   * setCurrentFileIndex に繋がっているため Win A しか動かない。
   * 連動 OFF のときは Win B を移動する手段が画面から消える。
   * 分割表示中は常に 2 本並べ、空の側は空である旨を出す。
   */
  const showDualTree = isSplitView;

  const treeA = useMemo(() => buildTreeFromPaths(fileListA), [fileListA]);
  const treeB = useMemo(() => buildTreeFromPaths(fileListB), [fileListB]);

  /**
   * 読み込み直後はフォルダをすべて開いた状態にする。
   *
   * 以前は最上位のフォルダしか展開しておらず、しかも統合リストから作った
   * ツリーだけを対象にしていたため、Win B のツリーが閉じたままだった。
   * 既に開いているものはそのままなので、ユーザーが畳んだ状態は保たれる。
   */
  useEffect(() => {
    const wanted = new Set<string>();
    collectFolderPaths(fileTreeNodes, wanted);
    collectFolderPaths(treeA, wanted);
    collectFolderPaths(treeB, wanted);
    rollPanes.forEach((pane) => collectFolderPaths(pane.nodes, wanted));
    if (wanted.size === 0) return;

    setExpandedPaths((prev) => {
      const missing = Array.from(wanted).filter((path) => !prev.has(path));
      if (missing.length === 0) return prev;
      const next = new Set(prev);
      missing.forEach((path) => next.add(path));
      return next;
    });
  }, [fileTreeNodes, treeA, treeB, rollPanes]);

  /**
   * ツリー内の位置 → 統合リスト上の位置。
   *
   * ⚠️ フレーム番号で引かないこと。番号が重なるサブフォルダがあると
   * 別フォルダの項目に当たり、選択が飛んだり項目が飛ばされたりする。
   */
  const toUnifiedIndex = (path: string, fallback: number) => {
    const idx = indexOfFileForView(path, 0);
    return idx >= 0 ? idx : fallback;
  };

  const toUnifiedIndexForView = (path: string, view: 0 | 1, fallback: number) => {
    const idx = indexOfFileForView(path, view);
    return idx >= 0 ? idx : fallback;
  };

  const clearMarks = () => {
    if (markedPaths.length > 0) logDebug('file', `複数選択を解除 (${markedPaths.length} 件 → 0)`);
    setMarkedPaths([]);
    setMarkAnchor(null);
  };

  /**
   * Ctrl / Shift クリックでリネーム対象を選ぶ。
   * 修飾キーが無いときは false を返し、通常のコマ移動に任せる。
   */
  const markFileInView = (view: 0 | 1, list: string[]) =>
    (path: string, modifiers: { ctrl: boolean; shift: boolean }): boolean => {
      const label = view === 1 ? 'Win B' : 'Win A';

      if (!modifiers.ctrl && !modifiers.shift) {
        /**
         * ⚠️ 通常クリックでも起点 (markAnchor) を覚えること。
         * 覚えていないと、次の Shift + クリックで範囲の始まりが決まらず、
         * 1 件だけ選ばれて「複数選択できない」ことになる (2026-09-01 の報告)。
         * エクスプローラーや Finder と同じ振る舞い。
         */
        if (markedPaths.length > 0) {
          logDebug('file', `複数選択を解除 (${markedPaths.length} 件 → 0) — ${label}`, path);
          setMarkedPaths([]);
        }
        setMarkedView(view);
        setMarkAnchor(path);
        return false;
      }

      // 別ビューのツリーを触ったら選択を作り直す
      const base = view === markedView ? markedPaths : [];
      if (view !== markedView) setMarkedView(view);

      if (modifiers.shift && view === markedView) {
        const from = markAnchor ? list.indexOf(markAnchor) : -1;
        const to = list.indexOf(path);
        if (from >= 0 && to >= 0) {
          const [lo, hi] = from <= to ? [from, to] : [to, from];
          const range = list.slice(lo, hi + 1);
          setMarkedPaths(range);
          logDebug(
            'file',
            `複数選択: Shift で ${range.length} 件 — ${label}`,
            `${range[0]} 〜 ${range[range.length - 1]} (起点 ${markAnchor})`
          );
          return true;
        }
        // ⚠️ 黙って 1 件選択へ落とさないこと。なぜ範囲にならなかったのかが分からなくなる
        logDebug(
          'file',
          'Shift の範囲を作れませんでした (1 件だけ選びます)',
          `起点 ${markAnchor ?? '(なし)'} は一覧の ${from} 番目 / 選んだ ${path} は ${to} 番目 — ${label} の一覧 ${list.length} 件`,
          'warn'
        );
      }

      const next = base.includes(path) ? base.filter((p) => p !== path) : [...base, path];
      setMarkedPaths(next);
      setMarkAnchor(path);
      logDebug(
        'file',
        `複数選択: ${modifiers.ctrl ? 'Ctrl' : 'Shift'} で ${base.includes(path) ? '外して' : '足して'} ${next.length} 件 — ${label}`,
        path
      );
      return true;
    };

  /**
   * 右クリック。Finder と同じで、選択に入っていないファイルを右クリックしたら
   * そのファイルだけを選び直してからメニューを開く。
   *
   * ⚠️ 選び直しは必ず記録すること。まとめて選んだあと選択外の行を右クリックすると
   * 1 件に潰れる。画面では気づきにくく、「42 件選んだのに 1 件しか処理されない」の
   * 報告になる (2026-09-02 のログで、右クリック以降が 1 行も残っていなかった)。
   */
  const openContextMenu = (view: 0 | 1) => (path: string, position: { x: number; y: number }) => {
    const label = view === 1 ? 'Win B (右画面)' : 'Win A (左画面)';
    const replaced = view !== markedView || !markedPaths.includes(path);

    if (replaced) {
      if (markedPaths.length > 1) {
        logDebug(
          'file',
          `右クリック: 選択に入っていない行なので 1 件に選び直した (${markedPaths.length} 件 → 1 件)`,
          `${label} — ${path}`,
          'warn'
        );
      }
      setMarkedView(view);
      setMarkedPaths([path]);
      setMarkAnchor(path);
    }

    logDebug(
      'file',
      `右クリック: メニューを開いた (${replaced ? 1 : markedPaths.length} 件)`,
      `${label} — ${path}`
    );
    setMenuPos(position);
  };

  /** 連番の順序はツリーの並び (ソート済みのファイル一覧) に合わせる */
  const markedInOrder = useMemo(() => {
    const list = markedView === 1 ? fileListB : fileListA;
    const set = new Set(markedPaths);
    return list.filter((p) => set.has(p));
  }, [markedPaths, markedView, fileListA, fileListB]);

  const copyPathsToClipboard = async () => {
    const text = markedInOrder.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      logFileAction(`パスをコピー: ${markedInOrder.length} 件`);
    } catch {
      // 権限が無い環境向けのフォールバック
      // eslint-disable-next-line no-alert
      window.prompt('パスをコピーしてください', text);
      logDebug('file', 'パスをコピー: クリップボードが使えないので入力欄に出した', undefined, 'warn');
    }
  };

  const handleDuplicate = async () => {
    logFileAction(`複製: メニューから実行 (${markedInOrder.length} 件)`);
    const result = await duplicateFiles(markedView, markedInOrder);
    alert(result.message);
    if (result.ok) clearMarks();
  };

  /**
   * 選んだファイルにタップ補正を焼き込む。
   *
   * ⚠️ 上書きするので必ず確認を取る。基準が無ければ並びの先頭が基準になり、
   * その 1 枚は動かない — それを先に伝えること。
   */
  const applyPegTo = async (target: string[], mode: 'copy' | 'overwrite') => {
    if (target.length === 0) return;

    const names = target.map((p) => p.split('/').pop()).slice(0, 5).join('\n');
    const more = target.length > 5 ? `\n…ほか ${target.length - 5} 件` : '';
    const base = pegStabilizer.reference
      ? '今の基準へ合わせます。'
      : '先頭のファイルを基準にし、その 1 枚はそのまま残します。';

    if (mode === 'copy') {
      const ok = window.confirm(
        `${target.length} 件にタップ補正を焼き込み、選んだフォルダへ書き出します。\n` +
          `元のファイルは触りません。\n${base}\n\n${names}${more}`
      );
      if (!ok) {
        logFileAction(`タップ補正 → 別フォルダへ書き出す: 取り消した (${target.length} 件)`);
        return;
      }
      const result = await applyPegCorrectionToFiles(markedView, target, { mode: 'copy' });
      alert(result.message);
      return;
    }

    // ⚠️ 上書きは元に戻せない。控えを残すかどうかまで確かめる
    const ok = window.confirm(
      `${target.length} 件を上書きします。元に戻せません。\n${base}\n\n${names}${more}`
    );
    if (!ok) {
      logFileAction(`タップ補正で上書き: 取り消した (${target.length} 件)`);
      return;
    }
    const backup = window.confirm('上書きの前に、元のファイルを _orig 付きで残しますか？');
    const result = await applyPegCorrectionToFiles(markedView, target, { mode: 'overwrite', backup });
    alert(result.message);
  };

  const handleApplyPeg = () => applyPegTo(markedInOrder, 'copy');
  const handleApplyPegOverwrite = () => applyPegTo(markedInOrder, 'overwrite');

  /** フォルダ全体 (そのビューの一覧すべて) に適用する */
  const handleApplyPegToFolder = () => applyPegTo(markedView === 1 ? fileListB : fileListA, 'copy');

  const handleDelete = async () => {
    const names = markedInOrder.map((p) => p.split('/').pop()).slice(0, 5).join('\n');
    const more = markedInOrder.length > 5 ? `\n…ほか ${markedInOrder.length - 5} 件` : '';
    // ⚠️ 元に戻せないので必ず確認を取る
    const ok = window.confirm(
      `${markedInOrder.length} 件のファイルを削除します。元に戻せません。\n\n${names}${more}`
    );
    if (!ok) {
      logFileAction(`削除: 取り消した (${markedInOrder.length} 件)`);
      return;
    }

    const result = await deleteFiles(markedView, markedInOrder);
    alert(result.message);
    if (result.ok) clearMarks();
  };

  /**
   * 選んだファイルを、新しいフォルダへまとめて移す。
   *
   * ⚠️ 元の場所から動くので必ず確認を取る。どこに作られるかは
   * 選んだファイルの置き場所で決まる — それを確認の文面に出すこと。
   */
  const handleMoveToNewFolder = async () => {
    if (markedInOrder.length === 0) return;

    // eslint-disable-next-line no-alert
    const name = window.prompt(
      `${markedInOrder.length} 件をまとめる新しいフォルダの名前を入力してください。`,
      '新規フォルダ'
    );
    if (name === null) {
      logFileAction(`新しいフォルダにまとめる: 取り消した (${markedInOrder.length} 件)`);
      return;
    }

    const invalid = invalidFolderName(name);
    if (invalid) {
      logDebug('file', `新しいフォルダにまとめる: 中止 (${invalid})`, `入力された名前「${name}」`, 'warn');
      alert(invalid);
      return;
    }

    const list = markedView === 1 ? fileListB : fileListA;
    const plan = buildMoveToFolderPlan(markedInOrder, name, list);
    if (plan.problems.length > 0) {
      logDebug('file', `新しいフォルダにまとめる: 中止 (${plan.problems.length} 件の問題)`, plan.problems.join(' / '), 'warn');
      alert(`まとめられません:\n${plan.problems.join('\n')}`);
      return;
    }

    const names = markedInOrder.map((p) => p.split('/').pop()).slice(0, 5).join('\n');
    const more = markedInOrder.length > 5 ? `\n…ほか ${markedInOrder.length - 5} 件` : '';
    const ok = window.confirm(
      `「${plan.folderPath}」を作って、${plan.items.length} 件をそこへ移します。\n` +
        `元の場所からは無くなります。\n\n${names}${more}`
    );
    if (!ok) {
      logFileAction(`新しいフォルダにまとめる: 取り消した (${plan.items.length} 件 → ${plan.folderPath})`);
      return;
    }

    const result = await moveFilesToNewFolder(markedView, markedInOrder, name);
    alert(result.message);
    if (result.ok) clearMarks();
  };

  /**
   * メニューから始めた操作を、取り消した場合も含めて残す。
   *
   * ⚠️ 確認で「いいえ」を押した場合はストアまで届かない。ここで残さないと
   * 「操作したのに何も起きない」の報告を追えなくなる。
   */
  const logFileAction = (message: string, detail?: string) => {
    logDebug('file', message, `${markedView === 1 ? 'Win B (右画面)' : 'Win A (左画面)'}${detail ? ` — ${detail}` : ''}`);
  };

  const contextMenuItems: (ContextMenuItem | { type: 'divider' })[] = [
    {
      id: 'rename',
      label: markedInOrder.length > 1 ? `${markedInOrder.length} 項目の名前を変更...` : '名前を変更...',
      icon: <Type className="w-3.5 h-3.5" />,
      onSelect: () => {
        logFileAction(`名前を変更: ダイアログを開いた (${markedInOrder.length} 件)`);
        setIsRenameOpen(true);
      },
    },
    {
      id: 'duplicate',
      label: markedInOrder.length > 1 ? `コピー (${markedInOrder.length} 項目を複製)` : 'コピー (複製を作成)',
      icon: <Copy className="w-3.5 h-3.5" />,
      onSelect: handleDuplicate,
    },
    {
      id: 'copy-path',
      label: markedInOrder.length > 1 ? `パスをコピー (${markedInOrder.length} 項目)` : 'パスをコピー',
      icon: <ClipboardCopy className="w-3.5 h-3.5" />,
      onSelect: copyPathsToClipboard,
    },
    {
      id: 'move-to-folder',
      label:
        markedInOrder.length > 1
          ? `新しいフォルダにまとめる (${markedInOrder.length} 項目)...`
          : '新しいフォルダにまとめる...',
      icon: <FolderPlus className="w-3.5 h-3.5" />,
      onSelect: handleMoveToNewFolder,
    },
    { type: 'divider' },
    {
      id: 'peg',
      label:
        markedInOrder.length > 1
          ? `タップ補正 → 別フォルダへ書き出す (${markedInOrder.length} 項目)`
          : 'タップ補正 → 別フォルダへ書き出す',
      icon: <Anchor className="w-3.5 h-3.5" />,
      onSelect: handleApplyPeg,
    },
    {
      id: 'peg-folder',
      label: `タップ補正 → フォルダ全体を書き出す (${(markedView === 1 ? fileListB : fileListA).length} 枚)`,
      icon: <Anchor className="w-3.5 h-3.5" />,
      onSelect: handleApplyPegToFolder,
    },
    {
      id: 'peg-overwrite',
      label:
        markedInOrder.length > 1
          ? `タップ補正で上書き (${markedInOrder.length} 項目)`
          : 'タップ補正で上書き',
      icon: <Anchor className="w-3.5 h-3.5" />,
      danger: true,
      onSelect: handleApplyPegOverwrite,
    },
    { type: 'divider' },
    {
      id: 'delete',
      label: markedInOrder.length > 1 ? `${markedInOrder.length} 項目を削除` : '削除',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      onSelect: handleDelete,
    },
  ];

  const handleSelectFromTreeA = (localIdx: number) => {
    const path = fileListA[localIdx];
    if (!path) return;
    setCurrentFileIndex(toUnifiedIndex(path, localIdx), 'ツリー Win A の行をクリック');
  };

  const handleSelectFromTreeB = (localIdx: number) => {
    const path = fileListB[localIdx];
    if (!path) return;
    setSplitFileIndex(toUnifiedIndexForView(path, 1, localIdx), 'ツリー Win B の行をクリック');
  };

  // 各ツリー内で「今表示中のセル」がどれかを求める
  /**
   * 統合リスト上の位置から、各ツリー内での位置を求める。
   *
   * ファイル名での一致 → フレーム番号での突き合わせ → 同位置、の順に試す。
   * 名前だけで引くと、マージ情報が無い読み込み経路で解決できず
   * Win B 側のハイライトが出なくなる。
   */
  /**
   * 統合リスト上の位置 → ツリー内の位置。
   *
   * ⚠️ パスの完全一致だけで引く。以前はフレーム番号での突き合わせと
   * 「同じ位置」へのフォールバックがあり、対応が取れないときに
   * 無関係な行がハイライトされて選択が飛んでいるように見えていた。
   * 対応するファイルが無いなら -1 (どこもハイライトしない) が正しい。
   */
  const toLocalIndex = (unifiedIdx: number, list: string[], view: 0 | 1) => {
    if (list.length === 0) return -1;
    const name = resolveFileNameForView(unifiedIdx, view);
    return name ? list.indexOf(name) : -1;
  };

  const activeLocalIdxA = toLocalIndex(currentFileIndex, fileListA, 0);
  const activeLocalIdxB = toLocalIndex(splitFileIndex, fileListB, 1);

  // 可視ノードのフラット配列 (キーボード移動用)
  const flatVisibleNodes = useMemo(() => {
    return getFlatVisibleNodes(fileTreeNodes, expandedPaths);
  }, [fileTreeNodes, expandedPaths]);

  // 連番フレーム行クリック時の連動・個別のルーティング挙動
  // 連動中の Win B への追従はストア側 (setCurrentFileIndex) が担う。
  // ここで両方に同じ番号を入れると、連動開始時のコマ差が失われる。
  const handleSelectFrame = (idx: number, source = 'ツリー (統合) の行をクリック') => {
    // セルは「今アクティブな方」へ出す
    if (activeViewIndex === 1) setSplitFileIndex(idx, source);
    else setCurrentFileIndex(idx, source);
  };

  /** ロールのツリーは、その面のものだけを開く (どちらへ出るか迷わせない) */
  const handleSelectRoll = (id: RollId, paths: string[]) => (localIdx: number) => {
    const path = paths[localIdx];
    if (path) selectRollFile(id, path, '撮影ロールのツリーをクリック');
  };

  // ⌨️ キーボード方向キー (↑ ↓ ← → Enter Space) ナビゲーション処理
  const handleTreeKeyDown = (e: React.KeyboardEvent) => {
    if (flatVisibleNodes.length === 0) return;

    const currentFlatIdx = flatVisibleNodes.findIndex((item) => item.node.path === focusedPath);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = Math.min(flatVisibleNodes.length - 1, currentFlatIdx < 0 ? 0 : currentFlatIdx + 1);
      const nextNode = flatVisibleNodes[nextIdx].node;
      setFocusedPath(nextNode.path);
      if (!nextNode.isFolder && nextNode.fileIndex !== undefined) {
        handleSelectFrame(nextNode.fileIndex, 'ツリーでキー ↓');
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = Math.max(0, currentFlatIdx <= 0 ? 0 : currentFlatIdx - 1);
      const prevNode = flatVisibleNodes[prevIdx].node;
      setFocusedPath(prevNode.path);
      if (!prevNode.isFolder && prevNode.fileIndex !== undefined) {
        handleSelectFrame(prevNode.fileIndex, 'ツリーでキー ↑');
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (currentFlatIdx >= 0) {
        const { node } = flatVisibleNodes[currentFlatIdx];
        if (node.isFolder) {
          if (!expandedPaths.has(node.path)) {
            togglePath(node.path, true);
          } else if (node.children && node.children.length > 0) {
            setFocusedPath(node.children[0].path);
          }
        }
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (currentFlatIdx >= 0) {
        const { node, parentPath } = flatVisibleNodes[currentFlatIdx];
        if (node.isFolder && expandedPaths.has(node.path)) {
          togglePath(node.path, false);
        } else if (parentPath) {
          setFocusedPath(parentPath);
        }
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (currentFlatIdx >= 0) {
        const { node } = flatVisibleNodes[currentFlatIdx];
        if (node.isFolder) {
          togglePath(node.path);
        } else if (node.fileIndex !== undefined) {
          handleSelectFrame(node.fileIndex, 'ツリーで Enter / Space');
        }
      }
    }
  };

  /**
   * カットフォルダ（ルート）一括読み込み。
   *
   * ⚠️ 相対パスは必ずルートフォルダ名から始め、ハンドルはルートを持たせる。
   * 以前はパスがサブフォルダ名から始まるのにハンドルもサブフォルダだったため、
   * resolveFileHandle() が「_go の中の _go」を探して必ず失敗し、
   * 読み込みは filesMap のフォールバックで通るのに保存だけ落ちていた。
   */
  const handleOpenCutRootFolder = async () => {
    if (!('showDirectoryPicker' in window)) {
      alert('お使いのブラウザはフォルダ一括選択APIに対応していません。');
      return;
    }

    try {
      const rootHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      const rootName: string = rootHandle.name;

      // ⚠️ 走査は共通の関数に任せる。メニューバー側と同じ結果になるように
      const subDirs = await scanCutRootFolder(rootHandle, rootName);

      if (subDirs.length === 0) {
        alert('選択したフォルダに画像ファイル (.tga / .png / .jpg) が見つかりませんでした。');
        return;
      }

      setCutRootFolder(rootHandle, rootName, subDirs);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Error opening root cut folder:', err);
    }
  };

  /**
   * Win A / Win B のフォルダを個別に開く。
   *
   * ⚠️ 以前は直下 1 階層しか見ておらず、サブフォルダの中の画像は
   * ツリーにも出ず読み込めなかった。走査は共通の再帰関数に任せる。
   * 相対パスは選んだフォルダ名から始め、ハンドルはそのフォルダを渡す。
   */
  const openFolderForView = async (view: 0 | 1) => {
    const inputRef = view === 1 ? fileInputRefB : fileInputRefA;

    if ('showDirectoryPicker' in window) {
      try {
        const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
        const filesMap = new Map<string, File>();
        await collectImageFilesRecursively(handle, handle.name, filesMap);

        if (filesMap.size === 0) {
          alert(
            `選択した Dir ${view === 1 ? 'B' : 'A'} フォルダに画像ファイル (.tga / .png / .jpg) が見つかりませんでした。`
          );
          return;
        }

        const files = sortNatural(filesMap.keys());
        if (view === 1) setFolderHandleB(handle, handle.name, files, filesMap);
        else setFolderHandleA(handle, handle.name, files, filesMap);
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.error('Error opening folder:', err);
      }
    }

    inputRef.current?.click();
  };

  const handleOpenFolderA = () => openFolderForView(0);
  const handleOpenFolderB = () => openFolderForView(1);

  /**
   * showDirectoryPicker が使えない環境向けの <input webkitdirectory> 経路。
   *
   * ⚠️ キーには webkitRelativePath (ルートフォルダ名から始まる相対パス) を使う。
   * ファイル名だけをキーにすると、a/0001.tga と b/0001.tga のように
   * 階層違いの同名コマが Map で上書きされて片方が消える。
   */
  const readFileInput = (fileList: FileList, fallbackName: string) => {
    const filesMap = new Map<string, File>();
    let folderName = fallbackName;

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (!isSupportedImageFile(file.name)) continue;

      const relPath: string = (file as any).webkitRelativePath || file.name;
      filesMap.set(relPath, file);

      const parts = relPath.split('/');
      if (parts.length > 1) folderName = parts[0];
    }

    return { filesMap, folderName };
  };

  const handleFileInputChangeA = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const { filesMap, folderName } = readFileInput(e.target.files, 'Folder_A');
    if (filesMap.size > 0) setFolderFilesA(folderName, filesMap);
  };

  const handleFileInputChangeB = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const { filesMap, folderName } = readFileInput(e.target.files, 'Folder_B');
    if (filesMap.size > 0) setFolderFilesB(folderName, filesMap);
  };

  // 連動中の相手側への追従はストアが担う (連動開始時のコマ差を保つため)
  const handleSelectWinAOnly = (idx: number) => setCurrentFileIndex(idx, '連番表の Win A 列をクリック');
  const handleSelectWinBOnly = (idx: number) => setSplitFileIndex(idx, '連番表の Win B 列をクリック');

  return (
    <>
    <div className="flex-1 bg-white dark:bg-slate-900 border-b border-slate-300 dark:border-slate-800 flex flex-col select-none min-h-[200px]">
      {/* 1. 統合ファイルブラウザ ヘッダー */}
      <div className="h-6 bg-slate-100 dark:bg-slate-800 border-b border-slate-300 dark:border-slate-800 flex items-center justify-between px-2 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
        <div className="flex items-center gap-1.5 truncate">
          <FolderOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <span className="truncate">ファイルツリー</span>
        </div>

        {/* ツリー表示 / リスト表示 切替 ＆ 連動 */}
        <div className="flex items-center gap-1">
          <div className="flex items-center bg-slate-200 dark:bg-slate-700 p-0.5 rounded border border-slate-300 dark:border-slate-600">
            <button
              onClick={() => setViewMode('tree')}
              title="フォルダツリー構造で表示"
              className={`px-1.5 py-0.5 rounded text-[9px] flex items-center gap-0.5 font-bold ${
                viewMode === 'tree' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Network className="w-3 h-3" />
              <span>ツリー</span>
            </button>
            <button
              onClick={() => setViewMode('merge')}
              title="2画面連番マージリスト表示"
              className={`px-1.5 py-0.5 rounded text-[9px] flex items-center gap-0.5 font-bold ${
                viewMode === 'merge' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <List className="w-3 h-3" />
              <span>連番表</span>
            </button>
          </div>

          <button
            onClick={toggleSyncMode}
            title={
              syncMode
                ? `左右連動中${
                    syncFrameOffset !== 0
                      ? ` (Win B は Win A の ${syncFrameOffset > 0 ? `${syncFrameOffset} コマ先` : `${-syncFrameOffset} コマ手前`})`
                      : ' (同じコマ)'
                  }`
                : '独立モード (押すと現在のコマ差を保ったまま連動します)'
            }
            className={`px-1.5 py-0.5 rounded text-[9px] flex items-center gap-0.5 font-bold border transition-colors ${
              syncMode
                ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                : 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
            }`}
          >
            {syncMode ? <Link className="w-3 h-3" /> : <Link2Off className="w-3 h-3" />}
            {/* コマ差が見えないと「連動していない」ように見えるため常に表示する */}
            {syncMode && syncFrameOffset !== 0 && (
              <span className="tabular-nums">{syncFrameOffset > 0 ? `+${syncFrameOffset}` : syncFrameOffset}</span>
            )}
          </button>

          {/* ⚠️ 記録しているコマ差だけで出さないこと。実際のズレと食い違ったとき
              (連動中 (同じコマ) と出ているのに Win B だけ 1 コマ先) に、
              揃え直す手段が画面から消える */}
          {syncMode && isSplitView && (syncFrameOffset !== 0 || splitFileIndex !== currentFileIndex) && (
            <button
              onClick={alignSyncFrames}
              title="コマ差をリセットして Win B を Win A と同じコマに揃える"
              className="px-1.5 py-0.5 rounded text-[9px] font-bold border border-amber-400 text-amber-600 dark:text-amber-400 hover:bg-amber-500 hover:text-white transition-colors"
            >
              差を揃える
            </button>
          )}
        </div>
      </div>

      {/* 2. カット袋 (ルートフォルダ) 表示 & 一括選択 */}
      <div className="p-1.5 border-b border-slate-200 dark:border-slate-800 text-[10px] bg-slate-50 dark:bg-slate-950 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 truncate text-slate-700 dark:text-slate-300">
          <span className="font-bold text-slate-500">ルート:</span>
          <span className="font-semibold text-blue-600 dark:text-blue-400 truncate">
            {rootFolderName || '(カット未選択)'}
          </span>
        </div>
        <button
          onClick={handleOpenCutRootFolder}
          title="カットフォルダ（デジタルカット袋）を丸ごと選択してスキャン"
          className="text-[9px] bg-blue-600 hover:bg-blue-700 text-white px-2 py-0.5 rounded font-bold shadow-xs whitespace-nowrap flex items-center gap-1 transition-colors"
        >
          <FolderOpen className="w-3 h-3" />
          <span>カットを開く</span>
        </button>
      </div>

      {/* 3. サブフォルダセレクタ (Win A / Win B) */}
      <div className="p-1.5 border-b border-slate-200 dark:border-slate-800 text-[10px] grid grid-cols-2 gap-1.5 bg-white dark:bg-slate-900">
        {/* Win A セレクタ */}
        <div className="flex items-center gap-1">
          <span className="font-bold text-blue-600 dark:text-blue-400 flex-shrink-0">Win A:</span>
          {availableSubDirectories.length > 0 ? (
            <select
              value={selectedSubDirA || ''}
              onChange={(e) => setSelectedSubDirA(e.target.value)}
              className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1 py-0.5 text-[10px] font-semibold text-slate-800 dark:text-slate-200 truncate cursor-pointer"
            >
              {availableSubDirectories.map((dir) => (
                <option key={`a-${dir.name}`} value={dir.name}>
                  {dir.name} ({dir.fileList.length})
                </option>
              ))}
            </select>
          ) : (
            <button
              onClick={handleOpenFolderA}
              className="flex-1 text-left text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 truncate bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700"
            >
              {folderNameA || 'フォルダ選択'}
            </button>
          )}
        </div>

        {/* Win B セレクタ */}
        <div className="flex items-center gap-1">
          <span className="font-bold text-emerald-600 dark:text-emerald-400 flex-shrink-0">Win B:</span>
          {availableSubDirectories.length > 0 ? (
            <select
              value={selectedSubDirB || ''}
              onChange={(e) => setSelectedSubDirB(e.target.value)}
              className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1 py-0.5 text-[10px] font-semibold text-slate-800 dark:text-slate-200 truncate cursor-pointer"
            >
              {availableSubDirectories.map((dir) => (
                <option key={`b-${dir.name}`} value={dir.name}>
                  {dir.name} ({dir.fileList.length})
                </option>
              ))}
            </select>
          ) : (
            <button
              onClick={handleOpenFolderB}
              className="flex-1 text-left text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 truncate bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded border border-slate-200 dark:border-slate-700"
            >
              {folderNameB || 'フォルダ選択'}
            </button>
          )}
        </div>
      </div>

      {/* 4. メインツリー / 連番マージビュー */}
      <div
        className={`p-1 ${
          // ロールだけを読み込んだときは、案内で場所を取らずロールの一覧へ譲る
          unifiedFileList.length === 0 && rollPanes.length > 0
            ? 'flex-shrink-0'
            : 'flex-1 overflow-y-auto'
        }`}
      >
        {unifiedFileList.length === 0 ? (
          rollPanes.length > 0 ? (
            <div className="px-1 py-1.5 text-[10px] text-slate-400 dark:text-slate-500 select-none">
              セル画像は読み込まれていません (撮影ロールのみ)
            </div>
          ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-3 text-slate-400">
            <span className="text-[11px] font-medium mb-1">フォルダが読み込まれていません</span>
            <span className="text-[9px] text-slate-400 leading-relaxed">
              画面のどこへでもフォルダをドロップしてください。
              <br />
              セル画像 (.tga / .png / .jpg) と撮影ロール (.mov / .mp4) をまとめて読み込み、
              <br />
              ツリーから開いたファイルに合わせて表示先が切り替わります。
            </span>
          </div>
          )
        ) : viewMode === 'tree' ? (
          showDualTree ? (
            /* 📁📁 2画面分割中: Win A / Win B のツリーを並べて表示 */
            <div className="flex gap-1 h-full">
              {(
                [
                  {
                    key: 'A',
                    label: `Win A (${selectedSubDirA || folderNameA || 'Orig'})`,
                    tone: 'text-blue-600 dark:text-blue-400 border-blue-500/40',
                    selectionTone: 'blue' as const,
                    nodes: treeA,
                    onSelect: handleSelectFromTreeA,
                    onMark: markFileInView(0, fileListA),
                    onContext: openContextMenu(0),
                    activeIdx: activeLocalIdxA,
                  },
                  {
                    key: 'B',
                    label: `Win B (${selectedSubDirB || folderNameB || 'Retake'})`,
                    tone: 'text-emerald-600 dark:text-emerald-400 border-emerald-500/40',
                    selectionTone: 'emerald' as const,
                    nodes: treeB,
                    onSelect: handleSelectFromTreeB,
                    onMark: markFileInView(1, fileListB),
                    onContext: openContextMenu(1),
                    activeIdx: activeLocalIdxB,
                  },
                ] as const
              ).map((pane) => (
                <div key={pane.key} className="flex-1 min-w-0 flex flex-col">
                  <div
                    className={`text-[9px] font-bold px-1 pb-1 mb-1 border-b truncate select-none ${pane.tone}`}
                  >
                    {pane.label}
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-0.5">
                    {pane.nodes.length === 0 && (
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 px-1 py-2 leading-relaxed select-none">
                        フォルダが開かれていません。
                        <br />
                        {pane.key === 'A' ? 'Open A' : 'Open B'} から選択するか、
                        {pane.key === 'A' ? 'Win A' : 'Win B'} へフォルダをドロップしてください。
                      </div>
                    )}
                    {pane.nodes.map((node) => (
                      <TreeItemNode
                        key={node.path}
                        node={node}
                        depth={0}
                        expandedPaths={expandedPaths}
                        focusedPath={focusedPath}
                        togglePath={togglePath}
                        onSelectFile={pane.onSelect}
                        onFocusNode={setFocusedPath}
                        currentIdx={pane.activeIdx}
                        selectionTone={pane.selectionTone}
                        showSyncBadge={syncMode}
                        markedPaths={new Set(markedInOrder)}
                        onMarkFile={pane.onMark}
                        onContextFile={pane.onContext}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
          /* 📁 フォルダ階層ツリービュー (キーボード ↑ ↓ ← → 操作対応) */
          <div
            tabIndex={0}
            onKeyDown={handleTreeKeyDown}
            className="space-y-0.5 outline-none focus:ring-1 focus:ring-blue-500/50 rounded-xs"
          >
            {fileTreeNodes.map((node) => (
              <TreeItemNode
                key={node.path}
                node={node}
                depth={0}
                expandedPaths={expandedPaths}
                focusedPath={focusedPath}
                togglePath={togglePath}
                onSelectFile={handleSelectFrame}
                onFocusNode={setFocusedPath}
                currentIdx={currentFileIndex}
                markedPaths={new Set(markedInOrder)}
                onMarkFile={markFileInView(0, fileListA)}
                onContextFile={openContextMenu(0)}
                secondaryIdx={isSplitView ? splitFileIndex : undefined}
                showSyncBadge={syncMode && isSplitView}
              />
            ))}
          </div>
          )
        ) : (
          /* 📊 連番マージ表ビュー (Merge Table View) */
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="text-[9px] text-slate-400 dark:text-slate-500 border-b border-slate-200 dark:border-slate-800 select-none">
                <th className="pb-1 text-left w-2/5 font-semibold pl-1">Win A ({selectedSubDirA || folderNameA || 'Orig'})</th>
                <th className="pb-1 text-center font-semibold">フレーム</th>
                <th className="pb-1 text-right w-2/5 font-semibold pr-1">Win B ({selectedSubDirB || folderNameB || 'Retake'})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {mergedFrameNumbers.length > 0
                ? mergedFrameNumbers.map((frameNum, index) => {
                    const item = mergedFrameMap.get(frameNum);
                    const fileA = item?.fileNameA;
                    const fileB = item?.fileNameB;

                    const isActiveA = index === currentFileIndex;
                    const isActiveB = index === splitFileIndex;

                    return (
                      <tr key={frameNum} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td
                          onClick={() => fileA && handleSelectWinAOnly(index)}
                          className="py-1 px-0.5 cursor-pointer text-left"
                        >
                          {isActiveA && fileA ? (
                            <div className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs flex items-center justify-between">
                              <span className="truncate">{fileA}</span>
                              <span className="text-[8px] opacity-80 ml-0.5">◀</span>
                            </div>
                          ) : fileA ? (
                            <div className="text-[10px] text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 px-1 truncate transition-colors">
                              {fileA}
                            </div>
                          ) : (
                            <div className="text-[9px] text-slate-300 dark:text-slate-600 px-1 italic">
                              -
                            </div>
                          )}
                        </td>

                        <td
                          onClick={() => handleSelectFrame(index, '連番表のフレーム列をクリック')}
                          className={`py-1 text-center font-mono text-[11px] cursor-pointer truncate px-1 ${
                            isActiveA || isActiveB
                              ? 'font-bold text-blue-600 dark:text-blue-400 bg-blue-50/80 dark:bg-blue-900/30 rounded'
                              : 'text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400'
                          }`}
                        >
                          {frameNum}
                        </td>

                        <td
                          onClick={() => fileB && handleSelectWinBOnly(index)}
                          className="py-1 px-0.5 cursor-pointer text-right"
                        >
                          {isActiveB && fileB ? (
                            <div className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs flex items-center justify-between">
                              <span className="text-[8px] opacity-80 mr-0.5">▶</span>
                              <span className="truncate">{fileB}</span>
                            </div>
                          ) : fileB ? (
                            <div className="text-[10px] text-slate-600 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 px-1 truncate transition-colors">
                              {fileB}
                            </div>
                          ) : (
                            <div className="text-[9px] text-amber-500/80 font-bold px-1 flex items-center justify-end gap-0.5" title="Win B に対応セルがありません">
                              <AlertTriangle className="w-2.5 h-2.5 text-amber-500" />
                              <span>欠落</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                : unifiedFileList.map((fileName, index) => {
                    const inA = fileListA.includes(fileName);
                    const inB = fileListB.includes(fileName);
                    const isActiveA = index === currentFileIndex;
                    const isActiveB = index === splitFileIndex;

                    return (
                      <tr key={fileName} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td
                          onClick={() => inA && handleSelectWinAOnly(index)}
                          className="py-1 px-0.5 cursor-pointer text-left"
                        >
                          {isActiveA ? (
                            <div className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs truncate">
                              {fileName}
                            </div>
                          ) : inA ? (
                            <div className="text-[10px] text-slate-500 hover:text-blue-600 px-1 truncate">
                              {fileName}
                            </div>
                          ) : (
                            <div className="text-[9px] text-slate-300 px-1">-</div>
                          )}
                        </td>
                        <td
                          onClick={() => handleSelectFrame(index, '連番表のフレーム列をクリック')}
                          className="py-1 text-center font-mono text-[11px] cursor-pointer truncate px-1 text-slate-700 dark:text-slate-300"
                        >
                          {fileName}
                        </td>
                        <td
                          onClick={() => inB && handleSelectWinBOnly(index)}
                          className="py-1 px-0.5 cursor-pointer text-right"
                        >
                          {isActiveB ? (
                            <div className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-xs truncate">
                              {fileName}
                            </div>
                          ) : inB ? (
                            <div className="text-[10px] text-slate-500 hover:text-emerald-600 px-1 truncate">
                              {fileName}
                            </div>
                          ) : (
                            <div className="text-[9px] text-amber-500 font-bold px-1 text-right">欠落</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        )}
      </div>

      {/* 5. 撮影ロールのツリー。開いている面の数だけ横に並べる */}
      {rollPanes.length > 0 && (
        <div
          className={`border-t border-slate-300 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 flex flex-col min-h-0 ${
            unifiedFileList.length === 0 ? 'flex-1' : 'flex-shrink-0 max-h-[45%]'
          }`}
        >
          <div className="h-5 px-2 flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 dark:text-slate-400 select-none flex-shrink-0">
            <Film className="w-3 h-3 text-indigo-500 flex-shrink-0" />
            <span>撮影ロール</span>

            {/* 2 面あるときだけ。ツリーの選択を連動させる (再生の連動はロール窓のヘッダー側) */}
            {rollPanes.length > 1 && (
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={toggleRollFileSync}
                  title={
                    roll.fileSync
                      ? `ツリー連動中${
                          roll.fileSyncOffset !== 0
                            ? ` (ロール B は ロール A の ${
                                roll.fileSyncOffset > 0
                                  ? `${roll.fileSyncOffset} 本先`
                                  : `${-roll.fileSyncOffset} 本手前`
                              })`
                            : ' (同じ位置)'
                        }`
                      : '独立モード (押すと今のずれを保ったまま、片方で選ぶともう片方も動きます)'
                  }
                  className={`px-1.5 py-0.5 rounded text-[9px] flex items-center gap-0.5 font-bold border transition-colors ${
                    roll.fileSync
                      ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                      : 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {roll.fileSync ? <Link className="w-3 h-3" /> : <Link2Off className="w-3 h-3" />}
                  <span>選択連動</span>
                  {/* ずれが見えないと「連動していない」ように見えるため常に出す */}
                  {roll.fileSync && roll.fileSyncOffset !== 0 && (
                    <span className="tabular-nums">
                      {roll.fileSyncOffset > 0 ? `+${roll.fileSyncOffset}` : roll.fileSyncOffset}
                    </span>
                  )}
                </button>

                {roll.fileSync && roll.fileSyncOffset !== 0 && (
                  <button
                    onClick={alignRollFiles}
                    title="ずれをリセットして ロール B を ロール A と同じ位置に揃える"
                    className="px-1.5 py-0.5 rounded text-[9px] font-bold border border-amber-400 text-amber-600 dark:text-amber-400 hover:bg-amber-500 hover:text-white transition-colors"
                  >
                    差を揃える
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-1 flex-1 min-h-0 px-1 pb-1">
            {rollPanes.map((pane) => (
              <div key={pane.id} className="flex-1 min-w-0 flex flex-col">
                <div
                  className={`text-[9px] font-bold px-1 pb-1 mb-1 border-b truncate select-none flex items-center gap-1 ${pane.tone}`}
                >
                  {/* フォルダ名が無いのは 1 本だけ開いたとき。空の括弧を出さない */}
                  <span className="truncate">
                    {pane.folderName ? `${pane.label} (${pane.folderName})` : pane.label}
                  </span>
                  {/* どの面へ開くかは面ごとのツリーで決まるが、他の導線 (連番表など) の
                      行き先が分かるように、アクティブな面には印を出す */}
                  {roll.activeId === pane.id && rollPanes.length > 1 && (
                    <span className="text-[8px] font-bold bg-amber-400 text-slate-900 px-1 rounded flex-shrink-0">
                      選択先
                    </span>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto space-y-0.5">
                  {pane.nodes.length === 0 ? (
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 px-1 py-2 leading-relaxed select-none">
                      ロールが読み込まれていません。
                      <br />
                      {pane.label} へ .mov / .mp4 かフォルダをドロップしてください。
                    </div>
                  ) : (
                    pane.nodes.map((node) => (
                      <TreeItemNode
                        key={node.path}
                        node={node}
                        depth={0}
                        expandedPaths={expandedPaths}
                        focusedPath={focusedPath}
                        togglePath={togglePath}
                        onSelectFile={handleSelectRoll(pane.id, pane.paths)}
                        onFocusNode={setFocusedPath}
                        currentIdx={pane.activeIdx}
                        selectionTone={pane.selectionTone}
                        fileIcon="film"
                        showSyncBadge={roll.fileSync}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <input
        type="file"
        ref={fileInputRefA}
        onChange={handleFileInputChangeA}
        className="hidden"
        {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
      />
      <input
        type="file"
        ref={fileInputRefB}
        onChange={handleFileInputChangeB}
        className="hidden"
        {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
      />
    </div>

      {menuPos && markedInOrder.length > 0 && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={contextMenuItems.map((item) =>
            'type' in item
              ? item
              : {
                  ...item,
                  onSelect: () => {
                    menuUsedRef.current = true;
                    item.onSelect();
                  },
                }
          )}
          onClose={() => {
            if (!menuUsedRef.current) logDebug('file', '右クリック: メニューを閉じた (項目を選ばなかった)');
            menuUsedRef.current = false;
            setMenuPos(null);
          }}
        />
      )}

      {isRenameOpen && markedInOrder.length > 0 && (
        <RenameModal
          view={markedView}
          paths={markedInOrder}
          onClose={() => setIsRenameOpen(false)}
          onRenamed={clearMarks}
        />
      )}
    </>
  );
};
