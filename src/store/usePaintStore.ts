import { create } from 'zustand';
import { TGAImage } from '../engine/tga';
import { convertWhiteToAlphaMatting } from '../engine/paintAlgorithm';

export type ToolType = 
  | 'pointer' 
  | 'fill' 
  | 'gradient'
  | 'closedFill' 
  | 'brush' 
  | 'pencil'
  | 'eraser' 
  | 'noiseEraser'
  | 'eyedropper' 
  | 'lasso' 
  | 'pan' 
  | 'zoom';

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
  hex: string;
}

export interface PaletteItem {
  id: string;
  name: string;
  color: RGBA;
}

export interface LayerItem {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
}

export interface HistoryItem {
  label: string;
  data: Uint8ClampedArray;
}

export interface PaintStore {
  // --- テーマ ---
  isDarkMode: boolean;
  toggleDarkMode: () => void;

  // --- 2画面分割 (Split View) & 連動 (Sync Mode) ---
  isSplitView: boolean;
  syncMode: boolean;
  activeViewIndex: 0 | 1;
  splitFileIndex: number;
  splitCanvasTransform: { scale: number; offsetX: number; offsetY: number };
  toggleIsSplitView: () => void;
  toggleSyncMode: () => void;
  setActiveViewIndex: (idx: 0 | 1) => void;
  setSplitFileIndex: (index: number) => void;
  setSplitCanvasTransform: (transform: { scale: number; offsetX: number; offsetY: number }) => void;

  // --- 統合ファイルブラウザ (Dir A & Dir B 2フォルダ管理) ---
  folderHandleA: any | null;
  folderHandleB: any | null;
  folderNameA: string;
  folderNameB: string;
  fileListA: string[];
  fileListB: string[];
  unifiedFileList: string[];
  setFolderHandleA: (handle: any, name: string, files: string[]) => void;
  setFolderHandleB: (handle: any, name: string, files: string[]) => void;

  // --- ツール関連 ---
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;

  toolOptions: {
    gapCloseLevel: number;        // 0 to 20 px
    enableIncludeTrace: boolean;
    retainTraceLine: boolean;     // トレス線を塗らずに残す
    traceColors: { red: boolean; blue: boolean; green: boolean };
    tolerance: number;            // 0 to 255
    brushSize: number;            // 1 to 500 px
    expandContract: number;       // -10 to 10 px
    contiguous: boolean;          // 隣接ピクセルのみ
    sampleSize: '1x1' | '3x3' | '5x5';
    referenceLayer: 'current' | 'all' | 'reference';
    maxNoiseSize: number;         // 手動ゴミ取り最大サイズ
    frameHold: 1 | 2 | 3;         // 1コマ打ち, 2コマ打ち, 3コマ打ち
  };
  setGapCloseLevel: (level: number) => void;
  setEnableIncludeTrace: (enable: boolean) => void;
  setRetainTraceLine: (retain: boolean) => void;
  toggleTraceColor: (color: 'red' | 'blue' | 'green') => void;
  setBrushSize: (size: number) => void;
  setExpandContract: (val: number) => void;
  setContiguous: (val: boolean) => void;
  setSampleSize: (size: '1x1' | '3x3' | '5x5') => void;
  setReferenceLayer: (ref: 'current' | 'all' | 'reference') => void;
  setMaxNoiseSize: (size: number) => void;
  setFrameHold: (hold: 1 | 2 | 3) => void;

  // --- 前景色 & 背景色 ---
  currentColor: RGBA;
  backgroundColor: RGBA;
  setCurrentColor: (color: RGBA) => void;
  setBackgroundColor: (color: RGBA) => void;
  swapColors: () => void;

  // --- パネル可視性 ---
  panelVisibility: {
    toolPalette: boolean;
    toolOptions: boolean;
    colorChart: boolean;
    lightTable: boolean;
    fileBrowser: boolean;
    layerPanel: boolean;
    historyPanel: boolean;
  };
  togglePanelVisibility: (panel: 'toolPalette' | 'toolOptions' | 'colorChart' | 'lightTable' | 'fileBrowser' | 'layerPanel' | 'historyPanel') => void;

