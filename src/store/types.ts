/**
 * Kingfisher グローバルストアの型定義。
 *
 * ストア本体は責務ごとにスライス (store/slices/*) へ分割してあり、
 * ここでは各スライスが持つ状態の形だけを宣言する。
 * PaintStore は全スライスを合成した最終形で、コンポーネントはこれだけを見ればよい。
 */

import { TGAImage } from '../engine/tga';
import { RenamePlanItem } from '../engine/renamePlan';
import { compareNatural } from '../engine/naturalOrder';
import { CodecInfo as VideoCodecInfo } from '../engine/videoSource';
import { PaneLayout, PaneId } from '../engine/paneLayout';

export type { PaneLayout, PaneId };

export type { VideoCodecInfo };

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
  /** カット内の全セルを対象にする (前後の枚数指定を無視する) */
  showAllFrames: boolean;
  pastColor: { r: number; g: number; b: number };
  futureColor: { r: number; g: number; b: number };
  items: LightTableSubItem[];
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

/** 相対パスのディレクトリ部分 ("_go/a0001.tga" -> "_go/") */
function directoryOf(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf(String.fromCharCode(92)));
  return idx < 0 ? '' : path.slice(0, idx + 1);
}

/** キーが 0-9 だけで構成されているか (連番として数値順に並べてよいか) */
function isNumericKey(key: string): boolean {
  return /^[0-9]+$/.test(key);
}

/**
 * A 側 / B 側のファイル群からフレーム対応表を組み立てる。
 *
 * ⚠️ 1 ファイルにつき必ず 1 エントリを作ること。
 * 以前はフレーム番号だけをキーにしていたため、サブフォルダをまたいで
 * 同じ番号があると (例: _go/a0001.tga と b/b0001.tga) 後勝ちで上書きされ、
 * ファイルが一覧から消え、ツリーの選択が別フォルダの項目へ飛んでいた。
 * 番号が埋まっている場合はディレクトリを付けて別キーにする。
 */
export function buildMergedFrameData(
  listA: string[],
  listB: string[]
): { frameNumbers: string[]; frameMap: Map<string, MergedFrameMapItem>; unifiedFiles: string[] } {
  const frameMap = new Map<string, MergedFrameMapItem>();

  const assign = (path: string, side: 'A' | 'B') => {
    const num = extractFrameNumber(path);

    // その番号がこちら側でまだ空いていればそのまま使う (A と B の対応づけ)
    const taken = (key: string) => {
      const item = frameMap.get(key);
      if (!item) return false;
      return side === 'A' ? !!item.fileNameA : !!item.fileNameB;
    };

    let key = num;
    if (taken(key)) {
      const dir = directoryOf(path);
      key = `${dir}${num}`;
      let n = 2;
      while (taken(key)) {
        key = `${dir}${num}#${n}`;
        n += 1;
      }
    }

    const item = frameMap.get(key) || { frameNumber: key };
    if (side === 'A') item.fileNameA = path;
    else item.fileNameB = path;
    frameMap.set(key, item);
  };

  listA.forEach((f) => assign(f, 'A'));
  listB.forEach((f) => assign(f, 'B'));

  // ⚠️ 比較関数は全順序になっていること。
  // 数値キーと非数値キーが混ざったときに片方だけ localeCompare へ落ちると
  // 推移律が崩れ、並び順が入力順しだいで変わってしまう。
  const frameNumbers = Array.from(frameMap.keys()).sort((a, b) => {
    const aNum = isNumericKey(a);
    const bNum = isNumericKey(b);
    if (aNum && bNum) return parseInt(a, 10) - parseInt(b, 10);
    if (aNum) return -1;
    if (bNum) return 1;
    return compareNatural(a, b);
  });

  const unifiedFiles: string[] = [];
  frameNumbers.forEach((num) => {
    const item = frameMap.get(num)!;
    const representative = item.fileNameA || item.fileNameB || num;
    unifiedFiles.push(representative);
  });

  return { frameNumbers, frameMap, unifiedFiles };
}


