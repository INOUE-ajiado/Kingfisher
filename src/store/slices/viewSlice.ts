/**
 * 2画面分割・参照ウィンドウ・タップ穴補正など、ビュー構成の状態
 */

import { StateCreator } from 'zustand';
import {
  bakePegTransform,
  detectPegHoles,
  pegTransformTo,
  referenceFromDetection,
} from '../../engine/pegStabilizer';
import { decodeTGA, encodeTGA } from '../../engine/tga';
import { ensureWritePermission, resolveFileHandle } from '../../engine/fileSystemPath';
import { PaintStore, ViewSlice } from '../types';
import { logDebug } from '../../engine/debugLog';
import { isSyncPairConsistent } from '../types';

/**
 * 相対パスの途中のフォルダを作りながら、書き込み先のファイルを用意する。
 *
 * ⚠️ ルート名で始まるパスは 1 段落とすこと。ハンドルはそのルートを指しているので、
 * 落とさないと「Cut の中の Cut」を作ってしまう (resolveFileHandle と同じ約束)。
 */
async function createFileIn(dirHandle: any, path: string, rootName?: string | null): Promise<any> {
  const parts = path.split(/[/\\]/).filter(Boolean);
  if (rootName && parts.length > 1 && parts[0] === rootName) parts.shift();

  let dir = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: true });
  }
  return dir.getFileHandle(parts[parts.length - 1], { create: true });
}

/** 上書きの前に残す控えの名前 (a0001.tga → a0001_orig.tga) */
function backupPathFor(path: string): string {
  return path.replace(/(\.[^.]+)$/, '_orig$1');
}

