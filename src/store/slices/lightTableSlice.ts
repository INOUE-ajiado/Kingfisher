/**
 * ライトテーブル (オニオンスキン) の設定と重ね合わせ素材
 */

import { StateCreator } from 'zustand';
import { PaintStore, LightTableSlice } from '../types';

export const createLightTableSlice: StateCreator<PaintStore, [], [], LightTableSlice> = (set) => ({
  lightTable: {
    enabled: true,
    pastFrames: 1,
    futureFrames: 1,
    startOpacity: 30,
    opacityStep: 10,
    displayMode: 'monochrome',
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
        pastFrames: Math.max(0, Math.min(5, past)),
        futureFrames: Math.max(0, Math.min(5, future)),
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
            id: Date.now().toString(),
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
