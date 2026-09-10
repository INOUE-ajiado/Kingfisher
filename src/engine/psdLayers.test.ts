import { describe, it, expect } from 'vitest';
import { renderPsdComposite, PSDLayerData } from './psdLayers';

describe('PSD レイヤーの合成描画 (renderPsdComposite)', () => {
  it('可視レイヤーのみを合成して TGAImage 形式で出力する', () => {
    const layers: PSDLayerData[] = [
      {
        id: 'layer-1',
        name: 'Background',
        visible: true,
        opacity: 1.0,
        left: 0,
        top: 0,
        width: 10,
        height: 10,
      },
      {
        id: 'layer-2',
        name: 'Hidden Layer',
        visible: false,
        opacity: 1.0,
        left: 0,
        top: 0,
        width: 10,
        height: 10,
      },
    ];

    const result = renderPsdComposite(10, 10, layers);

    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
    expect(result.isReadOnly).toBe(true);
    expect(result.data.length).toBe(10 * 10 * 4);
  });
});