  // --- 未塗り漏れ点滅表示 ---
  showUnpaintedFlash: boolean;
  toggleShowUnpaintedFlash: () => void;

  // --- モーダル ---
  activeModal: 'about' | 'preferences' | 'shortcuts' | 'replaceColor' | null;
  setActiveModal: (modal: 'about' | 'preferences' | 'shortcuts' | 'replaceColor' | null) => void;

  // --- カラー・パレット編集 ---
  activePaletteTab: 'normal' | 'shadow' | 'highlight';
  setActivePaletteTab: (tab: 'normal' | 'shadow' | 'highlight') => void;
  palettes: {
    normal: PaletteItem[];
    shadow: PaletteItem[];
    highlight: PaletteItem[];
  };
  selectedColorIndex: number | null;
  setSelectedColorIndex: (index: number | null) => void;
  addPaletteColor: (name: string, hex: string) => void;
  deletePaletteColor: (index: number) => void;
  exportPaletteJSON: () => string;
  importPaletteJSON: (jsonStr: string) => boolean;
  importACTPalette: (buffer: ArrayBuffer) => boolean;

  // --- 機能処理 ---
  replaceColorGlobal: (targetHex: string, newHex: string) => void;
  smoothLineartGlobal: () => void;
  separateLineartLayersGlobal: () => void;
  convertWhiteToAlphaGlobal: () => void;

  // --- マルチレイヤー ---
  layers: LayerItem[];
  activeLayerId: string;
  setActiveLayerId: (id: string) => void;
  toggleLayerVisible: (id: string) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  addLayer: (name: string) => void;
  deleteLayer: (id: string) => void;

  // --- ファイル・ナビゲーション ---
  folderHandle: any | null;
  folderName: string | null;
  fileList: string[];
  currentFileIndex: number;
  setFolderHandle: (handle: any, name: string, files: string[]) => void;
  setCurrentFileIndex: (index: number) => void;
  nextCell: () => void;
  prevCell: () => void;

  // --- 画像データバッファ & プリフェッチキャッシュ ---
  currentImage: TGAImage | null;
  prevImage: TGAImage | null;
  nextImage: TGAImage | null;
  cacheImages: Map<string, TGAImage>;
  setCurrentImage: (image: TGAImage | null) => void;
  setPrevNextImages: (prev: TGAImage | null, next: TGAImage | null) => void;

  // --- 操作履歴 ---
  historyStack: HistoryItem[];
  historyIndex: number;
  saveUndoState: (actionName?: string) => void;
  jumpToHistory: (index: number) => void;
  undo: () => void;
  redo: () => void;

  // --- アニメーション再生 ---
  isPlaying: boolean;
  fps: number;
  setIsPlaying: (playing: boolean) => void;
  setFps: (fps: number) => void;

  // --- ズーム, グリッド, ルーラー ---
  showGrid: boolean;
  showRuler: boolean;
  toggleShowGrid: () => void;
  toggleShowRuler: () => void;
  canvasTransform: { scale: number; offsetX: number; offsetY: number };
  setCanvasTransform: (transform: { scale: number; offsetX: number; offsetY: number }) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetCanvasTransform: () => void;

  // --- ライトテーブル ---
  lightTable: {
    enabled: boolean;
    prevFrames: number;
    nextFrames: number;
    opacity: number;
    colorMode: 'default' | 'tinted';
  };
  setLightTableEnabled: (enabled: boolean) => void;
  setLightTableOpacity: (opacity: number) => void;
  setLightTableColorMode: (mode: 'default' | 'tinted') => void;

  renderTrigger: number;
  triggerRender: () => void;
}

