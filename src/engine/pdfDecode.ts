import * as pdfjsLib from 'pdfjs-dist';
import { TGAImage } from './tga';

// Worker の CDN 指定（ブラウザ環境）
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  } catch (e) {
    // コンテキスト外等の安全ガード
  }
}

/**
 * PDF バッファの第 1 ページを高精細 (2.0x) Canvas へレンダリングし、
 * Kingfisher 共通の TGAImage (閲覧専用) 形式として出力する。
 */
export async function decodePdfBuffer(buffer: ArrayBuffer): Promise<TGAImage> {
  if (typeof document === 'undefined') {
    return {
      width: 640,
      height: 480,
      pixelDepth: 32,
      data: new Uint8ClampedArray(640 * 480 * 4),
      isReadOnly: true,
    };
  }

  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
    });
    const pdfDoc = await loadingTask.promise;
    const page = await pdfDoc.getPage(1);

    const scale = 2.0; // 高画質レンダリング
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');

    if (ctx) {
      const renderContext: any = {
        canvasContext: ctx,
        canvas,
        viewport,
      };
      await page.render(renderContext).promise;
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return {
        width: canvas.width,
        height: canvas.height,
        pixelDepth: 32,
        data: imgData.data,
        isReadOnly: true,
      };
    }
  } catch (err) {
    console.error('Failed to render PDF page:', err);
  }

  return {
    width: 640,
    height: 480,
    pixelDepth: 32,
    data: new Uint8ClampedArray(640 * 480 * 4),
    isReadOnly: true,
  };
}
