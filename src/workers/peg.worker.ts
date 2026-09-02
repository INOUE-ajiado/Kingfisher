/**
 * タップ補正の焼き込みを担当する。
 *
 * ⚠️ 読み込み・穴の検出・焼き込み・書き出しを丸ごとここで済ませること。
 * スキャン 1 枚は展開すると数十 MB になるので、主スレッドへ運ぶと
 * そのコピーだけで時間を食う。検出も焼き込みも画面を止める重さがある。
 * ⚠️ 基準 (reference) は呼び出し側が先に決めて渡すこと。ここで決めると、
 * どの担当が最初に終わったかで基準が変わってしまう。
 */

import { backupPathFor, createFileIn, isBackupPath, resolveFileHandle } from '../engine/fileSystemPath';
import { readPixels, writePixels } from '../engine/imagePixels';
import {
  bakePegTransform,
  describePegDetection,
  detectPegHoles,
  PegDetectOptions,
  PegReference,
  PegTransform,
  pegGeometryDiff,
  pegTransformMoves,
  pegTransformTo,
} from '../engine/pegStabilizer';

export interface PegWorkerInit {
  type: 'init';
  dir: any;
  /** 別フォルダへ書き出すときの行き先 */
  outputDir: any | null;
  rootName: string | null;
  reference: PegReference;
  options: PegDetectOptions;
  mode: 'copy' | 'overwrite';
  backup: boolean;
}

/** 補正量を測るだけ (書き込まない) */
export interface PegWorkerMeasure {
  type: 'measure';
  id: number;
  path: string;
}

/** 決まった補正量で焼き込む */
export interface PegWorkerBake {
  type: 'bake';
  id: number;
  path: string;
  transform: PegTransform;
  /** 揃える画寸。どのコマも切らない大きさを呼び出し側が決める */
  outSize: { width: number; height: number } | null;
}

export interface PegWorkerDone {
  id: number;
  /** 測れた / 焼き込めたか (見送りは false + reason) */
  ok: boolean;
  reason?: string;
  /** measure のときの補正量 */
  transform?: PegTransform;
  /** measure のときの、基準との並びの違い */
  angleDiff?: number;
  spacingRatio?: number;
  /** 検出の中身 (精度を詰めるための解析ログ) */
  diagnostic?: string;
  /** そのコマの画寸 (揃えたときの切り取りを見積もるのに使う) */
  width?: number;
  height?: number;
  /** ログに出す補正量 */
  detail?: string;
}

let setup: PegWorkerInit | null = null;

/**
 * 補正量を測るだけ。
 * ⚠️ ここでは書き込まないこと。他の枚と食い違う値かどうかは、
 * 全部を測り終えるまで分からない (誤検出をそのまま焼き込まないため)。
 */
async function measureOne(
  path: string
): Promise<{
  ok: boolean;
  reason?: string;
  transform?: PegTransform;
  angleDiff?: number;
  spacingRatio?: number;
  diagnostic?: string;
  width?: number;
  height?: number;
}> {
  const s = setup!;
  const fileHandle = await resolveFileHandle(s.dir, path, s.rootName);
  const image = await readPixels(await fileHandle.getFile(), path);

  /**
   * ⚠️ 基準が決まっているなら、期待する穴の間隔を渡すこと。
   * タップ穴の周りが黒く塗られていると、しきい値しだいで塗りと穴がくっつき、
   * 別の 3 つを穴と取り違える。同じカットの間隔はほぼ変わらないので、
   * それを手がかりに選び分けられる。
   */
  const detection = detectPegHoles(image.data, image.width, image.height, {
    ...s.options,
    expectedSpacing: s.reference.spacing,
  });
  if (!detection.detected) return { ok: false, reason: detection.message };

  const diff = pegGeometryDiff(detection, s.reference);
  return {
    ok: true,
    transform: pegTransformTo(detection, s.reference),
    ...diff,
    diagnostic: describePegDetection(detection),
    width: image.width,
    height: image.height,
  };
}

/** 決まった補正量で焼き込んで書き戻す */
async function bakeOne(
  path: string,
  transform: PegTransform,
  requested: { width: number; height: number } | null
): Promise<{ ok: boolean; reason?: string; detail?: string }> {
  const s = setup!;
  const fileHandle = await resolveFileHandle(s.dir, path, s.rootName);
  const file: File = await fileHandle.getFile();
  const image = await readPixels(file, path);

  /**
   * ⚠️ 画寸も揃えること。1 カットの全コマは同じ大きさである必要がある。
   * 穴が絶対座標で揃っていても、画寸が違うと表示や合成で飛んで見える。
   * ⚠️ どの大きさへ揃えるかは呼び出し側が決める (どのコマも切らない大きさ)。
   */
  const outSize = requested ?? { width: image.width, height: image.height };
  const sameSize = outSize.width === image.width && outSize.height === image.height;

  // ⚠️ 動かず、画寸も同じなら書き直さない (JPEG を作り直すだけ画質が落ちる)
  if (!pegTransformMoves(transform) && sameSize) {
    return { ok: true, detail: 'すでに合っている (1px 未満なので書き直さない)' };
  }

  const moved = bakePegTransform(image.data, image.width, image.height, transform, outSize);
  const body = await writePixels(moved, outSize.width, outSize.height, path, image.tga, image.density);

  if (s.mode === 'copy') {
    // 元のフォルダ構成を保ったまま、書き出し先の同じ場所へ置く
    const target = await createFileIn(s.outputDir, path);
    const writable = await target.createWritable();
    await writable.write(body);
    await writable.close();
  } else {
    // ⚠️ 控えの控えは作らない (元から手つかずの 1 枚なので)
    if (s.backup && !isBackupPath(path)) {
      // ⚠️ 上書きの前に元を残す。焼き込みは元に戻せない
      const original = await file.arrayBuffer();
      const backupHandle = await createFileIn(s.dir, backupPathFor(path), s.rootName);
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

self.onmessage = async (e: MessageEvent<PegWorkerInit | PegWorkerMeasure | PegWorkerBake>) => {
  const data = e.data;

  if (data.type === 'init') {
    setup = data;
    return;
  }

  try {
    const result =
      data.type === 'measure'
        ? await measureOne(data.path)
        : await bakeOne(data.path, data.transform, data.outSize);
    const done: PegWorkerDone = { id: data.id, ...result };
    self.postMessage(done);
  } catch (err: any) {
    const done: PegWorkerDone = { id: data.id, ok: false, reason: String(err?.message || err) };
    self.postMessage(done);
  }
};
