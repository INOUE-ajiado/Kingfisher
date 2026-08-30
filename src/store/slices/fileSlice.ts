/**
 * カットフォルダ階層・A/B フォルダ・連番ナビゲーション
 */

import { StateCreator } from 'zustand';
import { renameFile, copyFile, deleteFile, ensureWritePermission } from '../../engine/fileSystemPath';
import { sortNatural } from '../../engine/naturalOrder';
import {
  buildDuplicatePlan,
  findInvalidNames,
  findRenameConflicts,
  needsTwoPhaseRename,
  omitUnchanged,
  replaceBaseName,
} from '../../engine/renamePlan';
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
    const nextDriver = clamp(driverIndex + delta);
    if (nextDriver === driverIndex) {
      // ⚠️ 黙って返さないこと。「押しても動かない」ときに端なのか無反応なのか分からない
      logDebug(
        'cell',
        `コマ送り ${delta > 0 ? '↓ 次へ' : '↑ 前へ'}${source ? ` (${source})` : ''} — 端なので動かさない`,
        `主導 ${driver === 1 ? 'Win B' : 'Win A'} が ${driverIndex} / 全 ${state.unifiedFileList.length} コマ。${describeAB(state)}`
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
        `Win B ${state.splitFileIndex} → ${after.splitFileIndex} (${nameAt(after, after.splitFileIndex, 1)})`
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
    if (plan.length === 0) {
      return { ok: true, message: '名前が変わるファイルはありませんでした。', renamed: 0 };
    }

    if (!folderHandle) {
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
      return {
        ok: false,
        message:
          '名前が衝突するため中止しました。ファイルは 1 件も変更していません。\n' +
          (dup.length ? `\n同じ名前が複数できます: ${dup.slice(0, 5).join(', ')}` : '') +
          (exists.length ? `\n既にあるファイルと同名です: ${exists.slice(0, 5).join(', ')}` : ''),
        renamed: 0,
      };
    }

    if (!(await ensureWritePermission(folderHandle))) {
      return { ok: false, message: `${label} のフォルダへの書き込みが許可されませんでした。`, renamed: 0 };
    }

    const rootName = state.rootFolderName;
    const twoPhase = needsTwoPhaseRename(plan);
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

    if (paths.length === 0) return { ok: true, message: '対象がありません。', renamed: 0 };
    if (!folderHandle) {
      return { ok: false, message: `${label} は書き込み可能なフォルダとして開かれていません。`, renamed: 0 };
    }
    if (!(await ensureWritePermission(folderHandle))) {
      return { ok: false, message: `${label} のフォルダへの書き込みが許可されませんでした。`, renamed: 0 };
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

    if (paths.length === 0) return { ok: true, message: '対象がありません。', renamed: 0 };
    if (!folderHandle) {
      return { ok: false, message: `${label} は書き込み可能なフォルダとして開かれていません。`, renamed: 0 };
    }
    if (!(await ensureWritePermission(folderHandle))) {
      return { ok: false, message: `${label} のフォルダへの書き込みが許可されませんでした。`, renamed: 0 };
    }

    const removed: string[] = [];
    try {
      for (const path of paths) {
        await deleteFile(folderHandle, path, state.rootFolderName);
        removed.push(path);
      }
    } catch (err: any) {
      console.error('Failed to delete:', err);
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

    return { ok: true, message: `${removed.length} 件を削除しました。`, renamed: removed.length };
  },
});
