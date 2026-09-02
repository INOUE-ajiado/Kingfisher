/**
 * 2画面分割・参照ウィンドウ・タップ穴補正など、ビュー構成の状態
 */

import { StateCreator } from 'zustand';
import {
  bakePegTransform,
  detectPegHoles,
  pegTransformTo,
  referenceFromDetection,
  PegDetectOptions,
  PegReference,
  PegTransform,
  pegGeometryDiff,
  pegTransformMoves,
  describePegDetection,
} from '../../engine/pegStabilizer';
import { readPixels, writePixels } from '../../engine/imagePixels';
import { laneCount, runInLanes } from '../../engine/jobPool';
import { PegCandidate, rejectPegOutliers } from '../../engine/pegBatch';
import { PegSample, summarizePegBatch } from '../../engine/pegReport';
import type { PegWorkerDone, PegWorkerInit } from '../../workers/peg.worker';
import {
  backupPathFor,
  createFileIn,
  isBackupPath,
  requestWriteAccess,
  resolveFileHandle,
} from '../../engine/fileSystemPath';
import { PaintStore, ViewSlice } from '../types';
import { logDebug } from '../../engine/debugLog';
import { isSyncPairConsistent } from '../types';

/** 担当 1 人に 1 枚頼んで、終わるまで待つ (測る / 焼く のどちらも) */
function askPeg(
  worker: Worker,
  id: number,
  message: any
): Promise<{
  ok: boolean;
  reason?: string;
  detail?: string;
  transform?: PegTransform;
  angleDiff?: number;
  spacingRatio?: number;
  diagnostic?: string;
}> {
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<PegWorkerDone>) => {
      if (e.data.id !== id) return;
      cleanup();
      resolve({
        ok: e.data.ok,
        reason: e.data.reason,
        detail: e.data.detail,
        transform: e.data.transform,
        angleDiff: e.data.angleDiff,
        spacingRatio: e.data.spacingRatio,
        diagnostic: e.data.diagnostic,
      });
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(e.message || '焼き込みの担当が落ちました'));
    };
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ ...message, id });
  });
}

/**
 * 補正量を測るだけ (担当を立てられない環境向けの控え)。
 * ⚠️ ここでは書き込まない。他の枚と食い違うかどうかは全部測るまで分からない。
 */
async function measurePegForFile(
  dir: any,
  rootName: string | null,
  path: string,
  reference: PegReference,
  options: PegDetectOptions
): Promise<{
  ok: boolean;
  reason?: string;
  transform?: PegTransform;
  angleDiff?: number;
  spacingRatio?: number;
  diagnostic?: string;
}> {
  const fileHandle = await resolveFileHandle(dir, path, rootName);
  const image = await readPixels(await fileHandle.getFile(), path);

  const detection = detectPegHoles(image.data, image.width, image.height, options);
  if (!detection.detected) return { ok: false, reason: detection.message };

  return {
    ok: true,
    transform: pegTransformTo(detection, reference),
    ...pegGeometryDiff(detection, reference),
    diagnostic: describePegDetection(detection),
  };
}

/**
 * 決まった補正量で 1 枚に焼き込む (担当を立てられない環境向けの控え)。
 * ⚠️ ワーカー側 (peg.worker.ts) と同じ手順にしておくこと。片方だけ直すと結果が変わる。
 */