const defaultColors: PaletteItem[] = [
  { id: '1', name: 'Hair', color: { r: 255, g: 215, b: 0, a: 255, hex: '#FFD700' } },
  { id: '2', name: 'Hair Shadow', color: { r: 255, g: 165, b: 0, a: 255, hex: '#FFA500' } },
  { id: '3', name: 'Skin', color: { r: 255, g: 228, b: 181, a: 255, hex: '#FFE4B5' } },
  { id: '4', name: 'Skin Shadow', color: { r: 205, g: 133, b: 63, a: 255, hex: '#CD853F' } },
  { id: '5', name: 'White', color: { r: 255, g: 255, b: 255, a: 255, hex: '#FFFFFF' } },
  { id: '6', name: 'Inner White', color: { r: 245, g: 245, b: 245, a: 255, hex: '#F5F5F5' } },
  { id: '7', name: 'Jacket', color: { r: 65, g: 105, b: 225, a: 255, hex: '#4169E1' } },
  { id: '8', name: 'Jacket Shadow', color: { r: 0, g: 0, b: 128, a: 255, hex: '#000080' } },
  { id: '9', name: 'Green Accent', color: { r: 50, g: 205, b: 50, a: 255, hex: '#32CD32' } },
  { id: '10', name: 'Dark Green', color: { r: 34, g: 139, b: 34, a: 255, hex: '#228B22' } },
  { id: '11', name: 'Lineart Black', color: { r: 0, g: 0, b: 0, a: 255, hex: '#000000' } },
  { id: '12', name: 'Gray Line', color: { r: 128, g: 128, b: 128, a: 255, hex: '#808080' } },
];

