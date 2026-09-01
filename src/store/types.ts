/**
 * Kingfisher グローバルストアの型定義。
 *
 * ストア本体は責務ごとにスライス (store/slices/*) へ分割してあり、
 * ここでは各スライスが持つ状態の形だけを宣言する。
 * PaintStore は全スライスを合成した最終形で、コンポーネントはこれだけを見ればよい。
 */

import { TGAImage } from '../engine/tga';
import { PegHole, PegReference } from '../engine/pegStabilizer';
import { RenamePlanItem } from '../engine/renamePlan';
import { compareNatural } from '../engine/naturalOrder';
import { CodecInfo as VideoCodecInfo, DroppedVideo } from '../engine/videoSource';
import { PaneLayout, PaneId } from '../engine/paneLayout';

export type { PaneLayout, PaneId };

export type { VideoCodecInfo, DroppedVideo };

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
  /** 穴の間隔から求めた倍率 (スキャナの送りむらの補正) */
  scale: number;
  manualX: number;
  manualY: number;
  manualRotation: number;
  showGuide: boolean;
  /** 直近の検出で見つかった穴 (左・中央・右)。ガイド表示に使う */
  holes: PegHole[];
  /**
   * 合わせ先。ふつうはカットの 1 枚目を基準にして、以降をそこへ重ねる。
   * ⚠️ 「理想の位置」を決め打ちにしないこと。紙のサイズもタップの間隔も現場ごとに違う。
   */
  reference: PegReference | null;
  /** 直前の結果の説明 (見つからなかった理由もここに入れる) */
  message: string;
  /**
   * 検出の調整値。自動で見つからない紙のために手で決められるようにする。
   * ⚠️ 既定は自動。素材ごとに毎回いじらせないこと。
   */
  options: {
    /** しきい値を画像から見当づけるか */
    autoThreshold: boolean;
    /** 手動のしきい値 (0-255)。これ以下の明るさを穴とみなす */
    threshold: number;
    /** 紙の端から何 % を探すか */
    searchPercent: number;
  };
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
  /**
   * 片側にしか無く、しかもそのフォルダに相手がいないコマ
   * (例: paint 側だけにある _pool の撮影素材)。
   * ⚠️ コマ送り (stepCell) はここを飛ばす。ツリーから選べば開ける。
   */
  unpairedFolder?: boolean;
}

/** パスのファイル名部分だけ ("Cut029/a/a0001.tga" -> "a0001.tga") */
export function baseNameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf(String.fromCharCode(92)));
  return idx < 0 ? path : path.slice(idx + 1);
}

/**
 * 先頭のフォルダ名を落とした相対パス ("ATO_029_trace/a/a0001.tga" -> "a/a0001.tga")。
 *
 * ⚠️ A と B は別のフォルダを開くので、先頭の名前は必ず違う (trace / paint)。
 * 中の構造を比べたいときは必ずここを通すこと。
 */
export function pathWithoutRoot(path: string): string {
  const idx = Math.min(
    ...[path.indexOf('/'), path.indexOf(String.fromCharCode(92))].filter((v) => v >= 0).concat(Infinity)
  );
  return idx === Infinity ? path : path.slice(idx + 1);
}

/**
 * ファイル名から「4桁等の連番数字」を抽出する (例: b_go0003.tga -> "0003", a0012.tga -> "0012")。
 *
 * ⚠️ パス全体から探さないこと。フォルダ名の数字を拾ってしまう。
 * 実例: ATO_OP_029_trace/_sheet/cut.tga が「029 コマ目」になり、
 * 数字を持たないはずのファイルが連番の中に紛れ込んでいた (2026-08-31 の報告)。
 * ⚠️ 数字が無いときはファイル名をそのまま返す。パスを返すと、A と B で
 * 先頭のフォルダ名が違うだけで別のコマ扱いになる。
 */
export function extractFrameNumber(fileName: string): string {
  const name = baseNameOf(fileName);
  const match = name.match(/(?:^|[^0-9])([0-9]{2,4})(?=[^0-9]*\.[a-z0-9]+$)/i);
  if (match) return match[1];
  const numMatch = name.match(/([0-9]+)(?=[^0-9]*\.[a-z0-9]+$)/i);
  return numMatch ? numMatch[1].padStart(4, '0') : name;
}

