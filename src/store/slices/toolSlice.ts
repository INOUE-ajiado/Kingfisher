/**
 * ツール選択・ツールオプション・前景/背景色・カラーパレット
 */

import { StateCreator } from 'zustand';
import { PaintStore, ToolSlice, PaletteItem, defaultColors } from '../types';

export const createToolSlice: StateCreator<PaintStore, [], [], ToolSlice> = (set, get) => ({
  activeTool: 'fill',

  setActiveTool: (tool) => set({ activeTool: tool }),

  toolOptions: {
    gapCloseLevel: 3,
    enableIncludeTrace: true,
    retainTraceLine: false,
    traceColors: { red: true, blue: true, green: false },
    tolerance: 0,
    brushSize: 5,
    expandContract: 0,
    contiguous: true,
    sampleSize: '1x1',
    referenceLayer: 'current',
    maxNoiseSize: 5,
    frameHold: 1,
  },

  setGapCloseLevel: (level) =>
    set((state) => ({
      toolOptions: { ...state.toolOptions, gapCloseLevel: level },
    })),

  setEnableIncludeTrace: (enable) =>
    set((state) => ({
      toolOptions: { ...state.toolOptions, enableIncludeTrace: enable },
    })),

  setRetainTraceLine: (retain) =>
    set((state) => ({
      toolOptions: { ...state.toolOptions, retainTraceLine: retain },
    })),

  toggleTraceColor: (color) =>
    set((state) => ({
      toolOptions: {
        ...state.toolOptions,
        traceColors: {
          ...state.toolOptions.traceColors,
          [color]: !state.toolOptions.traceColors[color],
        },
      },
    })),

  setBrushSize: (size) =>
    set((state) => ({
      toolOptions: { ...state.toolOptions, brushSize: size },
    })),

  setExpandContract: (val) =>
    set((state) => ({
      toolOptions: { ...state.toolOptions, expandContract: val },
    })),

  setContiguous: (val) =>
    set((state) => ({
      toolOptions: { ...state.toolOptions, contiguous: val },
    })),

  setSampleSize: (size) =>
    set((state) => ({
      toolOptions: { ...state.toolOptions, sampleSize: size },
    })),

  setReferenceLayer: (ref) =>
    set((state) => ({
      toolOptions: { ...state.toolOptions, referenceLayer: ref },
    })),

  setMaxNoiseSize: (size) =>
    set((state) => ({
      toolOptions: { ...state.toolOptions, maxNoiseSize: size },
    })),

  setFrameHold: (hold) =>
    set((state) => ({
      toolOptions: { ...state.toolOptions, frameHold: hold },
    })),

  currentColor: { r: 255, g: 215, b: 0, a: 255, hex: '#FFD700' },

  backgroundColor: { r: 255, g: 255, b: 255, a: 255, hex: '#FFFFFF' },

  setCurrentColor: (color) => set({ currentColor: color }),

  setBackgroundColor: (color) => set({ backgroundColor: color }),

  swapColors: () =>
    set((state) => ({
      currentColor: state.backgroundColor,
      backgroundColor: state.currentColor,
    })),

  activePaletteTab: 'normal',

  setActivePaletteTab: (tab) => set({ activePaletteTab: tab }),

  palettes: {
    normal: defaultColors,
    shadow: defaultColors.map((c, i) => ({ ...c, id: `s-${i}` })),
    highlight: defaultColors.map((c, i) => ({ ...c, id: `h-${i}` })),
  },

  selectedColorIndex: 0,

  setSelectedColorIndex: (index) =>
    set((state) => {
      const currentList = state.palettes[state.activePaletteTab];
      const color = index !== null && currentList[index] ? currentList[index].color : state.currentColor;
      return { selectedColorIndex: index, currentColor: color };
    }),

  addPaletteColor: (name: string, hex: string) =>
    set((state) => {
      const r = parseInt(hex.slice(1, 3), 16) || 0;
      const g = parseInt(hex.slice(3, 5), 16) || 0;
      const b = parseInt(hex.slice(5, 7), 16) || 0;
      const newItem: PaletteItem = {
        id: Date.now().toString(),
        name,
        color: { r, g, b, a: 255, hex },
      };
      const currentTab = state.activePaletteTab;
      return {
        palettes: {
          ...state.palettes,
          [currentTab]: [...state.palettes[currentTab], newItem],
        },
      };
    }),

  deletePaletteColor: (index: number) =>
    set((state) => {
      const currentTab = state.activePaletteTab;
      const newList = state.palettes[currentTab].filter((_, i) => i !== index);
      return {
        palettes: {
          ...state.palettes,
          [currentTab]: newList,
        },
        selectedColorIndex: null,
      };
    }),

  exportPaletteJSON: () => JSON.stringify(get().palettes, null, 2),

  importPaletteJSON: (jsonStr: string) => {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.normal && parsed.shadow && parsed.highlight) {
        set({ palettes: parsed });
        return true;
      }
    } catch (e) {
      console.error('Invalid palette JSON', e);
    }
    return false;
  },

  importACTPalette: (buffer: ArrayBuffer) => {
    try {
      const view = new DataView(buffer);
      const items: PaletteItem[] = [];
      const count = Math.min(256, Math.floor(buffer.byteLength / 3));

      for (let i = 0; i < count; i++) {
        const r = view.getUint8(i * 3);
        const g = view.getUint8(i * 3 + 1);
        const b = view.getUint8(i * 3 + 2);
        const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;

        items.push({
          id: `act-${i}`,
          name: `Color ${i + 1}`,
          color: { r, g, b, a: 255, hex },
        });
      }

      if (items.length > 0) {
        const currentTab = get().activePaletteTab;
        set((state) => ({
          palettes: {
            ...state.palettes,
            [currentTab]: items,
          },
        }));
        return true;
      }
    } catch (e) {
      console.error('Failed to parse Adobe ACT palette', e);
    }
    return false;
  },
});
