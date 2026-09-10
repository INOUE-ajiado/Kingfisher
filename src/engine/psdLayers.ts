import { readPsd, Layer as AgLayer } from 'ag-psd';
import { TGAImage } from './tga';

export interface PSDLayerData {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0.0 ~ 1.0
  blendMode?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  canvas?: HTMLCanvasElement;
  imageData?: ImageData;
}

export interface PSDDecodeResult {
  compositeImage: TGAImage;
  layers: PSDLayerData[];
}

/** PSD バッファからレイヤー構造を再帰的・フラットに抽出する */
export function parsePsdLayers(buffer: ArrayBuffer): PSDDecodeResult {
  const psd = readPsd(buffer, { skipLayerImageData: false, skipCompositeImageData: false });
  const layers: PSDLayerData[] = [];
  let seq = 0;

  function collectLayers(items?: AgLayer[]) {
    if (!items) return;
    for (const item of items) {
      // フォルダ（グループ）ではなく画像データを持つレイヤーを抽出
      if (item.children) {
        collectLayers(item.children);
      } else {
        seq += 1;
        const left = item.left || 0;
        const top = item.top || 0;
        const width = item.canvas ? item.canvas.width : (typeof item.right === 'number' ? item.right - left : 0);
        const height = item.canvas ? item.canvas.height : (typeof item.bottom === 'number' ? item.bottom - top : 0);
        const opacity = typeof item.opacity === 'number' ? item.opacity : 1.0;
        const visible = item.hidden !== true;

        layers.push({
          id: `psd-layer-${seq}`,
          name: item.name || `Layer ${seq}`,
          visible,
          opacity,
          blendMode: item.blendMode,
          left,
          top,
          width,
          height,
          canvas: item.canvas,
          imageData: item.imageData as unknown as ImageData,
        });
      }
    }
  }

  if (psd.children && psd.children.length > 0) {
    collectLayers(psd.children);
  } else if (psd.canvas) {
    // レイヤーが単一の場合
    layers.push({
      id: 'psd-layer-1',
      name: 'Background',
      visible: true,
      opacity: 1.0,
      left: 0,
      top: 0,
      width: psd.width,
      height: psd.height,
      canvas: psd.canvas,
      imageData: psd.imageData as unknown as ImageData,
    });
  }

  // 合成された初期画像
  const compositeImage = renderPsdComposite(psd.width, psd.height, layers);

  return {
    compositeImage,
    layers,
  };
}

/**
 * 有効な PSD レイヤー群をキャンバス上で下層から順に重ね合わせて合成し、
 * Kingfisher 共通の TGAImage 形式として出力する。
 */
export function renderPsdComposite(
  width: number,
  height: number,
  layers: PSDLayerData[]
): TGAImage {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.clearRect(0, 0, width, height);

      for (const layer of layers) {
        if (!layer.visible || layer.opacity <= 0) continue;

        ctx.save();
        ctx.globalAlpha = layer.opacity;

        if (layer.canvas) {
          ctx.drawImage(layer.canvas, layer.left, layer.top);
        } else if (layer.imageData) {
          // imageData を描画用 Offscreen Canvas へ展開
          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = layer.imageData.width;
          tmpCanvas.height = layer.imageData.height;
          const tmpCtx = tmpCanvas.getContext('2d');
          if (tmpCtx) {
            tmpCtx.putImageData(layer.imageData, 0, 0);
            ctx.drawImage(tmpCanvas, layer.left, layer.top);
          }
        }

        ctx.restore();
      }

      const imgData = ctx.getImageData(0, 0, width, height);
      return {
        width,
        height,
        pixelDepth: 32,
        data: imgData.data,
        isReadOnly: true,
      };
    }
  }

  // キャンバスコンテキストまたは DOM 無し環境でのフォールバック
  return {
    width,
    height,
    pixelDepth: 32,
    data: new Uint8ClampedArray(width * height * 4),
    isReadOnly: true,
  };
}