/**
 * 連動中の Win A / Win B の位置が、記録しているコマ差と辻褄が合っているか。
 *
 * ⚠️ 「B === A + コマ差」だけで見ないこと。端では追従する側が切り詰められるため、
 * 主導した側から見れば正しいのに食い違いと判定してしまう
 * (例: 全 4 コマ・コマ差 +1 で B が先頭へ来ると A=0 / B=0)。
 * どちらが主導でも辻褄が合えば正しい、と見る。
 */
export function isSyncPairConsistent(
  indexA: number,
  indexB: number,
  offset: number,
  total: number
): boolean {
  const last = Math.max(0, total - 1);
  const clamp = (v: number) => Math.max(0, Math.min(last, v));
  return indexB === clamp(indexA + offset) || indexA === clamp(indexB - offset);
}

/** 相対パスのディレクトリ部分 ("_go/a0001.tga" -> "_go/") */
function directoryOf(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf(String.fromCharCode(92)));
  return idx < 0 ? '' : path.slice(0, idx + 1);
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
  /** 実ファイルのパス -> そのファイルが入ったキー */
  const keyOfA = new Map<string, string>();
  const keyOfB = new Map<string, string>();

  /** ルートを除いたフォルダ位置。A と B でルート名が違っても比べられる ("a/") */
  const dirTailOf = (path: string) => directoryOf(pathWithoutRoot(path));

  /** ルートを除いた相対パス -> A のキー (同じ位置・同じ名前なら同じセル) */
  const aKeyByRelPath = new Map<string, string>();
  /** コマ番号 -> A のキー (先に入った順) */
  const aKeysByNumber = new Map<string, string[]>();
  /** A のキー -> ルートを除いたフォルダ位置 */
  const aDirTail = new Map<string, string>();

  const isFree = (key: string, side: 'A' | 'B') => {
    const item = frameMap.get(key);
    if (!item) return true;
    return side === 'A' ? !item.fileNameA : !item.fileNameB;
  };

  /**
   * 新しい枠のキーを作る。
   *
   * ⚠️ 埋まっているときのキーにフォルダのフルパスを使わないこと。
   * 先頭のフォルダ名は A と B で必ず違う (trace / paint) ため、
   * 同じ位置・同じ名前のファイルなのに別のキーになり、永久に対にならない。
   * 実例: A=trace/a/a0001.tga と B=paint/a/a0001.tga が別のコマになり、
   * 統合リストが 1 コマ増えて「a0001 だけ相手が居ない」状態になっていた
   * (2026-08-31 の報告)。ルートを除いた位置で作れば、両側で同じキーになる。
   */
  const freeKeyFor = (path: string, num: string, side: 'A' | 'B') => {
    /**
     * ⚠️ B の新しい枠を作るとき、A のファイルが入っている枠を使わないこと。
     * そこは「対にしない」と判断した相手なので、空いているからと入れてしまうと
     * 結局その A と対になる (_pool の .jpg が設定シートと並んでいた)。
     */
    const usable = (key: string) => isFree(key, side) && !(side === 'B' && frameMap.get(key)?.fileNameA);
    if (usable(num)) return num;
    const tail = dirTailOf(path);
    let key = `${tail}${num}`;
    let n = 2;
    while (!usable(key)) {
      key = `${tail}${num}#${n}`;
      n += 1;
    }
    return key;
  };

  const put = (key: string, path: string, side: 'A' | 'B') => {
    const item = frameMap.get(key) || { frameNumber: key };
    if (side === 'A') {
      item.fileNameA = path;
      keyOfA.set(path, key);
      aKeyByRelPath.set(pathWithoutRoot(path), key);
      const list = aKeysByNumber.get(extractFrameNumber(path)) ?? [];
      list.push(key);
      aKeysByNumber.set(extractFrameNumber(path), list);
      aDirTail.set(key, dirTailOf(path));
    } else {
      item.fileNameB = path;
      keyOfB.set(path, key);
    }
    frameMap.set(key, item);
  };

  listA.forEach((path) => put(freeKeyFor(path, extractFrameNumber(path), 'A'), path, 'A'));

  /**
   * フォルダの対応づけ。
   *
   * ⚠️ 番号だけで A の枠を取らせないこと。B 側にだけある参照用のフォルダ
   * (例: _pool/ に置いた撮影素材の .jpg 200 枚) が、番号だけを頼りに
   * A のセルや設定シートの枠を奪ってしまう。実際に、A のセルが軒並み
   * 「実体なし」と対になっていた (2026-08-31 の報告)。
   * 同じ名前のフォルダがあればそこが相手。無い場合だけ、
   * 相手の見つからないフォルダ同士で番号を突き合わせる (異名連番の A/B)。
   */
  const dirsOf = (list: string[]) => {
    const dirs: string[] = [];
    list.forEach((path) => {
      const dir = dirTailOf(path);
      if (!dirs.includes(dir)) dirs.push(dir);
    });
    return dirs;
  };
  const aDirs = dirsOf(listA);
  const bDirs = dirsOf(listB);
  /** 相手の見つからない A のフォルダ (異名連番の受け皿) */
  const unmatchedADirs = new Set(aDirs.filter((dir) => !bDirs.includes(dir)));
  const dirPartnerOf = (bDir: string) => (aDirs.includes(bDir) ? bDir : null);

  /**
   * B のファイルを A の枠へ入れる。
   *
   * ⚠️ まず「ルートを除いた相対パスが同じ」ものを全部先に対にすること。
   * これが一番強い手がかりで、後回しにすると、先に処理された別のファイルが
   * 番号だけを頼りにその枠を埋めてしまう (_pool の .jpg が a/ のセルの枠を
   * 取り、あとから来た本物の a/a0001.tga が行き場を失っていた)。
   *
   * そのあと、残りを番号で突き合わせる。相手は「同じ名前のフォルダ」、
   * 無ければ「相手の見つからないフォルダ同士」に限る。
   */
  const pendingB: string[] = [];
  listB.forEach((path) => {
    const samePath = aKeyByRelPath.get(pathWithoutRoot(path));
    if (samePath && isFree(samePath, 'B')) {
      put(samePath, path, 'B');
      return;
    }
    pendingB.push(path);
  });

  pendingB.forEach((path) => {
    const num = extractFrameNumber(path);
    const tail = dirTailOf(path);
    const partner = dirPartnerOf(tail);

    const candidates = (aKeysByNumber.get(num) ?? []).filter((key) => {
      if (!isFree(key, 'B')) return false;
      const aTail = aDirTail.get(key) ?? '';
      return partner === null ? unmatchedADirs.has(aTail) : aTail === partner;
    });

    if (candidates.length > 0) {
      put(candidates[0], path, 'B');
      return;
    }

    put(freeKeyFor(path, num, 'B'), path, 'B');
  });

  /**
   * 「相手のいないフォルダのコマ」に印を付ける。
   *
   * ⚠️ 片側にしか無いだけでは付けないこと。同じ名前のフォルダが両側にあるなら、
   * それは「相手が欠けているセル」であって参照素材ではない (Win B が NO DATA に
   * なるだけで、コマ送りで通るべき)。フォルダごと相手がいないときだけ印を付ける。
   */
  const unmatchedBDirs = new Set(bDirs.filter((dir) => !aDirs.includes(dir)));
  frameMap.forEach((item) => {
    if (item.fileNameA && item.fileNameB) return;
    const path = (item.fileNameA ?? item.fileNameB)!;
    const dir = dirTailOf(path);
    const hasPartnerDir = item.fileNameA
      ? bDirs.includes(dir) || unmatchedBDirs.size > 0
      : aDirs.includes(dir) || unmatchedADirs.size > 0;
    if (!hasPartnerDir) item.unpairedFolder = true;
  });

  const representativeOf = (key: string): string => {
    const item = frameMap.get(key)!;
    return item.fileNameA || item.fileNameB || key;
  };

  /** 連番として比べられる番号。数字を持たないファイルは null */
  const numberOf = (key: string): number | null => {
    const num = extractFrameNumber(representativeOf(key));
    return /^[0-9]+$/.test(num) ? parseInt(num, 10) : null;
  };

  /**
   * 並び順は「フォルダごとにまとめ、その中は自然順」。ツリー (fileListA の順) と
   * コマ送りの順を一致させるための決まり。
   *
   * ⚠️ コマ番号だけで並べないこと。サブフォルダをまたいで同じ番号があると、
   * 番号を先に取った側だけが数値キーになり、取れなかった側は末尾へ回る。その結果
   *   _bg/x0001 → x0002 → x0003 → _go/y0004 → y0005 → _go/y0001 …
   * と、コマ送りの途中で別フォルダへ飛び、あとから戻ってくる (2026-08-31 の報告)。
   * ⚠️ かといってパスだけで並べるのも駄目で、Win B にしか無いコマ (追加リテイク) が
   * B 側のフォルダ名で並んでしまい、番号と無関係な場所 (先頭など) に現れる。
   * B だけのコマは「B の並びで直前にあった、両方にあるコマ」のフォルダへ寄せ、
   * その中では番号が収まる位置へ差し込む。
   * ⚠️ 入力の順に依存しないこと。フォルダも中身も compareNatural で並べ直す
   * (呼び出し側は sortNatural 済みの一覧を渡すので、結果は同じ並びになる)。
   */
  const homeDir = new Map<string, string>();
  // ⚠️ 前後どちらも見ること。B の 1 本目が B だけのコマだと、
  // 前だけ見ていては寄せ先が決まらず、末尾へ回ってしまう
  const anchorPass = (paths: string[]) => {
    let anchorDir: string | null = null;
    paths.forEach((path) => {
      const key = keyOfB.get(path)!;
      const item = frameMap.get(key)!;
      if (item.fileNameA) {
        anchorDir = directoryOf(item.fileNameA);
        return;
      }
      // ⚠️ 相手の見つからないフォルダ (B にだけある参照用フォルダ) は、
      // A の並びへ差し込まないこと。セルの列に 200 枚の参照画像が割り込む
      if (anchorDir !== null && !homeDir.has(key) && dirPartnerOf(dirTailOf(path)) !== null) {
        homeDir.set(key, anchorDir);
      }
    });
  };
  anchorPass(listB);
  anchorPass(listB.slice().reverse());
  // 手がかりが無くても、同じフォルダが A 側にあるならそこへ (同じフォルダの追加コマ)
  listB.forEach((path) => {
    const key = keyOfB.get(path)!;
    if (frameMap.get(key)!.fileNameA || homeDir.has(key)) return;
    if (dirPartnerOf(dirTailOf(path)) === null) return; // 相手のいないフォルダは最後へ
    homeDir.set(key, directoryOf(path));
  });

  const aKeysByDir = new Map<string, string[]>();
  listA.forEach((path) => {
    const dir = directoryOf(path);
    const keys = aKeysByDir.get(dir) ?? [];
    keys.push(keyOfA.get(path)!);
    aKeysByDir.set(dir, keys);
  });

  const bOnlyByDir = new Map<string, string[]>();
  /** 寄せ先が決まらない (両方にあるコマが 1 つも無い) B のコマは最後にまとめる */
  const orphans: string[] = [];
  listB.forEach((path) => {
    const key = keyOfB.get(path)!;
    if (frameMap.get(key)!.fileNameA) return;
    const dir = homeDir.get(key);
    if (dir === undefined || !aKeysByDir.has(dir)) {
      orphans.push(key);
      return;
    }
    const keys = bOnlyByDir.get(dir) ?? [];
    keys.push(key);
    bOnlyByDir.set(dir, keys);
  });

  const frameNumbers: string[] = [];
  Array.from(aKeysByDir.keys())
    .sort(compareNatural)
    .forEach((dir) => {
      const keys = aKeysByDir
        .get(dir)!
        .slice()
        .sort((a, b) => compareNatural(representativeOf(a), representativeOf(b)));

      // B だけのコマを、そのフォルダの中で番号が収まる位置へ差し込む
      (bOnlyByDir.get(dir) ?? []).forEach((key) => {
        const value = numberOf(key);
        let at = keys.length;
        if (value !== null) {
          const ahead = keys.findIndex((k) => {
            const other = numberOf(k);
            return other !== null && other > value;
          });
          if (ahead >= 0) at = ahead;
        }
        keys.splice(at, 0, key);
      });

      frameNumbers.push(...keys);
    });

  frameNumbers.push(...orphans.sort((a, b) => compareNatural(representativeOf(a), representativeOf(b))));

  const unifiedFiles = frameNumbers.map(representativeOf);

  return { frameNumbers, frameMap, unifiedFiles };
}


