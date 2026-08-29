/**
 * 2画面分割・参照ウィンドウ・タップ穴補正など、ビュー構成の状態
 */

import { StateCreator } from 'zustand';
import { detectPegHolesAndCalculateTransform } from '../../engine/pegStabilizer';
import { PaintStore, ViewSlice } from '../types';

export const createViewSlice: StateCreator<PaintStore, [], [], ViewSlice> = (set, get) => ({
  // 色指定参照ウィンドウ (Color Spec Reference Window)
  referenceCanvas: {
    isOpen: false,
    isFloating: false,
    fileName: '',
    image: null,
    transform: { scale: 1, offsetX: 0, offsetY: 0 },
    autoRevertTool: true,
    previousTool: null,
  },

  colorSpecLayoutMode: 'split-vertical',

  openReferenceImage: (_fileHandle, fileName, image) =>
    set((state) => ({
      referenceCanvas: {
        ...state.referenceCanvas,
        isOpen: true,
        fileName: fileName || state.referenceCanvas.fileName,
        image: image !== undefined ? image : state.referenceCanvas.image,
      },
    })),

  closeReferenceWindow: () =>
    set((state) => ({
      referenceCanvas: { ...state.referenceCanvas, isOpen: false },
    })),

  isWinAFloating: false,

  isWinBFloating: false,

  toggleWinAFloating: () => set((state) => ({ isWinAFloating: !state.isWinAFloating })),

  toggleWinBFloating: () => set((state) => ({ isWinBFloating: !state.isWinBFloating })),

  toggleReferenceFloating: () =>
    set((state) => ({
      referenceCanvas: { ...state.referenceCanvas, isFloating: !state.referenceCanvas.isFloating },
    })),

  mainAreaSplitRatio: 0.5,

  setMainAreaSplitRatio: (ratio) =>
    // 片側が潰れて操作できなくならないよう両端を残す
    set({ mainAreaSplitRatio: Math.min(0.85, Math.max(0.15, ratio)) }),

  setColorSpecLayoutMode: (mode) => set({ colorSpecLayoutMode: mode }),

  setAutoRevertTool: (enable) =>
    set((state) => ({
      referenceCanvas: { ...state.referenceCanvas, autoRevertTool: enable },
    })),

  setReferenceTransform: (transform) =>
    set((state) => ({
      referenceCanvas: { ...state.referenceCanvas, transform },
    })),

  pickColorFromReference: (color) =>
    set((state) => {
      const activeTool = state.activeTool;
      const autoRevert = state.referenceCanvas.autoRevertTool;
      const prevTool = activeTool !== 'eyedropper' ? activeTool : state.referenceCanvas.previousTool || 'fill';
      const nextTool = autoRevert ? prevTool : 'eyedropper';

      return {
        currentColor: color,
        activeTool: nextTool,
        referenceCanvas: {
          ...state.referenceCanvas,
          previousTool: prevTool,
        },
      };
    }),

  // タップ穴自動検出 ＆ 傾き補正 (Peg Hole Stabilizer)
  pegStabilizer: {
    enabled: false,
    status: 'idle',
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    manualX: 0,
    manualY: 0,
    manualRotation: 0,
    showGuide: false,
  },

  togglePegStabilizerEnabled: () =>
    set((state) => ({
      pegStabilizer: { ...state.pegStabilizer, enabled: !state.pegStabilizer.enabled },
    })),

  setPegManualOffset: (x, y, rot) =>
    set((state) => ({
      pegStabilizer: {
        ...state.pegStabilizer,
        manualX: x,
        manualY: y,
        manualRotation: rot,
      },
    })),

  togglePegGuide: () =>
    set((state) => ({
      pegStabilizer: { ...state.pegStabilizer, showGuide: !state.pegStabilizer.showGuide },
    })),

  runPegStabilizerAutoDetect: () => {
    const { currentImage, triggerRender } = get();
    if (!currentImage) return;

    const res = detectPegHolesAndCalculateTransform(
      currentImage.data,
      currentImage.width,
      currentImage.height
    );

    set((state) => ({
      pegStabilizer: {
        ...state.pegStabilizer,
        enabled: true,
        status: res.status,
        offsetX: res.offsetX,
        offsetY: res.offsetY,
        rotation: res.rotation,
      },
    }));
    triggerRender();
  },

  // 2画面分割 (Split View) & 連動 (Sync Mode)
  isSplitView: false,

  // 初期状態では連動しない。それぞれ好きなセルを選んでから「連動」を押す使い方に合わせる
  syncMode: false,

  syncFrameOffset: 0,

  activeViewIndex: 0,

  splitFileIndex: 0,

  splitCanvasTransform: { scale: 1, offsetX: 0, offsetY: 0 },

  isWinAVisible: false,

  toggleWinAVisible: () => {
    const { isWinAVisible, confirmDiscardIfDirty } = get();
    // 閉じると編集中の内容は見えなくなるので、未保存なら確認する
    if (isWinAVisible && !confirmDiscardIfDirty(0)) return;
    set({ isWinAVisible: !isWinAVisible, ...(isWinAVisible ? {} : { activeSurface: 'cell' as const }) });
  },

  toggleIsSplitView: () => {
    const { isSplitView, confirmDiscardIfDirty } = get();
    // 2画面表示を閉じると Win B の編集は破棄されるので確認する
    if (isSplitView && !confirmDiscardIfDirty(1)) return;
    set({
      isSplitView: !isSplitView,
      // セルを並べた操作なので、↑ ↓ と Space はセルのものへ
      ...(isSplitView ? {} : { activeSurface: 'cell' as const }),
      // 閉じたときはアクティブビューを Win A に戻す (保存先の取り違えを防ぐ)
      ...(isSplitView ? { activeViewIndex: 0 as 0 | 1, splitHistoryStack: [], splitHistoryIndex: -1 } : {}),
    });
  },

  toggleSyncMode: () =>
    set((state) => {
      if (!state.syncMode) {
        // 連動開始: 今それぞれが表示しているコマの差をそのまま保つ。
        // 以前は Win B を Win A の位置へ強制的に合わせていたため、
        // 狙って選んだコマがずれてしまっていた。
        return {
          syncMode: true,
          syncFrameOffset: state.splitFileIndex - state.currentFileIndex,
        };
      }
      return { syncMode: false };
    }),

  alignSyncFrames: () => {
    const state = get();
    if (state.splitFileIndex !== state.currentFileIndex) {
      if (!state.confirmDiscardIfDirty(1)) return;
    }
    set({
      syncFrameOffset: 0,
      splitFileIndex: state.currentFileIndex,
      splitHistoryStack: [],
      splitHistoryIndex: -1,
      isDirtyB: false,
    });
  },

  // セルの窓を触ったら、↑ ↓ と Space の効き先もセルへ戻す
  setActiveViewIndex: (idx) => set({ activeViewIndex: idx, activeSurface: 'cell' }),

  setSplitCanvasTransform: (transform) => set({ splitCanvasTransform: transform }),

  setSplitFileIndex: (index) => {
    const state = get();
    if (index === state.splitFileIndex) {
      // 同じコマでも、選んだ以上はキーの効き先をセルへ戻す
      if (state.activeSurface !== 'cell') set({ activeSurface: 'cell' });
      return;
    }
    if (!state.confirmDiscardIfDirty(1)) return;

    const patch: Record<string, unknown> = {
      splitFileIndex: index,
      splitHistoryStack: [],
      splitHistoryIndex: -1,
      isDirtyB: false,
      activeSurface: 'cell',
    };

    // 連動中は Win A 側も同じコマ差を保って追従させる
    if (state.syncMode && state.isSplitView) {
      const last = Math.max(0, state.unifiedFileList.length - 1);
      const target = Math.max(0, Math.min(last, index - state.syncFrameOffset));
      if (target !== state.currentFileIndex) {
        if (!state.confirmDiscardIfDirty(0)) return;
        patch.currentFileIndex = target;
        patch.historyStack = [];
        patch.historyIndex = -1;
        patch.isDirtyA = false;
      }
    }

    set(patch as any);
  },
});
