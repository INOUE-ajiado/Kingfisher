import React, { useRef, useEffect, useState, useCallback } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { collectImageFilesRecursively, isSupportedImageFile, readAllDirectoryEntries, resolveDropHandles } from '../../engine/fileSystemPath';
import { collectDroppedVideoFiles, commonRootName } from '../../engine/videoSource';
import { sortNatural } from '../../engine/naturalOrder';
import {
  floodFill,
  gradientFill,
  closedAreaFill,
  drawBrushLine,
  removeSingleNoiseAt,
  sampleColorAt,
} from '../../engine/paintAlgorithm';
import { cloneTGAImage, createCheckerPattern } from '../../engine/imageDecode';
import { AlertTriangle, Maximize2, Minimize2, FolderOpen } from 'lucide-react';
import { useFloatingWindow } from '../../hooks/useFloatingWindow';
import { useFrameLoader, useCellPrefetch, useOnionSkinFrames } from '../../hooks/useFrameLoader';
import { CornerResizeHandles } from '../common/CornerResizeHandles';
import { DockPlaceholder } from '../common/DockPlaceholder';
import { ReferenceCanvasView } from './ReferenceCanvasView';
import { RollViewer } from './RollViewer';
import { PaneTabBar, PaneDropGap, isPaneDrag } from './PaneTabBar';
import { PaneId, PANE_LABELS } from '../../engine/paneLayout';
import { RollId } from '../../store/types';
import { logDebug, PLAYBACK_SOURCE } from '../../engine/debugLog';

