/**
 * カットフォルダ階層・A/B フォルダ・連番ナビゲーション
 */

import { StateCreator } from 'zustand';
import {
  renameFile,
  copyFile,
  deleteFile,
  moveFileToDirectory,
  requestWriteAccess,
  resolveFileHandle,
  backupPathFor,
} from '../../engine/fileSystemPath';
import { sortNatural } from '../../engine/naturalOrder';
import {
  buildDuplicatePlan,
  findInvalidNames,
  findRenameConflicts,
  needsTwoPhaseRename,
  omitUnchanged,
  replaceBaseName,
} from '../../engine/renamePlan';
import { applyMoveToList, buildMoveToFolderPlan } from '../../engine/folderPlan';
import { encodeTypeFor, rotateImageData, rotateLabel, RotateDirection } from '../../engine/rotateImage';
import { laneCount, runInLanes } from '../../engine/jobPool';
import type { RotateWorkerDone, RotateWorkerJob } from '../../workers/rotate.worker';
import { decodeTGA, encodeTGA } from '../../engine/tga';
import { applyJpegDensity, readJpegDensity } from '../../engine/jpegDensity';
import { logDebug, PLAYBACK_SOURCE } from '../../engine/debugLog';
import {
  isSyncPairConsistent,
  PaintStore,
  FileSlice,
  SubDirectoryItem,
  MergedFrameMapItem,
  buildMergedFrameData,
} from '../types';

/** そのビューに実体があるコマかどうか */
function viewHasFile(frameMap: Map<string, MergedFrameMapItem>, frameNumber: string, view: 0 | 1): boolean {
  const item = frameMap.get(frameNumber);
  return view === 1 ? !!item?.fileNameB : !!item?.fileNameA;
}

/**
 * そのビューに実体があるコマのうち、最初の位置。
 *
 * ⚠️ 開いた直後の位置を 0 に固定してはいけない。A と B のコマ番号が
 * 重ならない場合 (一部のセルだけリテイクを受け取る等)、先頭のコマには
 * そのビューの実体が無く、ウィンドウが「NO DATA」のままになる。
 */
function firstIndexWithFile(
  frameNumbers: string[],
  frameMap: Map<string, MergedFrameMapItem>,
  view: 0 | 1
): number {
  const idx = frameNumbers.findIndex((n) => viewHasFile(frameMap, n, view));
  return idx < 0 ? 0 : idx;
}

/**
 * 新しく開いた B 側の初期位置。
 *
 * ⚠️ Win A が見ているコマに合わせること (そのコマが B にもあるなら)。
 * 別々のコマから始まると、そのまま「連動」を押したときに意図しないコマ差が
 * 記録され、「0001 と 0002 が対になったまま送られる」ことになる。
 * B にそのコマが無いときだけ、B に実体がある最初のコマへ (NO DATA で開かないため)。
 */
function alignedWithOther(
  frameNumbers: string[],
  frameMap: Map<string, MergedFrameMapItem>,
  view: 0 | 1,
  otherIndex: number
): number {
  const number = frameNumbers[otherIndex];
  if (number && viewHasFile(frameMap, number, view)) return otherIndex;
  return firstIndexWithFile(frameNumbers, frameMap, view);
}

/**
 * 連動中の Win B の位置。
 *
 * ⚠️ 連動中にフォルダを開き直したら、必ず「Win A + コマ差」へ引き直すこと。
 * ここを別々に決めると、記録しているコマ差 (syncFrameOffset) と実際のズレが
 * 食い違い、「連動中 (同じコマ) と出ているのに Win B だけ 1 コマ先」になる。
 * 先頭のコマではそれ以上戻れないため、そのズレだけ直せないまま残る
 * (2026-08-29 の報告)。
 */
function linkedSplitIndex(state: PaintStore, frameCount: number, currentFileIndex: number): number | null {
  if (!state.syncMode || !state.isSplitView) return null;
  const last = Math.max(0, frameCount - 1);
  return Math.max(0, Math.min(last, currentFileIndex + state.syncFrameOffset));
}

/**
 * 片側のフォルダだけを差し替えたときに、もう一方が見ていたコマを維持する。
 * マージし直すと統合リストの並びが変わるため、位置ではなくコマ番号で引き継ぐ。
 */
function keepFrameIndex(
  prevFrameNumbers: string[],
  prevIndex: number,
  frameNumbers: string[],
  frameMap: Map<string, MergedFrameMapItem>,
  view: 0 | 1
): number {
  const prevNumber = prevFrameNumbers[prevIndex];
  if (prevNumber) {
    const next = frameNumbers.indexOf(prevNumber);
    if (next >= 0 && viewHasFile(frameMap, prevNumber, view)) return next;
  }
  return firstIndexWithFile(frameNumbers, frameMap, view);
}

/** コマ差の符号を読みやすく (+2 / -1 / 0) */
function formatOffset(offset: number): string {
  return offset > 0 ? `+${offset}` : String(offset);
}

/** その位置のファイル名。実体が無ければそう書く (空欄にしない) */
function nameAt(state: PaintStore, index: number, view: 0 | 1): string {
  return state.resolveFileNameForView(index, view) ?? '実体なし';
}

/** 「Win A=3 (a0004.tga) / Win B=5 (b0006.tga)」 */
function describeAB(state: PaintStore): string {
  return (
    `Win A=${state.currentFileIndex} (${nameAt(state, state.currentFileIndex, 0)})` +
    ` / Win B=${state.splitFileIndex} (${nameAt(state, state.splitFileIndex, 1)})`
  );
}

/**
 * 連動中に「記録しているコマ差」と「実際の位置」が食い違っていないか見る。
 *
 * ⚠️ 端で切り詰められた場合は食い違いではない。主導 (Win A) + コマ差 を
 * 一覧の範囲へ収めた位置と比べること。
 * ⚠️ これは 2 画面連動の不具合を追うための要。黙って進めず、警告として残す。
 */
function logSyncMismatch(state: PaintStore): void {
  if (!state.syncMode || !state.isSplitView) return;

  const total = state.unifiedFileList.length;
  if (isSyncPairConsistent(state.currentFileIndex, state.splitFileIndex, state.syncFrameOffset, total)) return;

  const expected = Math.max(0, Math.min(Math.max(0, total - 1), state.currentFileIndex + state.syncFrameOffset));
  logDebug(
    'sync',
    `コマ差の食い違いを検出 (記録 ${formatOffset(state.syncFrameOffset)} / 実際 ${formatOffset(state.splitFileIndex - state.currentFileIndex)})`,
    `${describeAB(state)} — 本来 Win B は ${expected} のはず。「差を揃える」で直せます`,
    'warn'
  );
}

/**
 * フォルダを開いたときのログ。
 *
 * ⚠️ 数字を必ず入れること (枚数・統合コマ数・A と B の表示位置)。
 * 「連携がおかしい」の報告と突き合わせるとき、この 3 つが分かれば
 * 対応づけの食い違いか、位置の食い違いかをその場で切り分けられる。
 */