/** テーマ・パネル配置・モーダル・ズーム/ルーラーなど、画面まわりの状態 */
export interface UiSlice {
  // --- テーマ ＆ キャンバス背景マット ＆ 右サイドパネル開閉 ---
  isDarkMode: boolean
  toggleDarkMode: () => void
  isRightSidebarOpen: boolean
  toggleRightSidebarOpen: () => void
  canvasBgMatteMode: 'checkerboard' | 'black' | 'white' | 'magenta' | 'custom'
  canvasCustomBgColor: string
  setCanvasBgMatteMode: (mode: 'checkerboard' | 'black' | 'white' | 'magenta' | 'custom') => void
  setCanvasCustomBgColor: (color: string) => void
  // --- ドラッグ中スポイトカラー (ColorChartへのドロップ色登録用) ---
  activeDragColor: RGBA | null
  setActiveDragColor: (color: RGBA | null) => void
  // --- パネル可視性 ＆ フローティング ---
  panelVisibility: {
    toolPalette: boolean;
    toolOptions: boolean;
    colorChart: boolean;
    lightTable: boolean;
    fileBrowser: boolean;
    layerPanel: boolean;
    historyPanel: boolean;
  }
  togglePanelVisibility: (panel: 'toolPalette' | 'toolOptions' | 'colorChart' | 'lightTable' | 'fileBrowser' | 'layerPanel' | 'historyPanel') => void
  isColorChartFloating: boolean
  toggleColorChartFloating: () => void
  // --- 未塗り漏れ点滅表示 ---
  showUnpaintedFlash: boolean
  toggleShowUnpaintedFlash: () => void
  // --- モーダル ---
  activeModal: 'about' | 'preferences' | 'shortcuts' | 'replaceColor' | 'exportVector' | 'exportTrace' | null
  setActiveModal: (modal: 'about' | 'preferences' | 'shortcuts' | 'replaceColor' | 'exportVector' | 'exportTrace' | null) => void
  // --- ズーム, グリッド, ルーラー ---
  showGrid: boolean
  showRuler: boolean
  toggleShowGrid: () => void
  toggleShowRuler: () => void
  canvasTransform: { scale: number; offsetX: number; offsetY: number }
  setCanvasTransform: (transform: { scale: number; offsetX: number; offsetY: number }) => void
  zoomIn: () => void
  zoomOut: () => void
  resetCanvasTransform: () => void
  renderTrigger: number
  triggerRender: () => void;
}

