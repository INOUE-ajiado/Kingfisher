import React, { useRef, useEffect, useState, useCallback, useSyncExternalStore } from 'react';
import { usePaintStore } from '../../store/usePaintStore';
import { useShallow } from 'zustand/react/shallow';
import { angleFromCenter, normalizeAngle, screenToImagePoint, snapAngle } from '../../engine/viewTransform';
import {
  collectImageFilesFromEntry,
  collectImageFilesRecursively,
  isSupportedImageFile,
  resolveDropHandles,
} from '../../engine/fileSystemPath';
import { readDropItems, readMultipleDroppedFolders } from '../../engine/dropFolder';
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
import { FolderOpen, Loader2, FileCode } from 'lucide-react';
import { useFloatingWindow } from '../../hooks/useFloatingWindow';
import { useFrameLoader, useCellPrefetch, useOnionSkinFrames } from '../../hooks/useFrameLoader';
import { DockPlaceholder } from '../common/DockPlaceholder';
import { ReferenceCanvasView } from './ReferenceCanvasView';
import { RollViewer } from './RollViewer';
import { RushWindow } from './RushWindow';
import { PaneTabBar, PaneDropGap, isPaneDrag } from './PaneTabBar';
import { CellCanvasPane } from './CellCanvasPane';
import { PaneId, PANE_LABELS } from '../../engine/paneLayout';
import { RollId, CanvasTransform } from '../../store/types';
import { logDebug, PLAYBACK_SOURCE } from '../../engine/debugLog';
import { getRenderSignal, subscribeRenderSignal } from '../../engine/renderSignal';
import { fitTransformFor, isUserAdjusted, sizeKeyOf } from '../../engine/canvasFit';
import {
  onionAlpha,
  tintedOnionCanvas,
  clearOnionCache,
  OnionColor,
  OnionDisplayMode,
} from '../../engine/onionSkin';
import { wheelInputFrom, wheelTransform } from '../../engine/canvasZoom';

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
    isPsdLoading,
    psdLoadingFileName,
    isAuthenticated,
  } = usePaintStore(
    useShallow((s) => ({
        currentFileIndex: s.currentFileIndex,
        splitFileIndex: s.splitFileIndex,
        isSplitView: s.isSplitView,
        syncMode: s.syncMode,
        activeViewIndex: s.activeViewIndex,
        setActiveViewIndex: s.setActiveViewIndex,
        activeTool: s.activeTool,
        toolOptions: s.toolOptions,
        currentColor: s.currentColor,
        backgroundColor: s.backgroundColor,
        setCurrentColor: s.setCurrentColor,
        currentImage: s.currentImage,
        setCurrentImage: s.setCurrentImage,
        splitImage: s.splitImage,
        setSplitImage: s.setSplitImage,
        resolveFileNameForView: s.resolveFileNameForView,
        isDirtyA: s.isDirtyA,
        isDirtyB: s.isDirtyB,
        prevImage: s.prevImage,
        nextImage: s.nextImage,
        canvasTransform: s.canvasTransform,
        setCanvasTransform: s.setCanvasTransform,
        splitCanvasTransform: s.splitCanvasTransform,
        setSplitCanvasTransform: s.setSplitCanvasTransform,
        lightTable: s.lightTable,
        triggerRender: s.triggerRender,
        folderNameA: s.folderNameA,
        folderNameB: s.folderNameB,
        saveUndoState: s.saveUndoState,
        isPlaying: s.isPlaying,
        fps: s.fps,
        roll: s.roll,
        toggleRollFloating: s.toggleRollFloating,
        loadRollFiles: s.loadRollFiles,
        closeRollWindow: s.closeRollWindow,
        closeReferenceWindow: s.closeReferenceWindow,
        toggleIsSplitView: s.toggleIsSplitView,
        isWinAVisible: s.isWinAVisible,
        toggleWinAVisible: s.toggleWinAVisible,
        paneLayout: s.paneLayout,
        syncPaneVisibility: s.syncPaneVisibility,
        setActivePaneInSlot: s.setActivePaneInSlot,
        stackPaneOnSlot: s.stackPaneOnSlot,
        movePaneToPosition: s.movePaneToPosition,
        toggleMaximizedPane: s.toggleMaximizedPane,
        setPaneSlotFlex: s.setPaneSlotFlex,
        showGrid: s.showGrid,
        showRuler: s.showRuler,
        showUnpaintedFlash: s.showUnpaintedFlash,
        pegStabilizer: s.pegStabilizer,
        referenceCanvas: s.referenceCanvas,
        colorSpecLayoutMode: s.colorSpecLayoutMode,
        isWinAFloating: s.isWinAFloating,
        isWinBFloating: s.isWinBFloating,
        toggleWinAFloating: s.toggleWinAFloating,
        toggleWinBFloating: s.toggleWinBFloating,
        toggleReferenceFloating: s.toggleReferenceFloating,
        setCustomDropFolderA: s.setCustomDropFolderA,
        setCustomDropFolderB: s.setCustomDropFolderB,
        setFolderHandleA: s.setFolderHandleA,
        setFolderHandleB: s.setFolderHandleB,
        canvasBgMatteMode: s.canvasBgMatteMode,
        canvasCustomBgColor: s.canvasCustomBgColor,
        isPsdLoading: s.isPsdLoading,
        psdLoadingFileName: s.psdLoadingFileName,
        isAuthenticated: s.isAuthenticated,
    }))
  );

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

  /**
   * 回転ビューのドラッグ中の控え。
   * ⚠️ ストアへ毎フレーム書くのは角度だけ。掴んだ時点の角度と、掴んだ向きをここに置く。
   */
  const rotateDragRef = useRef<{ center: { x: number; y: number }; startAngle: number; startRotation: number; isLeftView: boolean } | null>(null);
  const [isRotatingView, setIsRotatingView] = useState(false);
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
   * 掴んだまま canvas の外で離したときの取りこぼし対策。
   *
   * パン・ブラシ・回転ビュー・投げ縄の終了を canvas の onMouseUp だけに任せていると、
   * 外へ出てからボタンを離した場合に「押しっぱなし」の状態が残り、
   * 以降の左クリックがすべてパン扱いになって描画ツールが反応しなくなる。
   *
   * ⚠️ canvas の上で離した分はここで打ち切らないこと。pointerup は onMouseUp より
   * 先に来るため、無条件に止めると通常の塗りが実行されなくなる。
   * 外で離した投げ縄は塗らずに破棄する (履歴は確定の直前に積むので汚れない)。
   */
  useEffect(() => {
    if (!isPanning && !isBrushing && !isRotatingView && !isLassoing) return;

    const endDrag = (e: Event) => {
      setIsPanning(false);
      setIsBrushing(false);
      setIsRotatingView(false);
      rotateDragRef.current = null;
      setLastPos(null);

      const canvas = lassoView === 1 ? rightCanvasRef.current : leftCanvasRef.current;
      if (canvas && e.target === canvas) return;
      setIsLassoing(false);
      setLassoPoints([]);
    };

    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [isPanning, isBrushing, isRotatingView, isLassoing, lassoView]);

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

    const items = readDropItems(e.dataTransfer);
    const store = usePaintStore.getState();

    const multi = await readMultipleDroppedFolders(items, store);
    if (multi.handled) return;

    const { plainFiles, handlePromises, entries } = items;

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
        await collectImageFilesFromEntry(entry, fileMap, entry.name);
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
        /**
         * ⚠️ 落とした窓に合わせて面を決めること (Win A → ロール A / Win B → ロール B)。
         * 「今アクティブなロール」にしていた頃は、2 画面で見比べようと Win B へ
         * 落としてもロール A が差し替わり、ロール B へ入れる手段が無かった
         * (2026-08-31 の報告)。
         */
        const targetRoll: RollId = isWinA ? 'rollA' : 'rollB';
        loadRollFiles(targetRoll, videos, commonRootName(videos));
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


  /**
   * カットを変えたら、色づけして取ってあるコマを捨てる。
   * ⚠️ 残しておくと、前のカットの大きな絵を抱えたままになる。
   */
  useEffect(() => {
    clearOnionCache();
  }, [folderNameA]);

  // 画像の読み込み・先読み・オニオンスキンは useFrameLoader 系フックに委譲する。
  // (splitImage = Win B の編集対象はストア管理なので、保存・Undo が Win A と同じ経路を通る)
  const loadFrameForView = useFrameLoader();
  useCellPrefetch(loadFrameForView);
  const onionFramesMap = useOnionSkinFrames(loadFrameForView, 0);
  /**
   * ⚠️ Win B にも前後のコマを重ねること。以前は Win A だけで、
   * 「Win B でライトテーブルが効かない」ように見えていた。
   */
  const onionFramesMapB = useOnionSkinFrames(loadFrameForView, 1);

  /**
   * 「描き直せ」の合図。
   * ⚠️ ストアではなくここから受け取ること。ストアに置くと、
   * ブラシを引くたびに全パネルが描き直される (2026-09-03 の監査)。
   */
  const renderTrigger = useSyncExternalStore(subscribeRenderSignal, getRenderSignal, getRenderSignal);

  /**
   * 自動フィットが最後に決めた値。面ごとに控える。
   *
   * ⚠️ Win A の値だけで判断しないこと。以前は片方しか見ていなかったので、
   * Win B だけを拡大して塗っていると、その倍率が自動フィットで流された。
   */
  const lastFitTransformRef = useRef<Record<0 | 1, CanvasTransform | null>>({ 0: null, 1: null });

  /**
   * 1 つの面の表示を、その面の画像に合わせる。
   *
   * ⚠️ その面の画像の高さで計算すること。Win A の高さで Win B まで合わせると、
   * サイズの違うリテイク素材を並べたときに収まらない。
   * ⚠️ 連動中は Win A を合わせれば Win B も付いてくる (ストア側が写す)。
   */
  const fitView = useCallback(
    (viewIdx: 0 | 1, reason: string) => {
      const container = containerRef.current;
      if (!container) return;

      const live = usePaintStore.getState();
      const image = viewIdx === 0 ? live.currentImage : live.splitImage;
      const current = viewIdx === 0 ? live.canvasTransform : live.splitCanvasTransform;
      const fit = fitTransformFor(container.clientHeight, image?.height ?? 0, current);
      if (!fit) return;

      logDebug(
        'view',
        `表示倍率 ${Math.round(current.scale * 100)}% → ${Math.round(fit.scale * 100)}% (自動フィット)`,
        `${reason} / ${viewIdx === 0 ? 'Win A' : 'Win B'} / 画像 ${image ? `${image.width}x${image.height}` : '(なし)'}` +
          `${live.syncMode && live.isSplitView ? ' / 連動中なので両方' : ''}`
      );

      lastFitTransformRef.current[viewIdx] = fit;
      if (viewIdx === 0) {
        setCanvasTransform(fit);
        // 連動中はストア側が Win B へ写すので、控えもそろえておく
        if (live.syncMode && live.isSplitView) lastFitTransformRef.current[1] = fit;
      } else {
        setSplitCanvasTransform(fit);
      }
    },
    [setCanvasTransform, setSplitCanvasTransform]
  );

  /** その面を自動で合わせてよいか (自分で動かしていなければ合わせる) */
  const mayAutoFit = useCallback((viewIdx: 0 | 1): boolean => {
    const live = usePaintStore.getState();
    const current = viewIdx === 0 ? live.canvasTransform : live.splitCanvasTransform;
    return !isUserAdjusted(lastFitTransformRef.current[viewIdx], current);
  }, []);

  /**
   * 自動フィットは「画像の大きさが変わった時」だけ行う。
   *
   * 以前は画像が変わるたびに実行していたため、拡大して細部を塗っている最中に
   * コマ送りすると毎回ズームが初期化されてしまっていた。
   * 同じ大きさのセルを送っている間は、決めた表示倍率と位置をそのまま保つ。
   */
  const lastFittedSizeRef = useRef<Record<0 | 1, string | null>>({ 0: null, 1: null });

  useEffect(() => {
    const sizeKey = sizeKeyOf(currentImage);
    if (!sizeKey || lastFittedSizeRef.current[0] === sizeKey) return;

    const previous = lastFittedSizeRef.current[0];
    lastFittedSizeRef.current[0] = sizeKey;

    // ⚠️ 自分で決めた倍率は壊さないこと。設定シートのように大きさの違う
    // ファイルを 1 枚挟むだけで、拡大して塗っていた倍率が飛んでしまう
    // (2026-08-31 の報告)。合わせ直すのは、自動で合わせた値のままのときだけ。
    if (!mayAutoFit(0)) {
      logDebug(
        'view',
        `Win A の画像の大きさが変わったが、表示倍率はそのまま保つ`,
        `${previous ?? '(初回)'} → ${sizeKey} / 自分でズーム・パンした値を優先`
      );
      return;
    }
    fitView(0, `Win A の画像の大きさが変わった (${previous ?? '(初回)'} → ${sizeKey})`);
  }, [currentImage, fitView, mayAutoFit]);

  useEffect(() => {
    const sizeKey = sizeKeyOf(splitImage);
    if (!sizeKey) {
      lastFittedSizeRef.current[1] = null;
      return;
    }
    if (lastFittedSizeRef.current[1] === sizeKey) return;

    const previous = lastFittedSizeRef.current[1];
    lastFittedSizeRef.current[1] = sizeKey;

    // 連動中は Win A に付いていくので、ここでは触らない
    const live = usePaintStore.getState();
    if (live.syncMode && live.isSplitView) return;
    if (!mayAutoFit(1)) return;

    fitView(1, `Win B の画像の大きさが変わった (${previous ?? '(初回)'} → ${sizeKey})`);
  }, [splitImage, fitView, mayAutoFit]);

  /**
   * ウィンドウをリサイズした時は表示を合わせ直すが、
   * 自分でズーム・パンしている面は、その操作を尊重して触らない。
   */
  useEffect(() => {
    const handleResize = () => {
      if (mayAutoFit(0)) fitView(0, 'ウィンドウのリサイズ');
      const live = usePaintStore.getState();
      if (live.isSplitView && !(live.syncMode) && mayAutoFit(1)) {
        fitView(1, 'ウィンドウのリサイズ');
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fitView, mayAutoFit]);

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

  /**
   * 素材を canvas へ写すための下書き。
   *
   * ⚠️ 描くたびに new しないこと。ブラシを 1 回引くだけで描き直しが走るので、
   * 重ねる枚数ぶんの canvas が毎回作られていた。1 枚を使い回す
   * (写したらすぐ描き込むので、次の呼び出しまで内容を持つ必要はない)。
   */
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const toScratchCanvas = useCallback(
    (img: { width: number; height: number; data: Uint8ClampedArray }): HTMLCanvasElement | null => {
      if (!scratchCanvasRef.current) scratchCanvasRef.current = document.createElement('canvas');
      const scratch = scratchCanvasRef.current;
      if (scratch.width !== img.width || scratch.height !== img.height) {
        scratch.width = img.width;
        scratch.height = img.height;
      }
      const sctx = scratch.getContext('2d');
      if (!sctx) return null;
      const imgData = sctx.createImageData(img.width, img.height);
      imgData.data.set(img.data);
      sctx.putImageData(imgData, 0, 0);
      return scratch;
    },
    []
  );

  /**
   * タップ穴のずれを直す補正をかける。
   *
   * ⚠️ 焼き込みと同じ順 (回す → 倍率 → 平行移動)。順が違うと画面と結果がずれる。
   * ⚠️ 絵とガイドで別々に書かないこと。片方だけ直すと、合っているのかが分からなくなる。
   */
  const applyPegTransform = useCallback(
    (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
      if (!pegStabilizer.enabled) return;
      const totalX = pegStabilizer.offsetX + pegStabilizer.manualX;
      const totalY = pegStabilizer.offsetY + pegStabilizer.manualY;
      const totalRot = (pegStabilizer.rotation + pegStabilizer.manualRotation) * (Math.PI / 180);
      ctx.translate(canvas.width / 2 + totalX, canvas.height / 2 + totalY);
      ctx.rotate(totalRot);
      ctx.scale(pegStabilizer.scale, pegStabilizer.scale);
      ctx.translate(-canvas.width / 2, -canvas.height / 2);
    },
    [pegStabilizer]
  );

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
      // ⚠️ 過去と未来で処理を分けて書かないこと。以前は色と符号だけが違う
      // 46 行が 2 つ並んでおり、片方だけ直る形になっていた。
      const framesForView = isLeft ? onionFramesMap : onionFramesMapB;
      if (lightTable.enabled && !isPlaying) {
        const mode = (lightTable.displayMode ?? 'monochrome') as OnionDisplayMode;
        const startOpacity = lightTable.startOpacity ?? 30;
        const opacityStep = lightTable.opacityStep ?? 10;

        // 「カット全体」指定のときは読み込めた枚数ぶんすべて重ねる
        const pastCount = lightTable.showAllFrames ? framesForView.size : lightTable.pastFrames ?? 1;
        const futureCount = lightTable.showAllFrames ? framesForView.size : lightTable.futureFrames ?? 1;

        // 奥のコマから順に重ねる (過去は遠い方から、未来は近い方から)
        const layers: { step: number; color: OnionColor; frame: any }[] = [];
        for (let step = pastCount; step >= 1; step--) {
          // 1 コマ前後はストアの先読み (Win A のみ) も当てにする
          const frame = framesForView.get(-step) || (isLeft && step === 1 ? prevImage : null);
          if (frame) layers.push({ step, color: lightTable.pastColor || { r: 239, g: 68, b: 68 }, frame });
        }
        for (let step = 1; step <= futureCount; step++) {
          const frame = framesForView.get(step) || (isLeft && step === 1 ? nextImage : null);
          if (frame) layers.push({ step, color: lightTable.futureColor || { r: 59, g: 130, b: 246 }, frame });
        }

        for (const layer of layers) {
          const tinted = tintedOnionCanvas(layer.frame, layer.color, mode);
          if (!tinted) continue;
          ctx.globalAlpha = onionAlpha(startOpacity, opacityStep, layer.step);
          ctx.drawImage(tinted, 0, 0);
          ctx.globalAlpha = 1.0;
        }
      }
      // 1.5 Draw Individual Light Table SubLayers (登録された個別の参照TGA: 移動・回転アフィン変換)
      if (lightTable.items && lightTable.items.length > 0) {
        for (const subItem of lightTable.items) {
          if (!subItem.visible || !subItem.image) continue;

          const subImg = subItem.image;
          const subCanvas = toScratchCanvas(subImg);
          if (!subCanvas) continue;

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

      // 2. Draw Target Image (スタビライザー アフィン変換適用)
      const tempCanvas = toScratchCanvas(targetImg);
      if (tempCanvas) {
        ctx.save();
        applyPegTransform(ctx, canvas);
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

      /**
       * 4. タップ穴のガイド
       *
       * 赤 = 合わせ先 (基準にしたコマの穴)、緑 = 今のコマの穴を補正した位置。
       * ⚠️ 決め打ちの円を描かないこと。紙のサイズもタップの間隔も現場ごとに違う。
       * 検出した実際の位置を出さないと、合っているのか外しているのかが分からない。
       */
      if (pegStabilizer.showGuide) {
        const ref = pegStabilizer.reference;

        if (ref) {
          ctx.strokeStyle = '#EF4444';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          [-ref.spacing, 0, ref.spacing].forEach((dx) => {
            const rad = (ref.angle * Math.PI) / 180;
            ctx.beginPath();
            ctx.ellipse(
              ref.center.x + dx * Math.cos(rad),
              ref.center.y + dx * Math.sin(rad),
              dx === 0 ? 16 : 10,
              dx === 0 ? 10 : 10,
              rad,
              0,
              Math.PI * 2
            );
            ctx.stroke();
          });
          ctx.setLineDash([]);
        }

        if (pegStabilizer.holes.length === 3) {
          // 画像と同じ補正をかけて描く。基準の赤と重なれば合っている
          ctx.save();
          applyPegTransform(ctx, canvas);
          ctx.strokeStyle = '#10B981';
          ctx.lineWidth = 2;
          pegStabilizer.holes.forEach((hole) => {
            ctx.beginPath();
            ctx.ellipse(hole.x, hole.y, Math.max(6, hole.width / 2), Math.max(5, hole.height / 2), 0, 0, Math.PI * 2);
            ctx.stroke();
          });
          ctx.restore();
        }
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
    [
      prevImage,
      nextImage,
      onionFramesMap,
      onionFramesMapB,
      lightTable,
      isPlaying,
      showGrid,
      showUnpaintedFlash,
      lassoPoints,
      lassoView,
      pegStabilizer,
      toScratchCanvas,
      applyPegTransform,
    ]
  );

  useEffect(() => {
    renderCanvasInstance(leftCanvasRef.current, currentImage, true);
    if (isSplitView) {
      renderCanvasInstance(rightCanvasRef.current, splitImage, false);
    }
  }, [renderCanvasInstance, currentImage, splitImage, isSplitView, renderTrigger]);


  /**
   * 画面の座標を画像の画素へ直す。
   * ⚠️ 表示を回している (回転ビュー) と、外接四角形からは倍率も位置も読めない。
   * 角度を渡して逆回しすること (screenToImagePoint)。
   */
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement, isLeftView: boolean) => {
    const live = usePaintStore.getState();
    const rotation = (isLeftView ? live.canvasTransform : live.splitCanvasTransform).rotation ?? 0;
    return screenToImagePoint(e.clientX, e.clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height, rotation);
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

    // 回転ビュー: 掴んだ向きからの差分だけ表示を回す (画像は変わらない)
    if (e.button === 0 && activeTool === 'rotateView') {
      const rect = canvas.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      rotateDragRef.current = {
        center,
        startAngle: angleFromCenter(e.clientX, e.clientY, center),
        startRotation: currentTransform.rotation ?? 0,
        isLeftView,
      };
      setIsRotatingView(true);
      return;
    }

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

    const { x, y } = getCanvasCoords(e, canvas, isLeftView);

    // 閲覧専用（タイムシートや指示メモなどの JPG/PNG 画像）の場合は塗り・描画操作をガード。
    // 黙って無視すると「ツールが反応しない」ようにしか見えないので理由を表示する。
    // 認証済みユーザー (@ajiado.co.jp) の場合はすべてのファイルを編集可能にする
    const isAuthenticated = usePaintStore.getState().isAuthenticated;
    if (targetImg.isReadOnly && !isAuthenticated && activeTool !== 'eyedropper' && e.button !== 1 && !e.altKey) {
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

    const rotateDrag = rotateDragRef.current;
    if (rotateDrag) {
      const moved = angleFromCenter(e.clientX, e.clientY, rotateDrag.center) - rotateDrag.startAngle;
      const raw = rotateDrag.startRotation + moved;
      const rotation = e.shiftKey ? snapAngle(raw, 15) : normalizeAngle(raw);
      const live = usePaintStore.getState();
      const liveTransform = rotateDrag.isLeftView ? live.canvasTransform : live.splitCanvasTransform;
      const rotated = { ...liveTransform, rotation };
      // ⚠️ 連動中の写しはストア側が行う。ここで両方へ書かないこと
      if (rotateDrag.isLeftView) setCanvasTransform(rotated);
      else setSplitCanvasTransform(rotated);
      return;
    }

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

      if (isLeftView) setCanvasTransform(newTransform);
      else setSplitCanvasTransform(newTransform);
      return;
    }

    if (!targetImg || !canvas) return;
    const { x, y } = getCanvasCoords(e, canvas, isLeftView);

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
    if (rotateDragRef.current) {
      rotateDragRef.current = null;
      setIsRotatingView(false);
      const live = usePaintStore.getState();
      const rotation = (isLeftView ? live.canvasTransform : live.splitCanvasTransform).rotation ?? 0;
      logDebug('view', `表示の角度を ${Math.round(rotation)}° にした (回転ビュー)`);
      return;
    }

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
    const newTransform = wheelTransform(currentTransform, wheelInputFrom(e), live.inputMode);

    // 平行移動だけのときは倍率の記録を取らない (トラックパッドの 2 本指)
    if (newTransform.scale !== currentTransform.scale) {
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
    }

    // ⚠️ 連動中の写しはストア側 (setCanvasTransform) が行う。ここで両方へ書かないこと
    if (isLeftView) setCanvasTransform(newTransform);
    else setSplitCanvasTransform(newTransform);
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
  const isRushOpen = usePaintStore((s) => s.isRushOpen);

  useEffect(() => {
    syncPaneVisibility({
      winA: isWinAVisible,
      winB: isSplitView,
      reference: referenceCanvas.isOpen,
      rollA: roll.views.rollA.isOpen,
      rollB: roll.views.rollB.isOpen,
      rush: isRushOpen,
    });
  }, [
    isWinAVisible,
    isSplitView,
    referenceCanvas.isOpen,
    roll.views.rollA.isOpen,
    roll.views.rollB.isOpen,
    isRushOpen,
    syncPaneVisibility,
  ]);

  // --- 各面の中身。並べる順序はレイアウトが決めるので、ここでは組み立てるだけ ---

  /** 掴んでいる間は追従を切る (transition が入ると引きずられる) */
  const isTransformDragging = isPanning || isRotatingView;
  const paneCursorClass =
    activeTool === 'pan' || isSpacePressed
      ? 'cursor-grab active:cursor-grabbing'
      : activeTool === 'rotateView'
      ? 'cursor-alias'
      : 'cursor-crosshair';

  const winAPaneContent = (
    <CellCanvasPane
      viewIdx={0}
      floating={winAWindow}
      isFloating={isWinAFloating}
      toggleFloating={toggleWinAFloating}
      borderClass={activeBorderClass(0, isWinAFloating)}
      isDragOver={isWinADragOver}
      onDragEnter={(e) => handleWindowDragEnter(e, 'winA')}
      onDragOver={(e) => handleWindowDragOver(e, 'winA')}
      onDragLeave={(e) => handleWindowDragLeave(e, 'winA')}
      onDrop={(e) => handleFolderOrFilesNativeDrop(e, 'winA')}
      onActivate={() => setActiveViewIndex(0)}
      folderName={folderNameA}
      fileName={resolveFileNameForView(currentFileIndex, 0) || ''}
      isDirty={isDirtyA}
      image={currentImage}
      showReadOnlyBadge={!!currentImage?.isReadOnly && !isAuthenticated}
      showReadOnlyNotice={readOnlyNoticeView === 0}
      showRuler={showRuler}
      transform={canvasTransform}
      isDragging={isTransformDragging}
      cursorClass={paneCursorClass}
      canvasRef={(el) => {
        leftCanvasRef.current = el;
      }}
      onWheel={(e) => handleWheel(e, true)}
      onMouseDown={(e) => handleMouseDown(e, true)}
      onMouseMove={(e) => handleMouseMove(e, true)}
      onMouseUp={() => handleMouseUp(true)}
    />
  );

  const winBPaneContent = isSplitView ? (
    <CellCanvasPane
      viewIdx={1}
      floating={winBWindow}
      isFloating={isWinBFloating}
      toggleFloating={toggleWinBFloating}
      borderClass={activeBorderClass(1, isWinBFloating)}
      isDragOver={isWinBDragOver}
      onDragEnter={(e) => handleWindowDragEnter(e, 'winB')}
      onDragOver={(e) => handleWindowDragOver(e, 'winB')}
      onDragLeave={(e) => handleWindowDragLeave(e, 'winB')}
      onDrop={(e) => handleFolderOrFilesNativeDrop(e, 'winB')}
      onActivate={() => setActiveViewIndex(1)}
      folderName={folderNameB}
      fileName={resolveFileNameForView(splitFileIndex, 1) || ''}
      isDirty={isDirtyB}
      image={splitImage}
      showReadOnlyBadge={!!splitImage?.isReadOnly && !isAuthenticated}
      showReadOnlyNotice={readOnlyNoticeView === 1}
      showRuler={showRuler}
      transform={splitCanvasTransform}
      isDragging={isTransformDragging}
      cursorClass={paneCursorClass}
      canvasRef={(el) => {
        rightCanvasRef.current = el;
      }}
      onWheel={(e) => handleWheel(e, false)}
      onMouseDown={(e) => handleMouseDown(e, false)}
      onMouseMove={(e) => handleMouseMove(e, false)}
      onMouseUp={() => handleMouseUp(false)}
    />
  ) : null;

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
    if (pane === 'rush') return <RushWindow />;
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
    else if (pane === 'rush') usePaintStore.getState().closeRushWindow();
  };

  /**
   * タブに添える「いま開いているもの」。
   * ⚠️ 面の中にもう 1 本見出しを置かないこと (2 つの × が並ぶ)。
   */
  const paneDetail = (pane: PaneId): string | null => {
    if (pane === 'winA') {
      return `${folderNameA || 'Orig'}: ${resolveFileNameForView(currentFileIndex, 0) || '---'}${isDirtyA ? ' *' : ''}`;
    }
    if (pane === 'winB') {
      return `${folderNameB || 'Retake'}: ${resolveFileNameForView(splitFileIndex, 1) || '---'}${isDirtyB ? ' *' : ''}`;
    }
    if (pane === 'rollA' || pane === 'rollB') {
      const view = roll.views[pane];
      const at = view.files.length > 1 && view.currentPath
        ? ` (${view.files.findIndex((v) => v.path === view.currentPath) + 1}/${view.files.length})`
        : '';
      return `${view.fileName || '(未読み込み)'}${at}`;
    }
    if (pane === 'reference') return referenceCanvas.fileName || null;
    return null;
  };

  const paneIsFloating = (pane: PaneId): boolean => {
    if (pane === 'winA') return isWinAFloating;
    if (pane === 'winB') return isWinBFloating;
    if (pane === 'reference') return referenceCanvas.isFloating;
    if (pane === 'rollA' || pane === 'rollB') return roll.views[pane].isFloating;
    return false;
  };

  const togglePaneFloating = (pane: PaneId) => {
    if (pane === 'winA') toggleWinAFloating();
    else if (pane === 'winB') toggleWinBFloating();
    else if (pane === 'reference') toggleReferenceFloating();
    else if (pane === 'rollA' || pane === 'rollB') toggleRollFloating(pane);
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
      {/* 🔮 PSD デコード・レイヤー解析中の高級ローディングオーバーレイ */}
      {isPsdLoading && (
        <div className="absolute inset-0 z-[90] flex items-center justify-center bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-150 select-none">
          <div className="flex flex-col items-center justify-center p-8 bg-slate-900/90 border border-indigo-500/30 rounded-2xl shadow-2xl max-w-sm text-center relative overflow-hidden">
            {/* バックドロップグラデーション発光効果 */}
            <div className="absolute -top-12 -left-12 w-32 h-32 bg-indigo-500/20 rounded-full blur-2xl pointer-events-none" />
            <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-blue-500/20 rounded-full blur-2xl pointer-events-none" />

            <div className="relative mb-4">
              <div className="w-16 h-16 rounded-2xl bg-indigo-950/80 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shadow-lg">
                <FileCode className="w-8 h-8 animate-pulse text-indigo-400" />
              </div>
              <div className="absolute -bottom-1 -right-1 bg-slate-900 rounded-full p-1 border border-indigo-500/50">
                <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
              </div>
            </div>

            <h3 className="text-sm font-bold text-white mb-1 tracking-wide flex items-center gap-1.5">
              <span>PSD レイヤー解析中...</span>
            </h3>
            <p className="text-[11px] text-slate-300 font-mono truncate max-w-[240px] mb-3 bg-slate-800/80 px-2.5 py-1 rounded border border-slate-700">
              {psdLoadingFileName || 'PSD File'}
            </p>

            {/* インディゴグラデーションプログレスバー */}
            <div className="w-48 h-1.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700 relative">
              <div className="absolute inset-y-0 bg-gradient-to-r from-indigo-500 via-blue-500 to-indigo-400 w-full rounded-full animate-pulse" />
            </div>
            <span className="text-[10px] text-slate-400 mt-2 font-medium">
              Photoshop レイヤー構造とビットマップを展開しています
            </span>
          </div>
        </div>
      )}

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
              className="flex flex-col min-w-0 overflow-hidden flex-1 w-full"
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
                detailOf={paneDetail}
                onToggleFloat={togglePaneFloating}
                isFloating={paneIsFloating}
              />
              <div className="flex-1 flex min-h-0 w-full">{renderPane(slot.activePane)}</div>
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