/** テーマ・パネル配置・モーダル・ズーム/ルーラーなど、画面まわりの状態 */
export interface UiSlice {
  // --- テーマ ＆ キャンバス背景マット ＆ 右サイドパネル開閉 ---
  isDarkMode: boolean
  toggleDarkMode: () => void
  isRightSidebarOpen: boolean
  toggleRightSidebarOpen: () => void
  /** 右サイドパネルの幅 (px)。ドラッグでも、DEBUG ログの「広げる」でも変わる */
  rightSidebarWidth: number
  setRightSidebarWidth: (width: number) => void
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
    /** 操作ログ (DEBUG ウィンドウ) */
    debugLog: boolean;
  }
  togglePanelVisibility: (panel: 'toolPalette' | 'toolOptions' | 'colorChart' | 'lightTable' | 'fileBrowser' | 'layerPanel' | 'historyPanel' | 'debugLog') => void
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
  /**
   * キーの効き先。最後に操作した面で決まる ('cell' = Win A / Win B、'roll' = 撮影ロール)。
   * ⚠️ ↑ ↓ と Space はセルとロールで意味が違う (セル: コマ送り / パン、
   * ロール: 前後のロール / 再生) ので、これで振り分ける。
   */
  activeSurface: 'cell' | 'roll'
  setActiveSurface: (surface: 'cell' | 'roll') => void
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
  /** 表示中のコマのタップ穴を検出し、基準へ合わせる (基準が無ければこのコマを基準にする) */
  runPegStabilizerAutoDetect: () => void
  /** 表示中のコマを基準にし直す */
  setPegReferenceFromCurrent: () => void
  /** 基準を捨てて補正を戻す */
  clearPegReference: () => void
  /** 検出の調整値を変える (変えたら DEBUG ログに残る) */
  setPegOptions: (options: Partial<PegStabilizerState['options']>) => void
  /**
   * 選んだファイルにタップ補正を焼き込む。
   *
   * mode 'copy'      … 別フォルダへ書き出す (元は触らない / 既定・推奨)
   * mode 'overwrite' … 元のファイルを上書きする。backup を付けると元を残す
   * ⚠️ 上書きは元に戻せないので、呼び出し側で必ず確認を取ること。
   */
  applyPegCorrectionToFiles: (
    view: 0 | 1,
    paths: string[],
    options?: { mode?: 'copy' | 'overwrite'; backup?: boolean }
  ) => Promise<{ ok: boolean; message: string; applied: number }>
  // --- 2画面分割 (Split View) & 連動 (Sync Mode) ---
  /**
   * Win A を出しているか。
   * ⚠️ 「常に出す」にしないこと。ロールを 2 面並べたいときに、空の Win A が
   * 場所を取って並べられなくなる。
   */
  isWinAVisible: boolean
  toggleWinAVisible: () => void
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
  setSplitFileIndex: (index: number, source?: string) => void
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
  setCurrentFileIndex: (index: number, source?: string) => void
  stepCell: (delta: number, source?: string) => void
  /** source には「どこから動かしたか」(キー名・ボタン名) を渡す。DEBUG ログに残る */
  nextCell: (source?: string) => void
  prevCell: (source?: string) => void
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

  /**
   * 選択したファイルを、新しく作ったフォルダへまとめて移す。
   * フォルダは選んだファイルの置き場所に作る (ばらけているときはルート直下)。
   * 衝突・不正な名前があれば 1 件も動かさずに中止する。
   */
  moveFilesToNewFolder: (view: 0 | 1, paths: string[], folderName: string) => Promise<RenameResult>;
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