/** 2画面分割・参照ウィンドウ・タップ穴補正など、ビュー構成の状態 */
export interface ViewSlice {
  // --- 色指定参照 ＆ メインセルビュー フローティング ---
  referenceCanvas: ReferenceCanvasState
  colorSpecLayoutMode: 'single' | 'split-vertical' | 'split-horizontal'
  isWinAFloating: boolean
  isWinBFloating: boolean
  toggleWinAFloating: () => void
  toggleWinBFloating: () => void
  openReferenceImage: (fileHandle?: any, fileName?: string, image?: TGAImage) => void
  closeReferenceWindow: () => void
  toggleReferenceFloating: () => void
  /**
   * ドッキング中の参照ウィンドウとメイン編集エリアの分割比 (メイン側の取り分)。
   * 0.15〜0.85 に丸められる。境界線のドラッグで変わる。
   */
  mainAreaSplitRatio: number;
  setMainAreaSplitRatio: (ratio: number) => void;
  setColorSpecLayoutMode: (mode: 'single' | 'split-vertical' | 'split-horizontal') => void
  setAutoRevertTool: (enable: boolean) => void
  setReferenceTransform: (transform: { scale: number; offsetX: number; offsetY: number }) => void
  pickColorFromReference: (color: RGBA) => void
  // --- タップ穴自動検出 ＆ 傾き補正 (Peg Hole Stabilizer) ---
  pegStabilizer: PegStabilizerState
  togglePegStabilizerEnabled: () => void
  setPegManualOffset: (x: number, y: number, rot: number) => void
  togglePegGuide: () => void
  runPegStabilizerAutoDetect: () => void
  // --- 2画面分割 (Split View) & 連動 (Sync Mode) ---
  isSplitView: boolean
  /**
   * 連動時に保つ Win B と Win A のコマ差 (splitFileIndex - currentFileIndex)。
   * 「連動」を押した瞬間の位置関係を記録し、以降その差を保ったまま追従させる。
   */
  syncFrameOffset: number;
  /** 連動中のコマ差を 0 に揃える (Win B を Win A と同じコマへ) */
  alignSyncFrames: () => void;
  syncMode: boolean
  activeViewIndex: 0 | 1
  splitFileIndex: number
  splitCanvasTransform: { scale: number; offsetX: number; offsetY: number }
  toggleIsSplitView: () => void
  toggleSyncMode: () => void
  setActiveViewIndex: (idx: 0 | 1) => void
  setSplitFileIndex: (index: number) => void
  setSplitCanvasTransform: (transform: { scale: number; offsetX: number; offsetY: number }) => void;
}

/** カットフォルダ階層・A/B フォルダ・連番ナビゲーション */
export interface FileSlice {
  // --- 統合ファイルブラウザ (Dir A & Dir B 2フォルダ管理 ＆ カット階層ナビゲーション) ---
  rootFolderHandle: any | null
  rootFolderName: string | null
  availableSubDirectories: SubDirectoryItem[]
  selectedSubDirA: string | null
  selectedSubDirB: string | null
  mergedFrameNumbers: string[]
  mergedFrameMap: Map<string, MergedFrameMapItem>
  /**
   * サブフォルダを持たないフォルダを Win A として開く。
   *
   * ⚠️ この用途で setCutRootFolder を使わないこと。あちらはカット全体を開き直す操作で、
   * サブフォルダが 1 つしか無いと Win B を空にしてしまう。
   * ⚠️ 一方で、前に開いたカットのサブフォルダ一覧は必ず捨てること。
   * 残すとドロップダウンに前のカットの _go / _ao が並び、選ぶとそちらへ飛ぶ。
   */
  openPlainFolderAsA: (handle: any, name: string, files: string[], filesMap: Map<string, File>) => void
  setCutRootFolder: (rootHandle: any, rootName: string, subDirs: SubDirectoryItem[]) => void
  setSelectedSubDirA: (dirName: string | null) => void
  setSelectedSubDirB: (dirName: string | null) => void
  folderHandleA: any | null
  folderHandleB: any | null
  fileMapA: Map<string, File>
  fileMapB: Map<string, File>
  folderNameA: string
  folderNameB: string
  fileListA: string[]
  fileListB: string[]
  unifiedFileList: string[]
  /**
   * ⚠️ handle には「files のパスの起点」となるハンドルを渡すこと。
   * 相対パスがサブフォルダ名から始まるなら、そのサブフォルダではなく
   * ルートのハンドルを渡す (resolveFileHandle がそこから辿るため)。
   * filesMap を省略すると、前のフォルダの残骸を防ぐため空で置き換える。
   */
  setFolderHandleA: (handle: any, name: string, files: string[], filesMap?: Map<string, File>) => void
  setFolderHandleB: (handle: any, name: string, files: string[], filesMap?: Map<string, File>) => void
  setFolderFilesA: (name: string, filesMap: Map<string, File>) => void
  setFolderFilesB: (name: string, filesMap: Map<string, File>) => void
  // --- ファイル・ナビゲーション ＆ D&Dドロップフォルダ ---
  folderHandle: any | null
  folderName: string | null
  fileList: string[]
  currentFileIndex: number
  setFolderHandle: (handle: any, name: string, files: string[]) => void
  setCustomDropFolderA: (folderName: string, fileMap: Map<string, File>, fileList: string[]) => void
  setCustomDropFolderB: (folderName: string, fileMap: Map<string, File>, fileList: string[]) => void
  setCurrentFileIndex: (index: number) => void
  stepCell: (delta: number) => void
  nextCell: () => void
  prevCell: () => void
  /** 統合フレーム番号から、指定ビュー側の実ファイル名を解決する (異名連番対応) */
  resolveFileNameForView: (index: number, view: 0 | 1) => string | null;

