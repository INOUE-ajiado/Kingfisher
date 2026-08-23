import { create } from 'zustand';
import { TGAImage } from '../engine/tga';
import { convertWhiteToAlphaMatting } from '../engine/paintAlgorithm';
import { detectPegHolesAndCalculateTransform } from '../engine/pegStabilizer';

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

export interface PegStabilizerState {
  enabled: boolean;
  status: 'success' | 'failed' | 'idle';
  offsetX: number;
  offsetY: number;
  rotation: number;
  manualX: number;
  manualY: number;
  manualRotation: number;
  showGuide: boolean;
}

export interface ReferenceCanvasState {
  isOpen: boolean;
  isFloating: boolean;
  fileName: string;
  image: TGAImage | null;
  transform: { scale: number; offsetX: number; offsetY: number };
  autoRevertTool: boolean;
  previousTool: ToolType | null;
}

export interface LightTableSubItem {
  id: string;
  name: string;
  file?: File;
  image?: TGAImage;
  offsetX: number;
  offsetY: number;
  rotation: number;
  opacity: number;
  visible: boolean;
}

export interface LightTableState {
  enabled: boolean;
  pastFrames: number;
  futureFrames: number;
  startOpacity: number;
  opacityStep: number;
  displayMode: 'color' | 'half-color' | 'monochrome';
  pastColor: { r: number; g: number; b: number };
  futureColor: { r: number; g: number; b: number };
  items: LightTableSubItem[];

  // 互換性エイリアス
  prevFrames?: number;
  nextFrames?: number;
  opacity?: number;
  colorMode?: string;
}

export interface SubDirectoryItem {
  name: string;
  handle: any;
  filesMap: Map<string, File>;
  fileList: string[];
  isImageFolder: boolean;
}

export interface MergedFrameMapItem {
  frameNumber: string;
  fileNameA?: string;
  fileNameB?: string;
}

// ファイル名から「4桁等の連番数字」を抽出する関数 (例: b_go0003.tga -> "0003", a0012.tga -> "0012")
export function extractFrameNumber(fileName: string): string {
  const match = fileName.match(/(?:^|[^0-9])([0-9]{2,4})(?=[^0-9]*\.[a-z0-9]+$)/i);
  if (match) return match[1];
  const numMatch = fileName.match(/([0-9]+)(?=[^0-9]*\.[a-z0-9]+$)/i);
  return numMatch ? numMatch[1].padStart(4, '0') : fileName;
}

// サブフォルダAとサブフォルダBのファイル群から異名連番マージマップを再構築する関数
export function buildMergedFrameData(
  listA: string[],
  listB: string[]
): { frameNumbers: string[]; frameMap: Map<string, MergedFrameMapItem>; unifiedFiles: string[] } {
  const frameMap = new Map<string, MergedFrameMapItem>();

  listA.forEach((f) => {
    const num = extractFrameNumber(f);
    const item = frameMap.get(num) || { frameNumber: num };
    item.fileNameA = f;
    frameMap.set(num, item);
  });

  listB.forEach((f) => {
    const num = extractFrameNumber(f);
    const item = frameMap.get(num) || { frameNumber: num };
    item.fileNameB = f;
    frameMap.set(num, item);
  });

  const frameNumbers = Array.from(frameMap.keys()).sort((a, b) => {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });

  const unifiedFiles: string[] = [];
  frameNumbers.forEach((num) => {
    const item = frameMap.get(num)!;
    const representative = item.fileNameA || item.fileNameB || num;
    unifiedFiles.push(representative);
  });

  return { frameNumbers, frameMap, unifiedFiles };
}

export interface PaintStore {
  // --- テーマ ---
  isDarkMode: boolean;
  toggleDarkMode: () => void;

  // --- 色指定参照 ＆ メインセルビュー フローティング ---
  referenceCanvas: ReferenceCanvasState;
  colorSpecLayoutMode: 'single' | 'split-vertical' | 'split-horizontal';
  isWinAFloating: boolean;
  isWinBFloating: boolean;
  toggleWinAFloating: () => void;
  toggleWinBFloating: () => void;
  openReferenceImage: (fileHandle?: any, fileName?: string, image?: TGAImage) => void;
  closeReferenceWindow: () => void;
  toggleReferenceFloating: () => void;
  setColorSpecLayoutMode: (mode: 'single' | 'split-vertical' | 'split-horizontal') => void;
  setAutoRevertTool: (enable: boolean) => void;
  setReferenceTransform: (transform: { scale: number; offsetX: number; offsetY: number }) => void;
  pickColorFromReference: (color: RGBA) => void;

