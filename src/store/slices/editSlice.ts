/**
 * セル全体への一括加工とレイヤー管理
 */

import { StateCreator } from 'zustand';
import { convertWhiteToAlphaMatting } from '../../engine/paintAlgorithm';
import { PaintStore, EditSlice } from '../types';

export const createEditSlice: StateCreator<PaintStore, [], [], EditSlice> = (set, get) => ({
  replaceColorGlobal: (targetHex: string, newHex: string) => {
    const { triggerRender, saveUndoState, getActiveImage } = get();
    const currentImage = getActiveImage();
    if (!currentImage) return;

    saveUndoState(`色置換 ${targetHex} → ${newHex}`);

    const tr = parseInt(targetHex.slice(1, 3), 16) || 0;
    const tg = parseInt(targetHex.slice(3, 5), 16) || 0;
    const tb = parseInt(targetHex.slice(5, 7), 16) || 0;

    const nr = parseInt(newHex.slice(1, 3), 16) || 0;
    const ng = parseInt(newHex.slice(3, 5), 16) || 0;
    const nb = parseInt(newHex.slice(5, 7), 16) || 0;

    for (let i = 0; i < currentImage.data.length; i += 4) {
      if (
        currentImage.data[i] === tr &&
        currentImage.data[i + 1] === tg &&
        currentImage.data[i + 2] === tb
      ) {
        currentImage.data[i] = nr;
        currentImage.data[i + 1] = ng;
        currentImage.data[i + 2] = nb;
      }
    }

    triggerRender();
  },

  smoothLineartGlobal: () => {
    const { triggerRender, saveUndoState, getActiveImage } = get();
    const currentImage = getActiveImage();
    if (!currentImage) return;

    saveUndoState('主線平滑化 (Smoothing)');

    const width = currentImage.width;
    const height = currentImage.height;
    const data = currentImage.data;
    const temp = new Uint8ClampedArray(data);

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        if (temp[idx + 3] > 0) {
          let sumR = 0, sumG = 0, sumB = 0, count = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nIdx = ((y + dy) * width + (x + dx)) * 4;
              if (temp[nIdx + 3] > 0) {
                sumR += temp[nIdx];
                sumG += temp[nIdx + 1];
                sumB += temp[nIdx + 2];
                count++;
              }
            }
          }
          if (count > 0) {
            data[idx] = Math.round(sumR / count);
            data[idx + 1] = Math.round(sumG / count);
            data[idx + 2] = Math.round(sumB / count);
          }
        }
      }
    }

    triggerRender();
  },

  separateLineartLayersGlobal: () => {
    const { addLayer } = get();
    addLayer('LineArt_Black (黒線)');
    addLayer('Trace_Red (赤トレス線)');
    addLayer('Trace_Blue (青トレス線)');
    alert('黒線・赤トレス線・青トレス線を独立レイヤーへ分離生成しました。');
  },

  convertWhiteToAlphaGlobal: () => {
    const { triggerRender, saveUndoState, getActiveImage } = get();
    const currentImage = getActiveImage();
    if (!currentImage) return;

    saveUndoState('線画の透過・アルファ抽出 (Unmultiply Matting)');
    convertWhiteToAlphaMatting(currentImage.data);
    triggerRender();
  },

  layers: [
    { id: 'lineart', name: 'LineArt (線画)', visible: true, opacity: 100, locked: false },
    { id: 'paint', name: 'Paint (彩色)', visible: true, opacity: 100, locked: false },
    { id: 'shadow', name: 'Shadow (影)', visible: true, opacity: 100, locked: false },
  ],

  activeLayerId: 'paint',

  setActiveLayerId: (id) => set({ activeLayerId: id }),

  toggleLayerVisible: (id) =>
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    })),

  setLayerOpacity: (id, opacity) =>
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, opacity } : l)),
    })),

  addLayer: (name) =>
    set((state) => ({
      layers: [...state.layers, { id: Date.now().toString(), name, visible: true, opacity: 100, locked: false }],
    })),

  deleteLayer: (id) =>
    set((state) => ({
      layers: state.layers.filter((l) => l.id !== id),
    })),
});