  /**
   * ファイルの相対パスから、そのビューでの表示位置を求める。
   * ⚠️ フレーム番号での逆引きは 1 対 1 にならない (番号が重なるサブフォルダ)。
   * 必ずパスの完全一致で引くこと。見つからなければ -1。
   */
  indexOfFileForView: (path: string, view: 0 | 1) => number;

  /**
   * ファイル名を変更する。plan は engine/renamePlan で組み立てたもの。
   * 衝突・不正な名前があれば 1 件も書き換えずに中止する。
   */
  renameFiles: (view: 0 | 1, plan: RenamePlanItem[]) => Promise<RenameResult>;

  /** 選択したファイルを同じフォルダへ複製する (元ファイルは触らない) */
  duplicateFiles: (view: 0 | 1, paths: string[]) => Promise<RenameResult>;

  /** 選択したファイルを削除する。呼ぶ前に確認を取ること */
  deleteFiles: (view: 0 | 1, paths: string[]) => Promise<RenameResult>;
}

/** 編集中の画像・キャッシュ・未保存管理・操作履歴・再生 */
export interface DocumentSlice {
  // --- 画像データバッファ & プリフェッチキャッシュ ---
  currentImage: TGAImage | null
  splitImage: TGAImage | null
  prevImage: TGAImage | null
  nextImage: TGAImage | null
  cacheImages: Map<string, TGAImage>
  setCurrentImage: (image: TGAImage | null) => void
  setSplitImage: (image: TGAImage | null) => void
  setPrevNextImages: (prev: TGAImage | null, next: TGAImage | null) => void
  /** アクティブなビュー (Win A / Win B) が編集対象にしている画像 */
  getActiveImage: () => TGAImage | null
  /** デコード済み画像キャッシュ (オニオンスキン・コマ送りの再デコードを防ぐ) */
  getImageCacheKey: (view: 0 | 1, fileName: string) => string
  getCachedImage: (key: string) => TGAImage | null
  putCachedImage: (key: string, image: TGAImage) => void
  invalidateCachedImage: (key: string) => void
  clearImageCache: () => void
  // --- 未保存状態の管理 ---
  isDirtyA: boolean
  isDirtyB: boolean
  markDirty: (view?: 0 | 1) => void
  clearDirty: (view: 0 | 1) => void
  /** 未保存の編集があれば確認ダイアログを出す。移動して良ければ true */
  confirmDiscardIfDirty: (view: 0 | 1) => boolean
  /** アクティブビューのセルを、正しいフォルダ・正しいファイル名へ上書き保存する */
  saveActiveCell: () => Promise<SaveResult>
  /**
   * アクティブビューのセルを、保存先を選んで書き出す。
   * 開いているフォルダ・連番の対応づけは変えないので、
   * 元ファイルの未保存状態はそのまま残る。
   */
  saveActiveCellAs: () => Promise<SaveResult>
  // --- 操作履歴 (Win A / Win B で独立) ---
  historyStack: HistoryItem[]
  historyIndex: number
  splitHistoryStack: HistoryItem[]
  splitHistoryIndex: number
  /** 未確定の最新状態を履歴末尾へ書き戻す (undo/redo/saveUndoState の前に自動で呼ばれる) */
  commitLiveState: () => void;
  saveUndoState: (actionName?: string) => void
  jumpToHistory: (index: number) => void
  undo: () => void
  redo: () => void
  // --- アニメーション再生 ---
  isPlaying: boolean
  fps: number
  setIsPlaying: (playing: boolean) => void
  setFps: (fps: number) => void;
}