/** ロールを出せる面。修正前 / 修正後を並べて見比べるために 2 面ある */
export type RollId = 'rollA' | 'rollB';

export const ROLL_IDS: RollId[] = ['rollA', 'rollB'];

/** 1 つの面の再生状態 */
export interface RollViewState {
  isOpen: boolean;
  isFloating: boolean;
  /**
   * この面で開いたフォルダの映像一覧。
   * ⚠️ 面ごとに持つ。ツリーも面ごとに 1 本ずつ並べるので、
   * ここを共有すると「A に落としたフォルダが B のツリーにも出る」ことになる。
   */
  files: DroppedVideo[];
  /** 一覧の見出しに出すフォルダ名 */
  folderName: string;
  fileName: string;
  /** 元ファイル。再生に失敗したときコーデックを調べ直すために持っておく (実データは読まない) */
  file: File | null;
  /** <video> に渡す blob URL。差し替え・終了のたびに必ず revoke する */
  objectUrl: string | null;
  /** 今開いているロールの相対パス */
  currentPath: string | null;
  status: RollStatus;
  /** 再生できないときにユーザーへ出す説明 */
  message: string;
  codec: VideoCodecInfo | null;
  /** コマ送りの基準。実再生から推定し、外れたら手動で指定できる */
  fps: number;
  fpsSource: 'default' | 'auto' | 'manual';
}

