/**
 * 独立ウィンドウ (フローティング) の位置・サイズ・重なり順。
 *
 * 位置とサイズをここで持つことで、ドッキングとの往復やブラウザの再描画をまたいでも
 * ユーザーが動かした場所・広げた大きさが保たれる。
 */

import { StateCreator } from 'zustand';
import { PaintStore, WindowSlice, FloatingWindowId, FloatingWindowLayout } from '../types';

/** 初期レイアウト。ユーザーが動かすまではこの位置・大きさで開く */
const DEFAULT_LAYOUTS: Record<FloatingWindowId, FloatingWindowLayout> = {
  winA: { x: 60, y: 60, width: 680, height: 520 },
  winB: { x: 200, y: 80, width: 680, height: 520 },
  reference: { x: 120, y: 80, width: 360, height: 420 },
  colorChart: { x: 0, y: 120, width: 340, height: 240 },
};

/** 最背面の独立ウィンドウに割り当てる z-index */
const Z_INDEX_BASE = 50;

export const createWindowSlice: StateCreator<PaintStore, [], [], WindowSlice> = (set, get) => ({
  floatingWindows: {
    ...DEFAULT_LAYOUTS,
    // カラーチャートだけは画面右寄りを既定位置にする
    colorChart: {
      ...DEFAULT_LAYOUTS.colorChart,
      x: typeof window !== 'undefined' ? Math.max(20, window.innerWidth - 360) : 20,
    },
  },

  // 末尾ほど手前。既定の重なりは カラーチャート → 参照 → Win B → Win A
  floatingWindowOrder: ['colorChart', 'reference', 'winB', 'winA'],

  setFloatingWindowPosition: (id, x, y) =>
    set((state) => ({
      floatingWindows: {
        ...state.floatingWindows,
        [id]: { ...state.floatingWindows[id], x, y },
      },
    })),

  setFloatingWindowSize: (id, width, height) =>
    set((state) => ({
      floatingWindows: {
        ...state.floatingWindows,
        [id]: { ...state.floatingWindows[id], width, height },
      },
    })),

  bringWindowToFront: (id) =>
    set((state) => {
      const order = state.floatingWindowOrder;
      // 既に最前面なら再描画を起こさない
      if (order[order.length - 1] === id) return {};
      return { floatingWindowOrder: [...order.filter((w) => w !== id), id] };
    }),

  getWindowZIndex: (id) => {
    const index = get().floatingWindowOrder.indexOf(id);
    return Z_INDEX_BASE + (index < 0 ? 0 : index);
  },
});