/** ツール選択・ツールオプション・前景/背景色・カラーパレット */
export interface ToolSlice {
  // --- ツール関連 ---
  activeTool: ToolType
  setActiveTool: (tool: ToolType) => void
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
  }
  setGapCloseLevel: (level: number) => void
  setEnableIncludeTrace: (enable: boolean) => void
  setRetainTraceLine: (retain: boolean) => void
  toggleTraceColor: (color: 'red' | 'blue' | 'green') => void
  setBrushSize: (size: number) => void
  setExpandContract: (val: number) => void
  setContiguous: (val: boolean) => void
  setSampleSize: (size: '1x1' | '3x3' | '5x5') => void
  setReferenceLayer: (ref: 'current' | 'all' | 'reference') => void
  setMaxNoiseSize: (size: number) => void
  setFrameHold: (hold: 1 | 2 | 3) => void
  // --- 前景色 & 背景色 ---
  currentColor: RGBA
  backgroundColor: RGBA
  setCurrentColor: (color: RGBA) => void
  setBackgroundColor: (color: RGBA) => void
  swapColors: () => void
  // --- カラー・パレット編集 ---
  activePaletteTab: 'normal' | 'shadow' | 'highlight'
  setActivePaletteTab: (tab: 'normal' | 'shadow' | 'highlight') => void
  palettes: {
    normal: PaletteItem[];
    shadow: PaletteItem[];
    highlight: PaletteItem[];
  }
  selectedColorIndex: number | null
  setSelectedColorIndex: (index: number | null) => void
  addPaletteColor: (name: string, hex: string) => void
  deletePaletteColor: (index: number) => void
  exportPaletteJSON: () => string
  importPaletteJSON: (jsonStr: string) => boolean
  importACTPalette: (buffer: ArrayBuffer) => boolean;
}

/** セル全体への一括加工とレイヤー管理 */
export interface EditSlice {
  // --- 機能処理 ---
  replaceColorGlobal: (targetHex: string, newHex: string) => void
  smoothLineartGlobal: () => void
  separateLineartLayersGlobal: () => void
  convertWhiteToAlphaGlobal: () => void
  // --- マルチレイヤー ---
  layers: LayerItem[]
  activeLayerId: string
  setActiveLayerId: (id: string) => void
  toggleLayerVisible: (id: string) => void
  setLayerOpacity: (id: string, opacity: number) => void
  addLayer: (name: string) => void
  deleteLayer: (id: string) => void;
}

/** ライトテーブル (オニオンスキン) の設定と重ね合わせ素材 */
export interface LightTableSlice {
  // --- ライトテーブル ＆ オニオンスキン ---
  lightTable: LightTableState
  setLightTableEnabled: (enabled: boolean) => void
  setLightTableOpacity: (opacity: number) => void
  setOnionSkinFrames: (past: number, future: number) => void
  setOnionSkinOpacityConfig: (startOpacity: number, opacityStep: number) => void
  /** カット内の全セルをオニオンスキン表示するかどうか */
  setOnionSkinShowAllFrames: (showAll: boolean) => void;
  setOnionSkinDisplayMode: (mode: 'color' | 'half-color' | 'monochrome') => void
  setOnionSkinColors: (pastColor: { r: number; g: number; b: number }, futureColor: { r: number; g: number; b: number }) => void
  addLightTableSubItem: (name: string, file?: File, image?: TGAImage) => void
  removeLightTableSubItem: (id: string) => void
  updateLightTableSubItemTransform: (id: string, transform: { offsetX?: number; offsetY?: number; rotation?: number; opacity?: number }) => void
  toggleLightTableSubItemVisible: (id: string) => void;
}

