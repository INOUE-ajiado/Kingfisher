/**
 * テーマ・パネル配置・モーダル・ズーム/ルーラーなど、画面まわりの状態
 */

import { StateCreator } from 'zustand';
import { PaintStore, UiSlice } from '../types';

export const createUiSlice: StateCreator<PaintStore, [], [], UiSlice> = (set) => ({
  isDarkMode: false,

  toggleDarkMode: () => set((state) => ({ isDarkMode: !state.isDarkMode })),

  isRightSidebarOpen: true,

  toggleRightSidebarOpen: () => set((state) => ({ isRightSidebarOpen: !state.isRightSidebarOpen })),

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
      if (state.syncMode && state.isSplitView) {
        return { canvasTransform: newTransform, splitCanvasTransform: newTransform };
      }
      return { canvasTransform: newTransform };
    }),

  zoomOut: () =>
    set((state) => {
      const newScale = Math.max(0.2, state.canvasTransform.scale / 1.2);
      const newTransform = { ...state.canvasTransform, scale: newScale };
      if (state.syncMode && state.isSplitView) {
        return { canvasTransform: newTransform, splitCanvasTransform: newTransform };
      }
      return { canvasTransform: newTransform };
    }),

  resetCanvasTransform: () =>
    set({
      canvasTransform: { scale: 1, offsetX: 0, offsetY: 0 },
      splitCanvasTransform: { scale: 1, offsetX: 0, offsetY: 0 },
    }),

  renderTrigger: 0,

  triggerRender: () => set((state) => ({ renderTrigger: state.renderTrigger + 1 })),
});