async function bakePegIntoFile(
  dir: any,
  outputDir: any,
  rootName: string | null,
  path: string,
  transform: PegTransform,
  setup: { mode: 'copy' | 'overwrite'; backup: boolean; reference: PegReference }
): Promise<{ ok: boolean; reason?: string; detail?: string }> {
  const fileHandle = await resolveFileHandle(dir, path, rootName);
  const file: File = await fileHandle.getFile();
  const image = await readPixels(file, path);

  // ⚠️ 画寸も基準へ揃える (ワーカー側と同じ手順にすること)
  const outSize =
    setup.reference.width && setup.reference.height
      ? { width: setup.reference.width, height: setup.reference.height }
      : { width: image.width, height: image.height };
  const sameSize = outSize.width === image.width && outSize.height === image.height;

  if (!pegTransformMoves(transform) && sameSize) {
    return { ok: true, detail: 'すでに合っている (1px 未満なので書き直さない)' };
  }

  const moved = bakePegTransform(image.data, image.width, image.height, transform, outSize);
  const body = await writePixels(moved, outSize.width, outSize.height, path, image.tga, image.density);

  if (setup.mode === 'copy') {
    const target = await createFileIn(outputDir, path);
    const writable = await target.createWritable();
    await writable.write(body);
    await writable.close();
  } else {
    // ⚠️ 控えの控えは作らない
    if (setup.backup && !isBackupPath(path)) {
      const original = await file.arrayBuffer();
      const backupHandle = await createFileIn(dir, backupPathFor(path), rootName);
      const backupWritable = await backupHandle.createWritable();
      await backupWritable.write(original);
      await backupWritable.close();
    }
    const writable = await fileHandle.createWritable();
    await writable.write(body);
    await writable.close();
  }

  return {
    ok: true,
    detail:
      `X ${transform.offsetX}px / Y ${transform.offsetY}px` +
      (sameSize ? '' : ` / 画寸 ${image.width}x${image.height} → ${outSize.width}x${outSize.height}`),
  };
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
    options: { autoThreshold: true, threshold: 70, searchPercent: 28, detailLog: false },
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

    const reference =
      pegStabilizer.reference ??
      referenceFromDetection(detection, { width: currentImage.width, height: currentImage.height });
    const isNewReference = !pegStabilizer.reference;
    const transform = pegTransformTo(detection, reference);

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
      const outAccess = await requestWriteAccess(outputHandle);
      if (!outAccess.ok) {
        logDebug('file', 'タップ補正の焼き込み: 中止 (書き出し先への書き込みが許可されなかった)', `${label} — ${outAccess.reason}`, 'warn');
        return { ok: false, message: `書き出し先へ書き込めません。\n${outAccess.reason}`, applied: 0 };
      }
    } else {
      const access = await requestWriteAccess(folderHandle);
      if (!access.ok) {
        logDebug('file', 'タップ補正の焼き込み: 中止 (書き込みが許可されなかった)', `${label} — ${access.reason}`, 'warn');
        return { ok: false, message: `${label} のフォルダへ書き込めません。\n${access.reason}`, applied: 0 };
      }
    }

    const pegOptions = {
      threshold: state.pegStabilizer.options.threshold,
      autoThreshold: state.pegStabilizer.options.autoThreshold,
      searchRatio: state.pegStabilizer.options.searchPercent / 100,
    };

    let reference = state.pegStabilizer.reference;
    let applied = 0;
    const skipped: string[] = [];
    const startedAt = Date.now();

    /**
     * 基準がまだ無ければ、先頭から順に見て最初に穴が見つかった 1 枚を基準にする。
     *
     * ⚠️ ここは順番に決めること。並行に流すと、どの担当が先に終わったかで
     * 基準が変わり、同じ操作でも結果が変わってしまう。
     * ⚠️ 基準にした 1 枚は動かさない (それが基準なので、焼き込む対象から外す)。
     */
    let rest = paths;
    if (!reference) {
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        try {
          const handle = await resolveFileHandle(folderHandle, path, state.rootFolderName);
          const image = await readPixels(await handle.getFile(), path);
          const detection = detectPegHoles(image.data, image.width, image.height, pegOptions);
          if (!detection.detected) {
            skipped.push(`${path} (${detection.message})`);
            continue;
          }
          reference = referenceFromDetection(detection, { width: image.width, height: image.height });
          logDebug(
            'view',
            `タップ補正の基準: ${path}`,
            `${detection.message} / この画寸 ${image.width}x${image.height} へ全部を揃えます`
          );
          logDebug('view', '基準の検出の中身', describePegDetection(detection));
          rest = paths.slice(i + 1);
          break;
        } catch (err: any) {
          skipped.push(`${path} (${err?.message || err})`);
        }
      }
    }

    if (!reference) {
      logDebug('file', 'タップ補正の焼き込み: 中止 (基準にできる 1 枚が無い)', label, 'warn');
      return {
        ok: false,
        message: `タップ穴を見つけられませんでした。\n\n${skipped.slice(0, 5).join('\n')}`,
        applied: 0,
      };
    }

    /**
     * ⚠️ 1 枚ずつ順番に焼き込まないこと。検出も焼き込みも重く、実測で
     * 2325x3303 のスキャン 1 枚あたり 175ms かかる。42 枚なら 7 秒、
     * その間ずっと画面が止まったままになる。
     */
    const useWorkers = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
    const lanes = laneCount(rest.length, navigator.hardwareConcurrency);

    logDebug(
      'file',
      `タップ補正の焼き込み: 実行 ${rest.length} 件 — ${label}`,
      `${mode === 'copy' ? `書き出し先「${outputHandle?.name ?? ''}」` : backup ? '上書き / 控えを残す' : '上書き'} / ` +
        `${useWorkers ? `${lanes} 本で並行` : '主スレッドで順に (担当を立てられない環境)'}`
    );

    const workers: Worker[] = useWorkers
      ? Array.from({ length: lanes }, () => {
          const worker = new Worker(new URL('../../workers/peg.worker.ts', import.meta.url), { type: 'module' });
          const init: PegWorkerInit = {
            type: 'init',
            dir: folderHandle,
            outputDir: outputHandle,
            rootName: state.rootFolderName,
            reference: reference as PegReference,
            options: pegOptions,
            mode,
            backup,
          };
          worker.postMessage(init);
          return worker;
        })
      : [];

    let jobId = 0;

    try {
      /**
       * 一段目: 全部の補正量を測るだけ。
       * ⚠️ ここで書き込まないこと。他の枚と食い違う値かどうかは、
       * 全部を測り終えるまで分からない。
       */
      const measured = await runInLanes(rest, lanes, async (path, _index, lane) => {
        if (useWorkers) {
          jobId += 1;
          return await askPeg(workers[lane], jobId, { type: 'measure', path });
        }
        return await measurePegForFile(folderHandle, state.rootFolderName, path, reference as PegReference, pegOptions);
      });

      const candidates: PegCandidate[] = [];
      measured.forEach((outcome, i) => {
        const path = rest[i];
        if (outcome.error) {
          skipped.push(`${path} (${outcome.error})`);
          return;
        }
        const result = outcome.value!;
        if (!result.ok || !result.transform) {
          skipped.push(`${path} (${result.reason})`);
          return;
        }
        candidates.push({
          path,
          transform: result.transform,
          angleDiff: result.angleDiff,
          spacingRatio: result.spacingRatio,
        });

        /**
         * ⚠️ 1 枚ごとの検出の中身を残すこと。中心だけでは
         * 「違うものを穴と見なした」のか「紙が本当にずれた」のか区別できない。
         */
        if (state.pegStabilizer.options.detailLog) {
          logDebug(
            'view',
            `検出 ${path.split(/[/\\]/).pop()}: ずれ X ${result.transform.offsetX}px / Y ${result.transform.offsetY}px`,
            result.diagnostic
          );
        }
      });

      /**
       * ⚠️ 揃っていない 1 枚は焼き込まないこと。同じ機械で取り込んだスキャンは
       * 補正量がほぼ揃うのが正しい姿で、そこから外れた値はタップ穴以外を
       * 穴と見なした結果である。焼くと元に戻せない上に、
       * 「数枚だけ絵がずれている」という一番気づきにくい壊れ方になる。
       */
      /**
       * ⚠️ 束全体のばらつきを必ず残すこと。ばらつきが小さいのに範囲が広ければ、
       * 大半は揃っていて数枚だけ外れている = 誤検出を疑う場面である。
       */
      const samples: PegSample[] = candidates.map((c) => ({
        path: c.path,
        offsetX: c.transform.offsetX,
        offsetY: c.transform.offsetY,
        angleDiff: c.angleDiff ?? 0,
        spacingRatio: c.spacingRatio ?? 1,
      }));
      const summary = summarizePegBatch(samples);
      // ⚠️ 空のメッセージで行を増やさないこと。読むときに何の行か分からなくなる
      logDebug('view', `補正量のばらつき (${samples.length} 枚)`, summary.slice(0, 4).join(' / '));
      summary.slice(4).forEach((line) => logDebug('view', '中央値から離れているコマ', line, 'warn'));

      const checked = rejectPegOutliers(candidates);
      checked.rejected.forEach((r) => skipped.push(`${r.path} (他と食い違うため見送り: ${r.reason})`));

      /**
       * ⚠️ 基準にした 1 枚が他とずれていると、全部がその誤りへ引きずられる。
       * 「ほぼ全員が同じ方向へ大きく動く」ときは、動かすべきは基準の方である。
       * (2026-09-02: 基準を変えたら全件 1px 未満になり、前の基準が外れ値だったと分かった)
       */
      if (checked.median && Math.hypot(checked.median.offsetX, checked.median.offsetY) > 10) {
        logDebug(
          'view',
          '基準にした 1 枚が他とずれている可能性',
          `ほぼ全件が X ${checked.median.offsetX.toFixed(1)}px / Y ${checked.median.offsetY.toFixed(1)}px 動きます。` +
            `別のコマを基準にすると、動かす量がもっと小さくなるかもしれません`,
          'warn'
        );
      }

      if (checked.median) {
        logDebug(
          'view',
          `タップ補正の目安 (中央値): X ${checked.median.offsetX.toFixed(1)}px / Y ${checked.median.offsetY.toFixed(1)}px`,
          `穴の並びの差 ${checked.median.angleDiff.toFixed(3)}° / 間隔の比 ${(checked.median.spacingRatio * 100).toFixed(2)}% — ` +
            `${checked.accepted.length} 件を焼き込み / ${checked.rejected.length} 件は食い違いで見送り`,
          checked.rejected.length > 0 ? 'warn' : 'info'
        );
      }

      /**
       * ⚠️ 見つからなかった分・食い違った分は not_founds へ分けること (本家と同じ)。
       * 書き出し先に「補正できた分」だけが並ぶと、抜けているコマに気づけない。
       * 元のファイルには触らないので、上書きのときは何もしない。
       */
      if (mode === 'copy' && skipped.length > 0) {
        const notFound = skipped.map((line) => line.replace(/ \(.*$/, ''));
        const carried = await runInLanes(notFound, lanes, async (path) => {
          const handle = await resolveFileHandle(folderHandle, path, state.rootFolderName);
          const body = await handle.getFile();
          const name = path.split(/[/\\]/).pop() || path;
          const target = await createFileIn(outputHandle, `not_founds/${name}`);
          const writable = await target.createWritable();
          await writable.write(body);
          await writable.close();
          return path;
        });
        const moved = carried.filter((o) => !o.error).length;
        logDebug(
          'file',
          `タップ補正: 補正できなかった ${moved} 件を not_founds へ写した`,
          `書き出し先「${outputHandle?.name ?? ''}」/ not_founds`,
          'warn'
        );
      }

      // 二段目: 揃っている分だけ焼き込む
      const baked = await runInLanes(checked.accepted, lanes, async (candidate, _index, lane) => {
        if (useWorkers) {
          jobId += 1;
          return await askPeg(workers[lane], jobId, {
            type: 'bake',
            path: candidate.path,
            transform: candidate.transform,
          });
        }
        return await bakePegIntoFile(
          folderHandle,
          outputHandle,
          state.rootFolderName,
          candidate.path,
          candidate.transform,
          { mode, backup, reference: reference as PegReference }
        );
      });

      baked.forEach((outcome, i) => {
        const path = checked.accepted[i].path;
        if (outcome.error) {
          skipped.push(`${path} (${outcome.error})`);
          return;
        }
        const result = outcome.value!;
        if (!result.ok) {
          skipped.push(`${path} (${result.reason})`);
          return;
        }
        applied += 1;
        get().invalidateCachedImage(get().getImageCacheKey(view, path));
        if (result.detail) logDebug('view', `タップ補正を焼き込み: ${path}`, result.detail);
      });
    } finally {
      // ⚠️ 必ず片づけること。残すと 1 回焼くたびに担当が増えていく
      workers.forEach((w) => w.terminate());
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
    const elapsed = Date.now() - startedAt;
    logDebug(
      'file',
      `タップ補正の焼き込み: 完了 ${applied} 件 / 見送り ${skipped.length} 件`,
      `${(elapsed / 1000).toFixed(1)} 秒 (1 枚あたり ${applied > 0 ? Math.round(elapsed / applied) : 0}ms) — ${where}`,
      skipped.length > 0 ? 'warn' : 'info'
    );
    return {
      ok: skipped.length === 0,
      message: `${applied} 件にタップ補正を焼き込みました (${where} / ${(elapsed / 1000).toFixed(1)} 秒)。${detail}`,
      applied,
    };
  },

  setPegOptions: (options) =>
    set((state) => {
      const next = { ...state.pegStabilizer.options, ...options };
      logDebug(
        'view',
        'タップ穴の検出条件を変更',
        `しきい値 ${next.autoThreshold ? '自動' : next.threshold} / 探索範囲 端から ${next.searchPercent}%` +
          ` / 詳しい解析ログ ${next.detailLog ? 'ON' : 'OFF'}`
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
