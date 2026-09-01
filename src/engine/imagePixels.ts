/**
 * 画像ファイルと RGBA の画素を行き来する。
 *
 * ⚠️ 主スレッドでもワーカーでも同じものを使うこと。OffscreenCanvas は
 * どちらでも動くので、document.createElement('canvas') を使わない。
 * 使うとワーカー側だけ動かなくなる。
 */

import { decodeTGA, encodeTGA, TGAImage } from './tga';
import { encodeTypeFor } from './rotateImage';

export interface ReadPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** TGA だったときの元の情報 (書き戻すときに使う) */
  tga: TGAImage | null;
}

/**
 * 画像を RGBA で読む。
 *
 * ⚠️ TGA は自前の復号を通すこと (純白 RGB(255,255,255) = 透明の決まりがある)。
 * スキャンした JPG や PNG はブラウザに任せる。
 * ⚠️ タップ穴はスキャン原稿にこそ空いている。TGA だけを相手にしないこと
 * (2026-09-02: JPG のスキャン 42 枚が「TGA ではありません」で全部見送られた)。
 */
export async function readPixels(
  file: File,
  path: string
): Promise<ReadPixels> {
  if (/[.]tga$/i.test(path)) {
    const image = decodeTGA(await file.arrayBuffer());
    return { data: image.data, width: image.width, height: image.height, tga: image };
  }

  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('キャンバスを用意できませんでした');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: pixels.data, width: canvas.width, height: canvas.height, tga: null };
}

/**
 * 焼き込んだ結果を、元と同じ形式に戻す。
 *
 * ⚠️ JPEG には透明が無い。空いた縁は不透明の白にしてから渡すこと。
 * 透明のまま渡すと、書き出しのときに黒く塗り潰される。
 * (bakePegTransform は空いたところを「純白 + 透明」で埋める。RGB はすでに白)
 */
export async function writePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  path: string,
  tga: TGAImage | null
): Promise<Blob> {
  if (tga) return new Blob([encodeTGA({ ...tga, data })]);

  const type = encodeTypeFor(path);
  const body = new Uint8ClampedArray(data);
  if (type.mime === 'image/jpeg') {
    for (let i = 3; i < body.length; i += 4) body[i] = 255;
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('キャンバスを用意できませんでした');
  ctx.putImageData(new ImageData(body, width, height), 0, 0);

  return canvas.convertToBlob({ type: type.mime, quality: type.quality });
}