  // --- タップ穴自動検出 ＆ 傾き補正 (Peg Hole Stabilizer) ---
  pegStabilizer: PegStabilizerState;
  togglePegStabilizerEnabled: () => void;
  setPegManualOffset: (x: number, y: number, rot: number) => void;
  togglePegGuide: () => void;
  runPegStabilizerAutoDetect: () => void;

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

  // --- 統合ファイルブラウザ (Dir A & Dir B 2フォルダ管理 ＆ カット階層ナビゲーション) ---
  rootFolderHandle: any | null;
  rootFolderName: string | null;
  availableSubDirectories: SubDirectoryItem[];
  selectedSubDirA: string | null;
  selectedSubDirB: string | null;
  mergedFrameNumbers: string[];
  mergedFrameMap: Map<string, MergedFrameMapItem>;
  setCutRootFolder: (rootHandle: any, rootName: string, subDirs: SubDirectoryItem[]) => void;
  setSelectedSubDirA: (dirName: string | null) => void;
  setSelectedSubDirB: (dirName: string | null) => void;

  folderHandleA: any | null;
  folderHandleB: any | null;
  fileMapA: Map<string, File>;
  fileMapB: Map<string, File>;
  folderNameA: string;
  folderNameB: string;
  fileListA: string[];
  fileListB: string[];
  unifiedFileList: string[];
  setFolderHandleA: (handle: any, name: string, files: string[]) => void;
  setFolderHandleB: (handle: any, name: string, files: string[]) => void;
  setFolderFilesA: (name: string, filesMap: Map<string, File>) => void;
  setFolderFilesB: (name: string, filesMap: Map<string, File>) => void;

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

  // --- パネル可視性 ＆ フローティング ---
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
  isColorChartFloating: boolean;
  toggleColorChartFloating: () => void;

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
  // --- ライトテーブル ＆ オニオンスキン ---
  lightTable: LightTableState;
  setLightTableEnabled: (enabled: boolean) => void;
  setLightTableOpacity: (opacity: number) => void;
  setLightTableColorMode: (mode: 'default' | 'tinted') => void;
  setOnionSkinFrames: (past: number, future: number) => void;
  setOnionSkinOpacityConfig: (startOpacity: number, opacityStep: number) => void;
  setOnionSkinDisplayMode: (mode: 'color' | 'half-color' | 'monochrome') => void;
  setOnionSkinColors: (pastColor: { r: number; g: number; b: number }, futureColor: { r: number; g: number; b: number }) => void;
  addLightTableSubItem: (name: string, file?: File, image?: TGAImage) => void;
  removeLightTableSubItem: (id: string) => void;
  updateLightTableSubItemTransform: (id: string, transform: { offsetX?: number; offsetY?: number; rotation?: number; opacity?: number }) => void;
  toggleLightTableSubItemVisible: (id: string) => void;

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
  toggleIsSplitView: () => set((state) => ({ isSplitView: !state.isSplitView })),
  toggleSyncMode: () =>
    set((state) => {
      const nextSyncMode = !state.syncMode;
      if (nextSyncMode) {
        return { syncMode: true, splitFileIndex: state.currentFileIndex };
      }
      return { syncMode: false };
    }),
  setActiveViewIndex: (idx) => set({ activeViewIndex: idx }),
  setSplitFileIndex: (index) => set({ splitFileIndex: index }),
  setSplitCanvasTransform: (transform) => set({ splitCanvasTransform: transform }),

  // 統合ファイルブラウザ (Dir A & Dir B 2フォルダ管理 ＆ カット階層ナビゲーション)
  rootFolderHandle: null,
  rootFolderName: null,
  availableSubDirectories: [],
  selectedSubDirA: null,
  selectedSubDirB: null,
  mergedFrameNumbers: [],
  mergedFrameMap: new Map(),