export const CellWindow: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const {
    currentFileIndex,
    splitFileIndex,
    isSplitView,
    syncMode,
    activeViewIndex,
    setActiveViewIndex,
    activeTool,
    toolOptions,
    currentColor,
    backgroundColor,
    setCurrentColor,
    currentImage,
    setCurrentImage,
    splitImage,
    setSplitImage,
    resolveFileNameForView,
    isDirtyA,
    isDirtyB,
    prevImage,
    nextImage,
    canvasTransform,
    setCanvasTransform,
    splitCanvasTransform,
    setSplitCanvasTransform,
    lightTable,
    renderTrigger,
    triggerRender,
    folderNameA,
    folderNameB,
    saveUndoState,
    isPlaying,
    fps,
    roll,
    toggleRollFloating,
    loadRollFiles,
    closeRollWindow,
    closeReferenceWindow,
    toggleIsSplitView,
    isWinAVisible,
    toggleWinAVisible,
    paneLayout,
    syncPaneVisibility,
    setActivePaneInSlot,
    stackPaneOnSlot,
    movePaneToPosition,
    toggleMaximizedPane,
    setPaneSlotFlex,
    showGrid,
    showRuler,
    showUnpaintedFlash,
    pegStabilizer,
    referenceCanvas,
    colorSpecLayoutMode,
    isWinAFloating,
    isWinBFloating,
    toggleWinAFloating,
    toggleWinBFloating,
    toggleReferenceFloating,
    setCustomDropFolderA,
    setCustomDropFolderB,
    setFolderHandleA,
    setFolderHandleB,
    canvasBgMatteMode,
    canvasCustomBgColor,
  } = usePaintStore();

  // 引きはがし・移動・リサイズ・ドッキング復帰・重なり順は useFloatingWindow に集約
  const winAWindow = useFloatingWindow({
    id: 'winA',
    isFloating: isWinAFloating,
    getIsFloating: () => usePaintStore.getState().isWinAFloating,
    toggleFloating: toggleWinAFloating,
    dockTargetId: 'winA-dock-target',
    minWidth: 320,
    minHeight: 240,
  });

  const winBWindow = useFloatingWindow({
    id: 'winB',
    isFloating: isWinBFloating,
    getIsFloating: () => usePaintStore.getState().isWinBFloating,
    toggleFloating: toggleWinBFloating,
    dockTargetId: 'winB-dock-target',
    minWidth: 320,
    minHeight: 240,
  });

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [lassoPoints, setLassoPoints] = useState<{ x: number; y: number }[]>([]);
  const [isLassoing, setIsLassoing] = useState(false);
  /**
   * 投げ縄をどちらのウィンドウで引いているか。
   *
   * ⚠️ 以前は投げ縄の状態にビューの区別が無く、プレビューの描画が
   * 左キャンバスに固定されていた。そのため Win B でドラッグすると
   * B には何も出ず、輪郭線が Win A に現れる。塗り自体は B に入るのに
   * 「Win B の操作が Win A に吸われた」ようにしか見えなかった。
   */
  const [lassoView, setLassoView] = useState<0 | 1>(0);
  const [isBrushing, setIsBrushing] = useState(false);
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null);
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  /**
   * ドラッグ操作を canvas の外で離した時の取りこぼし対策。
   *
   * パン・ブラシの終了は canvas の onMouseUp だけに任せていたため、
   * キャンバスの外へ出てからボタンを離すと状態が「押しっぱなし」のまま残り、
   * 以降の左クリックがすべてパン扱いになって描画ツールが反応しなくなる。
   * window 側でも確実に終了させる。
   */
  useEffect(() => {
    if (!isPanning && !isBrushing) return;

    const endDrag = () => {
      setIsPanning(false);
      setIsBrushing(false);
      setLastPos(null);
    };

    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [isPanning, isBrushing]);

  /**
   * 投げ縄をキャンバスの外で離したときの取りこぼし対策。
   *
   * 上の endDrag は isLassoing を落としていない (依存配列も [isPanning, isBrushing]
   * なので投げ縄だけの操作では登録すらされない)。そのため外で離すと
   * 「投げ縄を引いている」状態が残り、ボタンを押していないのにカーソルへ
   * 輪郭線が付いてきてしまう。
   *
   * ⚠️ キャンバス上で離した分はここで触らないこと。pointerup は onMouseUp より
   * 先に来るため、無条件に打ち切ると通常の塗りが実行されなくなる。
   * 外で離した場合は塗らずに破棄する (キャンバス上で離したときだけ塗る、という
   * 従来の意図をそのまま保つ)。履歴は確定の直前に積むので、破棄しても
   * 履歴や「未保存」の表示は汚れない。
   */
  useEffect(() => {
    if (!isLassoing) return;

    const cancelLasso = (e: Event) => {
      const canvas = lassoView === 1 ? rightCanvasRef.current : leftCanvasRef.current;
      if (canvas && e.target === canvas) return;
      setIsLassoing(false);
      setLassoPoints([]);
    };

    window.addEventListener('pointerup', cancelLasso);
    window.addEventListener('pointercancel', cancelLasso);
    return () => {
      window.removeEventListener('pointerup', cancelLasso);
      window.removeEventListener('pointercancel', cancelLasso);
    };
  }, [isLassoing, lassoView]);

  /**
   * ウィンドウからフォーカスが外れている間に Space を離すと keyup が届かず、
   * 「Space 押しっぱなし」と誤認して左クリックがパンになり続ける。
   */
  useEffect(() => {
    const clearSpace = () => setIsSpacePressed(false);
    window.addEventListener('blur', clearSpace);
    return () => window.removeEventListener('blur', clearSpace);
  }, []);

  // ⌨️ Space キー検出 (Space キーを押している間は一時的にパン移動ツール化)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // エクスプローラーダイレクト D&D ドラッグオーバー・ステート
  // ── ドッキング中の参照ウィンドウとの境界線ドラッグ ──────────────────
  // ドラッグ中はストアを毎フレーム更新せず、flexGrow を直接書き換える。
  // 確定値は離した時にだけ保存するので、React の再描画が挟まらず滑らかに動く。
  const splitRowRef = useRef<HTMLDivElement | null>(null);

  /**
   * 枠と枠のあいだの仕切り。ドラッグで左右の取り分を変える。
   *
   * ⚠️ ドラッグ中は DOM の flexGrow を直接書き、離した時だけストアへ確定する。
   * 毎フレーム state を更新すると、キャンバスを持つ面が付いてこられない。
   */
  const handleSlotResizePointerDown = (e: React.PointerEvent, leftId: string, rightId: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const row = splitRowRef.current;
    const leftEl = row?.querySelector<HTMLElement>(`[data-slot-id="${leftId}"]`);
    const rightEl = row?.querySelector<HTMLElement>(`[data-slot-id="${rightId}"]`);
    if (!leftEl || !rightEl) return;

    const leftFlex = paneLayout.slots.find((sl) => sl.id === leftId)?.flexGrow ?? 1;
    const rightFlex = paneLayout.slots.find((sl) => sl.id === rightId)?.flexGrow ?? 1;
    const sum = leftFlex + rightFlex;

    const startX = leftEl.getBoundingClientRect().left;
    const totalPx = leftEl.getBoundingClientRect().width + rightEl.getBoundingClientRect().width;
    if (totalPx <= 0) return;

    let nextLeft = leftFlex;
    let nextRight = rightFlex;

    const onPointerMove = (ev: PointerEvent) => {
      const ratio = Math.min(0.85, Math.max(0.15, (ev.clientX - startX) / totalPx));
      nextLeft = sum * ratio;
      nextRight = sum * (1 - ratio);
      leftEl.style.flexGrow = String(nextLeft);
      rightEl.style.flexGrow = String(nextRight);
    };

    const finish = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setPaneSlotFlex(leftId, nextLeft);
      setPaneSlotFlex(rightId, nextRight);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  /**
   * アクティブなウィンドウを示す枠線。
   *
   * ⚠️ 独立ウィンドウ (Tear-off) 側は以前 Win A=青 / Win B=緑 の固定色で、
   * activeViewIndex を反映していなかった。切り離すと「どちらが操作対象か」が
   * 枠線から読み取れなくなり、Win B を触っているのに Win A がアクティブに
   * 見える状態になっていたため、ドッキング中と同じ規則へ揃える。
   */
  const activeBorderClass = (view: 0 | 1, isFloating: boolean) => {
    const isActive = isSplitView && activeViewIndex === view;
    if (isFloating) {
      // 独立ウィンドウは枠が無いと背景に溶けるので、非アクティブでも色は残す
      return isActive
        ? 'border-blue-600 dark:border-blue-500'
        : 'border-slate-300 dark:border-slate-700';
    }
    // ⚠️ ドッキング中は枠が 1px なので、色だけでは分かりにくい。内側のリングで示す
    // (外側だと隣の面へはみ出し、エッジ・トゥ・エッジの並びが崩れる)
    return isActive
      ? 'border-blue-600 dark:border-blue-500 ring-1 ring-inset ring-blue-600/60'
      : 'border-slate-300 dark:border-slate-800';
  };

  // 閲覧専用の画像に描画しようとした時の通知 (無言で無視されると原因が分からないため)。
  // ⚠️ どちらのウィンドウで弾かれたかを保持する。単一の真偽値にすると
  // Win B をクリックしたのに Win A にも通知が出て、判定が Win A へ移ったように見える。
  const [readOnlyNoticeView, setReadOnlyNoticeView] = useState<0 | 1 | null>(null);

  /**
   * タブを掴んでいる間だけ、枠と枠のあいだに落とし先を開く。
   * ⚠️ 常時開けておかないこと。面を 2 つ並べるだけで左右と中央の 18px を失う。
   */
  const [isPaneDragging, setIsPaneDragging] = useState(false);
  useEffect(() => {
    if (readOnlyNoticeView === null) return;
    const timer = setTimeout(() => setReadOnlyNoticeView(null), 3000);
    return () => clearTimeout(timer);
  }, [readOnlyNoticeView]);

  // 参照ウィンドウがドッキング領域の上にいるか (跡地のハイライト用)
  const [isReferenceOverDock, setIsReferenceOverDock] = useState(false);

  const [isWinADragOver, setIsWinADragOver] = useState(false);
  const [isWinBDragOver, setIsWinBDragOver] = useState(false);

  /**
   * ファイルのドラッグ判定。
   *
   * dragenter / dragleave は子要素をまたぐたびに親へバブリングしてくる。
   * さらに Chrome / WebKit では dragleave が dragenter より先に発火することがあり、
   * 出入りの回数を数えるだけでは一瞬 0 になってハイライトが点滅する。
   * そこで発火順に依存しない 2 段構えにする。
   *
   *  1. dragleave は relatedTarget が自分の内側なら無視する (子要素への移動)
   *  2. dragover を心拍とみなし、一定時間届かなくなったら解除する
   *     (relatedTarget が null になるブラウザ差異への保険)
   */
  const DRAG_HEARTBEAT_MS = 500;
  const dragClearTimer = useRef<{ winA: number | null; winB: number | null }>({
    winA: null,
    winB: null,
  });

  const setDragOverState = (win: 'winA' | 'winB', active: boolean) => {
    if (win === 'winA') setIsWinADragOver(active);
    else setIsWinBDragOver(active);
  };

  const resetDragState = (win: 'winA' | 'winB') => {
    if (dragClearTimer.current[win] !== null) {
      clearTimeout(dragClearTimer.current[win]!);
      dragClearTimer.current[win] = null;
    }
    setDragOverState(win, false);
  };

  /**
   * ドラッグ継続中であることを記録し、途切れたら自動で解除する。
   *
   * ハイライトは常にどちらか一方だけ。Win A の上を通過して Win B へ入ると、
   * 心拍のタイムアウトが切れるまで Win A も光ったままになり、
   * どちらに取り込まれるのか分からなくなるため、相手側は即座に消す。
   */
  const keepDragAlive = (win: 'winA' | 'winB') => {
    const other: 'winA' | 'winB' = win === 'winA' ? 'winB' : 'winA';
    if (dragClearTimer.current[other] !== null) {
      clearTimeout(dragClearTimer.current[other]!);
      dragClearTimer.current[other] = null;
    }
    setDragOverState(other, false);

    setDragOverState(win, true);
    if (dragClearTimer.current[win] !== null) clearTimeout(dragClearTimer.current[win]!);
    dragClearTimer.current[win] = window.setTimeout(() => {
      dragClearTimer.current[win] = null;
      setDragOverState(win, false);
    }, DRAG_HEARTBEAT_MS);
  };

  /** ファイル / フォルダのドラッグかどうか (テキスト選択のドラッグ等を無視する) */
  const isFileDrag = (e: React.DragEvent) => {
    const types = e.dataTransfer?.types;
    return !!types && Array.prototype.includes.call(types, 'Files');
  };

  const handleWindowDragEnter = (e: React.DragEvent, win: 'winA' | 'winB') => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    keepDragAlive(win);
  };

  const handleWindowDragOver = (e: React.DragEvent, win: 'winA' | 'winB') => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    // 毎回指定しないとブラウザが「ドロップ不可」と判断して drop が発火しない
    e.dataTransfer.dropEffect = 'copy';
    keepDragAlive(win);
  };

  const handleWindowDragLeave = (e: React.DragEvent, win: 'winA' | 'winB') => {
    // 子要素へ移動しただけの dragleave は無視する
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    e.stopPropagation();
    resetDragState(win);
  };

  // ドラッグがウィンドウ外で終わった場合にハイライトが残らないようにする
  useEffect(() => {
    const clearAll = () => {
      resetDragState('winA');
      resetDragState('winB');
    };
    window.addEventListener('dragend', clearAll);
    window.addEventListener('drop', clearAll);
    return () => {
      window.removeEventListener('dragend', clearAll);
      window.removeEventListener('drop', clearAll);
    };
  }, []);

  // 📁 エクスプローラーからのフォルダ/ファイル直接ドロップ処理 (階層パス保持)
  const readDirectoryEntries = async (dirEntry: any, fileMap: Map<string, File>, currentPath = '') => {
    const entries = await readAllDirectoryEntries(dirEntry.createReader());

    for (const entry of entries) {
      const relPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
      if (entry.isFile) {
        const file: File | null = await new Promise((resolve) => (entry as any).file((f: File) => resolve(f), () => resolve(null)));
        if (file && isSupportedImageFile(file.name)) {
          fileMap.set(relPath, file);
        }
      } else if (entry.isDirectory) {
        await readDirectoryEntries(entry, fileMap, relPath);
      }
    }
  };

  /**
   * エクスプローラーから Win A / Win B へフォルダを落としたときの読み込み。
   *
   * ⚠️ 書き込みたいので getAsFileSystemHandle() を優先する。
   * webkitGetAsEntry() が返す FileSystemEntry は読み取り専用で、
   * これしか取らないと「ドロップしたフォルダは保存できない」状態になる。
   * getAsFileSystemHandle() に対応しない環境 (Firefox / Safari) では
   * 従来どおりエントリ経由で読み込み、保存だけができない扱いにする。
   */
  const handleFolderOrFilesNativeDrop = async (e: React.DragEvent, targetWin: 'winA' | 'winB') => {
    // ⚠️ タブの移動をここで拾わないこと。ファイルが 1 つも無いので
    // 「画像ファイルが見つかりませんでした」が出てしまう
    if (isPaneDrag(e.dataTransfer)) return;

    e.preventDefault();
    e.stopPropagation();

    resetDragState('winA');
    resetDragState('winB');

    // ⚠️ dataTransfer.items はハンドラを抜けた時点で無効になる。
    // await を挟む前に、エントリとハンドルの取得を同期的に始めておく。
    // (従来は 1 件目の処理を await した後で 2 件目を読んでいたため、
    //  複数まとめてドロップすると取りこぼしが起きていた)
    const entries: any[] = [];
    const handlePromises: Promise<any>[] = [];
    const items = e.dataTransfer.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item: any = items[i];
        if (typeof item.getAsFileSystemHandle === 'function') {
          handlePromises.push(item.getAsFileSystemHandle().catch(() => null));
        }
        const entry = item.webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
    }
    const plainFiles: File[] = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];

    const isWinA = targetWin === 'winA';
    const fileMap = new Map<string, File>();

    // --- 1. 書き込み可能なディレクトリハンドルが取れる場合 ---
    const handles = await resolveDropHandles(handlePromises);
    const dirHandle = handles.find((h: any) => h?.kind === 'directory') ?? null;

    if (dirHandle) {
      await collectImageFilesRecursively(dirHandle, dirHandle.name, fileMap);
      if (fileMap.size > 0) {
        const fileList = sortNatural(fileMap.keys());
        // 保存できる経路なので、ハンドルを持つ通常のフォルダとして登録する
        if (isWinA) setFolderHandleA(dirHandle, dirHandle.name, fileList, fileMap);
        else setFolderHandleB(dirHandle, dirHandle.name, fileList, fileMap);
        return;
      }
    }

    // --- 2. 読み取り専用のフォールバック (FileSystemEntry / 素のファイル) ---
    let detectedFolderName: string | null = null;

    for (const entry of entries) {
      if (entry.isDirectory) {
        if (!detectedFolderName) detectedFolderName = entry.name;
        await readDirectoryEntries(entry, fileMap, entry.name);
      } else if (entry.isFile) {
        const file: File | null = await new Promise((resolve) =>
          entry.file((f: File) => resolve(f), () => resolve(null))
        );
        if (file && isSupportedImageFile(file.name)) {
          fileMap.set((file as any).webkitRelativePath || file.name, file);
        }
      }
    }

    if (fileMap.size === 0) {
      for (const file of plainFiles) {
        if (isSupportedImageFile(file.name)) {
          fileMap.set((file as any).webkitRelativePath || file.name, file);
        }
      }
    }

    if (fileMap.size === 0) {
      // ⚠️ 画像が無いというだけで突き放さないこと。撮影ロールをセルの窓へ落とすのは
      // 自然な操作で、しかもロールウィンドウを閉じていると落とす先が他に無い。
      // ⚠️ plainFiles だけを見ないこと。フォルダを落とした場合そこにはフォルダ自体しか
      // 入っておらず、中の .mov / .mp4 が見えない。ハンドルとエントリも渡して中を探す。
      const videos = await collectDroppedVideoFiles(plainFiles, handles, entries);
      if (videos.length > 0) {
        // 開く面は「今アクティブなロール」。連動して見比べたい側へ落とせる
        loadRollFiles(roll.activeId, videos, commonRootName(videos));
        return;
      }
      alert(
        'ドロップされた中に画像ファイル (.tga / .png / .jpg) が見つかりませんでした。\n' +
          '撮影ロールは .mov / .mp4 に対応しています。'
      );
      return;
    }

    const fileList = sortNatural(fileMap.keys());
    const folderTitle = detectedFolderName || (isWinA ? 'ドロップフォルダ A' : 'ドロップフォルダ B');
    if (isWinA) setCustomDropFolderA(folderTitle, fileMap, fileList);
    else setCustomDropFolderB(folderTitle, fileMap, fileList);
  };


  // 画像の読み込み・先読み・オニオンスキンは useFrameLoader 系フックに委譲する。
  // (splitImage = Win B の編集対象はストア管理なので、保存・Undo が Win A と同じ経路を通る)
  const loadFrameForView = useFrameLoader();
  useCellPrefetch(loadFrameForView);
  const onionFramesMap = useOnionSkinFrames(loadFrameForView);

  // 自動フィットが最後に設定した値 (ユーザー操作との区別に使う)
  const lastFitTransformRef = useRef<{ scale: number; offsetX: number; offsetY: number } | null>(null);

  // 画面サイズ（PCディスプレイのキャンバスエリア高さ）に合わせて、仮想フレーム/セル画像が上下にぴったり収まるサイズに自動計算＆初期位置設定
  const fitToScreenHeight = useCallback(
    (reason: string) => {
      const container = containerRef.current;
      if (!container) return;

      const availableHeight = container.clientHeight - 48; // 上下24pxずつのマージン余白
      const targetHeight = currentImage ? currentImage.height : 480;
      if (availableHeight <= 0 || targetHeight <= 0) return;

      const fitScale = Math.min(Math.max(0.2, availableHeight / targetHeight), 3.0);
      const fitTransform = { scale: fitScale, offsetX: 0, offsetY: 0 };

      const before = usePaintStore.getState().canvasTransform.scale;
      logDebug(
        'view',
        `表示倍率 ${Math.round(before * 100)}% → ${Math.round(fitScale * 100)}% (自動フィット)`,
        `${reason} / 画像 ${currentImage ? `${currentImage.width}x${currentImage.height}` : '(なし)'} / 表示領域の高さ ${availableHeight}px / Win A と Win B の両方に適用`
      );

      // 「自動で合わせた値」を控えておく。これと現在値がずれていれば
      // ユーザーが自分でズーム・パンしたと判断できる。
      lastFitTransformRef.current = fitTransform;
      setCanvasTransform(fitTransform);
      setSplitCanvasTransform(fitTransform);
    },
    [currentImage, setCanvasTransform, setSplitCanvasTransform]
  );

  /**
   * 自動フィットは「画像のサイズが変わった時」だけ行う。
   *
   * 以前は currentImage が変わるたびに実行していたため、拡大して細部を塗っている最中に
   * コマ送りすると毎回ズームが初期化されてしまっていた。
   * 同じサイズのセルを送っている間は、ユーザーが決めた表示倍率と位置をそのまま保つ。
   */
  const lastFittedSizeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentImage) return;
    const sizeKey = `${currentImage.width}x${currentImage.height}`;
    if (lastFittedSizeRef.current === sizeKey) return;

    const previous = lastFittedSizeRef.current;
    lastFittedSizeRef.current = sizeKey;

    // ⚠️ ユーザーが自分で決めた倍率は壊さないこと。設定シートのようにサイズの違う
    // ファイルを 1 枚挟むだけで、拡大して塗っていた倍率が飛んでしまう
    // (2026-08-31 の報告)。合わせ直すのは、自動で合わせた値のままのときだけ。
    const fitted = lastFitTransformRef.current;
    const current = usePaintStore.getState().canvasTransform;
    const isUserAdjusted =
      !!fitted &&
      (fitted.scale !== current.scale ||
        fitted.offsetX !== current.offsetX ||
        fitted.offsetY !== current.offsetY);

    if (isUserAdjusted) {
      logDebug(
        'view',
        `画像サイズが変わったが、表示倍率は ${Math.round(current.scale * 100)}% のまま保つ`,
        `${previous ?? '(初回)'} → ${sizeKey} / 自分でズーム・パンした値を優先`
      );
      return;
    }

    fitToScreenHeight(`画像サイズが変わった (${previous ?? '(初回)'} → ${sizeKey})`);
  }, [currentImage, fitToScreenHeight]);

  /**
   * ウィンドウをリサイズした時は表示を合わせ直すが、
   * ユーザーが自分でズーム・パンしている場合はその操作を尊重して触らない。
   */
  useEffect(() => {
    const handleResize = () => {
      const fitted = lastFitTransformRef.current;
      const current = usePaintStore.getState().canvasTransform;
      const isUserAdjusted =
        !!fitted &&
        (fitted.scale !== current.scale ||
          fitted.offsetX !== current.offsetX ||
          fitted.offsetY !== current.offsetY);
      if (isUserAdjusted) return;
      fitToScreenHeight('ウィンドウのリサイズ');
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fitToScreenHeight]);

  // メイン画像の読み込み (Win A)
  useEffect(() => {
    let isSubscribed = true;

    (async () => {
      const frame = await loadFrameForView(currentFileIndex, 0);
      if (!isSubscribed) return;
      setCurrentImage(frame ? cloneTGAImage(frame) : null);
    })();

    return () => { isSubscribed = false; };
  }, [currentFileIndex, loadFrameForView, setCurrentImage]);

  // 分割右側ビュー画像の読み込み (Win B)
  useEffect(() => {
    if (!isSplitView) {
      setSplitImage(null);
      return;
    }
    let isSubscribed = true;

    (async () => {
      const frame = await loadFrameForView(splitFileIndex, 1);
      if (!isSubscribed) return;
      setSplitImage(frame ? cloneTGAImage(frame) : null);
    })();

    return () => { isSubscribed = false; };
  }, [isSplitView, splitFileIndex, loadFrameForView, setSplitImage]);

  /**
   * アニメーション再生。
   *
   * ⚠️ fps は依存配列に入れること。setInterval の間隔は生成時にしか決まらないので、
   * 依存から外すと再生中に FPS スライダーを動かしても次に停止するまで効かない。
   */
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      const { currentFileIndex, unifiedFileList, setCurrentFileIndex } = usePaintStore.getState();

      // ⚠️ 空リストのまま剰余を取ると NaN になる。currentFileIndex が NaN になると
      // NaN === NaN が false のため毎回 set が通り、履歴を消し続けたまま復帰できない。
      // 再生ボタンはフォルダを開いていなくても押せるので、ここで必ず弾く。
      const total = unifiedFileList.length;
      if (total === 0) return;

      const current = Number.isInteger(currentFileIndex) ? currentFileIndex : -1;
      // ⚠️ 毎コマ走るので DEBUG ログには残さない (PLAYBACK_SOURCE)
      setCurrentFileIndex((current + 1) % total, PLAYBACK_SOURCE);
    }, (1000 / Math.max(1, fps)) * toolOptions.frameHold);

    return () => clearInterval(interval);
  }, [isPlaying, fps, toolOptions.frameHold]);

  // キャンバス描画
  const renderCanvasInstance = useCallback(
    (canvas: HTMLCanvasElement | null, targetImg: any, isLeft: boolean) => {
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (!targetImg) {
        canvas.width = 640;
        canvas.height = 480;
        const pattern = createCheckerPattern(ctx, 10);
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        return;
      }

      canvas.width = targetImg.width;
      canvas.height = targetImg.height;

      // 透過表現用チェッカーボード
      if (showUnpaintedFlash) {
        ctx.fillStyle = '#FF007F';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        const pattern = createCheckerPattern(ctx, 10);
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }

      // 1. Draw Onion Skin Layers (オニオンスキン: 前後フレーム透過 & カラーコーディング)
      if (isLeft && lightTable.enabled && !isPlaying) {
        // A. 過去フレーム描画 (Past Frames: デフォルト 赤)
        // 「カット全体」指定のときは読み込めた枚数ぶんすべて重ねる
        const pastCount = lightTable.showAllFrames
          ? onionFramesMap.size
          : lightTable.pastFrames ?? 1;
        for (let step = pastCount; step >= 1; step--) {
          const frameImg = onionFramesMap.get(-step) || (step === 1 ? prevImage : null);
          if (!frameImg) continue;

          const startOp = (lightTable.startOpacity ?? 30) / 100;
          const stepDecay = ((lightTable.opacityStep ?? 10) * (step - 1)) / 100;
          const frameAlpha = Math.max(0.05, startOp - stepDecay);

          const frameImgData = ctx.createImageData(frameImg.width, frameImg.height);
          const pColor = lightTable.pastColor || { r: 239, g: 68, b: 68 };
          const mode = lightTable.displayMode;

          for (let i = 0; i < frameImg.data.length; i += 4) {
            const a = frameImg.data[i + 3];
            if (a > 0) {
              if (mode === 'monochrome') {
                const lum = (0.299 * frameImg.data[i] + 0.587 * frameImg.data[i + 1] + 0.114 * frameImg.data[i + 2]) / 255;
                frameImgData.data[i] = Math.round(lum * pColor.r);
                frameImgData.data[i + 1] = Math.round(lum * pColor.g);
                frameImgData.data[i + 2] = Math.round(lum * pColor.b);
                frameImgData.data[i + 3] = a;
              } else if (mode === 'half-color') {
                frameImgData.data[i] = Math.round((frameImg.data[i] + pColor.r) / 2);
                frameImgData.data[i + 1] = Math.round((frameImg.data[i + 1] + pColor.g) / 2);
                frameImgData.data[i + 2] = Math.round((frameImg.data[i + 2] + pColor.b) / 2);
                frameImgData.data[i + 3] = a;
              } else {
                frameImgData.data[i] = frameImg.data[i];
                frameImgData.data[i + 1] = frameImg.data[i + 1];
                frameImgData.data[i + 2] = frameImg.data[i + 2];
                frameImgData.data[i + 3] = a;
              }
            }
          }

          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = frameImg.width;
          tempCanvas.height = frameImg.height;
          const tempCtx = tempCanvas.getContext('2d');
          if (tempCtx) {
            tempCtx.putImageData(frameImgData, 0, 0);
            ctx.globalAlpha = frameAlpha;
            ctx.drawImage(tempCanvas, 0, 0);
            ctx.globalAlpha = 1.0;
          }
        }

        // B. 未来フレーム描画 (Future Frames: デフォルト 青)
        const futureCount = lightTable.showAllFrames
          ? onionFramesMap.size
          : lightTable.futureFrames ?? 1;
        for (let step = 1; step <= futureCount; step++) {
          const frameImg = onionFramesMap.get(step) || (step === 1 ? nextImage : null);
          if (!frameImg) continue;

          const startOp = (lightTable.startOpacity ?? 30) / 100;
          const stepDecay = ((lightTable.opacityStep ?? 10) * (step - 1)) / 100;
          const frameAlpha = Math.max(0.05, startOp - stepDecay);

          const frameImgData = ctx.createImageData(frameImg.width, frameImg.height);
          const fColor = lightTable.futureColor || { r: 59, g: 130, b: 246 };
          const mode = lightTable.displayMode;

          for (let i = 0; i < frameImg.data.length; i += 4) {
            const a = frameImg.data[i + 3];
            if (a > 0) {
              if (mode === 'monochrome') {
                const lum = (0.299 * frameImg.data[i] + 0.587 * frameImg.data[i + 1] + 0.114 * frameImg.data[i + 2]) / 255;
                frameImgData.data[i] = Math.round(lum * fColor.r);
                frameImgData.data[i + 1] = Math.round(lum * fColor.g);
                frameImgData.data[i + 2] = Math.round(lum * fColor.b);
                frameImgData.data[i + 3] = a;
              } else if (mode === 'half-color') {
                frameImgData.data[i] = Math.round((frameImg.data[i] + fColor.r) / 2);
                frameImgData.data[i + 1] = Math.round((frameImg.data[i + 1] + fColor.g) / 2);
                frameImgData.data[i + 2] = Math.round((frameImg.data[i + 2] + fColor.b) / 2);
                frameImgData.data[i + 3] = a;
              } else {
                frameImgData.data[i] = frameImg.data[i];
                frameImgData.data[i + 1] = frameImg.data[i + 1];
                frameImgData.data[i + 2] = frameImg.data[i + 2];
                frameImgData.data[i + 3] = a;
              }
            }
          }

          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = frameImg.width;
          tempCanvas.height = frameImg.height;
          const tempCtx = tempCanvas.getContext('2d');
          if (tempCtx) {
            tempCtx.putImageData(frameImgData, 0, 0);
            ctx.globalAlpha = frameAlpha;
            ctx.drawImage(tempCanvas, 0, 0);
            ctx.globalAlpha = 1.0;
          }
        }
      }

      // 1.5 Draw Individual Light Table SubLayers (登録された個別の参照TGA: 移動・回転アフィン変換)
      if (isLeft && lightTable.items && lightTable.items.length > 0) {
        for (const subItem of lightTable.items) {
          if (!subItem.visible || !subItem.image) continue;

          const subImg = subItem.image;
          const subCanvas = document.createElement('canvas');
          subCanvas.width = subImg.width;
          subCanvas.height = subImg.height;
          const subCtx = subCanvas.getContext('2d');

          if (subCtx) {
            const imgData = subCtx.createImageData(subImg.width, subImg.height);
            imgData.data.set(subImg.data);
            subCtx.putImageData(imgData, 0, 0);

            ctx.save();
            // サブレイヤー位置オフセット & 回転中心移動
            ctx.translate(canvas.width / 2 + subItem.offsetX, canvas.height / 2 + subItem.offsetY);
            ctx.rotate((subItem.rotation * Math.PI) / 180);
            ctx.translate(-subImg.width / 2, -subImg.height / 2);

            ctx.globalAlpha = subItem.opacity / 100;
            ctx.drawImage(subCanvas, 0, 0);
            ctx.restore();
          }
        }
      }

      // 2. Draw Target Image (スタビライザー アフィン変換適用)
      const imgData = ctx.createImageData(targetImg.width, targetImg.height);
      imgData.data.set(targetImg.data);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = targetImg.width;
      tempCanvas.height = targetImg.height;
      const tempCtx = tempCanvas.getContext('2d');

      if (tempCtx) {
        tempCtx.putImageData(imgData, 0, 0);

        ctx.save();
        if (pegStabilizer.enabled) {
          const totalX = pegStabilizer.offsetX + pegStabilizer.manualX;
          const totalY = pegStabilizer.offsetY + pegStabilizer.manualY;
          const totalRot = (pegStabilizer.rotation + pegStabilizer.manualRotation) * (Math.PI / 180);

          ctx.translate(canvas.width / 2 + totalX, canvas.height / 2 + totalY);
          ctx.rotate(totalRot);
          ctx.translate(-canvas.width / 2, -canvas.height / 2);
        }

        ctx.drawImage(tempCanvas, 0, 0);
        ctx.restore();
      }

      // 3. Grid Overlay
      if (showGrid) {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.lineWidth = 1;
        const gridSize = 32;
        for (let x = 0; x <= canvas.width; x += gridSize) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, canvas.height);
          ctx.stroke();
        }
        for (let y = 0; y <= canvas.height; y += gridSize) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();
        }
      }

      // 4. 理想タップ穴ガイドオーバーレイ (Peg Guide)
      if (pegStabilizer.showGuide) {
        ctx.strokeStyle = '#EF4444'; // 赤アウトライン
        ctx.lineWidth = 2;
        const cx = canvas.width / 2;
        const cy = 50;

        // 中央長円
        ctx.beginPath();
        ctx.ellipse(cx, cy, 14, 8, 0, 0, Math.PI * 2);
        ctx.stroke();

        // 左右正円
        ctx.beginPath();
        ctx.arc(cx - 140, cy, 8, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx + 140, cy, 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 5. Lasso Preview
      if (lassoView === (isLeft ? 0 : 1) && lassoPoints.length > 1) {
        ctx.strokeStyle = '#2563EB';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
        for (let i = 1; i < lassoPoints.length; i++) {
          ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    },
    [prevImage, nextImage, onionFramesMap, lightTable, isPlaying, showGrid, showUnpaintedFlash, lassoPoints, lassoView, pegStabilizer]
  );

  useEffect(() => {
    renderCanvasInstance(leftCanvasRef.current, currentImage, true);
    if (isSplitView) {
      renderCanvasInstance(rightCanvasRef.current, splitImage, false);
    }
  }, [renderCanvasInstance, currentImage, splitImage, isSplitView, renderTrigger]);

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.floor((e.clientX - rect.left) * scaleX),
      y: Math.floor((e.clientY - rect.top) * scaleY),
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>, isLeftView: boolean) => {
    const viewIdx = isLeftView ? 0 : 1;
    setActiveViewIndex(viewIdx);

    // 前回のドラッグが canvas の外で終わっていた場合に備え、毎回状態を仕切り直す
    if (isPanning) setIsPanning(false);
    if (isBrushing) setIsBrushing(false);

    const targetImg = isLeftView ? currentImage : splitImage;
    const canvas = isLeftView ? leftCanvasRef.current : rightCanvasRef.current;
    if (!targetImg || !canvas) return;

    // ⚠️ 掴んだ時点の位置もストアの最新から取る (ホイールの直後に掴むとずれる)
    const live = usePaintStore.getState();
    const currentTransform = isLeftView ? live.canvasTransform : live.splitCanvasTransform;

    // ⚠️ 左クリック (0) (panツール/Spaceキー押下時), 中ボタン (1), 右ボタン (2) でパン移動
    if (
      e.button === 1 ||
      e.button === 2 ||
      (e.button === 0 && (activeTool === 'pan' || isSpacePressed))
    ) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - currentTransform.offsetX, y: e.clientY - currentTransform.offsetY });
      return;
    }

    const { x, y } = getCanvasCoords(e, canvas);

    // 閲覧専用（タイムシートや指示メモなどの JPG/PNG 画像）の場合は塗り・描画操作をガード。
    // 黙って無視すると「ツールが反応しない」ようにしか見えないので理由を表示する。
    if (targetImg.isReadOnly && activeTool !== 'eyedropper' && e.button !== 1 && !e.altKey) {
      setReadOnlyNoticeView(viewIdx);
      return;
    }

    if (activeTool === 'fill') {
      saveUndoState('バケツ塗り');
      floodFill(
        targetImg.data,
        targetImg.width,
        targetImg.height,
        x, y,
        currentColor,
        toolOptions,
        referenceCanvas.image?.data ?? null
      );
      triggerRender();
    } else if (activeTool === 'gradient') {
      saveUndoState('グラデーション塗り');
      gradientFill(
        targetImg.data,
        targetImg.width,
        targetImg.height,
        x, y,
        currentColor,
        backgroundColor,
        toolOptions,
        referenceCanvas.image?.data ?? null
      );
      triggerRender();
    } else if (activeTool === 'noiseEraser') {
      saveUndoState('ワンクリックゴミ取り');
      const removed = removeSingleNoiseAt(
        targetImg.data,
        targetImg.width,
        targetImg.height,
        x, y,
        toolOptions.maxNoiseSize * 10
      );
      if (removed) triggerRender();
    } else if (activeTool === 'brush' || activeTool === 'pencil' || activeTool === 'eraser') {
      saveUndoState(activeTool === 'eraser' ? '消しゴム描画' : 'ペイント線描画');
      setIsBrushing(true);
      setLastPos({ x, y });
      drawBrushLine(
        targetImg.data,
        targetImg.width,
        targetImg.height,
        x, y, x, y,
        toolOptions.brushSize,
        currentColor,
        activeTool === 'eraser'
      );
      triggerRender();
    } else if (activeTool === 'eyedropper' || e.altKey) {
      // ツールオプションの「サンプル範囲」に従って色を採取する
      const sampled = sampleColorAt(
        targetImg.data,
        targetImg.width,
        targetImg.height,
        x, y,
        toolOptions.sampleSize
      );
      const hex = `#${((1 << 24) + (sampled.r << 16) + (sampled.g << 8) + sampled.b)
        .toString(16)
        .slice(1)
        .toUpperCase()}`;
      setCurrentColor({ ...sampled, hex });
    } else if (activeTool === 'closedFill' || activeTool === 'lasso') {
      // ⚠️ ここで saveUndoState を呼ばないこと。投げ縄は塗るかどうかが
      // 離した時点まで決まらない。開始時に積むと、ドラッグせずクリックしただけで
      // 履歴が 1 つ増え「未保存」になってしまう。確定の直前に積む。
      setIsLassoing(true);
      setLassoView(viewIdx);
      setLassoPoints([{ x, y }]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>, isLeftView: boolean) => {
    const targetImg = isLeftView ? currentImage : splitImage;
    const canvas = isLeftView ? leftCanvasRef.current : rightCanvasRef.current;

    if (isPanning) {
      // ⚠️ 倍率はストアの最新を使うこと。描画時の値を広げると、
      // 直前のホイール操作で変えた倍率を巻き戻してしまう
      const live = usePaintStore.getState();
      const liveTransform = isLeftView ? live.canvasTransform : live.splitCanvasTransform;
      const newTransform = {
        ...liveTransform,
        offsetX: e.clientX - panStart.x,
        offsetY: e.clientY - panStart.y,
      };

      if (syncMode && isSplitView) {
        setCanvasTransform(newTransform);
        setSplitCanvasTransform(newTransform);
      } else {
        if (isLeftView) setCanvasTransform(newTransform);
        else setSplitCanvasTransform(newTransform);
      }
      return;
    }

    if (!targetImg || !canvas) return;
    const { x, y } = getCanvasCoords(e, canvas);

    if (isBrushing && lastPos) {
      drawBrushLine(
        targetImg.data,
        targetImg.width,
        targetImg.height,
        lastPos.x, lastPos.y, x, y,
        toolOptions.brushSize,
        currentColor,
        activeTool === 'eraser'
      );
      setLastPos({ x, y });
      triggerRender();
    } else if (isLassoing && lassoView === (isLeftView ? 0 : 1)) {
      setLassoPoints((prev) => [...prev, { x, y }]);
      triggerRender();
    }
  };

  const handleMouseUp = (isLeftView: boolean) => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isBrushing) {
      setIsBrushing(false);
      setLastPos(null);
    }

    const targetImg = isLeftView ? currentImage : splitImage;
    if (isLassoing && lassoView === (isLeftView ? 0 : 1) && targetImg) {
      setIsLassoing(false);
      if (lassoPoints.length > 2) {
        saveUndoState('閉領域フィル');
        closedAreaFill(
          targetImg.data,
          targetImg.width,
          targetImg.height,
          lassoPoints,
          currentColor,
          toolOptions
        );
        triggerRender();
      }
      setLassoPoints([]);
    }
  };

  /**
   * ホイールでのズームは 1 回転ずつ書かず、手を止めたところで 1 行にまとめる。
   *
   * ⚠️ 1 回転ごとに書くと、ひと転がしで何十行も流れて肝心の操作が押し出される。
   * ⚠️ まとめても始点と終点は本物を使うこと (最初の 1 回転の直前と、止まった時点)。
   * 途中を省いた数字を書くと、あとで前後がつながらず読めなくなる。
   */
  const wheelBurstRef = useRef<{ from: number; notches: number } | null>(null);
  const wheelTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
    };
  }, []);

  /**
   * ホイールでの拡大・縮小。
   *
   * ⚠️ 倍率は必ずストアから読み直すこと (canvasTransform をそのまま使わない)。
   * ホイールは 1 フレームの間に何度も来るが、React の再描画は 1 回しか挟まらないため、
   * 描画時に閉じ込めた値から計算すると同じ倍率から何度も計算することになり、
   * 何回転させても 1 段しか変わらない。DEBUG ログでも「41% → 37%」の次が
   * 「33% → 30%」のように前後がつながらない形で見えていた (2026-08-31 の報告)。
   */
  const handleWheel = (e: React.WheelEvent, isLeftView: boolean) => {
    e.preventDefault();
    const live = usePaintStore.getState();
    const currentTransform = isLeftView ? live.canvasTransform : live.splitCanvasTransform;
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(Math.max(0.2, currentTransform.scale * zoomFactor), 5.0);
    const newTransform = { ...currentTransform, scale: newScale };

    const burst = wheelBurstRef.current ?? { from: currentTransform.scale, notches: 0 };
    burst.notches += 1;
    wheelBurstRef.current = burst;

    if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
    const where = `${isLeftView ? 'Win A' : 'Win B'}${syncMode && isSplitView ? ' (連動中なので両方)' : ''}`;
    wheelTimerRef.current = window.setTimeout(() => {
      const settled = wheelBurstRef.current;
      wheelBurstRef.current = null;
      wheelTimerRef.current = null;
      if (!settled) return;
      const after = usePaintStore.getState();
      const scaleNow = (isLeftView ? after.canvasTransform : after.splitCanvasTransform).scale;
      logDebug(
        'view',
        `表示倍率 ${Math.round(settled.from * 100)}% → ${Math.round(scaleNow * 100)}% (ホイール)`,
        `${where} / ${settled.notches} 回転ぶん`
      );
    }, 250);

    if (syncMode && isSplitView) {
      setCanvasTransform(newTransform);
      setSplitCanvasTransform(newTransform);
    } else {
      if (isLeftView) setCanvasTransform(newTransform);
      else setSplitCanvasTransform(newTransform);
    }
  };

  const isDockedReference = referenceCanvas.isOpen && !referenceCanvas.isFloating;
  const isHorizontalSplit = isDockedReference && colorSpecLayoutMode === 'split-horizontal';

  /**
   * 開いている面とレイアウトを揃える。
   *
   * ⚠️ 開閉のフラグ (isSplitView / referenceCanvas.isOpen / roll.isOpen) は
   * 連動やファイル読み込みからも参照されているので、真実の源はあちらのまま。
   * ここで一方向に流し込むことで、既存のメニューやショートカットを書き換えずに済む。
   */
  useEffect(() => {
    syncPaneVisibility({
      winA: isWinAVisible,
      winB: isSplitView,
      reference: referenceCanvas.isOpen,
      rollA: roll.views.rollA.isOpen,
      rollB: roll.views.rollB.isOpen,
    });
  }, [
    isWinAVisible,
    isSplitView,
    referenceCanvas.isOpen,
    roll.views.rollA.isOpen,
    roll.views.rollB.isOpen,
    syncPaneVisibility,
  ]);

  // --- 各面の中身。並べる順序はレイアウトが決めるので、ここでは組み立てるだけ ---

  const winAPaneContent = (
    <>
          {/* 左ビュー (Win A / Dir A) */}
          <div
            ref={winAWindow.targetRef}
            style={winAWindow.windowStyle}
            onPointerDownCapture={winAWindow.bringToFront}
            onClick={() => setActiveViewIndex(0)}
            onDragEnter={(e) => handleWindowDragEnter(e, 'winA')}
            onDragOver={(e) => handleWindowDragOver(e, 'winA')}
            onDragLeave={(e) => handleWindowDragLeave(e, 'winA')}
            onDrop={(e) => handleFolderOrFilesNativeDrop(e, 'winA')}
            // ⚠️ ハイライト用のクラスはレイアウト用のクラスと必ず併記する。
            // 以前は D&D 中に flex-1 が外れて要素が縮み、カーソルの下から
            // 逃げてしまうため判定が点滅していた。
            /*
              ⚠️ ドッキング中は 1px の枠・角丸なし。太い枠と角丸は、面を並べたときに
              その分だけ絵が小さくなる。浮かせたときだけ従来の見た目に戻す。
            */
            className={`flex flex-col ${
              isWinAFloating
                ? `border-2 bg-slate-100 dark:bg-slate-900 shadow-2xl rounded relative ${activeBorderClass(0, true)}`
                : `border flex-1 relative overflow-hidden ${activeBorderClass(0, false)}`
            } ${isWinADragOver ? 'border-blue-500 ring-4 ring-inset ring-blue-500/60' : ''}`}
          >
            {/* 📁 エクスプローラーダイレクト D&D 案内オーバーレイ */}
            {isWinADragOver && (
              <div className="absolute inset-0 bg-blue-950/90 backdrop-blur-xs border-2 border-dashed border-blue-300 rounded flex flex-col items-center justify-center text-blue-200 z-50 pointer-events-none p-4 animate-in fade-in duration-100 select-none">
                <FolderOpen className="w-10 h-10 mb-2 animate-bounce text-blue-400" />
                <span className="font-bold text-sm text-white">ここにフォルダをドロップして Win A で開く</span>
                <span className="text-[10px] opacity-80 mt-1">エクスプローラーからダイレクトにフォルダを開けます</span>
              </div>
            )}

            {/* Win A タイトルバー (Tear-off & Docking 対応) */}
            <div
              onPointerDown={winAWindow.handleHeaderPointerDown}
              className="h-6 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-2 text-[11px] justify-between select-none touch-none cursor-grab active:cursor-grabbing"
            >
              <span className="font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1.5 min-w-0">
                <span className="truncate">
                  Win A ({folderNameA || 'Orig'}): {resolveFileNameForView(currentFileIndex, 0) || '---'}
                  {isDirtyA ? ' *' : ''}
                </span>
                {currentImage?.isReadOnly && (
                  <span className="flex-shrink-0 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-xs whitespace-nowrap">
                    🔒 閲覧専用 (描画不可)
                  </span>
                )}
              </span>

              <div className="flex items-center gap-1">
                {!currentImage && (
                  <span className="text-[9px] text-red-500 font-bold flex items-center gap-1 mr-1">
                    <AlertTriangle className="w-3 h-3" /> NO DATA
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleWinAFloating();
                  }}
                  title={isWinAFloating ? 'ドッキングに戻す' : '切り離して独立表示 (Tear-off)'}
                  className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors text-slate-600 dark:text-slate-300"
                >
                  {isWinAFloating ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                </button>
              </div>
            </div>

            {showRuler && currentImage && (
              <div className="h-3.5 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-2 text-[8px] font-mono text-slate-500 dark:text-slate-400 justify-between select-none">
                <span>0px</span>
                <span>{Math.floor(currentImage.width / 2)}px</span>
                <span>{currentImage.width}px</span>
              </div>
            )}

            <div
              className={`flex-1 bg-slate-300 dark:bg-slate-950 relative flex items-center justify-center overflow-hidden transition-colors ${
                activeTool === 'pan' || isSpacePressed ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
              }`}
              onWheel={(e) => handleWheel(e, true)}
            >
              <div
                style={{
                  transform: `translate(${canvasTransform.offsetX}px, ${canvasTransform.offsetY}px) scale(${canvasTransform.scale})`,
                  transformOrigin: 'center center',
                  transition: isPanning ? 'none' : 'transform 0.05s ease-out',
                }}
                className="shadow-2xl border border-slate-400 dark:border-slate-700 bg-white relative"
              >
                <canvas
                  ref={leftCanvasRef}
                  onMouseDown={(e) => handleMouseDown(e, true)}
                  onMouseMove={(e) => handleMouseMove(e, true)}
                  onMouseUp={() => handleMouseUp(true)}
                  onContextMenu={(e) => e.preventDefault()}
                  className="block"
                />

                {readOnlyNoticeView === 0 && (
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none px-3 py-2 rounded-lg bg-amber-500 text-white text-[11px] font-bold shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    <span>
                      この画像は閲覧専用（TGA 以外）のため描画できません。
                      <br />
                      .tga のセルが入ったフォルダを選択してください。
                    </span>
                  </div>
                )}

                {!currentImage && (
                  <div className="absolute inset-0 flex items-center justify-center p-4 bg-slate-900/10 dark:bg-slate-950/20 backdrop-blur-[1px] pointer-events-none">
                    <div className="flex flex-col items-center justify-center p-5 text-center bg-white/95 dark:bg-slate-900/95 border border-slate-300 dark:border-slate-800 rounded-xl shadow-2xl max-w-sm select-none animate-in fade-in duration-150">
                      <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 flex items-center justify-center mb-2.5 text-blue-600 dark:text-blue-400">
                        <FolderOpen className="w-5 h-5" />
                      </div>
                      <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 mb-1">NO CELL DATA</h3>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-2.5 leading-relaxed">
                        エクスプローラーやFinderから TGAファイルが入ったフォルダを開いてセル画像を選択してください
                      </p>
                      <span className="text-[9px] text-blue-600 dark:text-blue-400 font-semibold bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                        ファイル &gt; フォルダを開く (Ctrl+Shift+O) または 右パネル Open A
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ⚡ フローティング Win A 用の全4角マルチリサイズグリップ */}
            {isWinAFloating && (
              <CornerResizeHandles getResizeHandler={winAWindow.getResizeHandler} topOffset={24} />
            )}
          </div>

          {/* Win A を切り離した跡地: ドッキング復帰のドロップ先 ＆ 復帰ボタン */}
          {isWinAFloating && (
            <DockPlaceholder
              id="winA-dock-target"
              label="Win A"
              onRestore={toggleWinAFloating}
              isActive={winAWindow.isOverDockTarget}
            />
          )}
    </>
  );

  const winBPaneContent = (
    <>
          {/* 右ビュー (Win B / Dir B / Split View 有効時) */}
          {isSplitView && (
            <div
              ref={winBWindow.targetRef}
              style={winBWindow.windowStyle}
              onPointerDownCapture={winBWindow.bringToFront}
              onClick={() => setActiveViewIndex(1)}
              onDragEnter={(e) => handleWindowDragEnter(e, 'winB')}
              onDragOver={(e) => handleWindowDragOver(e, 'winB')}
              onDragLeave={(e) => handleWindowDragLeave(e, 'winB')}
              onDrop={(e) => handleFolderOrFilesNativeDrop(e, 'winB')}
              // Win A と同様、ハイライトでレイアウトが変わらないようにする
              className={`flex flex-col ${
                isWinBFloating
                  ? `border-2 bg-slate-100 dark:bg-slate-900 shadow-2xl rounded relative ${activeBorderClass(1, true)}`
                  : `border flex-1 relative overflow-hidden ${activeBorderClass(1, false)}`
              } ${isWinBDragOver ? 'border-emerald-500 ring-4 ring-inset ring-emerald-500/60' : ''}`}
            >
              {/* 📁 エクスプローラーダイレクト D&D 案内オーバーレイ */}
              {isWinBDragOver && (
                <div className="absolute inset-0 bg-emerald-950/90 backdrop-blur-xs border-2 border-dashed border-emerald-300 rounded flex flex-col items-center justify-center text-emerald-200 z-50 pointer-events-none p-4 animate-in fade-in duration-100 select-none">
                  <FolderOpen className="w-10 h-10 mb-2 animate-bounce text-emerald-400" />
                  <span className="font-bold text-sm text-white">ここにフォルダをドロップして Win B で開く</span>
                  <span className="text-[10px] opacity-80 mt-1">エクスプローラーからダイレクトにフォルダを開けます</span>
                </div>
              )}

              {/* Win B タイトルバー (Tear-off & Docking 対応) */}
              <div
                onPointerDown={winBWindow.handleHeaderPointerDown}
                className="h-6 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-2 text-[11px] select-none touch-none cursor-grab active:cursor-grabbing"
              >
                <span className="font-semibold text-slate-700 dark:text-slate-300 truncate flex items-center gap-1.5">
                  <span>Win B ({folderNameB || 'Retake'}): {resolveFileNameForView(splitFileIndex, 1) || '---'}{isDirtyB ? ' *' : ''}</span>
                  {splitImage?.isReadOnly && (
                    <span className="bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.2 rounded shadow-xs">
                      🔒 閲覧専用 (Sheet View)
                    </span>
                  )}
                </span>

                <div className="flex items-center gap-1">
                  {!splitImage && (
                    <span className="text-[9px] text-red-500 font-bold flex items-center gap-1 mr-1">
                      <AlertTriangle className="w-3 h-3" /> NO DATA
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleWinBFloating();
                    }}
                    title={isWinBFloating ? 'ドッキングに戻す' : '切り離して独立表示 (Tear-off)'}
                    className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors text-slate-600 dark:text-slate-300"
                  >
                    {isWinBFloating ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                  </button>
                </div>
              </div>

              {showRuler && splitImage && (
                <div className="h-3.5 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center px-2 text-[8px] font-mono text-slate-500 dark:text-slate-400 justify-between select-none">
                  <span>0px</span>
                  <span>{Math.floor(splitImage.width / 2)}px</span>
                  <span>{splitImage.width}px</span>
                </div>
              )}

              <div
                className={`flex-1 bg-slate-300 dark:bg-slate-950 relative flex items-center justify-center overflow-hidden transition-colors ${
                  activeTool === 'pan' || isSpacePressed ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
                }`}
                onWheel={(e) => handleWheel(e, false)}
              >
                <div
                  style={{
                    transform: `translate(${splitCanvasTransform.offsetX}px, ${splitCanvasTransform.offsetY}px) scale(${splitCanvasTransform.scale})`,
                    transformOrigin: 'center center',
                    transition: isPanning ? 'none' : 'transform 0.05s ease-out',
                  }}
                  className="shadow-2xl border border-slate-400 dark:border-slate-700 bg-white relative"
                >
                  <canvas
                    ref={rightCanvasRef}
                    onMouseDown={(e) => handleMouseDown(e, false)}
                    onMouseMove={(e) => handleMouseMove(e, false)}
                    onMouseUp={() => handleMouseUp(false)}
                    onContextMenu={(e) => e.preventDefault()}
                    className="block"
                  />

                  {readOnlyNoticeView === 1 && (
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none px-3 py-2 rounded-lg bg-amber-500 text-white text-[11px] font-bold shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      <span>
                        この画像は閲覧専用（TGA 以外）のため描画できません。
                        <br />
                        .tga のセルが入ったフォルダを選択してください。
                      </span>
                    </div>
                  )}

                  {!splitImage && (
                    <div className="absolute inset-0 flex items-center justify-center p-4 bg-slate-900/10 dark:bg-slate-950/20 backdrop-blur-[1px] pointer-events-none">
                      <div className="flex flex-col items-center justify-center p-5 text-center bg-white/95 dark:bg-slate-900/95 border border-slate-300 dark:border-slate-800 rounded-xl shadow-2xl max-w-sm select-none animate-in fade-in duration-150">
                        <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center mb-2.5 text-emerald-600 dark:text-emerald-400">
                          <FolderOpen className="w-5 h-5" />
                        </div>
                        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 mb-1">NO RETAKE DATA</h3>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-2.5 leading-relaxed">
                          リテイク用（Dir B）フォルダを開いて比較セル画像を表示してください
                        </p>
                        <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                          右パネル Open B からリテイクフォルダを選択
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ⚡ フローティング Win B 用の全4角マルチリサイズグリップ */}
              {isWinBFloating && (
                <CornerResizeHandles getResizeHandler={winBWindow.getResizeHandler} topOffset={24} />
              )}
            </div>
          )}

          {/* Win B を切り離した跡地 */}
          {isSplitView && isWinBFloating && (
            <DockPlaceholder
              id="winB-dock-target"
              label="Win B"
              onRestore={toggleWinBFloating}
              isActive={winBWindow.isOverDockTarget}
            />
          )}
    </>
  );

  const referencePaneContent = (
    <>
            {referenceCanvas.isFloating && (
              <DockPlaceholder
                id="reference-dock-target"
                label="参照"
                onRestore={toggleReferenceFloating}
                isActive={isReferenceOverDock}
                variant={isHorizontalSplit ? 'strip-h' : 'strip-v'}
              />
            )}
            <ReferenceCanvasView onDockHoverChange={setIsReferenceOverDock} />
    </>
  );

  /** ロールは 2 面ある (修正前 / 修正後を並べて見比べるため) */
  const rollPaneContent = (id: RollId) => (
    <>
      {roll.views[id].isFloating && (
        <DockPlaceholder
          id={`${id}-dock-target`}
          label={PANE_LABELS[id]}
          onRestore={() => toggleRollFloating(id)}
          isActive={false}
          variant="strip-v"
        />
      )}
      <RollViewer rollId={id} />
    </>
  );

  const renderPane = (pane: PaneId): React.ReactNode => {
    if (pane === 'winA') return winAPaneContent;
    if (pane === 'winB') return winBPaneContent;
    if (pane === 'reference') return referencePaneContent;
    if (pane === 'rollA' || pane === 'rollB') return rollPaneContent(pane);
    return null;
  };

  /**
   * タブの × で面を閉じる。
   *
   * ⚠️ レイアウトから直接消さないこと。開いているかどうかは従来どおり
   * 各スライスのフラグが持っており、そちらを動かせば同期でレイアウトも畳まれる。
   */
  const closePane = (pane: PaneId) => {
    if (pane === 'winA' && isWinAVisible) toggleWinAVisible();
    else if (pane === 'winB' && isSplitView) toggleIsSplitView();
    else if (pane === 'reference') closeReferenceWindow();
    else if (pane === 'rollA' || pane === 'rollB') closeRollWindow(pane);
  };

  /** 一面表示中はその枠だけを、幅いっぱいに出す */
  const slotsToRender = paneLayout.maximized
    ? paneLayout.slots
        .filter((slot) => slot.panes.includes(paneLayout.maximized as PaneId))
        .map((slot) => ({ ...slot, activePane: paneLayout.maximized as PaneId, flexGrow: 1 }))
    : paneLayout.slots;

  return (
    <div
      ref={containerRef}
      id="main-workspace-area"
      className={`flex-1 flex flex-col relative overflow-hidden select-none transition-colors ${
        canvasBgMatteMode === 'checkerboard'
          ? 'checkerboard-pattern bg-slate-300 dark:bg-slate-950'
          : canvasBgMatteMode === 'black'
          ? 'bg-black'
          : canvasBgMatteMode === 'white'
          ? 'bg-white'
          : canvasBgMatteMode === 'magenta'
          ? 'bg-[#ff00ff]'
          : ''
      }`}
      style={canvasBgMatteMode === 'custom' ? { backgroundColor: canvasCustomBgColor } : undefined}
    >
      {/* セルキャンバス＆参照エリア (画面分割レイアウト) */}
      <div
        ref={splitRowRef}
        /*
          ⚠️ 作業領域はエッジ・トゥ・エッジ。外周の余白も枠と枠の隙間も入れないこと
          (2026-08-31 のユーザー指定)。ここに p-* / gap-* を足すと、面を 2 つ並べた
          ときに数十 px が表示領域から削られる。仕切りは枠線と幅調整のつまみだけで示す。
        */
        className={`flex-1 flex overflow-hidden ${isHorizontalSplit ? 'flex-col' : 'flex-row'}`}
      >
        {/*
          作業領域。どの面をどこへ、どう重ねて出すかは paneLayout が持つ。
          ⚠️ ここに面の順序を直接書かないこと。以前は Win A → Win B → 見本 → ロール の
          順序が JSX に固定されており、入れ替えも一面表示もできなかった。
        */}
        {slotsToRender.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center select-none p-6">
            <FolderOpen className="w-10 h-10 text-slate-400 dark:text-slate-600" />
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
              フォルダをドロップしてください
            </p>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
              画面のどこへ落としても構いません。
              <br />
              セル画像 (.tga / .png / .jpg) と撮影ロール (.mov / .mp4) をまとめて読み込み、
              <br />
              ツリーから開いたファイルに合わせたウィンドウが出ます。
            </p>
            <p className="text-[10px] text-slate-400 dark:text-slate-600">
              ウィンドウ (W) メニューからも個別に出せます
            </p>
          </div>
        )}

        {slotsToRender.map((slot, index) => (
          <React.Fragment key={slot.id}>
            <PaneDropGap
              index={index}
              active={isPaneDragging}
              onDropPane={(pane, at) => {
                setIsPaneDragging(false);
                movePaneToPosition(pane, at);
              }}
            />
            <div
              data-slot-id={slot.id}
              className="flex flex-col min-w-0 overflow-hidden"
              style={{ flexGrow: slot.flexGrow, flexBasis: 0 }}
            >
              <PaneTabBar
                slot={slot}
                maximized={paneLayout.maximized}
                onSelect={(pane) => setActivePaneInSlot(slot.id, pane)}
                onClose={closePane}
                onToggleMaximize={toggleMaximizedPane}
                onDropOnSlot={(pane) => stackPaneOnSlot(pane, slot.id)}
                onDragStateChange={setIsPaneDragging}
              />
              <div className="flex-1 flex min-h-0">{renderPane(slot.activePane)}</div>
            </div>
            {index < slotsToRender.length - 1 && (
              <div
                onPointerDown={(e) => handleSlotResizePointerDown(e, slot.id, slotsToRender[index + 1].id)}
                title="ドラッグで左右の取り分を調整"
                className="flex-shrink-0 w-1 cursor-col-resize touch-none bg-slate-400/70 dark:bg-slate-700 hover:bg-blue-500 active:bg-blue-600 transition-colors"
              />
            )}
          </React.Fragment>
        ))}
        <PaneDropGap
          index={slotsToRender.length}
          active={isPaneDragging}
          onDropPane={(pane, at) => {
            setIsPaneDragging(false);
            movePaneToPosition(pane, at);
          }}
        />
      </div>
    </div>
  );
};