function logFolderOpened(
  state: PaintStore,
  view: 0 | 1,
  how: string,
  name: string,
  fileCount: number,
  unifiedCount: number,
  indexA: number,
  indexB: number
): void {
  logDebug(
    'folder',
    `${view === 1 ? 'Win B' : 'Win A'} ${how}: ${name || '(名前なし)'} (${fileCount} 枚)`,
    `統合 ${unifiedCount} コマ / 表示位置 Win A=${indexA} Win B=${indexB}`
  );

  // ⚠️ 連動中にフォルダを開き直す経路は、記録したコマ差と実際の位置が
  // 食い違いやすい。開いた直後の並びをここで必ず残す
  if (!state.syncMode || !state.isSplitView) return;
  const consistent = isSyncPairConsistent(indexA, indexB, state.syncFrameOffset, unifiedCount);
  const expected = Math.max(0, Math.min(Math.max(0, unifiedCount - 1), indexA + state.syncFrameOffset));
  logDebug(
    'sync',
    `連動は入ったまま (コマ差 ${formatOffset(state.syncFrameOffset)})`,
    `開き直したあとの位置 Win A=${indexA} / Win B=${indexB}${consistent ? '' : ` — 本来 Win B は ${expected} のはず`}`,
    consistent ? 'info' : 'warn'
  );
}

/**
 * 回す担当を人数分だけ立ち上げる。
 *
 * ⚠️ 1 枚ごとに立ち上げないこと。起動のたびにモジュールを読み直すので、
 * 枚数が増えるほどその分だけ損をする。人数分だけ作って使い回す。
 * ⚠️ フォルダのハンドルは構造化複製で渡せる (許可の状態も引き継ぐ)。
 * 画素を主スレッドへ運ばずに済むので、1 枚あたり数十 MB のコピーが消える。
 */
function makeRotateWorkers(count: number, dir: any, rootName: string | null): Worker[] {
  return Array.from({ length: count }, () => {
    const worker = new Worker(new URL('../../workers/rotate.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.postMessage({ type: 'init', dir, rootName });
    return worker;
  });
}

/** 担当 1 人に 1 枚頼んで、終わるまで待つ */
function askRotate(worker: Worker, id: number, path: string, direction: RotateDirection): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<RotateWorkerDone>) => {
      if (e.data.id !== id) return;
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      if (e.data.ok) resolve();
      else reject(new Error(e.data.error || '回せませんでした'));
    };
    const onError = (e: ErrorEvent) => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      reject(new Error(e.message || '回す担当が落ちました'));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    const job: RotateWorkerJob = { type: 'job', id, path, direction };
    worker.postMessage(job);
  });
}

/** 担当を立てられる環境か (立てられなければ主スレッドで回す) */
function canUseRotateWorkers(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

/**
 * 1 枚を回した中身を作る。
 *
 * ⚠️ TGA は自前の符号化を通すこと。キャンバスに載せると純白と透明の扱いが崩れる
 * (純白 RGB(255,255,255) = 透明という決まりがある)。
 * ⚠️ TGA 以外はキャンバスで回す。JPEG は保存し直しになるので、
 * 呼び出し側が確認の文面で必ず断ること。
 */
async function rotatedBytes(file: File, path: string, direction: RotateDirection): Promise<Blob> {
  if (/[.]tga$/i.test(path)) {
    const image = decodeTGA(await file.arrayBuffer());
    const turned = rotateImageData(image.data, image.width, image.height, direction);
    return new Blob([encodeTGA({ ...image, ...turned })]);
  }

  // ⚠️ 回しても解像度は引き継ぐこと (書き出し直すと 72dpi 相当へ落ちる)
  const density = /[.]jpe?g$/i.test(path) ? readJpegDensity(await file.arrayBuffer()) : null;

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.height;
  canvas.height = bitmap.width;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('キャンバスを用意できませんでした');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(direction === 'right' ? Math.PI / 2 : -Math.PI / 2);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();

  const type = encodeTypeFor(path);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type.mime, type.quality));
  if (!blob) throw new Error(`${type.mime} で書き出せませんでした`);
  if (type.mime !== 'image/jpeg' || !density) return blob;
  return new Blob([applyJpegDensity(await blob.arrayBuffer(), density)], { type: type.mime });
}

/**
 * ログに載せるファイルの並び。
 *
 * ⚠️ 全部は載せないこと。1 行が長くなると DEBUG ログが読めなくなる。
 * 先頭 5 件と残りの件数が分かれば、報告と突き合わせるには足りる。
 */
function describePaths(paths: string[]): string {
  const head = paths.slice(0, 5).map((p) => p.split(/[/\\]/).pop()).join(', ');
  return paths.length > 5 ? `${head} ほか ${paths.length - 5} 件` : head || '(なし)';
}

/** 「a0001.tga → b0001.tga」の並び */
function describePlan(plan: { path: string; to: string }[]): string {
  const head = plan.slice(0, 5).map((i) => `${i.path.split(/[/\\]/).pop()} → ${i.to}`).join(', ');
  return plan.length > 5 ? `${head} ほか ${plan.length - 5} 件` : head || '(なし)';
}

/**
 * 移したファイルを、読み込み済みの実体の一覧から外す。
 *
 * ⚠️ 新しいパスへ付け替えないこと。File は開いた時点の場所を指しているので、
 * 移動後に読むと失敗しうる。外しておけばフォルダハンドル経由で読み直される
 * (複製したファイルを一覧に入れないのと同じ考え方)。
 */
function dropMoved(fileMap: Map<string, File>, moved: { from: string }[]): Map<string, File> {
  const gone = new Set(moved.map((m) => m.from));
  const next = new Map<string, File>();
  fileMap.forEach((file, path) => {
    if (!gone.has(path)) next.set(path, file);
  });
  return next;
}