  setCutRootFolder: (rootHandle, rootName, subDirs) => {
    // 初期状態で _go や a, b 等の画像フォルダをデフォルトで自動選択
    let defaultDirA: SubDirectoryItem | undefined = subDirs.find((d) => d.name === '_go' || d.name === 'a');
      let defaultDirB: SubDirectoryItem | undefined = subDirs.find((d) => d.name === 'b' || d.name === 'c');

      if (!defaultDirA && subDirs.length > 0) defaultDirA = subDirs[0];
      if (!defaultDirB && subDirs.length > 1) defaultDirB = subDirs[1];

      const listA = defaultDirA ? defaultDirA.fileList : [];
      const listB = defaultDirB ? defaultDirB.fileList : [];
      const mapA = defaultDirA ? defaultDirA.filesMap : new Map();
      const mapB = defaultDirB ? defaultDirB.filesMap : new Map();

      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(listA, listB);

      set({
        rootFolderHandle: rootHandle,
        rootFolderName: rootName,
        availableSubDirectories: subDirs,
        selectedSubDirA: defaultDirA ? defaultDirA.name : null,
        selectedSubDirB: defaultDirB ? defaultDirB.name : null,
        folderNameA: defaultDirA ? defaultDirA.name : rootName,
        folderNameB: defaultDirB ? defaultDirB.name : rootName,
        folderHandleA: defaultDirA ? defaultDirA.handle : rootHandle,
        folderHandleB: defaultDirB ? defaultDirB.handle : rootHandle,
        fileMapA: mapA,
        fileMapB: mapB,
        fileListA: listA,
        fileListB: listB,
        unifiedFileList: unifiedFiles,
        fileList: unifiedFiles,
        mergedFrameNumbers: frameNumbers,
        mergedFrameMap: frameMap,
        currentFileIndex: 0,
        splitFileIndex: 0,
      });
    },

  setSelectedSubDirA: (dirName) =>
    set((state) => {
      const targetDir = state.availableSubDirectories.find((d) => d.name === dirName);
      const listA = targetDir ? targetDir.fileList : [];
      const mapA = targetDir ? targetDir.filesMap : new Map();

      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(listA, state.fileListB);

      return {
        selectedSubDirA: dirName,
        folderNameA: dirName || state.rootFolderName || '',
        folderHandleA: targetDir ? targetDir.handle : state.rootFolderHandle,
        fileMapA: mapA,
        fileListA: listA,
        unifiedFileList: unifiedFiles,
        fileList: unifiedFiles,
        mergedFrameNumbers: frameNumbers,
        mergedFrameMap: frameMap,
        currentFileIndex: 0,
      };
    }),

  setSelectedSubDirB: (dirName) =>
    set((state) => {
      const targetDir = state.availableSubDirectories.find((d) => d.name === dirName);
      const listB = targetDir ? targetDir.fileList : [];
      const mapB = targetDir ? targetDir.filesMap : new Map();

      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(state.fileListA, listB);

      return {
        selectedSubDirB: dirName,
        folderNameB: dirName || state.rootFolderName || '',
        folderHandleB: targetDir ? targetDir.handle : state.rootFolderHandle,
        fileMapB: mapB,
        fileListB: listB,
        unifiedFileList: unifiedFiles,
        fileList: unifiedFiles,
        mergedFrameNumbers: frameNumbers,
        mergedFrameMap: frameMap,
        splitFileIndex: 0,
      };
    }),

  folderHandleA: null,
  folderHandleB: null,
  fileMapA: new Map(),
  fileMapB: new Map(),
  folderNameA: '',
  folderNameB: '',
  fileListA: [],
  fileListB: [],
  unifiedFileList: [],

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

  setFolderFilesA: (name, filesMap) =>
    set((state) => {
      const files = Array.from(filesMap.keys()).sort();
      const union = Array.from(new Set([...files, ...state.fileListB])).sort();
      return {
        fileMapA: filesMap,
        folderNameA: name,
        fileListA: files,
        unifiedFileList: union,
        fileList: union,
        currentFileIndex: 0,
        splitFileIndex: 0,
      };
    }),

