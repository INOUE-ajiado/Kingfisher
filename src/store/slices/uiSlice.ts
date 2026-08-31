/**
 * テーマ・パネル配置・モーダル・ズーム/ルーラーなど、画面まわりの状態
 */

import { StateCreator } from 'zustand';
import { PaintStore, UiSlice } from '../types';
import { logDebug } from '../../engine/debugLog';

/** 表示倍率を人が読める形に (0.625 -> 63%) */
function percent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export const createUiSlice: StateCreator<PaintStore, [], [], UiSlice> = (set) => ({
  // 既定はダークモード (2026-08-31 のユーザー指定)。
  // ⚠️ index.html の <html class="dark"> と揃えること。片方だけ変えると、
  // 起動直後の一瞬だけ明るい画面が出る (React が乗る前は CSS だけで決まる)。
  isDarkMode: true,

  toggleDarkMode: () => set((state) => ({ isDarkMode: !state.isDarkMode })),

  isRightSidebarOpen: true,

  toggleRightSidebarOpen: () => set((state) => ({ isRightSidebarOpen: !state.isRightSidebarOpen })),

  /**
   * 右サイドパネルの幅。
   * ⚠️ 既定を狭くしないこと。DEBUG ログはパスや位置を 1 行に並べるので、
   * 320px では折り返しだらけで読めない (2026-09-01 のユーザー指定で 420 へ)。
   * ⚠️ 上限は広めに取る。ログを読むときは一時的に 2 倍近くまで広げる使い方がある。
   */
  rightSidebarWidth: 420,

  setRightSidebarWidth: (width) =>
    set({ rightSidebarWidth: Math.max(180, Math.min(1000, Math.round(width))) }),

  canvasBgMatteMode: 'checkerboard',

  canvasCustomBgColor: '#00ff00',

  setCanvasBgMatteMode: (mode) => set({ canvasBgMatteMode: mode }),

  setCanvasCustomBgColor: (color) => set({ canvasCustomBgColor: color }),

  activeDragColor: null,

  setActiveDragColor: (color) => set({ activeDragColor: color }),

  panelVisibility: {
    toolPalette: true,
    toolOptions: true,
    colorChart: true,
    lightTable: true,
    fileBrowser: true,
    layerPanel: true,
    historyPanel: true,
    // 不具合の切り分けに使うので既定で出しておく (メニューから閉じられる)
    debugLog: true,
  },

  togglePanelVisibility: (panel) =>
    set((state) => ({
      panelVisibility: {
        ...state.panelVisibility,
        [panel]: !state.panelVisibility[panel],
      },
    })),

  isColorChartFloating: false,

  toggleColorChartFloating: () => set((state) => ({ isColorChartFloating: !state.isColorChartFloating })),

  showUnpaintedFlash: false,

  toggleShowUnpaintedFlash: () => set((state) => ({ showUnpaintedFlash: !state.showUnpaintedFlash })),

  activeModal: null,

  setActiveModal: (modal) => set({ activeModal: modal }),

  showGrid: false,

  showRuler: true,

  toggleShowGrid: () => set((state) => ({ showGrid: !state.showGrid })),

  toggleShowRuler: () => set((state) => ({ showRuler: !state.showRuler })),

  canvasTransform: { scale: 1, offsetX: 0, offsetY: 0 },

  setCanvasTransform: (transform) =>
    set((state) => {
      if (state.syncMode && state.isSplitView) {
        return { canvasTransform: transform, splitCanvasTransform: transform };
      }
      return { canvasTransform: transform };
    }),

  zoomIn: () =>
    set((state) => {
      const newScale = Math.min(5.0, state.canvasTransform.scale * 1.2);
      const newTransform = { ...state.canvasTransform, scale: newScale };
      logDebug('view', `表示倍率 ${percent(state.canvasTransform.scale)} → ${percent(newScale)} (拡大)`);
      if (state.syncMode && state.isSplitView) {
        return { canvasTransform: newTransform, splitCanvasTransform: newTransform };
      }
      return { canvasTransform: newTransform };
    }),

  zoomOut: () =>
    set((state) => {
      const newScale = Math.max(0.2, state.canvasTransform.scale / 1.2);
      const newTransform = { ...state.canvasTransform, scale: newScale };
      logDebug('view', `表示倍率 ${percent(state.canvasTransform.scale)} → ${percent(newScale)} (縮小)`);
      if (state.syncMode && state.isSplitView) {
        return { canvasTransform: newTransform, splitCanvasTransform: newTransform };
      }
      return { canvasTransform: newTransform };
    }),

  resetCanvasTransform: () =>
    set((state) => {
      logDebug(
        'view',
        `表示倍率 ${percent(state.canvasTransform.scale)} → 100% (等倍に戻す)`,
        `Win A / Win B の両方を等倍・原点へ`
      );
      return {
        canvasTransform: { scale: 1, offsetX: 0, offsetY: 0 },
        splitCanvasTransform: { scale: 1, offsetX: 0, offsetY: 0 },
      };
    }),

  renderTrigger: 0,

  triggerRender: () => set((state) => ({ renderTrigger: state.renderTrigger + 1 })),

  /**
   * キーの効き先。最初はセル。
   *
   * ⚠️ ↑ ↓ と Space はセルとロールの双方で意味を持つ (セル: コマ送り / パン、
   * ロール: 前後のロール / 再生)。どちらへ効かせるかは「最後に操作した面」で決める。
   * 面を触るたびにストア側で切り替えるので、コンポーネントで持たせないこと
   * (キーを拾うのは window のハンドラで、そこからは React の状態が見えない)。
   */
  activeSurface: 'cell',

  setActiveSurface: (surface) => set({ activeSurface: surface }),
});
