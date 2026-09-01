/**
 * タップ補正の焼き込みを担当する。
 *
 * ⚠️ 読み込み・穴の検出・焼き込み・書き出しを丸ごとここで済ませること。
 * スキャン 1 枚は展開すると数十 MB になるので、主スレッドへ運ぶと
 * そのコピーだけで時間を食う。検出も焼き込みも画面を止める重さがある。
 * ⚠️ 基準 (reference) は呼び出し側が先に決めて渡すこと。ここで決めると、
 * どの担当が最初に終わったかで基準が変わってしまう。
 */

import { backupPathFor, createFileIn, resolveFileHandle } from '../engine/fileSystemPath';
import { readPixels, writePixels } from '../engine/imagePixels';
import {
  bakePegTransform,
  detectPegHoles,
  PegDetectOptions,
  PegReference,
  PegTransform,
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
}

export interface PegWorkerDone {
  id: number;
  /** 測れた / 焼き込めたか (見送りは false + reason) */
  ok: boolean;
  reason?: string;
  /** measure のときの補正量 */
  transform?: PegTransform;
  /** ログに出す補正量 */
  detail?: string;
}

let setup: PegWorkerInit | null = null;

/**
 * 補正量を測るだけ。
 * ⚠️ ここでは書き込まないこと。他の枚と食い違う値かどうかは、
 * 全部を測り終えるまで分からない (誤検出をそのまま焼き込まないため)。
 */
async function measureOne(path: string): Promise<{ ok: boolean; reason?: string; transform?: PegTransform }> {
  const s = setup!;
  const fileHandle = await resolveFileHandle(s.dir, path, s.rootName);
  const image = await readPixels(await fileHandle.getFile(), path);

  const detection = detectPegHoles(image.data, image.width, image.height, s.options);
  if (!detection.detected) return { ok: false, reason: detection.message };

  return { ok: true, transform: pegTransformTo(detection, s.reference, image.width, image.height) };
}

/** 決まった補正量で焼き込んで書き戻す */
async function bakeOne(
  path: string,
  transform: PegTransform
): Promise<{ ok: boolean; reason?: string; detail?: string }> {
  const s = setup!;
  const fileHandle = await resolveFileHandle(s.dir, path, s.rootName);
  const file: File = await fileHandle.getFile();
  const image = await readPixels(file, path);

  if (transform.offsetX === 0 && transform.offsetY === 0 && transform.rotation === 0 && transform.scale === 1) {
    return { ok: true, detail: 'すでに合っている' };
  }

  const moved = bakePegTransform(image.data, image.width, image.height, transform);
  const body = await writePixels(moved, image.width, image.height, path, image.tga);

  if (s.mode === 'copy') {
    // 元のフォルダ構成を保ったまま、書き出し先の同じ場所へ置く
    const target = await createFileIn(s.outputDir, path);
    const writable = await target.createWritable();
    await writable.write(body);
    await writable.close();
  } else {
    if (s.backup) {
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
      `X ${transform.offsetX}px / Y ${transform.offsetY}px / 回転 ${transform.rotation}°` +
      ` / 倍率 ${(transform.scale * 100).toFixed(2)}%`,
  };
}

self.onmessage = async (e: MessageEvent<PegWorkerInit | PegWorkerMeasure | PegWorkerBake>) => {
  const data = e.data;

  if (data.type === 'init') {
    setup = data;
    return;
  }

  try {
    const result = data.type === 'measure' ? await measureOne(data.path) : await bakeOne(data.path, data.transform);
    const done: PegWorkerDone = { id: data.id, ...result };
    self.postMessage(done);
  } catch (err: any) {
    const done: PegWorkerDone = { id: data.id, ok: false, reason: String(err?.message || err) };
    self.postMessage(done);
  }
};
