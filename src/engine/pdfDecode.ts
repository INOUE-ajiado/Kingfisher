import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { TGAImage } from './tga';
import { PSDLayerData } from './psdLayers';

if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  } catch (e) {
    // コンテキスト外等の安全ガード
  }
}

export interface PDFDecodeResult {
  compositeImage: TGAImage;
  layers: PSDLayerData[];
}

/**
 * PDF ドキュメントの全ページを高精細 (2.0x) Canvas へレンダリングし、
 * 各ページを Kingfisher のレイヤー/ページ要素 (PSDLayerData 互換) として出力する。
 */
export async function decodePdfAllPages(buffer: ArrayBuffer, _fileName = 'document.pdf'): Promise<PDFDecodeResult> {
  const fallbackImage: TGAImage = {
    width: 640,
    height: 480,
    pixelDepth: 32,
    data: new Uint8ClampedArray(640 * 480 * 4),
    isReadOnly: true,
  };

  if (typeof document === 'undefined') {
    return {
      compositeImage: fallbackImage,
      layers: [],
    };
  }

  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
    });
    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages || 1;
    const layers: PSDLayerData[] = [];
    let firstPageImage: TGAImage | null = null;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const scale = 2.0; // 高解像度スケール
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
        const isFirst = pageNum === 1;

        layers.push({
          id: `pdf-page-${pageNum}`,
          name: `Page ${pageNum} / ${numPages}`,
          visible: isFirst,
          opacity: 1.0,
          left: 0,
          top: 0,
          width: canvas.width,
          height: canvas.height,
          canvas,
          imageData: imgData,
        });

        if (isFirst) {
          firstPageImage = {
            width: canvas.width,
            height: canvas.height,
            pixelDepth: 32,
            data: imgData.data,
            isReadOnly: true,
          };
        }
      }
    }

    return {
      compositeImage: firstPageImage || fallbackImage,
      layers,
    };
  } catch (err) {
    console.error('Failed to render PDF document:', err);
  }

  return {
    compositeImage: fallbackImage,
    layers: [],
  };
}

export async function decodePdfBuffer(buffer: ArrayBuffer): Promise<TGAImage> {
  const result = await decodePdfAllPages(buffer);
  return result.compositeImage;
}
