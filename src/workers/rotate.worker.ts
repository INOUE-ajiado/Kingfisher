/**
 * 画像を 90 度回して書き戻す担当。
 *
 * ⚠️ 読み込み・変換・書き出しを丸ごとここで済ませること。主スレッドへ画素を
 * 運ぶと、そのコピーだけで 1 枚あたり数十 MB 動くことになる。
 * ⚠️ フォルダのハンドルは受け取れる (構造化複製で渡せる)。許可の状態も
 * そのまま引き継ぐので、ここで開き直す必要はない。
 */

import { resolveFileHandle } from '../engine/fileSystemPath';
import { encodeTypeFor, rotateImageData, RotateDirection } from '../engine/rotateImage';
import { applyJpegDensity, readJpegDensity } from '../engine/jpegDensity';
import { decodeTGA, encodeTGA } from '../engine/tga';

export interface RotateWorkerInit {
  type: 'init';
  dir: any;
  rootName: string | null;
}

export interface RotateWorkerJob {
  type: 'job';
  id: number;
  path: string;
  direction: RotateDirection;
}

export interface RotateWorkerDone {
  id: number;
  ok: boolean;
  error?: string;
}

let dirHandle: any = null;
let rootName: string | null = null;

/** 使い回すキャンバス。1 枚ごとに作り直すと、その分だけ確保と解放が増える */
let canvas: OffscreenCanvas | null = null;

async function rotateOne(path: string, direction: RotateDirection): Promise<void> {
  const handle = await resolveFileHandle(dirHandle, path, rootName);
  const file: File = await handle.getFile();

  let body: Blob;

  if (/[.]tga$/i.test(path)) {
    // ⚠️ TGA はキャンバスに載せないこと。純白 = 透明の扱いが崩れる
    const image = decodeTGA(await file.arrayBuffer());
    const turned = rotateImageData(image.data, image.width, image.height, direction);
    body = new Blob([encodeTGA({ ...image, ...turned })]);
  } else {
    // ⚠️ 回しても解像度は引き継ぐこと (書き出し直すと 72dpi 相当へ落ちる)
    const density = /[.]jpe?g$/i.test(path) ? readJpegDensity(await file.arrayBuffer()) : null;

    // ⚠️ 色変換を挟ませないこと。回すだけなのに色が動く上に、その分だけ遅い
    const bitmap = await createImageBitmap(file, {
      colorSpaceConversion: 'none',
      imageOrientation: 'none',
    } as any);

    if (!canvas) canvas = new OffscreenCanvas(bitmap.height, bitmap.width);
    canvas.width = bitmap.height;
    canvas.height = bitmap.width;

    const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false });
    if (!ctx) throw new Error('キャンバスを用意できませんでした');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(direction === 'right' ? Math.PI / 2 : -Math.PI / 2);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    bitmap.close();

    const type = encodeTypeFor(path);
    body = await canvas.convertToBlob({ type: type.mime, quality: type.quality });
    if (type.mime === 'image/jpeg' && density) {
      body = new Blob([applyJpegDensity(await body.arrayBuffer(), density)], { type: type.mime });
    }
  }

  // ⚠️ Blob のまま渡すこと。arrayBuffer() を挟むと丸ごと 1 回コピーされる
  const writable = await handle.createWritable();
  await writable.write(body);
  await writable.close();
}

self.onmessage = async (e: MessageEvent<RotateWorkerInit | RotateWorkerJob>) => {
  const data = e.data;

  if (data.type === 'init') {
    dirHandle = data.dir;
    rootName = data.rootName;
    return;
  }

  try {
    await rotateOne(data.path, data.direction);
    const done: RotateWorkerDone = { id: data.id, ok: true };
    self.postMessage(done);
  } catch (err: any) {
    const done: RotateWorkerDone = { id: data.id, ok: false, error: String(err?.message || err) };
    self.postMessage(done);
  }
};
