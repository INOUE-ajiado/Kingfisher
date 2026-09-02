/**
 * ライトテーブル (オニオンスキン) の設定と重ね合わせ素材
 */

import { StateCreator } from 'zustand';
import { PaintStore, LightTableSlice } from '../types';
import { nextId } from '../../engine/uniqueId';

/** 前後それぞれに指定できるオニオンスキンの最大枚数 */
export const ONION_MAX_FRAMES = 30;

export const createLightTableSlice: StateCreator<PaintStore, [], [], LightTableSlice> = (set) => ({
  lightTable: {
    // 既定は OFF。必要な時にツールオプションから ON にして使う
    enabled: false,
    pastFrames: 1,
    futureFrames: 1,
    startOpacity: 30,
    opacityStep: 10,
    displayMode: 'monochrome',
    showAllFrames: false,
    pastColor: { r: 239, g: 68, b: 68 },
    futureColor: { r: 59, g: 130, b: 246 },
    items: [],
  },

  setLightTableEnabled: (enabled) =>
    set((state) => ({
      lightTable: { ...state.lightTable, enabled },
    })),

  setLightTableOpacity: (opacity) =>
    set((state) => ({
      lightTable: { ...state.lightTable, startOpacity: opacity },
    })),

  setOnionSkinFrames: (past, future) =>
    set((state) => ({
      lightTable: {
        ...state.lightTable,
        // カット全体を薄く重ねたい用途があるので上限を広く取る
        pastFrames: Math.max(0, Math.min(ONION_MAX_FRAMES, past)),
        futureFrames: Math.max(0, Math.min(ONION_MAX_FRAMES, future)),
      },
    })),

  setOnionSkinOpacityConfig: (startOpacity, opacityStep) =>
    set((state) => ({
      lightTable: {
        ...state.lightTable,
        startOpacity: Math.max(0, Math.min(100, startOpacity)),
        opacityStep: Math.max(0, Math.min(50, opacityStep)),
      },
    })),

  setOnionSkinDisplayMode: (mode) =>
    set((state) => ({
      lightTable: {
        ...state.lightTable,
        displayMode: mode,
      },
    })),

  setOnionSkinShowAllFrames: (showAll) =>
    set((state) => ({
      lightTable: { ...state.lightTable, showAllFrames: showAll },
    })),

  setOnionSkinColors: (pastColor, futureColor) =>
    set((state) => ({
      lightTable: { ...state.lightTable, pastColor, futureColor },
    })),

  addLightTableSubItem: (name, file, image) =>
    set((state) => ({
      lightTable: {
        ...state.lightTable,
        items: [
          ...state.lightTable.items,
          {
            id: nextId('light'),
            name,
            file,
            image,
            offsetX: 0,
            offsetY: 0,
            rotation: 0,
            opacity: 40,
            visible: true,
          },
        ],
      },
    })),

  removeLightTableSubItem: (id) =>
    set((state) => ({
      lightTable: {
        ...state.lightTable,
        items: state.lightTable.items.filter((item) => item.id !== id),
      },
    })),

  updateLightTableSubItemTransform: (id, transform) =>
    set((state) => ({
      lightTable: {
        ...state.lightTable,
        items: state.lightTable.items.map((item) =>
          item.id === id ? { ...item, ...transform } : item
        ),
      },
    })),

  toggleLightTableSubItemVisible: (id) =>
    set((state) => ({
      lightTable: {
        ...state.lightTable,
        items: state.lightTable.items.map((item) =>
          item.id === id ? { ...item, visible: !item.visible } : item
        ),
      },
    })),
});