export interface RollState {
  /** 面ごとの再生状態 (映像の一覧も面ごとに持つ) */
  views: Record<RollId, RollViewState>;
  /** ツリーから選んだときに開く面 */
  activeId: RollId;
  /** 2 面の再生を連動させるか */
  sync: boolean;
  /** 連動を開始した時点の時刻差 (B - A、秒) */
  syncOffset: number;
  /**
   * 2 面のツリーで選ぶロールを連動させるか。
   * 再生の連動 (sync) とは別物。あちらは同じロールの中の時刻、こちらは
   * 「一覧の何本目を開くか」を合わせる。
   */
  fileSync: boolean;
  /** ツリーの連動を開始した時点の一覧上のずれ (B - A、本数) */
  fileSyncOffset: number;
}

export interface RollSlice {
  roll: RollState
  /**
   * 面を開く。開く側に一覧が無ければ、もう一方の一覧を引き継ぐ
   * (1 つのフォルダを 2 面で見比べる使い方でツリーが片方だけになるのを防ぐ)
   */
  openRollWindow: (id: RollId) => void
  closeRollWindow: (id: RollId) => void
  toggleRollFloating: (id: RollId) => void
  /** ツリーから選んだときに開く面を決める */
  setActiveRollId: (id: RollId) => void
  /** ロールを 1 本だけ読み込む。デコードはブラウザに任せるのでここでは中身を読まない */
  loadRollFile: (id: RollId, file: File) => void
  /** フォルダの中で見つかったロールをまとめて受け取り、先頭を開く */
  loadRollFiles: (id: RollId, videos: DroppedVideo[], folderName: string) => void
  /**
   * 一覧だけ登録して開かない。フォルダを開いた時点では映像を再生せず、
   * ツリーから選ばれたときに初めて開くため
   */
  setRollFolderFiles: (id: RollId, videos: DroppedVideo[], folderName: string) => void
  /** 一覧の中から 1 本を選んで開く。source には「どこから選んだか」を渡す (DEBUG ログに残る) */
  selectRollFile: (id: RollId, path: string, source?: string) => void
  /** 一覧の中で前後のロールへ移る */
  stepRoll: (id: RollId, delta: number, source?: string) => void
  /** <video> が再生を拒否したときに呼ぶ。コーデックを調べて理由を出す */
  reportRollPlaybackFailure: (id: RollId) => Promise<void>
  setRollFps: (id: RollId, fps: number, source: 'auto' | 'manual') => void
  /**
   * 2 面の再生を連動させる / やめる。
   * 開始時の時刻差 (B - A、秒) を渡すと、その差を保ったまま追従する。
   */
  toggleRollSync: (offset?: number) => void
  /**
   * 2 面のツリーで選ぶロールを連動させる / やめる。
   * 開始時に今それぞれ開いている本数の差を記録し、以降その差を保って追従する。
   */
  toggleRollFileSync: () => void
  /** ツリーの連動のずれを 0 に戻し、ロール B を ロール A と同じ位置へ揃える */
  alignRollFiles: () => void
}

/** 独立ウィンドウとして切り離せるパネルの識別子 */
export type FloatingWindowId = 'winA' | 'winB' | 'reference' | 'colorChart' | 'rollA' | 'rollB';

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