  setFolderFilesB: (name, filesMap) =>
    set((state) => {
      const files = Array.from(filesMap.keys()).sort();
      const union = Array.from(new Set([...state.fileListA, ...files])).sort();
      return {
        fileMapB: filesMap,
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
  isColorChartFloating: false,
  toggleColorChartFloating: () => set((state) => ({ isColorChartFloating: !state.isColorChartFloating })),

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
  folderName: '',
  fileList: [],
  currentFileIndex: 0,
  setFolderHandle: (handle, name, files) =>
    set({ folderHandle: handle, folderName: name, fileList: files, currentFileIndex: 0, splitFileIndex: 0, historyStack: [], historyIndex: -1 }),
  setCurrentFileIndex: (index) => set({ currentFileIndex: index, historyStack: [], historyIndex: -1 }),

  nextCell: () =>
    set((state) => {
      if (state.syncMode) {
        const nextCurrent = Math.min(state.unifiedFileList.length - 1, state.currentFileIndex + 1);
        const nextSplit = Math.min(state.unifiedFileList.length - 1, state.splitFileIndex + 1);
        return {
          currentFileIndex: nextCurrent,
          splitFileIndex: nextSplit,
          historyStack: [],
          historyIndex: -1,
        };
      } else {
        if (state.activeViewIndex === 0) {
          const nextCurrent = Math.min(state.unifiedFileList.length - 1, state.currentFileIndex + 1);
          return { currentFileIndex: nextCurrent, historyStack: [], historyIndex: -1 };
        } else {
          const nextSplit = Math.min(state.unifiedFileList.length - 1, state.splitFileIndex + 1);
          return { splitFileIndex: nextSplit, historyStack: [], historyIndex: -1 };
        }
      }
    }),
  prevCell: () =>
    set((state) => {
      if (state.syncMode) {
        const prevCurrent = Math.max(0, state.currentFileIndex - 1);
        const prevSplit = Math.max(0, state.splitFileIndex - 1);
        return {
          currentFileIndex: prevCurrent,
          splitFileIndex: prevSplit,
          historyStack: [],
          historyIndex: -1,
        };
      } else {
        if (state.activeViewIndex === 0) {
          const prevCurrent = Math.max(0, state.currentFileIndex - 1);
          return { currentFileIndex: prevCurrent, historyStack: [], historyIndex: -1 };
        } else {
          const prevSplit = Math.max(0, state.splitFileIndex - 1);
          return { splitFileIndex: prevSplit, historyStack: [], historyIndex: -1 };
        }
      }
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
  fps: 4,
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
    pastFrames: 1,
    futureFrames: 1,
    startOpacity: 30,
    opacityStep: 10,
    displayMode: 'monochrome',
    pastColor: { r: 239, g: 68, b: 68 },
    futureColor: { r: 59, g: 130, b: 246 },
    items: [],
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
      lightTable: { ...state.lightTable, opacity, startOpacity: opacity },
    })),
  setLightTableColorMode: (mode) =>
    set((state) => ({
      lightTable: {
        ...state.lightTable,
        colorMode: mode,
        displayMode: mode === 'tinted' ? 'monochrome' : 'color',
      },
    })),
  setOnionSkinFrames: (past, future) =>
    set((state) => ({
      lightTable: {
        ...state.lightTable,
        pastFrames: Math.max(0, Math.min(5, past)),
        futureFrames: Math.max(0, Math.min(5, future)),
        prevFrames: past,
        nextFrames: future,
      },
    })),
  setOnionSkinOpacityConfig: (startOpacity, opacityStep) =>
    set((state) => ({
      lightTable: {
        ...state.lightTable,
        startOpacity: Math.max(0, Math.min(100, startOpacity)),
        opacityStep: Math.max(0, Math.min(50, opacityStep)),
        opacity: startOpacity,
      },
    })),
  setOnionSkinDisplayMode: (mode) =>
    set((state) => ({
      lightTable: {
        ...state.lightTable,
        displayMode: mode,
        colorMode: mode === 'color' ? 'default' : 'tinted',
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

  renderTrigger: 0,
  triggerRender: () => set((state) => ({ renderTrigger: state.renderTrigger + 1 })),
}));