/** 撮影上がりロールの読み込み状態 */
export type RollStatus = 'idle' | 'ready' | 'unsupported' | 'error';

export interface RollState {
  isOpen: boolean;
  isFloating: boolean;
  fileName: string;
  /** 元ファイル。再生に失敗したときコーデックを調べ直すために持っておく (実データは読まない) */
  file: File | null;
  /** <video> に渡す blob URL。差し替え・終了のたびに必ず revoke する */
  objectUrl: string | null;
  status: RollStatus;
  /** 再生できないときにユーザーへ出す説明 */
  message: string;
  codec: VideoCodecInfo | null;
  /** コマ送りの基準。実再生から推定し、外れたら手動で指定できる */
  fps: number;
  fpsSource: 'default' | 'auto' | 'manual';
}

export interface RollSlice {
  roll: RollState
  openRollWindow: () => void
  closeRollWindow: () => void
  toggleRollFloating: () => void
  /** ロールを読み込む。デコードはブラウザに任せるのでここでは中身を読まない */
  loadRollFile: (file: File) => void
  /** <video> が再生を拒否したときに呼ぶ。コーデックを調べて理由を出す */
  reportRollPlaybackFailure: () => Promise<void>
  setRollFps: (fps: number, source: 'auto' | 'manual') => void
}

/** 独立ウィンドウとして切り離せるパネルの識別子 */
export type FloatingWindowId = 'winA' | 'winB' | 'reference' | 'colorChart' | 'roll';

export interface FloatingWindowLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 独立ウィンドウの位置・サイズ・重なり順 */
export interface WindowSlice {
  floatingWindows: Record<FloatingWindowId, FloatingWindowLayout>;
  /** 末尾ほど手前。クリックしたウィンドウを末尾へ動かして最前面にする */
  floatingWindowOrder: FloatingWindowId[];
  setFloatingWindowPosition: (id: FloatingWindowId, x: number, y: number) => void;
  setFloatingWindowSize: (id: FloatingWindowId, width: number, height: number) => void;
  bringWindowToFront: (id: FloatingWindowId) => void;
  getWindowZIndex: (id: FloatingWindowId) => number;
}


/** 全スライスを合成したストアの最終形 */
export interface RenameResult {
  ok: boolean;
  message: string;
  /** 実際に名前が変わった件数 */
  renamed: number;
}

export interface SaveResult {
  ok: boolean;
  message: string;
  /** ユーザーがダイアログを閉じただけ。通知を出す必要はない */
  cancelled?: boolean;
}

export interface LayoutSlice {
  /** 作業領域の並び順・重なり・一面表示 */
  paneLayout: PaneLayout
  /** 開いている面とレイアウトを揃える。開閉フラグが変わったときに呼ぶ */
  syncPaneVisibility: (visible: Record<PaneId, boolean>) => void
  setActivePaneInSlot: (slotId: string, pane: PaneId) => void
  /** 面を別の枠へ重ねる (タブとして移す) */
  stackPaneOnSlot: (pane: PaneId, slotId: string) => void
  /** 面を独立した枠として、指定の位置へ差し込む */
  movePaneToPosition: (pane: PaneId, index: number) => void
  swapPanePositions: (a: PaneId, b: PaneId) => void
  toggleMaximizedPane: (pane: PaneId) => void
  setPaneSlotFlex: (slotId: string, flexGrow: number) => void
  evenOutPaneSlots: () => void
  /** 開いている面はそのままに、並びだけ既定へ戻す */
  resetPaneLayout: () => void
}

export interface PaintStore
  extends UiSlice,
    ViewSlice,
    WindowSlice,
    FileSlice,
    DocumentSlice,
    ToolSlice,
    EditSlice,
    LightTableSlice,
    RollSlice,
    LayoutSlice {}

export const defaultColors: PaletteItem[] = [
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