export const createViewSlice: StateCreator<PaintStore, [], [], ViewSlice> = (set, get) => ({
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

  mainAreaSplitRatio: 0.5,

  setMainAreaSplitRatio: (ratio) =>
    // 片側が潰れて操作できなくならないよう両端を残す
    set({ mainAreaSplitRatio: Math.min(0.85, Math.max(0.15, ratio)) }),

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
    scale: 1,
    manualX: 0,
    manualY: 0,
    manualRotation: 0,
    showGuide: false,
    holes: [],
    reference: null,
    message: '',
    options: { autoThreshold: true, threshold: 70, searchPercent: 28 },
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

  /**
   * 表示中のコマのタップ穴を検出し、基準へ重ねる。
   *
   * ⚠️ 「理想の位置」へ合わせないこと。紙のサイズもタップの間隔も現場ごとに違うので、
   * 合わせ先は「基準にしたコマ」で決める。基準が無ければ、このコマを基準にする
   * (オートフィードのスキャンを 1 枚目に揃える、という実際の使い方に合わせる)。
   * ⚠️ 見つからなかったときは理由を残すこと。黙って 0 を返すと、
   * 補正が効いていないのか、ずれていないのかが区別できない。
   */
  runPegStabilizerAutoDetect: () => {
    const { currentImage, triggerRender, pegStabilizer } = get();
    if (!currentImage) {
      set((state) => ({
        pegStabilizer: { ...state.pegStabilizer, status: 'failed', message: 'セルが開かれていません' },
      }));
      logDebug('view', 'タップ穴の補正: セルが開かれていません', undefined, 'warn');
      return;
    }

    const detection = detectPegHoles(currentImage.data, currentImage.width, currentImage.height, {
      threshold: pegStabilizer.options.threshold,
      autoThreshold: pegStabilizer.options.autoThreshold,
      searchRatio: pegStabilizer.options.searchPercent / 100,
    });

    if (!detection.detected) {
      set((state) => ({
        pegStabilizer: {
          ...state.pegStabilizer,
          enabled: true,
          status: 'failed',
          holes: [],
          message: detection.message,
        },
      }));
      logDebug('view', `タップ穴の補正: 検出できませんでした`, detection.message, 'warn');
      triggerRender();
      return;
    }

    const reference = pegStabilizer.reference ?? referenceFromDetection(detection);
    const isNewReference = !pegStabilizer.reference;
    const transform = pegTransformTo(detection, reference, currentImage.width, currentImage.height);

    set((state) => ({
      pegStabilizer: {
        ...state.pegStabilizer,
        enabled: true,
        status: 'success',
        holes: detection.holes,
        reference,
        offsetX: transform.offsetX,
        offsetY: transform.offsetY,
        rotation: transform.rotation,
        scale: transform.scale,
        message: isNewReference
          ? `このコマを基準にしました (${detection.message})`
          : `基準へ合わせました (${detection.message})`,
      },
    }));

    logDebug(
      'view',
      isNewReference
        ? 'タップ穴の補正: このコマを基準にした'
        : `タップ穴の補正: X ${transform.offsetX}px / Y ${transform.offsetY}px / 回転 ${transform.rotation}° / 倍率 ${(transform.scale * 100).toFixed(2)}%`,
      `${detection.message} / 中央の穴 (${Math.round(detection.center.x)}, ${Math.round(detection.center.y)})`
    );
    triggerRender();
  },

  setPegReferenceFromCurrent: () => {
    const { currentImage, triggerRender } = get();
    if (!currentImage) return;

    const detection = detectPegHoles(currentImage.data, currentImage.width, currentImage.height, {
      threshold: get().pegStabilizer.options.threshold,
      autoThreshold: get().pegStabilizer.options.autoThreshold,
      searchRatio: get().pegStabilizer.options.searchPercent / 100,
    });
    if (!detection.detected) {
      set((state) => ({
        pegStabilizer: { ...state.pegStabilizer, status: 'failed', holes: [], message: detection.message },
      }));
      logDebug('view', 'タップ穴の基準にできませんでした', detection.message, 'warn');
      return;
    }

    set((state) => ({
      pegStabilizer: {
        ...state.pegStabilizer,
        enabled: true,
        status: 'success',
        holes: detection.holes,
        reference: referenceFromDetection(detection),
        offsetX: 0,
        offsetY: 0,
        rotation: 0,
        scale: 1,
        message: `このコマを基準にしました (${detection.message})`,
      },
    }));
    logDebug('view', 'タップ穴の基準をこのコマにした', detection.message);
    triggerRender();
  },

  /**
   * 選んだファイルへタップ補正を焼き込む。
   *
   * ⚠️ 制作データを直接上書きするので、呼び出し側で必ず確認を取ること。
   * ⚠️ 基準が無ければ、並びの先頭のファイルを基準にする (そのファイルは動かさない)。
   *   ここで「理想の位置」を作らないこと。紙もタップの間隔も現場ごとに違う。
   * ⚠️ 途中で失敗しても、そこまでの結果と失敗の理由を返すこと。
   *   どこまで進んだのか分からないと、やり直す判断ができない。
   * ⚠️ 書き終えたらキャッシュを捨てること。捨てないと補正前の画像が出続ける。
   */
  applyPegCorrectionToFiles: async (view, paths, options) => {
    const state = get();
    const folderHandle = view === 1 ? state.folderHandleB : state.folderHandleA;
    const label = view === 1 ? 'Win B (右画面)' : 'Win A (左画面)';
    const mode = options?.mode ?? 'copy';
    const backup = options?.backup ?? false;

    // ⚠️ ファイルを書き換える操作は、断った場合も含めて必ず記録すること
    logDebug(
      'file',
      `タップ補正の焼き込み: 要求 ${paths.length} 件 (${mode === 'copy' ? '別フォルダへ書き出す' : backup ? '上書き / 控えを残す' : '上書き'})`,
      label
    );

    if (paths.length === 0) return { ok: true, message: '対象がありません。', applied: 0 };
    if (!folderHandle) {
      logDebug('file', 'タップ補正の焼き込み: 中止 (書き込めるフォルダとして開かれていない)', label, 'warn');
      return { ok: false, message: `${label} は書き込み可能なフォルダとして開かれていません。`, applied: 0 };
    }

    /**
     * ⚠️ 既定は「別フォルダへ書き出す」。制作データを上書きするのは、
     * 意図してそう選んだときだけにする。
     */
    let outputHandle: any = null;
    if (mode === 'copy') {
      if (!('showDirectoryPicker' in window)) {
        logDebug('file', 'タップ補正の焼き込み: 中止 (書き出し先を選べない環境)', label, 'warn');
        return { ok: false, message: 'この環境では書き出し先フォルダを選べません。', applied: 0 };
      }
      try {
        outputHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          logDebug('file', 'タップ補正の焼き込み: 取り消し (書き出し先を選ばなかった)', label);
          return { ok: true, message: '書き出しをやめました。', applied: 0 };
        }
        logDebug('file', 'タップ補正の焼き込み: 中止 (書き出し先を開けなかった)', String(err?.message || err), 'warn');
        return { ok: false, message: `書き出し先を開けませんでした: ${err?.message || err}`, applied: 0 };
      }
      if (!(await ensureWritePermission(outputHandle))) {
        logDebug('file', 'タップ補正の焼き込み: 中止 (書き出し先への書き込みが許可されなかった)', label, 'warn');
        return { ok: false, message: '書き出し先への書き込みが許可されませんでした。', applied: 0 };
      }
    } else if (!(await ensureWritePermission(folderHandle))) {
      logDebug('file', 'タップ補正の焼き込み: 中止 (書き込みが許可されなかった)', label, 'warn');
      return { ok: false, message: `${label} のフォルダへの書き込みが許可されませんでした。`, applied: 0 };
    }

    let reference = state.pegStabilizer.reference;
    let applied = 0;
    const skipped: string[] = [];

    logDebug(
      'file',
      `タップ補正の焼き込み: 実行 ${paths.length} 件 — ${label}`,
      mode === 'copy' ? `書き出し先「${outputHandle?.name ?? ''}」` : backup ? '上書き / 控えを残す' : '上書き'
    );

    try {
      for (const path of paths) {
        if (!/[.]tga$/i.test(path)) {
          skipped.push(`${path} (TGA ではありません)`);
          continue;
        }

        const fileHandle = await resolveFileHandle(folderHandle, path, state.rootFolderName);
        const file = await fileHandle.getFile();
        const image = decodeTGA(await file.arrayBuffer());

        const detection = detectPegHoles(image.data, image.width, image.height, {
          threshold: state.pegStabilizer.options.threshold,
          autoThreshold: state.pegStabilizer.options.autoThreshold,
          searchRatio: state.pegStabilizer.options.searchPercent / 100,
        });
        if (!detection.detected) {
          skipped.push(`${path} (${detection.message})`);
          continue;
        }

        if (!reference) {
          // 先頭を基準にする。基準そのものは動かさない
          reference = referenceFromDetection(detection);
          logDebug('view', `タップ補正の基準: ${path}`, detection.message);
          continue;
        }

        const transform = pegTransformTo(detection, reference, image.width, image.height);
        if (transform.offsetX === 0 && transform.offsetY === 0 && transform.rotation === 0 && transform.scale === 1) {
          applied += 1; // すでに合っている
          continue;
        }

        const moved = bakePegTransform(image.data, image.width, image.height, transform);
        const encoded = encodeTGA({ ...image, data: moved });

        if (mode === 'copy') {
          // 元のフォルダ構成を保ったまま、書き出し先へ同じ場所へ置く
          const target = await createFileIn(outputHandle, path);
          const writable = await target.createWritable();
          await writable.write(encoded);
          await writable.close();
        } else {
          if (backup) {
            // ⚠️ 上書きの前に元を残す。焼き込みは元に戻せない
            const original = await file.arrayBuffer();
            const backupHandle = await createFileIn(folderHandle, backupPathFor(path), state.rootFolderName);
            const backupWritable = await backupHandle.createWritable();
            await backupWritable.write(original);
            await backupWritable.close();
          }
          const writable = await fileHandle.createWritable();
          await writable.write(encoded);
          await writable.close();
          get().invalidateCachedImage(get().getImageCacheKey(view, path));
        }
        applied += 1;
        logDebug(
          'view',
          `タップ補正を焼き込み: ${path}`,
          `X ${transform.offsetX}px / Y ${transform.offsetY}px / 回転 ${transform.rotation}° / 倍率 ${(transform.scale * 100).toFixed(2)}%`
        );
      }
    } catch (err: any) {
      console.error('Failed to apply peg correction:', err);
      logDebug('file', 'タップ補正の焼き込み: 途中で失敗', String(err?.message || err), 'warn');
      return {
        ok: false,
        message: `途中で失敗しました: ${err?.message || err}\n${applied} 件は書き換え済みです。`,
        applied,
      };
    }

    if (reference) set((s2) => ({ pegStabilizer: { ...s2.pegStabilizer, reference } }));

    // 表示中のコマを読み直させる
    get().triggerRender();

    const detail = skipped.length > 0 ? `\n\n見送り ${skipped.length} 件:\n${skipped.slice(0, 8).join('\n')}` : '';
    const where =
      mode === 'copy'
        ? `書き出し先「${outputHandle?.name ?? ''}」へ`
        : backup
        ? '元のファイルへ (元は _orig 付きで残しました)'
        : '元のファイルへ';
    logDebug('file', `タップ補正の焼き込み: 完了 ${applied} 件 / 見送り ${skipped.length} 件`, where);
    return {
      ok: true,
      message: `${applied} 件にタップ補正を焼き込みました (${where})。${detail}`,
      applied,
    };
  },

  setPegOptions: (options) =>
    set((state) => {
      const next = { ...state.pegStabilizer.options, ...options };
      logDebug(
        'view',
        'タップ穴の検出条件を変更',
        `しきい値 ${next.autoThreshold ? '自動' : next.threshold} / 探索範囲 端から ${next.searchPercent}%`
      );
      return { pegStabilizer: { ...state.pegStabilizer, options: next } };
    }),

  clearPegReference: () =>
    set((state) => {
      logDebug('view', 'タップ穴の基準を解除し、補正を戻した');
      return {
        pegStabilizer: {
          ...state.pegStabilizer,
          status: 'idle',
          holes: [],
          reference: null,
          offsetX: 0,
          offsetY: 0,
          rotation: 0,
          scale: 1,
          message: '',
        },
      };
    }),

  // 2画面分割 (Split View) & 連動 (Sync Mode)
  isSplitView: false,

  // 初期状態では連動しない。それぞれ好きなセルを選んでから「連動」を押す使い方に合わせる
  syncMode: false,

  syncFrameOffset: 0,

  activeViewIndex: 0,

  splitFileIndex: 0,

  splitCanvasTransform: { scale: 1, offsetX: 0, offsetY: 0 },

  isWinAVisible: false,

  toggleWinAVisible: () => {
    const { isWinAVisible, confirmDiscardIfDirty } = get();
    // 閉じると編集中の内容は見えなくなるので、未保存なら確認する
    if (isWinAVisible && !confirmDiscardIfDirty(0)) return;
    set({ isWinAVisible: !isWinAVisible, ...(isWinAVisible ? {} : { activeSurface: 'cell' as const }) });
    logDebug('window', `Win A を${isWinAVisible ? '閉じた' : '開いた'}`);
  },

  toggleIsSplitView: () => {
    const { isSplitView, confirmDiscardIfDirty } = get();
    // 2画面表示を閉じると Win B の編集は破棄されるので確認する
    if (isSplitView && !confirmDiscardIfDirty(1)) return;
    set({
      isSplitView: !isSplitView,
      // セルを並べた操作なので、↑ ↓ と Space はセルのものへ
      ...(isSplitView ? {} : { activeSurface: 'cell' as const }),
      // 閉じたときはアクティブビューを Win A に戻す (保存先の取り違えを防ぐ)
      ...(isSplitView ? { activeViewIndex: 0 as 0 | 1, splitHistoryStack: [], splitHistoryIndex: -1 } : {}),
    });
    logDebug(
      'window',
      `2 画面表示を${isSplitView ? 'やめた (Win B を閉じた)' : '開始した (Win B を開いた)'}`,
      isSplitView ? 'アクティブを Win A へ戻し、Win B の履歴は捨てた' : undefined
    );
  },

  toggleSyncMode: () =>
    set((state) => {
      if (!state.syncMode) {
        // 連動開始: 今それぞれが表示しているコマの差をそのまま保つ。
        // 以前は Win B を Win A の位置へ強制的に合わせていたため、
        // 狙って選んだコマがずれてしまっていた。
        const offset = state.splitFileIndex - state.currentFileIndex;
        const nameA = state.resolveFileNameForView(state.currentFileIndex, 0) ?? '実体なし';
        const nameB = state.resolveFileNameForView(state.splitFileIndex, 1) ?? '実体なし';
        logDebug(
          'sync',
          `左右連動を入れた (コマ差 ${offset > 0 ? `+${offset}` : offset})`,
          `この 2 枚を対にして固定: Win A=${state.currentFileIndex} (${nameA}) ⇄ Win B=${state.splitFileIndex} (${nameB})`
        );
        return { syncMode: true, syncFrameOffset: offset };
      }
      logDebug(
        'sync',
        '左右連動を切った',
        `切った時点 Win A=${state.currentFileIndex} (${state.resolveFileNameForView(state.currentFileIndex, 0) ?? '実体なし'}) / ` +
          `Win B=${state.splitFileIndex} (${state.resolveFileNameForView(state.splitFileIndex, 1) ?? '実体なし'})`
      );
      return { syncMode: false };
    }),

  alignSyncFrames: () => {
    const state = get();
    if (state.splitFileIndex !== state.currentFileIndex) {
      if (!state.confirmDiscardIfDirty(1)) return;
    }
    set({
      syncFrameOffset: 0,
      splitFileIndex: state.currentFileIndex,
      splitHistoryStack: [],
      splitHistoryIndex: -1,
      isDirtyB: false,
    });
    logDebug(
      'sync',
      'コマ差を 0 に揃えた',
      `Win B ${state.splitFileIndex} → ${state.currentFileIndex} (${state.resolveFileNameForView(state.currentFileIndex, 1) ?? '実体なし'}) / コマ差 ${state.syncFrameOffset} → 0`
    );
  },

  // セルの窓を触ったら、↑ ↓ と Space の効き先もセルへ戻す
  setActiveViewIndex: (idx) => {
    // ⚠️ 変わったときだけ記録する。塗るたびに呼ばれるのでログが埋まる
    if (get().activeViewIndex !== idx) logDebug('window', `アクティブな窓を ${idx === 1 ? 'Win B' : 'Win A'} にした`);
    set({ activeViewIndex: idx, activeSurface: 'cell' });
  },

  setSplitCanvasTransform: (transform) => set({ splitCanvasTransform: transform }),

  setSplitFileIndex: (index, source) => {
    const state = get();
    if (index === state.splitFileIndex) {
      // 同じコマでも、選んだ以上はキーの効き先をセルへ戻す
      if (state.activeSurface !== 'cell') set({ activeSurface: 'cell' });
      return;
    }
    if (!state.confirmDiscardIfDirty(1)) return;

    const patch: Record<string, unknown> = {
      splitFileIndex: index,
      splitHistoryStack: [],
      splitHistoryIndex: -1,
      isDirtyB: false,
      activeSurface: 'cell',
    };

    // 連動中は Win A 側も同じコマ差を保って追従させる
    if (state.syncMode && state.isSplitView) {
      const last = Math.max(0, state.unifiedFileList.length - 1);
      const target = Math.max(0, Math.min(last, index - state.syncFrameOffset));
      if (target !== state.currentFileIndex) {
        if (!state.confirmDiscardIfDirty(0)) return;
        patch.currentFileIndex = target;
        patch.historyStack = [];
        patch.historyIndex = -1;
        patch.isDirtyA = false;
      }
    }

    set(patch as any);

    const after = get();
    const linked = state.syncMode && state.isSplitView;
    const name = (idx: number, view: 0 | 1) => after.resolveFileNameForView(idx, view) ?? '実体なし';
    const offsetText = state.syncFrameOffset > 0 ? `+${state.syncFrameOffset}` : String(state.syncFrameOffset);
    logDebug(
      'cell',
      `Win B を選択: ${state.splitFileIndex} → ${index} (${name(index, 1)})${source ? ` — ${source}` : ''}`,
      linked
        ? `連動 (コマ差 ${offsetText}) で Win A ${state.currentFileIndex} → ${after.currentFileIndex} (${name(after.currentFileIndex, 0)})`
        : `連動なし (Win A は ${after.currentFileIndex} のまま)`
    );

    // 記録しているコマ差と実際の位置が食い違っていたら警告として残す
    if (linked) {
      const total = after.unifiedFileList.length;
      const expected = Math.max(0, Math.min(Math.max(0, total - 1), after.currentFileIndex + after.syncFrameOffset));
      if (!isSyncPairConsistent(after.currentFileIndex, after.splitFileIndex, after.syncFrameOffset, total)) {
        logDebug(
          'sync',
          `コマ差の食い違いを検出 (記録 ${offsetText} / 実際 ${after.splitFileIndex - after.currentFileIndex})`,
          `Win A=${after.currentFileIndex} (${name(after.currentFileIndex, 0)}) / Win B=${after.splitFileIndex} (${name(after.splitFileIndex, 1)}) — 本来 Win B は ${expected} のはず`,
          'warn'
        );
      }
    }
  },
});