export const usePaintStore = create<PaintStore>((set, get) => ({
  isDarkMode: true,
  toggleDarkMode: () => set((state) => ({ isDarkMode: !state.isDarkMode })),

  // 2画面分割 (Split View) & 連動 (Sync Mode)
  isSplitView: false,
  syncMode: true,
  activeViewIndex: 0,
  splitFileIndex: 0,
  splitCanvasTransform: { scale: 1, offsetX: 0, offsetY: 0 },
  toggleIsSplitView: () => set((state) => ({ isSplitView: !state.isSplitView })),
  toggleSyncMode: () => set((state) => ({ syncMode: !state.syncMode })),
  setActiveViewIndex: (idx) => set({ activeViewIndex: idx }),
  setSplitFileIndex: (index) => set({ splitFileIndex: index }),
  setSplitCanvasTransform: (transform) => set({ splitCanvasTransform: transform }),

  // 統合ファイルブラウザ (Dir A & Dir B 2フォルダ管理)
  folderHandleA: null,
  folderHandleB: null,
  folderNameA: 'Cut001_Original',
  folderNameB: 'Cut001_Retake',
  fileListA: ['0001.tga', '0002.tga', '0003.tga', '0004.tga', '0005.tga', '0006.tga'],
  fileListB: ['0001.tga', '0003.tga', '0004.tga', '0005.tga', '0006.tga'],
  unifiedFileList: ['0001.tga', '0002.tga', '0003.tga', '0004.tga', '0005.tga', '0006.tga'],

  setFolderHandleA: (handle, name, files) =>
    set((state) => {
      const union = Array.from(new Set([...files, ...state.fileListB])).sort();
      return {
        folderHandleA: handle,
        folderNameA: name,
        fileListA: files,
        unifiedFileList: union,
        fileList: union,
        currentFileIndex: 0,
        splitFileIndex: 0,
      };
    }),

  setFolderHandleB: (handle, name, files) =>
    set((state) => {
      const union = Array.from(new Set([...state.fileListA, ...files])).sort();
      return {
        folderHandleB: handle,
        folderNameB: name,
        fileListB: files,
        unifiedFileList: union,
        fileList: union,
        currentFileIndex: 0,
        splitFileIndex: 0,
      };
    }),

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

  showUnpaintedFlash: false,
  toggleShowUnpaintedFlash: () => set((state) => ({ showUnpaintedFlash: !state.showUnpaintedFlash })),

  activeModal: null,
  setActiveModal: (modal) => set({ activeModal: modal }),

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

  replaceColorGlobal: (targetHex: string, newHex: string) => {
    const { currentImage, triggerRender, saveUndoState } = get();
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
    const { currentImage, triggerRender, saveUndoState } = get();
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
    const { currentImage, triggerRender, saveUndoState } = get();
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

  folderHandle: null,
  folderName: 'Demo_Folder',
  fileList: ['0001.tga', '0002.tga', '0003.tga', '0004.tga', '0005.tga', '0006.tga'],
  currentFileIndex: 1,
  setFolderHandle: (handle, name, files) =>
    set({ folderHandle: handle, folderName: name, fileList: files, currentFileIndex: 0, splitFileIndex: 0, historyStack: [], historyIndex: -1 }),
  setCurrentFileIndex: (index) => set({ currentFileIndex: index, historyStack: [], historyIndex: -1 }),

  nextCell: () =>
    set((state) => {
      const nextCurrent = Math.min(state.unifiedFileList.length - 1, state.currentFileIndex + 1);
      const nextSplit = state.syncMode
        ? Math.min(state.unifiedFileList.length - 1, state.splitFileIndex + 1)
        : state.splitFileIndex;
      return {
        currentFileIndex: nextCurrent,
        splitFileIndex: nextSplit,
        historyStack: [],
        historyIndex: -1,
      };
    }),
  prevCell: () =>
    set((state) => {
      const prevCurrent = Math.max(0, state.currentFileIndex - 1);
      const prevSplit = state.syncMode
        ? Math.max(0, state.splitFileIndex - 1)
        : state.splitFileIndex;
      return {
        currentFileIndex: prevCurrent,
        splitFileIndex: prevSplit,
        historyStack: [],
        historyIndex: -1,
      };
    }),

  currentImage: null,
  prevImage: null,
  nextImage: null,
  cacheImages: new Map(),
  setCurrentImage: (image) => set({ currentImage: image }),
  setPrevNextImages: (prev, next) => set({ prevImage: prev, nextImage: next }),

  historyStack: [],
  historyIndex: -1,
  saveUndoState: (actionName = 'ペイント操作') => {
    const { currentImage, historyStack, historyIndex } = get();
    if (!currentImage) return;

    const snapshot = new Uint8ClampedArray(currentImage.data);
    const newStack = [
      ...historyStack.slice(0, historyIndex + 1),
      { label: actionName, data: snapshot }
    ].slice(-30);

    set({ historyStack: newStack, historyIndex: newStack.length - 1 });
  },

  jumpToHistory: (index: number) => {
    const { currentImage, historyStack, triggerRender } = get();
    if (!currentImage || index < 0 || index >= historyStack.length) return;

    const targetSnapshot = historyStack[index].data;
    currentImage.data.set(targetSnapshot);
    set({ historyIndex: index });
    triggerRender();
  },

  undo: () => {
    const { historyIndex, jumpToHistory } = get();
    if (historyIndex > 0) {
      jumpToHistory(historyIndex - 1);
    }
  },

  redo: () => {
    const { historyIndex, historyStack, jumpToHistory } = get();
    if (historyIndex < historyStack.length - 1) {
      jumpToHistory(historyIndex + 1);
    }
  },

  isPlaying: false,
  fps: 12,
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setFps: (fps) => set({ fps }),

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

  lightTable: {
    enabled: true,
    prevFrames: 1,
    nextFrames: 1,
    opacity: 30,
    colorMode: 'tinted',
  },
  setLightTableEnabled: (enabled) =>
    set((state) => ({
      lightTable: { ...state.lightTable, enabled },
    })),
  setLightTableOpacity: (opacity) =>
    set((state) => ({
      lightTable: { ...state.lightTable, opacity },
    })),
  setLightTableColorMode: (mode) =>
    set((state) => ({
      lightTable: { ...state.lightTable, colorMode: mode },
    })),

  renderTrigger: 0,
  triggerRender: () => set((state) => ({ renderTrigger: state.renderTrigger + 1 })),
}));
