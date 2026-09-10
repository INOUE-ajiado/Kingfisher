/**
 * 画像ファイルの読み込み・複製まわりの共通処理。
 *
 * Kingfisher は .tga を主素材としつつ、タイムシートや指示メモの .png / .jpg も
 * 「閲覧専用」として同じパイプラインに載せる。その差異をここに閉じ込める。
 */

import { decodeTGA, TGAImage } from './tga';
import { readPsd } from 'ag-psd';

/** 画像ファイルが Kingfisher の編集対象 (TGA) かどうか */
export function isTgaFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.tga');
}

/** 画像ファイルが PSD かどうか */
export function isPsdFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.psd');
}

/** PSD ファイルを RGBA 配列へデコードする (閲覧専用扱い) */
async function decodePsdImageFile(file: File): Promise<TGAImage> {
  const buffer = await file.arrayBuffer();
  const psd = readPsd(buffer);

  if (psd.canvas) {
    const ctx = psd.canvas.getContext('2d');
    if (ctx) {
      const imgData = ctx.getImageData(0, 0, psd.width, psd.height);
      return {
        width: psd.width,
        height: psd.height,
        pixelDepth: 32,
        data: imgData.data,
        isReadOnly: true,
      };
    }
  }

  if (psd.imageData) {
    return {
      width: psd.width,
      height: psd.height,
      pixelDepth: 32,
      data: new Uint8ClampedArray(psd.imageData.data),
      isReadOnly: true,
    };
  }

  throw new Error('PSD 画像のデコードに失敗しました。');
}

/**
 * キャッシュされた画像は「読み込んだままの原本」として保持する。
 * 編集対象に渡すときは必ずこれで複製し、キャッシュ側が塗りで汚れないようにする。
 */
export function cloneTGAImage(image: TGAImage): TGAImage {
  return { ...image, data: new Uint8ClampedArray(image.data) };
}

/** PNG / JPEG を Canvas 経由で RGBA 配列へ変換する (閲覧専用扱い) */
function decodeRasterImageFile(file: File): Promise<TGAImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context error'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, img.width, img.height);
      resolve({
        width: img.width,
        height: img.height,
        pixelDepth: 32,
        data: imgData.data,
        isReadOnly: true,
      });
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };

    img.src = url;
  });
}

/**
 * 拡張子を問わず 1 枚の画像ファイルをデコードする。
 * decodeTga を渡すと TGA のデコードだけを差し替えられる (Web Worker 版を注入する用途)。
 */
export async function decodeAnyImageFile(
  file: File,
  decodeTga: (buffer: ArrayBuffer) => Promise<TGAImage> | TGAImage = decodeTGA
): Promise<TGAImage> {
  if (isTgaFile(file.name)) {
    const buffer = await file.arrayBuffer();
    return decodeTga(buffer);
  }
  if (isPsdFile(file.name)) {
    return decodePsdImageFile(file);
  }
  return decodeRasterImageFile(file);
}

/** キャンバス背景の市松模様パターン */
export function createCheckerPattern(
  ctx: CanvasRenderingContext2D,
  size: number = 8
): CanvasPattern | null {
  const patternCanvas = document.createElement('canvas');
  patternCanvas.width = size * 2;
  patternCanvas.height = size * 2;
  const pCtx = patternCanvas.getContext('2d');
  if (!pCtx) return null;

  pCtx.fillStyle = '#FFFFFF';
  pCtx.fillRect(0, 0, size * 2, size * 2);
  pCtx.fillStyle = '#CBD5E1';
  pCtx.fillRect(0, 0, size, size);
  pCtx.fillRect(size, size, size, size);

  return ctx.createPattern(patternCanvas, 'repeat');
}
