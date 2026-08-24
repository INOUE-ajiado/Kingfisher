/**
 * 編集中の画像・キャッシュ・未保存管理・操作履歴・再生
 */

import { StateCreator } from 'zustand';
import { encodeTGA } from '../../engine/tga';
import { resolveFileHandle, ensureWritePermission } from '../../engine/fileSystemPath';
import { PaintStore, DocumentSlice } from '../types';

/** 1 セルあたりに保持する履歴の最大数 (基準状態「編集前」を含む) */
const MAX_HISTORY = 30;

export const createDocumentSlice: StateCreator<PaintStore, [], [], DocumentSlice> = (set, get) => ({
  currentImage: null,

  splitImage: null,

  prevImage: null,

  nextImage: null,

  cacheImages: new Map(),

  setCurrentImage: (image) => set({ currentImage: image }),

  setSplitImage: (image) => set({ splitImage: image }),

  setPrevNextImages: (prev, next) => set({ prevImage: prev, nextImage: next }),

  getActiveImage: () => {
    const { activeViewIndex, currentImage, splitImage } = get();
    return activeViewIndex === 1 ? splitImage : currentImage;
  },

  /**
   * キャッシュキーにはフォルダ名を含める。
   * 別カット・別フォルダへ切り替えたときに同名ファイルが誤ヒットするのを防ぐ。
   */
  getImageCacheKey: (view, fileName) => {
    const { folderNameA, folderNameB } = get();
    const side = view === 1 ? 'B' : 'A';
    const folder = view === 1 ? folderNameB : folderNameA;
    return `${side}|${folder}|${fileName}`;
  },

  getCachedImage: (key) => get().cacheImages.get(key) || null,

  putCachedImage: (key, image) => {
    const cache = get().cacheImages;
    // 簡易 LRU (Map は挿入順を保持するので先頭から捨てる)。
    // 4K セルでも破綻しないよう、枚数ではなく合計バイト数で上限を決める。
    const MAX_BYTES = 256 * 1024 * 1024; // 256MB
    const MAX_ENTRIES = 16;

    if (cache.has(key)) cache.delete(key);
    cache.set(key, image);

    let totalBytes = 0;
    cache.forEach((img) => { totalBytes += img.data.length; });

    while ((cache.size > MAX_ENTRIES || totalBytes > MAX_BYTES) && cache.size > 1) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = cache.get(oldestKey);
      if (oldest) totalBytes -= oldest.data.length;
      cache.delete(oldestKey);
    }
  },

  invalidateCachedImage: (key) => {
    get().cacheImages.delete(key);
  },

  clearImageCache: () => {
    get().cacheImages.clear();
  },

  isDirtyA: false,

  isDirtyB: false,

  markDirty: (view) => {
    const target = view ?? get().activeViewIndex;
    set(target === 1 ? { isDirtyB: true } : { isDirtyA: true });
  },

  clearDirty: (view) => set(view === 1 ? { isDirtyB: false } : { isDirtyA: false }),

  confirmDiscardIfDirty: (view) => {
    const { isDirtyA, isDirtyB, isPlaying } = get();
    // 再生中は編集していない前提。毎フレーム確認を出さない。
    if (isPlaying) return true;

    const dirty = view === 1 ? isDirtyB : isDirtyA;
    if (!dirty) return true;

    const label = view === 1 ? 'Win B (右画面)' : 'Win A (左画面)';
    const ok = window.confirm(
      `${label} に保存していない編集があります。\n\n` +
        `このまま移動すると編集内容は失われます。\n` +
        `破棄して移動しますか？ (キャンセルを選ぶと留まります。Ctrl+S で保存できます)`
    );
    if (ok) set(view === 1 ? { isDirtyB: false } : { isDirtyA: false });
    return ok;
  },

  /**
   * アクティブなビューのセルを上書き保存する。
   * - 書き込む画素: そのビューが実際に編集している画像
   * - 書き込む先  : そのビューのフォルダハンドル / そのビュー側の実ファイル名
   */
  /**
   * 名前を付けて保存。
   *
   * ⚠️ 上書き保存と混同しないこと。以前はメニューの「名前を付けて保存」も
   * Ctrl+Shift+S も saveActiveCell に繋がっており、確認なく元ファイルを
   * 上書きしていた。
   *
   * 開いているフォルダと連番の対応づけは変更しない。書き出した先は
   * 連番の一部ではないため、元ファイルの未保存状態はそのまま残す
   * (クリアすると、まだ書き戻していない編集を保存済みに見せてしまう)。
   */
  saveActiveCellAs: async () => {
    const { activeViewIndex, currentImage, splitImage, currentFileIndex, splitFileIndex, resolveFileNameForView } =
      get();

    const view: 0 | 1 = activeViewIndex === 1 ? 1 : 0;
    const label = view === 1 ? 'Win B (右画面)' : 'Win A (左画面)';
    const image = view === 1 ? splitImage : currentImage;

    if (!image) {
      return { ok: false, message: `${label} に保存できる画像が読み込まれていません。` };
    }
    if (image.isReadOnly) {
      return { ok: false, message: `${label} の画像は閲覧専用のため保存できません。` };
    }
    // window ではなく globalThis を見る (ブラウザでは同一。テスト環境に window は無い)
    const showSaveFilePicker = (globalThis as any).showSaveFilePicker;
    if (typeof showSaveFilePicker !== 'function') {
      return {
        ok: false,
        message: 'お使いのブラウザは保存先を選ぶ操作に対応していません。上書き保存 (Ctrl+S) を使ってください。',
      };
    }

    const fileIndex = view === 1 ? splitFileIndex : currentFileIndex;
    const currentName = resolveFileNameForView(fileIndex, view);
    const suggestedName = (currentName ?? 'cell.tga').split('/').pop() || 'cell.tga';

    try {
      const fileHandle = await showSaveFilePicker({
        suggestedName,
        types: [{ description: 'TGA 画像', accept: { 'application/octet-stream': ['.tga'] } }],
      });

      if (!(await ensureWritePermission(fileHandle))) {
        return { ok: false, message: `${label} の保存先への書き込みが許可されませんでした。` };
      }

      const writable = await fileHandle.createWritable();
      await writable.write(encodeTGA(image));
      await writable.close();

      const isDirty = view === 1 ? get().isDirtyB : get().isDirtyA;
      return {
        ok: true,
        message:
          `${label} を [${fileHandle.name}] へ保存しました。` +
          (isDirty ? `
(連番の元ファイルは未保存のままです。上書きするには Ctrl+S)` : ''),
      };
    } catch (err: any) {
      // ダイアログを閉じただけなら通知しない
      if (err?.name === 'AbortError') return { ok: false, message: '', cancelled: true };
      console.error('Failed to save as:', err);
      return { ok: false, message: `保存に失敗しました: ${err?.message || err}` };
    }
  },

  saveActiveCell: async () => {
    const {
      activeViewIndex,
      currentImage,
      splitImage,
      folderHandleA,
      folderHandleB,
      currentFileIndex,
      splitFileIndex,
      resolveFileNameForView,
      invalidateCachedImage,
      clearDirty,
    } = get();

    const view: 0 | 1 = activeViewIndex === 1 ? 1 : 0;
    const label = view === 1 ? 'Win B (右画面)' : 'Win A (左画面)';
    const image = view === 1 ? splitImage : currentImage;
    const folderHandle = view === 1 ? folderHandleB : folderHandleA;
    const fileIndex = view === 1 ? splitFileIndex : currentFileIndex;

    if (!image) {
      return { ok: false, message: `${label} に保存できる画像が読み込まれていません。` };
    }
    if (image.isReadOnly) {
      return { ok: false, message: `${label} の画像は閲覧専用のため保存できません。` };
    }
    if (!folderHandle) {
      return {
        ok: false,
        message:
          `${label} は書き込み可能なフォルダとして開かれていません。\n` +
          `「ファイル > フォルダを開く」から開き直してください (ドラッグ＆ドロップでは保存できません)。`,
      };
    }

    const fileName = resolveFileNameForView(fileIndex, view);
    if (!fileName) {
      return { ok: false, message: `${label} の現在のフレームに対応するファイルが存在しません。` };
    }

    // 既定では読み取り許可しか付いていない (ピッカー・D&D とも)。
    // ここで昇格しておかないと createWritable() が NotAllowedError になる。
    if (!(await ensureWritePermission(folderHandle))) {
      return {
        ok: false,
        message:
          `${label} のフォルダへの書き込みが許可されませんでした。
` +
          `保存し直すと許可を求めるダイアログが再度表示されます。`,
      };
    }

    try {
      const fileHandle = await resolveFileHandle(folderHandle, fileName, get().rootFolderName);
      const writable = await fileHandle.createWritable();
      await writable.write(encodeTGA(image));
      await writable.close();

      invalidateCachedImage(get().getImageCacheKey(view, fileName));

      // ⚠️ 開いた時点の File スナップショット (fileMapA/B) を捨てる。
      // 残しておくと、ハンドル経由の読み出しが失敗したときに
      // フォールバックが保存前の内容を返し、保存したのに古い画像が出る。
      // ここへ到達している = 書き込み可能なハンドルがある、なので消して安全。
      const staleMap = view === 1 ? get().fileMapB : get().fileMapA;
      if (staleMap.has(fileName)) {
        const nextMap = new Map(staleMap);
        nextMap.delete(fileName);
        set(view === 1 ? { fileMapB: nextMap } : { fileMapA: nextMap });
      }

      clearDirty(view);

      return { ok: true, message: `${label} の [${fileName}] を上書き保存しました。` };
    } catch (err: any) {
      console.error('Failed to save file:', err);
      return { ok: false, message: `保存に失敗しました: ${err?.message || err}` };
    }
  },

  historyStack: [],

  historyIndex: -1,

  splitHistoryStack: [],

  splitHistoryIndex: -1,

  /**
   * 未確定の「最新の操作結果」を履歴の末尾へ書き戻す。
   *
   * saveUndoState は操作の *直前* に呼ばれるため、積んだ時点の枠には操作前の
   * 内容しか入っていない。履歴を移動する前・次の操作を積む前にここで同期し、
   * 「historyStack[historyIndex] は常に表示中の状態」という不変条件を保つ。
   */
  commitLiveState: () => {
    const { activeViewIndex, currentImage, splitImage } = get();
    const isSplit = activeViewIndex === 1;
    const image = isSplit ? splitImage : currentImage;
    if (!image) return;

    const stack = isSplit ? get().splitHistoryStack : get().historyStack;
    const index = isSplit ? get().splitHistoryIndex : get().historyIndex;

    // 既に過去へ戻っている場合、末尾は確定済みなので触らない
    if (index < 0 || index !== stack.length - 1) return;

    const newStack = stack.slice();
    newStack[index] = { ...newStack[index], data: new Uint8ClampedArray(image.data) };

    if (isSplit) set({ splitHistoryStack: newStack });
    else set({ historyStack: newStack });
  },

  saveUndoState: (actionName = 'ペイント操作') => {
    const { activeViewIndex, currentImage, splitImage, commitLiveState } = get();
    const isSplit = activeViewIndex === 1;
    const image = isSplit ? splitImage : currentImage;
    if (!image) return;

    // 直前の操作結果を確定させてから、新しい操作の枠を積む
    commitLiveState();

    const stack = isSplit ? get().splitHistoryStack : get().historyStack;
    const index = isSplit ? get().splitHistoryIndex : get().historyIndex;

    // 履歴が空なら、まず「編集前」を基準状態 (index 0) として積む。
    // これにより 1 回目の操作も Undo で取り消せる。
    const base =
      stack.length === 0
        ? [{ label: '編集前', data: new Uint8ClampedArray(image.data) }]
        : stack.slice(0, index + 1); // やり直し (redo) 先は捨てる

    // これから行う操作の結果を入れる枠。中身は commitLiveState で後から同期される。
    const newStack = [...base, { label: actionName, data: new Uint8ClampedArray(image.data) }].slice(
      -MAX_HISTORY
    );

    // ペイント操作が入った時点で「未保存」になる
    if (isSplit) {
      set({ splitHistoryStack: newStack, splitHistoryIndex: newStack.length - 1, isDirtyB: true });
    } else {
      set({ historyStack: newStack, historyIndex: newStack.length - 1, isDirtyA: true });
    }
  },

  jumpToHistory: (index: number) => {
    const { activeViewIndex, currentImage, splitImage, triggerRender, commitLiveState } = get();
    const isSplit = activeViewIndex === 1;
    const image = isSplit ? splitImage : currentImage;
    if (!image) return;

    // 移動前に、まだ履歴へ書き戻していない最新状態を確定させる
    commitLiveState();

    const stack = isSplit ? get().splitHistoryStack : get().historyStack;
    const currentIndex = isSplit ? get().splitHistoryIndex : get().historyIndex;
    if (index < 0 || index >= stack.length || index === currentIndex) return;

    image.data.set(stack[index].data);

    if (isSplit) {
      set({ splitHistoryIndex: index, isDirtyB: true });
    } else {
      set({ historyIndex: index, isDirtyA: true });
    }
    triggerRender();
  },

  undo: () => {
    const { activeViewIndex, jumpToHistory } = get();
    const index = activeViewIndex === 1 ? get().splitHistoryIndex : get().historyIndex;
    if (index > 0) jumpToHistory(index - 1);
  },

  redo: () => {
    const { activeViewIndex, jumpToHistory } = get();
    const isSplit = activeViewIndex === 1;
    const index = isSplit ? get().splitHistoryIndex : get().historyIndex;
    const stack = isSplit ? get().splitHistoryStack : get().historyStack;
    if (index < stack.length - 1) jumpToHistory(index + 1);
  },

  isPlaying: false,

  fps: 4,

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  setFps: (fps) => set({ fps }),
});
