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

  syncMode: true,

  activeViewIndex: 0,

  splitFileIndex: 0,

  splitCanvasTransform: { scale: 1, offsetX: 0, offsetY: 0 },

  toggleIsSplitView: () => {
    const { isSplitView, confirmDiscardIfDirty } = get();
    // 2画面表示を閉じると Win B の編集は破棄されるので確認する
    if (isSplitView && !confirmDiscardIfDirty(1)) return;
    set({
      isSplitView: !isSplitView,
      // 閉じたときはアクティブビューを Win A に戻す (保存先の取り違えを防ぐ)
      ...(isSplitView ? { activeViewIndex: 0 as 0 | 1, splitHistoryStack: [], splitHistoryIndex: -1 } : {}),
    });
  },

  toggleSyncMode: () =>
    set((state) => {
      const nextSyncMode = !state.syncMode;
      if (nextSyncMode) {
        return { syncMode: true, splitFileIndex: state.currentFileIndex };
      }
      return { syncMode: false };
    }),

  setActiveViewIndex: (idx) => set({ activeViewIndex: idx }),

  setSplitCanvasTransform: (transform) => set({ splitCanvasTransform: transform }),

  setSplitFileIndex: (index) => {
    const { splitFileIndex, confirmDiscardIfDirty } = get();
    if (index === splitFileIndex) return;
    if (!confirmDiscardIfDirty(1)) return;
    set({ splitFileIndex: index, splitHistoryStack: [], splitHistoryIndex: -1, isDirtyB: false });
  },
});
