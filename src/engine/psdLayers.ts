import { readPsd, Layer as AgLayer } from 'ag-psd';
import { TGAImage } from './tga';
import { usePaintStore } from '../store/usePaintStore';

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

  function collectLayers(items?: AgLayer[], parentVisible = true, parentOpacity = 1.0) {
    if (!items) return;
    for (const item of items) {
      const itemVisible = parentVisible && item.hidden !== true;
      const itemOpacity = parentOpacity * (typeof item.opacity === 'number' ? item.opacity : 1.0);

      // フォルダ（グループ）の場合、非表示・透明度を引き継いで再帰走査
      if (item.children) {
        collectLayers(item.children, itemVisible, itemOpacity);
      } else {
        seq += 1;
        const left = item.left || 0;
        const top = item.top || 0;
        const width = item.canvas ? item.canvas.width : (typeof item.right === 'number' ? item.right - left : 0);
        const height = item.canvas ? item.canvas.height : (typeof item.bottom === 'number' ? item.bottom - top : 0);

        layers.push({
          id: `psd-layer-${seq}`,
          name: item.name || `Layer ${seq}`,
          visible: itemVisible,
          opacity: itemOpacity,
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

  let compositeImage: TGAImage;

  // Photoshop が保持する完璧な事前合成データ (psd.canvas) が存在する場合はそれを優先使用
  if (psd.canvas && typeof document !== 'undefined') {
    const ctx = psd.canvas.getContext('2d');
    if (ctx) {
      const imgData = ctx.getImageData(0, 0, psd.width, psd.height);
      const isAuth = usePaintStore?.getState()?.isAuthenticated ?? false;
      compositeImage = {
        width: psd.width,
        height: psd.height,
        pixelDepth: 32,
        data: imgData.data,
        isReadOnly: !isAuth,
      };
    } else {
      compositeImage = renderPsdComposite(psd.width, psd.height, layers);
    }
  } else {
    compositeImage = renderPsdComposite(psd.width, psd.height, layers);
  }

  return {
    compositeImage,
    layers,
  };
}

export function mapPsdBlendModeToCanvas(blendMode?: string): GlobalCompositeOperation {
  if (!blendMode) return 'source-over';
  const mode = blendMode.toLowerCase().replace(/[\s\-_]/g, '');
  switch (mode) {
    case 'multiply':
      return 'multiply';
    case 'screen':
      return 'screen';
    case 'overlay':
      return 'overlay';
    case 'darken':
      return 'darken';
    case 'lighten':
      return 'lighten';
    case 'colordodge':
      return 'color-dodge';
    case 'colorburn':
      return 'color-burn';
    case 'hardlight':
      return 'hard-light';
    case 'softlight':
      return 'soft-light';
    case 'difference':
      return 'difference';
    case 'exclusion':
      return 'exclusion';
    case 'hue':
      return 'hue';
    case 'saturation':
      return 'saturation';
    case 'color':
      return 'color';
    case 'luminosity':
      return 'luminosity';
    case 'normal':
    case 'passthrough':
    default:
      return 'source-over';
  }
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
  const isAuth = usePaintStore?.getState()?.isAuthenticated ?? false;

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.clearRect(0, 0, width, height);

      let isFirstDrawnLayer = true;

      // layers[0] が最前面、layers[length - 1] が最背面となっているため
      // レイヤー重ね合わせ描画は最背面から最前面に向けてループを行う
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        if (!layer.visible || layer.opacity <= 0) continue;

        ctx.save();
        ctx.globalAlpha = layer.opacity;

        // 透明キャンバスへの乗算による描画消失・黒化を防ぐため、最初の可視層は source-over でベース描画
        if (isFirstDrawnLayer) {
          ctx.globalCompositeOperation = 'source-over';
          isFirstDrawnLayer = false;
        } else {
          ctx.globalCompositeOperation = mapPsdBlendModeToCanvas(layer.blendMode);
        }

        if (layer.canvas) {
          ctx.drawImage(layer.canvas, layer.left, layer.top);
        } else if (layer.imageData) {
          // imageData を描画用 Offscreen Canvas へ展開
          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = layer.imageData.width || layer.width;
          tmpCanvas.height = layer.imageData.height || layer.height;
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
        isReadOnly: !isAuth,
      };
    }
  }

  // キャンバスコンテキストまたは DOM 無し環境でのフォールバック
  return {
    width,
    height,
    pixelDepth: 32,
    data: new Uint8ClampedArray(width * height * 4),
    isReadOnly: !isAuth,
  };
}
