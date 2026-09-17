/**
 * ProRes の 1 コマを復号して ImageBitmap で返す Worker。
 * ファイルは最初に 1 度だけ受け取り、以後はコマの位置だけを受け取って自分で読む。
 */

import { decodeProResFrame, planesToRgba, type ProResPlanes } from '../engine/prores/proresBitstream';

export type ProResWorkerRequest =
  | { type: 'init'; file: Blob }
  | { type: 'decode'; id: number; offset: number; size: number };

export type ProResWorkerResponse =
  | { type: 'frame'; id: number; bitmap: ImageBitmap; ms: number }
  | { type: 'error'; id: number; message: string };

let file: Blob | null = null;
let planes: ProResPlanes | null = null;
let rgba: Uint8ClampedArray<ArrayBuffer> | null = null;

self.onmessage = async (e: MessageEvent<ProResWorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    file = msg.file;
    return;
  }

  const started = performance.now();
  try {
    if (!file) throw new Error('ファイルが渡されていません');
    const bytes = new Uint8Array(await file.slice(msg.offset, msg.offset + msg.size).arrayBuffer());
    planes = decodeProResFrame(bytes, planes);
    const { width, height } = planes.header;
    if (!rgba || rgba.length !== width * height * 4) rgba = new Uint8ClampedArray(width * height * 4);
    planesToRgba(planes, rgba);
    const bitmap = await createImageBitmap(new ImageData(rgba, width, height));
    const res: ProResWorkerResponse = { type: 'frame', id: msg.id, bitmap, ms: performance.now() - started };
    (self as unknown as Worker).postMessage(res, [bitmap]);
  } catch (err) {
    const res: ProResWorkerResponse = { type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(res);
  }
};
