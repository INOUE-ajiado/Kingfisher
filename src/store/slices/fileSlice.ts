/**
 * カットフォルダ階層・A/B フォルダ・連番ナビゲーション
 */

import { StateCreator } from 'zustand';
import { PaintStore, FileSlice, SubDirectoryItem, buildMergedFrameData } from '../types';

export const createFileSlice: StateCreator<PaintStore, [], [], FileSlice> = (set, get) => ({
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

  setCustomDropFolderA: (folderName, mapA, listA) =>
    set((state) => {
      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(listA, state.fileListB);
      return {
        folderNameA: folderName,
        folderHandleA: null,
        fileMapA: mapA,
        fileListA: listA,
        unifiedFileList: unifiedFiles,
        fileList: unifiedFiles,
        mergedFrameNumbers: frameNumbers,
        mergedFrameMap: frameMap,
        currentFileIndex: 0,
      };
    }),

  setCustomDropFolderB: (folderName, mapB, listB) =>
    set((state) => {
      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(state.fileListA, listB);
      return {
        folderNameB: folderName,
        folderHandleB: null,
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
      // ファイル名の単純和集合ではなく、連番でマージする。
      // A/B でファイル名が異なっても同じフレームとして対応付けられる。
      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(files, state.fileListB);
      return {
        folderHandleA: handle,
        folderNameA: name,
        fileListA: files,
        unifiedFileList: unifiedFiles,
        fileList: unifiedFiles,
        mergedFrameNumbers: frameNumbers,
        mergedFrameMap: frameMap,
        currentFileIndex: 0,
        splitFileIndex: 0,
      };
    }),

  setFolderHandleB: (handle, name, files) =>
    set((state) => {
      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(state.fileListA, files);
      return {
        folderHandleB: handle,
        folderNameB: name,
        fileListB: files,
        unifiedFileList: unifiedFiles,
        fileList: unifiedFiles,
        mergedFrameNumbers: frameNumbers,
        mergedFrameMap: frameMap,
        currentFileIndex: 0,
        splitFileIndex: 0,
      };
    }),

  setFolderFilesA: (name, filesMap) =>
    set((state) => {
      const files = Array.from(filesMap.keys()).sort();
      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(files, state.fileListB);
      return {
        fileMapA: filesMap,
        folderNameA: name,
        fileListA: files,
        unifiedFileList: unifiedFiles,
        fileList: unifiedFiles,
        mergedFrameNumbers: frameNumbers,
        mergedFrameMap: frameMap,
        currentFileIndex: 0,
        splitFileIndex: 0,
      };
    }),

  setFolderFilesB: (name, filesMap) =>
    set((state) => {
      const files = Array.from(filesMap.keys()).sort();
      const { frameNumbers, frameMap, unifiedFiles } = buildMergedFrameData(state.fileListA, files);
      return {
        fileMapB: filesMap,
        folderNameB: name,
        fileListB: files,
        unifiedFileList: unifiedFiles,
        fileList: unifiedFiles,
        mergedFrameNumbers: frameNumbers,
        mergedFrameMap: frameMap,
        currentFileIndex: 0,
        splitFileIndex: 0,
      };
    }),

  folderHandle: null,

  folderName: '',

  fileList: [],

  currentFileIndex: 0,

  setFolderHandle: (handle, name, files) =>
    set({ folderHandle: handle, folderName: name, fileList: files, currentFileIndex: 0, splitFileIndex: 0, historyStack: [], historyIndex: -1 }),

  setCurrentFileIndex: (index) => {
    const state = get();
    if (index === state.currentFileIndex) return;
    if (!state.confirmDiscardIfDirty(0)) return;

    const patch: Record<string, unknown> = {
      currentFileIndex: index,
      historyStack: [],
      historyIndex: -1,
      isDirtyA: false,
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
  },

  /** 移動対象のビューをすべて確認したうえでコマ送りする共通処理 */
  stepCell: (delta: number) => {
    const state = get();
    const last = Math.max(0, state.unifiedFileList.length - 1);
    const clamp = (v: number) => Math.max(0, Math.min(last, v));

    // 同期モードでは両ビューが動くので、両方の未保存を確認する
    const views: (0 | 1)[] = state.syncMode
      ? state.isSplitView
        ? [0, 1]
        : [0]
      : [state.activeViewIndex === 1 ? 1 : 0];

    for (const view of views) {
      if (!state.confirmDiscardIfDirty(view)) return;
    }

    const patch: Partial<PaintStore> = {};
    if (views.includes(0)) {
      patch.currentFileIndex = clamp(state.currentFileIndex + delta);
      patch.historyStack = [];
      patch.historyIndex = -1;
      patch.isDirtyA = false;
    }
    if (views.includes(1)) {
      patch.splitFileIndex = clamp(state.splitFileIndex + delta);
      patch.splitHistoryStack = [];
      patch.splitHistoryIndex = -1;
      patch.isDirtyB = false;
    }
    set(patch as any);
  },

  nextCell: () => get().stepCell(1),

  prevCell: () => get().stepCell(-1),

  /**
   * 統合リスト上のインデックスから、A側 / B側それぞれの実ファイル名を引く。
   * A と B でファイル名が異なる連番 (異名連番) でも正しい方の名前を返す。
   */
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
});