export const createFileSlice: StateCreator<PaintStore, [], [], FileSlice> = (set, get) => ({
  // 統合ファイルブラウザ (Dir A & Dir B 2フォルダ管理 ＆ カット階層ナビゲーション)
  rootFolderHandle: null,

  rootFolderName: null,

  availableSubDirectories: [],

  selectedSubDirA: null,

  selectedSubDirB: null,

  mergedFrameNumbers: [],

  mergedFrameMap: new Map(),

  /**
   * サブフォルダを持たないフォルダを Win A として開く。
   *
   * ⚠️ setCutRootFolder に流さないこと。あちらは A と B の両方を組み直すので、
   * サブフォルダが (Root) 1 つだけだと Win B が空になり、
   * 2 画面で開いて連動させる使い方ができなくなる。
   * ⚠️ かといって setFolderHandleA を呼ぶだけでも駄目で、前に開いたカットの
   * サブフォルダ一覧が残る。ドロップダウンに前のカットの _go / _ao が並び、
   * 選ぶとそちらのファイルへ飛んでしまう。ここで両方を面倒みる。
   */
  openPlainFolderAsA: (handle, name, files, filesMap) => {
    set({
      // 明示的にフォルダを開いた操作なので、隠していても Win A を出す
      isWinAVisible: true,
      // セルを開いた操作なので、↑ ↓ と Space の効き先もセルへ戻す
      activeSurface: 'cell',
      rootFolderHandle: handle,
      rootFolderName: name,
      availableSubDirectories: [],
      selectedSubDirA: null,
      selectedSubDirB: null,
    });
    // Win B の一覧・ハンドルには触れない
    get().setFolderHandleA(handle, name, files, filesMap);
    logDebug('folder', `フォルダを開いた (Win A): ${name} (${files.length} 枚)`, 'サブフォルダを持たないフォルダ / Win B はそのまま');
  },

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

      const currentFileIndex = firstIndexWithFile(frameNumbers, frameMap, 0);
      // 連動中はコマ差を保ったまま、そうでなければ Win A と同じコマから始める
      const splitFileIndex =
        linkedSplitIndex(get(), frameNumbers.length, currentFileIndex) ??
        alignedWithOther(frameNumbers, frameMap, 1, currentFileIndex);

      set({
        // 明示的にカットを開いた操作なので、隠していても Win A を出す
        isWinAVisible: true,
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
        // セルのフォルダを開いた操作。↑ ↓ と Space はセルのものへ戻す
        activeSurface: 'cell' as const,
        currentFileIndex,
        splitFileIndex,
      });

      logDebug(
        'folder',
        `カットを開いた: ${rootName} — Win A=${defaultDirA ? defaultDirA.name : '(なし)'} (${listA.length} 枚) / Win B=${defaultDirB ? defaultDirB.name : '(なし)'} (${listB.length} 枚)`,
        `サブフォルダ ${subDirs.map((d) => d.name).join(', ') || '(なし)'} / 統合 ${unifiedFiles.length} コマ / 表示位置 Win A=${currentFileIndex} Win B=${splitFileIndex}`
      );
    },

  setSelectedSubDirA: (dirName) =>
    set((state) => {
      const targetDir = state.availableSubDirectories.find((d) => d.name === dirName);
      const listA = targetDir ? targetDir.fileList : [];
      const mapA = targetDir ? targetDir.filesMap : new Map();

      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(listA, state.fileListB);

      const currentFileIndex = firstIndexWithFile(frameNumbers, frameMap, 0);
      const splitFileIndex =
        linkedSplitIndex(state, frameNumbers.length, currentFileIndex) ??
        keepFrameIndex(state.mergedFrameNumbers, state.splitFileIndex, frameNumbers, frameMap, 1);

      logFolderOpened(state, 0, 'のサブフォルダを切替', dirName || '', listA.length, unifiedFiles.length, currentFileIndex, splitFileIndex);
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
        // セルのフォルダを開いた操作。↑ ↓ と Space はセルのものへ戻す
        activeSurface: 'cell' as const,
        currentFileIndex,
        splitFileIndex,
      };
    }),

  setSelectedSubDirB: (dirName) =>
    set((state) => {
      const targetDir = state.availableSubDirectories.find((d) => d.name === dirName);
      const listB = targetDir ? targetDir.fileList : [];
      const mapB = targetDir ? targetDir.filesMap : new Map();

      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(state.fileListA, listB);

      const currentFileIndex = keepFrameIndex(
        state.mergedFrameNumbers,
        state.currentFileIndex,
        frameNumbers,
        frameMap,
        0
      );
      // 連動中は必ず「Win A + コマ差」へ引き直す。別々に決めると
      // 記録しているコマ差と実際のズレが食い違う
      const splitFileIndex =
        linkedSplitIndex(state, frameNumbers.length, currentFileIndex) ??
        alignedWithOther(frameNumbers, frameMap, 1, currentFileIndex);

      logFolderOpened(state, 1, 'のサブフォルダを切替', dirName || '', listB.length, unifiedFiles.length, currentFileIndex, splitFileIndex);
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
        // セルのフォルダを開いた操作。↑ ↓ と Space はセルのものへ戻す
        activeSurface: 'cell' as const,
        splitFileIndex,
        currentFileIndex,
      };
    }),

  setCustomDropFolderA: (folderName, mapA, listA) =>
    set((state) => {
      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(listA, state.fileListB);
      const currentFileIndex = firstIndexWithFile(frameNumbers, frameMap, 0);
      const splitFileIndex =
        linkedSplitIndex(state, frameNumbers.length, currentFileIndex) ??
        keepFrameIndex(state.mergedFrameNumbers, state.splitFileIndex, frameNumbers, frameMap, 1);

      logFolderOpened(state, 0, 'にドロップで開いた', folderName, listA.length, unifiedFiles.length, currentFileIndex, splitFileIndex);
      return {
        folderNameA: folderName,
        folderHandleA: null,
        fileMapA: mapA,
        fileListA: listA,
        unifiedFileList: unifiedFiles,
        fileList: unifiedFiles,
        mergedFrameNumbers: frameNumbers,
        mergedFrameMap: frameMap,
        // セルのフォルダを開いた操作。↑ ↓ と Space はセルのものへ戻す
        activeSurface: 'cell' as const,
        currentFileIndex,
        splitFileIndex,
      };
    }),

  setCustomDropFolderB: (folderName, mapB, listB) =>
    set((state) => {
      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(state.fileListA, listB);
      const currentFileIndex = keepFrameIndex(
        state.mergedFrameNumbers,
        state.currentFileIndex,
        frameNumbers,
        frameMap,
        0
      );
      // 連動中は必ず「Win A + コマ差」へ引き直す。別々に決めると
      // 記録しているコマ差と実際のズレが食い違う
      const splitFileIndex =
        linkedSplitIndex(state, frameNumbers.length, currentFileIndex) ??
        alignedWithOther(frameNumbers, frameMap, 1, currentFileIndex);

      logFolderOpened(state, 1, 'にドロップで開いた', folderName, listB.length, unifiedFiles.length, currentFileIndex, splitFileIndex);
      return {
        folderNameB: folderName,
        folderHandleB: null,
        fileMapB: mapB,
        fileListB: listB,
        unifiedFileList: unifiedFiles,
        fileList: unifiedFiles,
        mergedFrameNumbers: frameNumbers,
        mergedFrameMap: frameMap,
        // セルのフォルダを開いた操作。↑ ↓ と Space はセルのものへ戻す
        activeSurface: 'cell' as const,
        splitFileIndex,
        currentFileIndex,
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

  setFolderHandleA: (handle, name, files, filesMap) =>
    set((state) => {
      // ファイル名の単純和集合ではなく、連番でマージする。
      // A/B でファイル名が異なっても同じフレームとして対応付けられる。
      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(files, state.fileListB);
      const currentFileIndex = firstIndexWithFile(frameNumbers, frameMap, 0);
      const splitFileIndex =
        linkedSplitIndex(state, frameNumbers.length, currentFileIndex) ??
        keepFrameIndex(state.mergedFrameNumbers, state.splitFileIndex, frameNumbers, frameMap, 1);

      logFolderOpened(state, 0, 'のフォルダを開いた', name, files.length, unifiedFiles.length, currentFileIndex, splitFileIndex);
      return {
        folderHandleA: handle,
        // 前のフォルダの fileMap が残ると、読み込み時に古い実体が優先されてしまう
        fileMapA: filesMap ?? new Map(),
        folderNameA: name,
        fileListA: files,
        unifiedFileList: unifiedFiles,
        fileList: unifiedFiles,
        mergedFrameNumbers: frameNumbers,
        mergedFrameMap: frameMap,
        // セルのフォルダを開いた操作。↑ ↓ と Space はセルのものへ戻す
        activeSurface: 'cell' as const,
        currentFileIndex,
        splitFileIndex,
      };
    }),

  setFolderHandleB: (handle, name, files, filesMap) =>
    set((state) => {
      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(state.fileListA, files);
      const currentFileIndex = keepFrameIndex(
        state.mergedFrameNumbers,
        state.currentFileIndex,
        frameNumbers,
        frameMap,
        0
      );
      // 連動中は必ず「Win A + コマ差」へ引き直す。別々に決めると
      // 記録しているコマ差と実際のズレが食い違う
      const splitFileIndex =
        linkedSplitIndex(state, frameNumbers.length, currentFileIndex) ??
        alignedWithOther(frameNumbers, frameMap, 1, currentFileIndex);

      logFolderOpened(state, 1, 'のフォルダを開いた', name, files.length, unifiedFiles.length, currentFileIndex, splitFileIndex);
      return {
        folderHandleB: handle,
        // 前のフォルダの fileMap が残ると、読み込み時に古い実体が優先されてしまう
        fileMapB: filesMap ?? new Map(),
        folderNameB: name,
        fileListB: files,
        unifiedFileList: unifiedFiles,
        fileList: unifiedFiles,
        mergedFrameNumbers: frameNumbers,
        mergedFrameMap: frameMap,
        // セルのフォルダを開いた操作。↑ ↓ と Space はセルのものへ戻す
        activeSurface: 'cell' as const,
        currentFileIndex,
        splitFileIndex,
      };
    }),

  setFolderFilesA: (name, filesMap) =>
    set((state) => {
      const files = sortNatural(filesMap.keys());
      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(files, state.fileListB);
      const currentFileIndex = firstIndexWithFile(frameNumbers, frameMap, 0);
      const splitFileIndex =
        linkedSplitIndex(state, frameNumbers.length, currentFileIndex) ??
        keepFrameIndex(state.mergedFrameNumbers, state.splitFileIndex, frameNumbers, frameMap, 1);

      logFolderOpened(state, 0, 'の一覧を更新した', name, files.length, unifiedFiles.length, currentFileIndex, splitFileIndex);
      return {
        fileMapA: filesMap,
        folderNameA: name,
        fileListA: files,
        unifiedFileList: unifiedFiles,
        fileList: unifiedFiles,
        mergedFrameNumbers: frameNumbers,
        mergedFrameMap: frameMap,
        // セルのフォルダを開いた操作。↑ ↓ と Space はセルのものへ戻す
        activeSurface: 'cell' as const,
        currentFileIndex,
        splitFileIndex,
      };
    }),

  setFolderFilesB: (name, filesMap) =>
    set((state) => {
      const files = sortNatural(filesMap.keys());
      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(state.fileListA, files);
      const currentFileIndex = keepFrameIndex(
        state.mergedFrameNumbers,
        state.currentFileIndex,
        frameNumbers,
        frameMap,
        0
      );
      // 連動中は必ず「Win A + コマ差」へ引き直す。別々に決めると
      // 記録しているコマ差と実際のズレが食い違う
      const splitFileIndex =
        linkedSplitIndex(state, frameNumbers.length, currentFileIndex) ??
        alignedWithOther(frameNumbers, frameMap, 1, currentFileIndex);

      logFolderOpened(state, 1, 'の一覧を更新した', name, files.length, unifiedFiles.length, currentFileIndex, splitFileIndex);
      return {
        fileMapB: filesMap,
        folderNameB: name,
        fileListB: files,
        unifiedFileList: unifiedFiles,
        fileList: unifiedFiles,
        mergedFrameNumbers: frameNumbers,
        mergedFrameMap: frameMap,
        // セルのフォルダを開いた操作。↑ ↓ と Space はセルのものへ戻す
        activeSurface: 'cell' as const,
        currentFileIndex,
        splitFileIndex,
      };
    }),

  folderHandle: null,

  folderName: '',

  fileList: [],

  currentFileIndex: 0,

  setFolderHandle: (handle, name, files) =>
    set({ folderHandle: handle, folderName: name, fileList: files, currentFileIndex: 0, splitFileIndex: 0, historyStack: [], historyIndex: -1 }),

  setCurrentFileIndex: (index, source) => {
    const state = get();
    // ⚠️ 同じコマを選び直したときも、キーの効き先はセルへ戻すこと。
    // ここで返してしまうと「ツリーで選んだのに ↑ ↓ がロールのまま」になる
    if (index === state.currentFileIndex) {
      if (state.activeSurface !== 'cell') set({ activeSurface: 'cell' });
      return;
    }
    if (!state.confirmDiscardIfDirty(0)) return;

    const patch: Record<string, unknown> = {
      currentFileIndex: index,
      historyStack: [],
      historyIndex: -1,
      isDirtyA: false,
      // セルを選んだ時点で、↑ ↓ と Space はセルのものへ戻る
      activeSurface: 'cell',
    };

    // 連動中は、連動を開始した時点のコマ差を保ったまま Win B も追従させる
    if (state.syncMode && state.isSplitView) {
      const last = Math.max(0, state.unifiedFileList.length - 1);
      const target = Math.max(0, Math.min(last, index + state.syncFrameOffset));
      if (target !== state.splitFileIndex) {
        if (!state.confirmDiscardIfDirty(1)) return;
        patch.splitFileIndex = target;
        patch.splitHistoryStack = [];
        patch.splitHistoryIndex = -1;
        patch.isDirtyB = false;
      }
    }

    set(patch as any);

    // ⚠️ 再生の自動送りは毎コマ走るので記録しない
    if (source === PLAYBACK_SOURCE) return;

    const after = get();
    const linked = state.syncMode && state.isSplitView;
    logDebug(
      'cell',
      `Win A を選択: ${state.currentFileIndex} → ${index} (${nameAt(after, index, 0)})${source ? ` — ${source}` : ''}`,
      linked
        ? `連動 (コマ差 ${formatOffset(state.syncFrameOffset)}) で Win B ${state.splitFileIndex} → ${after.splitFileIndex} (${nameAt(after, after.splitFileIndex, 1)})`
        : `連動なし (Win B は ${after.splitFileIndex} のまま)`
    );
    logSyncMismatch(after);
  },

  /**
   * 移動対象のビューをすべて確認したうえでコマ送りする共通処理。
   *
   * ⚠️ 連動中に両方へ delta を足さないこと。片方が端 (先頭 / 末尾) で止まった時点で
   * コマ差が失われ、戻ってきたときに相手だけ 1 コマずれたまま進む。
   * 「Win B で先頭の 0001 だけ出てこない」という形で現れる (2026-08-29 の報告)。
   * 追従する側は必ず「主導する面 + コマ差」から決めること
   * (setCurrentFileIndex / setSplitFileIndex と同じ決め方)。
   * ⚠️ 主導する面が端で動けないときは、どちらも動かさない。相手だけ動かすと
   * やはりコマ差が変わる。
   */
  stepCell: (delta: number, source?: string) => {
    const state = get();
    const last = Math.max(0, state.unifiedFileList.length - 1);
    const clamp = (v: number) => Math.max(0, Math.min(last, v));

    const driver: 0 | 1 = state.isSplitView && state.activeViewIndex === 1 ? 1 : 0;
    const linked = state.syncMode && state.isSplitView;

    const driverIndex = driver === 1 ? state.splitFileIndex : state.currentFileIndex;

    /**
     * 相手のいないフォルダのコマ (paint 側だけにある _pool の撮影素材など) は、
     * コマ送りでは飛ばす (2026-08-31 のユーザー指定)。
     *
     * ⚠️ 今そこに居るときは 1 コマずつ普通に送ること。飛ばす規則をそのまま当てると、
     * ツリーから参照素材を開いたあと ↑ ↓ がどこへも行けなくなる。
     * ⚠️ 飛ばした先が端で、行き先がすべて対象なら動かさないこと。
     * 参照素材の上に着地させない。
     */
    const isSkippable = (index: number) => {
      const number = state.mergedFrameNumbers[index];
      return !!number && !!state.mergedFrameMap.get(number)?.unpairedFolder;
    };

    let nextDriver = clamp(driverIndex + delta);
    let skipped = 0;
    if (!isSkippable(driverIndex)) {
      while (nextDriver !== driverIndex && isSkippable(nextDriver)) {
        const further = clamp(nextDriver + delta);
        if (further === nextDriver) {
          nextDriver = driverIndex; // これ以上進めない。参照素材の上には止まらない
          break;
        }
        nextDriver = further;
        skipped += 1;
      }
    }

    if (nextDriver === driverIndex) {
      // ⚠️ 黙って返さないこと。「押しても動かない」ときに端なのか無反応なのか分からない
      logDebug(
        'cell',
        `コマ送り ${delta > 0 ? '↓ 次へ' : '↑ 前へ'}${source ? ` (${source})` : ''} — ` +
          `${skipped > 0 ? 'この先は相手のいないフォルダのコマだけなので動かさない' : '端なので動かさない'}`,
        `主導 ${driver === 1 ? 'Win B' : 'Win A'} が ${driverIndex} / 全 ${state.unifiedFileList.length} コマ` +
          `${skipped > 0 ? ` (この先は相手のいないフォルダのコマ ${skipped} 件だけ)` : ''}。${describeAB(state)}`
      );
      return;
    }

    // 連動中は両ビューが動くので、両方の未保存を確認する
    const views: (0 | 1)[] = linked ? [0, 1] : [driver];
    for (const view of views) {
      if (!state.confirmDiscardIfDirty(view)) return;
    }

    const patch: Partial<PaintStore> = {};
    const move = (view: 0 | 1, index: number) => {
      if (view === 0) {
        patch.currentFileIndex = index;
        patch.historyStack = [];
        patch.historyIndex = -1;
        patch.isDirtyA = false;
      } else {
        patch.splitFileIndex = index;
        patch.splitHistoryStack = [];
        patch.splitHistoryIndex = -1;
        patch.isDirtyB = false;
      }
    };

    move(driver, nextDriver);
    if (linked) {
      // syncFrameOffset は「B - A」。主導が A なら足し、B なら引く
      const follower = clamp(
        driver === 0 ? nextDriver + state.syncFrameOffset : nextDriver - state.syncFrameOffset
      );
      move(driver === 0 ? 1 : 0, follower);
    }

    set(patch as any);

    const after = get();
    logDebug(
      'cell',
      `コマ送り ${delta > 0 ? '↓ 次へ' : '↑ 前へ'}${source ? ` (${source})` : ''} — 主導 ${driver === 1 ? 'Win B' : 'Win A'}` +
        `${linked ? ` / 連動 コマ差 ${formatOffset(state.syncFrameOffset)}` : ' / 連動なし'}`,
      `Win A ${state.currentFileIndex} → ${after.currentFileIndex} (${nameAt(after, after.currentFileIndex, 0)}) / ` +
        `Win B ${state.splitFileIndex} → ${after.splitFileIndex} (${nameAt(after, after.splitFileIndex, 1)})` +
        `${skipped > 0 ? ` / 相手のいないフォルダのコマを ${skipped} 件飛ばした` : ''}`
    );
    logSyncMismatch(after);
  },

  nextCell: (source) => get().stepCell(1, source),

  prevCell: (source) => get().stepCell(-1, source),

  /**
   * 統合リスト上のインデックスから、A側 / B側それぞれの実ファイル名を引く。
   * A と B でファイル名が異なる連番 (異名連番) でも正しい方の名前を返す。
   */
  indexOfFileForView: (path, view) => {
    const { mergedFrameNumbers, mergedFrameMap, unifiedFileList } = get();

    for (let i = 0; i < mergedFrameNumbers.length; i++) {
      const item = mergedFrameMap.get(mergedFrameNumbers[i]);
      if (!item) continue;
      if ((view === 1 ? item.fileNameB : item.fileNameA) === path) return i;
    }

    // マージ情報が無い読み込み経路向けのフォールバック
    return unifiedFileList.indexOf(path);
  },

  resolveFileNameForView: (index, view) => {
    const { mergedFrameNumbers, mergedFrameMap, unifiedFileList, fileListA, fileListB } = get();

    const frameNumber = mergedFrameNumbers[index];
    if (frameNumber) {
      const item = mergedFrameMap.get(frameNumber);
      if (item) {
        const name = view === 1 ? item.fileNameB : item.fileNameA;
        if (name) return name;
        // マージマップに該当側の登録が無い場合はこのフレームに実体が無い
        return null;
      }
    }

    // マージ情報が無い (単独フォルダ運用など) 場合のフォールバック
    const fallback = unifiedFileList[index];
    if (!fallback) return null;
    const list = view === 1 ? fileListB : fileListA;
    if (list.length === 0 || list.includes(fallback)) return fallback;
    return null;
  },

  /**
   * ファイル名を変更する。
   *
   * ⚠️ 制作データを直接書き換えるので、衝突や不正な名前があれば
   * 1 件も書き換えずに中止する (部分的に適用された状態を作らない)。
   * 番号をずらすだけのリネームは名前が入れ替わるため、
   * 一時名を経由する 2 段階で実行する。
   */
  renameFiles: async (view, rawPlan) => {
    const state = get();
    const folderHandle = view === 1 ? state.folderHandleB : state.folderHandleA;
    const fileList = view === 1 ? state.fileListB : state.fileListA;
    const fileMap = view === 1 ? state.fileMapB : state.fileMapA;
    const label = view === 1 ? 'Win B (右画面)' : 'Win A (左画面)';

    const plan = omitUnchanged(rawPlan);

    // ⚠️ ファイルを触る操作は、断った場合も含めて必ず記録すること。
    // 「操作したのに何も起きない」の報告を、権限・名前・衝突のどれか切り分けられるように
    logDebug('file', `名前を変更: 要求 ${plan.length} 件`, `${label} — ${describePlan(plan)}`);

    if (plan.length === 0) {
      return { ok: true, message: '名前が変わるファイルはありませんでした。', renamed: 0 };
    }

    if (!folderHandle) {
      logDebug('file', '名前を変更: 中止 (書き込めるフォルダとして開かれていない)', label, 'warn');
      return {
        ok: false,
        message:
          `${label} は書き込み可能なフォルダとして開かれていません。\n` +
          `「ファイル > フォルダを開く」から開き直してください。`,
        renamed: 0,
      };
    }

    const invalid = findInvalidNames(plan);
    if (invalid.length > 0) {
      logDebug(
        'file',
        `名前を変更: 中止 (使えない名前 ${invalid.length} 件)`,
        invalid.slice(0, 5).map((i) => `${i.from} → ${i.to}`).join(' / '),
        'warn'
      );
      return {
        ok: false,
        message:
          `ファイル名として使えない名前が ${invalid.length} 件あります。\n` +
          invalid.slice(0, 5).map((i) => `・${i.from} → ${i.to}`).join('\n'),
        renamed: 0,
      };
    }

    const conflicts = findRenameConflicts(plan, fileList);
    if (conflicts.length > 0) {
      const dup = conflicts.filter((c) => c.reason === 'duplicate').map((c) => c.to);
      const exists = conflicts.filter((c) => c.reason === 'exists').map((c) => c.to);
      logDebug(
        'file',
        `名前を変更: 中止 (名前の衝突 ${conflicts.length} 件)`,
        `${dup.length ? `重複 ${dup.slice(0, 5).join(', ')} ` : ''}${exists.length ? `既存と同名 ${exists.slice(0, 5).join(', ')}` : ''}`,
        'warn'
      );
      return {
        ok: false,
        message:
          '名前が衝突するため中止しました。ファイルは 1 件も変更していません。\n' +
          (dup.length ? `\n同じ名前が複数できます: ${dup.slice(0, 5).join(', ')}` : '') +
          (exists.length ? `\n既にあるファイルと同名です: ${exists.slice(0, 5).join(', ')}` : ''),
        renamed: 0,
      };
    }

    const access = await requestWriteAccess(folderHandle);
    if (!access.ok) {
      logDebug('file', '名前を変更: 中止 (書き込みが許可されなかった)', `${label} — ${access.reason}`, 'warn');
      return { ok: false, message: `${label} のフォルダへ書き込めません。\n${access.reason}`, renamed: 0 };
    }

    const rootName = state.rootFolderName;
    const twoPhase = needsTwoPhaseRename(plan);
    logDebug(
      'file',
      `名前を変更: 実行 ${plan.length} 件`,
      twoPhase ? '名前が入れ替わるので一時名を経由' : '一括で変更'
    );
    const stamp = Date.now().toString(36);

    try {
      if (twoPhase) {
        // 名前が入れ替わるので、一度すべて一時名へ逃がしてから本来の名前にする
        const temps = plan.map((item, i) => ({ item, temp: `__kf_rename_${stamp}_${i}__${item.to}` }));
        for (const { item, temp } of temps) {
          await renameFile(folderHandle, item.path, temp, rootName);
        }
        for (const { item, temp } of temps) {
          await renameFile(folderHandle, replaceBaseName(item.path, temp), item.to, rootName);
        }
      } else {
        for (const item of plan) {
          await renameFile(folderHandle, item.path, item.to, rootName);
        }
      }
    } catch (err: any) {
      console.error('Failed to rename:', err);
      logDebug('file', '名前を変更: 途中で失敗', String(err?.message || err), 'warn');
      return {
        ok: false,
        message:
          `リネームの途中で失敗しました: ${err?.message || err}\n` +
          `フォルダを開き直して状態を確認してください。`,
        renamed: 0,
      };
    }

    // --- ストア側の一覧を新しい名前へ差し替える ---
    const renamedPath = new Map(plan.map((item) => [item.path, replaceBaseName(item.path, item.to)]));

    const nextList = sortNatural(fileList.map((p) => renamedPath.get(p) ?? p));
    const nextMap = new Map<string, File>();
    fileMap.forEach((file, p) => nextMap.set(renamedPath.get(p) ?? p, file));

    // 名前が変わったコマはキャッシュを捨てる (古い名前のキーが残るため)
    plan.forEach((item) => {
      state.invalidateCachedImage(state.getImageCacheKey(view, item.path));
    });

    if (view === 1) get().setFolderHandleB(folderHandle, state.folderNameB, nextList, nextMap);
    else get().setFolderHandleA(folderHandle, state.folderNameA, nextList, nextMap);

    logDebug('file', `名前を変更: 完了 ${plan.length} 件`, describePlan(plan));
    return {
      ok: true,
      message: `${plan.length} 件のファイル名を変更しました。`,
      renamed: plan.length,
    };
  },

  /**
   * 選択したファイルを同じフォルダへ複製する。
   * 名前は _copy / _copy2 … と衝突しないところまで伸ばす。
   */
  duplicateFiles: async (view, paths) => {
    const state = get();
    const folderHandle = view === 1 ? state.folderHandleB : state.folderHandleA;
    const fileList = view === 1 ? state.fileListB : state.fileListA;
    const fileMap = view === 1 ? state.fileMapB : state.fileMapA;
    const label = view === 1 ? 'Win B (右画面)' : 'Win A (左画面)';

    logDebug('file', `複製: 要求 ${paths.length} 件`, `${label} — ${describePaths(paths)}`);

    if (paths.length === 0) return { ok: true, message: '対象がありません。', renamed: 0 };
    if (!folderHandle) {
      logDebug('file', '複製: 中止 (書き込めるフォルダとして開かれていない)', label, 'warn');
      return { ok: false, message: `${label} は書き込み可能なフォルダとして開かれていません。`, renamed: 0 };
    }
    const access = await requestWriteAccess(folderHandle);
    if (!access.ok) {
      logDebug('file', '複製: 中止 (書き込みが許可されなかった)', `${label} — ${access.reason}`, 'warn');
      return { ok: false, message: `${label} のフォルダへ書き込めません。\n${access.reason}`, renamed: 0 };
    }

    const plan = buildDuplicatePlan(paths, fileList);
    const created: string[] = [];

    try {
      for (const item of plan) {
        await copyFile(folderHandle, item.path, item.to, state.rootFolderName);
        created.push(replaceBaseName(item.path, item.to));
      }
    } catch (err: any) {
      console.error('Failed to duplicate:', err);
      logDebug('file', '複製: 途中で失敗', `${created.length} 件は作成済み / ${err?.message || err}`, 'warn');
      return {
        ok: false,
        message: `複製の途中で失敗しました: ${err?.message || err}` + '\n' + `${created.length} 件は作成済みです。`,
        renamed: created.length,
      };
    }

    const nextList = sortNatural([...fileList, ...created]);
    const nextMap = new Map(fileMap);
    // 複製したファイルの実体はまだ読んでいないので、ハンドル経由で読ませる

    if (view === 1) get().setFolderHandleB(folderHandle, state.folderNameB, nextList, nextMap);
    else get().setFolderHandleA(folderHandle, state.folderNameA, nextList, nextMap);

    logDebug('file', `複製: 完了 ${created.length} 件`, describePaths(created));
    return { ok: true, message: `${created.length} 件を複製しました。`, renamed: created.length };
  },

  /**
   * 選択したファイルを削除する。
   * ⚠️ 元に戻せないので、呼び出し側で必ず確認を取ること。
   */
  deleteFiles: async (view, paths) => {
    const state = get();
    const folderHandle = view === 1 ? state.folderHandleB : state.folderHandleA;
    const fileList = view === 1 ? state.fileListB : state.fileListA;
    const fileMap = view === 1 ? state.fileMapB : state.fileMapA;
    const label = view === 1 ? 'Win B (右画面)' : 'Win A (左画面)';

    // ⚠️ 削除は元に戻せない。何を消したのかを必ず残すこと
    logDebug('file', `削除: 要求 ${paths.length} 件`, `${label} — ${describePaths(paths)}`, 'warn');

    if (paths.length === 0) return { ok: true, message: '対象がありません。', renamed: 0 };
    if (!folderHandle) {
      logDebug('file', '削除: 中止 (書き込めるフォルダとして開かれていない)', label, 'warn');
      return { ok: false, message: `${label} は書き込み可能なフォルダとして開かれていません。`, renamed: 0 };
    }
    const access = await requestWriteAccess(folderHandle);
    if (!access.ok) {
      logDebug('file', '削除: 中止 (書き込みが許可されなかった)', `${label} — ${access.reason}`, 'warn');
      return { ok: false, message: `${label} のフォルダへ書き込めません。\n${access.reason}`, renamed: 0 };
    }

    const removed: string[] = [];
    try {
      for (const path of paths) {
        await deleteFile(folderHandle, path, state.rootFolderName);
        removed.push(path);
      }
    } catch (err: any) {
      console.error('Failed to delete:', err);
      logDebug('file', '削除: 途中で失敗', `${removed.length} 件は削除済み / ${err?.message || err}`, 'warn');
      return {
        ok: false,
        message: `削除の途中で失敗しました: ${err?.message || err}` + '\n' + `${removed.length} 件は削除済みです。`,
        renamed: removed.length,
      };
    }

    const gone = new Set(removed);
    const nextList = fileList.filter((p) => !gone.has(p));
    const nextMap = new Map<string, File>();
    fileMap.forEach((file, p) => { if (!gone.has(p)) nextMap.set(p, file); });

    removed.forEach((p) => state.invalidateCachedImage(state.getImageCacheKey(view, p)));

    if (view === 1) get().setFolderHandleB(folderHandle, state.folderNameB, nextList, nextMap);
    else get().setFolderHandleA(folderHandle, state.folderNameA, nextList, nextMap);

    logDebug('file', `削除: 完了 ${removed.length} 件`, describePaths(removed), 'warn');
    return { ok: true, message: `${removed.length} 件を削除しました。`, renamed: removed.length };
  },

  /**
   * 選択したファイルを 90 度回して上書きする。
   *
   * ⚠️ 元のファイルを書き換える。呼び出し側で必ず確認を取ること。
   * ⚠️ 途中で失敗しても、そこまでに回した分は一覧と実体を揃えること。
   * 画面と中身が食い違ったまま作業を続けられる方が危ない。
   */
  rotateFiles: async (view, paths, direction) => {
    const state = get();
    const folderHandle = view === 1 ? state.folderHandleB : state.folderHandleA;
    const label = view === 1 ? 'Win B (右画面)' : 'Win A (左画面)';
    const turn = rotateLabel(direction);

    logDebug('file', `回転 (${turn}): 要求 ${paths.length} 件`, `${label} — ${describePaths(paths)}`);

    if (paths.length === 0) return { ok: true, message: '対象がありません。', renamed: 0 };
    if (!folderHandle) {
      logDebug('file', `回転 (${turn}): 中止 (書き込めるフォルダとして開かれていない)`, label, 'warn');
      return { ok: false, message: `${label} は書き込み可能なフォルダとして開かれていません。`, renamed: 0 };
    }

    const access = await requestWriteAccess(folderHandle);
    if (!access.ok) {
      logDebug('file', `回転 (${turn}): 中止 (書き込みが許可されなかった)`, `${label} — ${access.reason}`, 'warn');
      return { ok: false, message: `${label} のフォルダへ書き込めません。\n${access.reason}`, renamed: 0 };
    }

    /**
     * ⚠️ 1 枚ずつ順番に回さないこと。読み込み・変換・書き出しの待ちがそのまま
     * 積み上がり、42 枚のスキャンで十数秒かかる。空いた手から次を取らせる。
     * ⚠️ 主スレッドで回さないこと。大きな画像の符号化は画面を丸ごと止める。
     */
    const useWorkers = canUseRotateWorkers();
    const lanes = laneCount(paths.length, navigator.hardwareConcurrency);
    const startedAt = Date.now();

    logDebug(
      'file',
      `回転 (${turn}): 実行 ${paths.length} 件`,
      `${label} — ${useWorkers ? `${lanes} 本で並行` : '主スレッドで順に (担当を立てられない環境)'}`
    );

    const workers = useWorkers ? makeRotateWorkers(lanes, folderHandle, state.rootFolderName) : [];
    let jobId = 0;

    let outcomes;
    try {
      outcomes = await runInLanes(paths, lanes, async (path, _index, lane) => {
        if (useWorkers) {
          jobId += 1;
          await askRotate(workers[lane], jobId, path, direction);
          return path;
        }

        // 担当を立てられない環境向けの控え (主スレッドで回す)
        const handle = await resolveFileHandle(folderHandle, path, state.rootFolderName);
        const file: File = await handle.getFile();
        const blob = await rotatedBytes(file, path, direction);
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return path;
      });
    } finally {
      // ⚠️ 必ず片づけること。残すと 1 回まわすたびに担当が増えていく
      workers.forEach((w) => w.terminate());
    }

    const turned = outcomes.filter((o) => !o.error).map((o) => paths[o.index]);
    const skipped = outcomes.filter((o) => o.error).map((o) => `${paths[o.index]} (${o.error})`);

    get().refreshAfterRotate(view, turned);

    const elapsed = Date.now() - startedAt;
    const each = turned.length > 0 ? Math.round(elapsed / turned.length) : 0;
    const detail = skipped.length > 0 ? `\n\n見送り ${skipped.length} 件:\n${skipped.slice(0, 5).join('\n')}` : '';

    logDebug(
      'file',
      `回転 (${turn}): 完了 ${turned.length} 件 / 見送り ${skipped.length} 件`,
      `${(elapsed / 1000).toFixed(1)} 秒 (1 枚あたり ${each}ms / ${useWorkers ? `${lanes} 本` : '順に'}) — ${describePaths(turned)}`,
      skipped.length > 0 ? 'warn' : 'info'
    );

    return {
      ok: skipped.length === 0,
      message: `${turned.length} 件を${turn}回しました (${(elapsed / 1000).toFixed(1)} 秒)。${detail}`,
      renamed: turned.length,
    };
  },

  /**
   * 回したあとの読み直し。
   *
   * ⚠️ 名前は変わらないので一覧はそのまま。ただし読み込み済みの実体と
   * 画像のキャッシュは古いままなので、必ず捨てること。捨てないと
   * 回した結果が画面に出ず「効いていない」ように見える。
   */
  refreshAfterRotate: (view, paths) => {
    if (paths.length === 0) return;
    const state = get();
    const folderHandle = view === 1 ? state.folderHandleB : state.folderHandleA;
    const fileList = view === 1 ? state.fileListB : state.fileListA;
    const fileMap = view === 1 ? state.fileMapB : state.fileMapA;

    paths.forEach((p) => state.invalidateCachedImage(state.getImageCacheKey(view, p)));
    const nextMap = dropMoved(fileMap, paths.map((from) => ({ from })));

    if (view === 1) get().setFolderHandleB(folderHandle, state.folderNameB, fileList, nextMap);
    else get().setFolderHandleA(folderHandle, state.folderNameA, fileList, nextMap);
  },

  /**
   * 控え (_orig) から元のファイルへ戻す。
   *
   * ⚠️ 焼き込みは元に戻せない。控えを残していた場合の唯一の救済手段なので、
   * 誤検出で壊れたコマをここから戻せるようにしておく。
   * ⚠️ 戻したあとも控えは消さないこと。もう一度戻したくなることがある。
   */
  restoreFromBackup: async (view, paths) => {
    const state = get();
    const folderHandle = view === 1 ? state.folderHandleB : state.folderHandleA;
    const label = view === 1 ? 'Win B (右画面)' : 'Win A (左画面)';

    logDebug('file', `控えから戻す: 要求 ${paths.length} 件`, `${label} — ${describePaths(paths)}`, 'warn');

    if (paths.length === 0) return { ok: true, message: '対象がありません。', renamed: 0 };
    if (!folderHandle) {
      logDebug('file', '控えから戻す: 中止 (書き込めるフォルダとして開かれていない)', label, 'warn');
      return { ok: false, message: `${label} は書き込み可能なフォルダとして開かれていません。`, renamed: 0 };
    }

    const access = await requestWriteAccess(folderHandle);
    if (!access.ok) {
      logDebug('file', '控えから戻す: 中止 (書き込みが許可されなかった)', `${label} — ${access.reason}`, 'warn');
      return { ok: false, message: `${label} のフォルダへ書き込めません。\n${access.reason}`, renamed: 0 };
    }

    const restored: string[] = [];
    const missing: string[] = [];

    for (const path of paths) {
      // ⚠️ 控えそのものを選んでいた場合は触らない (自分で自分を上書きしてしまう)
      if (/_orig[.][^.]+$/i.test(path)) continue;

      try {
        const backup = await resolveFileHandle(folderHandle, backupPathFor(path), state.rootFolderName);
        const body = await (await backup.getFile()).arrayBuffer();
        const target = await resolveFileHandle(folderHandle, path, state.rootFolderName);
        const writable = await target.createWritable();
        await writable.write(body);
        await writable.close();
        restored.push(path);
        state.invalidateCachedImage(state.getImageCacheKey(view, path));
      } catch {
        missing.push(path);
      }
    }

    if (restored.length > 0) get().refreshAfterRotate(view, restored);

    const detail = missing.length > 0 ? `\n\n控えが無い ${missing.length} 件:\n${describePaths(missing)}` : '';
    logDebug(
      'file',
      `控えから戻す: 完了 ${restored.length} 件 / 控えが無い ${missing.length} 件`,
      describePaths(restored),
      missing.length > 0 ? 'warn' : 'info'
    );
    return {
      ok: restored.length > 0,
      message:
        restored.length > 0
          ? `${restored.length} 件を控え (_orig) から戻しました。${detail}`
          : `控え (_orig) が見つかりませんでした。${detail}`,
      renamed: restored.length,
    };
  },

  /**
   * 書き込み許可を先に取る。
   *
   * ⚠️ 名前を尋ねる prompt や確認の confirm を挟む操作は、押された時点でここを通すこと。
   * requestPermission() が通るのはボタンを押した直後の数秒だけで、入力しているあいだに
   * 期限が切れる。切れた状態で呼ぶと例外になり、画面にもログにも何も出ないまま操作が消える
   * (2026-09-02 の報告: 「まとめる: 要求 42 件」の次が 1 行も無い)。
   */
  ensureWriteAccess: async (view) => {
    const state = get();
    const folderHandle = view === 1 ? state.folderHandleB : state.folderHandleA;
    const label = view === 1 ? 'Win B (右画面)' : 'Win A (左画面)';

    if (!folderHandle) {
      logDebug('file', '書き込み許可: 中止 (書き込めるフォルダとして開かれていない)', label, 'warn');
      return { ok: false, message: `${label} は書き込み可能なフォルダとして開かれていません。` };
    }

    const access = await requestWriteAccess(folderHandle);
    if (!access.ok) {
      logDebug('file', '書き込み許可: 下りなかった', `${label} — ${access.reason}`, 'warn');
      return { ok: false, message: `${label} のフォルダへ書き込めません。\n${access.reason}` };
    }

    logDebug('file', `書き込み許可: あり${access.asked ? ' (この操作で許可された)' : ''}`, label);
    return { ok: true, message: '' };
  },

  /**
   * 選択したファイルを、新しく作ったフォルダへまとめて移す。
   *
   * ⚠️ 動かす前に計画を立て、上書きになる組み合わせがあれば 1 件も触らずに中止する
   * (move() は移動先の同名ファイルを黙って上書きする)。
   */
  moveFilesToNewFolder: async (view, paths, folderName) => {
    const state = get();
    const folderHandle = view === 1 ? state.folderHandleB : state.folderHandleA;
    const fileList = view === 1 ? state.fileListB : state.fileListA;
    const fileMap = view === 1 ? state.fileMapB : state.fileMapA;
    const label = view === 1 ? 'Win B (右画面)' : 'Win A (左画面)';

    // ⚠️ 何を求められたかは、断る場合も含めて必ず残す。
    // 「まとめられなかった」の報告を、権限・名前・衝突のどれか切り分けられるように
    logDebug('file', `新しいフォルダにまとめる: 要求 ${paths.length} 件 → 「${folderName}」`, label);

    if (paths.length === 0) return { ok: true, message: '対象がありません。', renamed: 0 };
    if (!folderHandle) {
      logDebug('file', '新しいフォルダにまとめる: 中止 (書き込めるフォルダとして開かれていない)', label, 'warn');
      return { ok: false, message: `${label} は書き込み可能なフォルダとして開かれていません。`, renamed: 0 };
    }
    const access = await requestWriteAccess(folderHandle);
    if (!access.ok) {
      logDebug('file', '新しいフォルダにまとめる: 中止 (書き込みが許可されなかった)', `${label} — ${access.reason}`, 'warn');
      return { ok: false, message: `${label} のフォルダへ書き込めません。\n${access.reason}`, renamed: 0 };
    }

    const plan = buildMoveToFolderPlan(paths, folderName, fileList);
    if (plan.problems.length > 0) {
      logDebug('file', `新しいフォルダにまとめる: 中止 (${plan.problems.length} 件の問題)`, plan.problems.join(' / '), 'warn');
      return { ok: false, message: `まとめられません:\n${plan.problems.join('\n')}`, renamed: 0 };
    }

    logDebug('file', `新しいフォルダにまとめる: 移動を開始 ${plan.items.length} 件 → ${plan.folderPath}`, label);

    const moved: { from: string; to: string }[] = [];
    try {
      for (const item of plan.items) {
        await moveFileToDirectory(folderHandle, item.from, plan.folderPath, state.rootFolderName);
        moved.push(item);
      }
    } catch (err: any) {
      console.error('Failed to move into folder:', err);
      logDebug('file', '新しいフォルダにまとめる: 途中で失敗', `${moved.length} 件は移動済み / ${err?.message || err}`, 'warn');
      // ⚠️ 途中で止まっても、移動済みの分は一覧に反映する。実体と表示がずれたままにしない
      if (moved.length > 0) {
        const partial = sortNatural(applyMoveToList(fileList, moved));
        const partialMap = dropMoved(fileMap, moved);
        moved.forEach((m) => state.invalidateCachedImage(state.getImageCacheKey(view, m.from)));
        if (view === 1) get().setFolderHandleB(folderHandle, state.folderNameB, partial, partialMap);
        else get().setFolderHandleA(folderHandle, state.folderNameA, partial, partialMap);
      }
      return {
        ok: false,
        message: `移動の途中で失敗しました: ${err?.message || err}\n${moved.length} 件は移動済みです。`,
        renamed: moved.length,
      };
    }

    const nextList = sortNatural(applyMoveToList(fileList, moved));
    const nextMap = dropMoved(fileMap, moved);

    // 画像キャッシュはパスで引いているので、移した分は捨てる
    moved.forEach((m) => state.invalidateCachedImage(state.getImageCacheKey(view, m.from)));

    if (view === 1) get().setFolderHandleB(folderHandle, state.folderNameB, nextList, nextMap);
    else get().setFolderHandleA(folderHandle, state.folderNameA, nextList, nextMap);

    logDebug('file', `新しいフォルダにまとめる: 完了 ${moved.length} 件`, plan.folderPath);
    return { ok: true, message: `${moved.length} 件を「${plan.folderPath}」にまとめました。`, renamed: moved.length };
  },
});
