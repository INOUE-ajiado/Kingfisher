import { describe, it, expect } from 'vitest';
import { decodeTGA, encodeTGA, TGAImage } from './tga';
import { drawBrushLine, floodFill, removeSingleNoiseAt, ToolOptions, RGBAColor } from './paintAlgorithm';

/**
 * 「編集 → 保存 → 開き直し」を実際の関数だけで通す統合テスト。
 *
 * 単体テストは encodeTGA / decodeTGA を個別に見ているが、本当に確かめたいのは
 * ツールが書いた画素が保存を挟んで生き残るかどうか。消しゴムやゴミ取りは
 * alpha を 0 にするだけで RGB を残すため、エンコード側が「白 = 透明」の規約へ
 * 戻していないと、消した部分が元の色で復活する。
 */

const WIDTH = 16;
const HEIGHT = 16;

/** 全面を 1 色で塗った不透明な画像を作る */
function makeFilledImage(color: [number, number, number]): TGAImage {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = 255;
  }
  return { width: WIDTH, height: HEIGHT, pixelDepth: 32, data };
}

/** 保存して開き直す */
function saveAndReload(image: TGAImage): TGAImage {
  return decodeTGA(encodeTGA(image));
}

function pixelAt(image: TGAImage, x: number, y: number): number[] {
  const idx = (y * image.width + x) * 4;
  return Array.from(image.data.slice(idx, idx + 4));
}

const baseOptions: ToolOptions = {
  gapCloseLevel: 0,
  enableIncludeTrace: false,
  traceColors: { red: false, blue: false, green: false },
  tolerance: 10,
  brushSize: 2,
  expandContract: 0,
  contiguous: true,
  sampleSize: '1x1',
  referenceLayer: 'current',
};

const RED: RGBAColor = { r: 200, g: 30, b: 40, a: 255 };

describe('編集 → 保存 → 開き直し', () => {
  it('消しゴムで消した部分は開き直しても透明のまま', () => {
    const image = makeFilledImage([200, 30, 40]);

    // 横一直線に消す
    drawBrushLine(image.data, WIDTH, HEIGHT, 2, 8, 13, 8, 1.5, RED, true);
    expect(pixelAt(image, 8, 8)[3]).toBe(0);

    const reloaded = saveAndReload(image);

    // 消した画素が「元の色の不透明な画素」として蘇っていないこと
    expect(pixelAt(reloaded, 8, 8)).toEqual([255, 255, 255, 0]);
    // 触っていない場所は元の色のまま
    expect(pixelAt(reloaded, 8, 0)).toEqual([200, 30, 40, 255]);
  });

  it('ゴミ取りで消した点も開き直しても消えたまま', () => {
    // 透明な下地に、孤立した点をひとつ置く
    const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 0;
    }
    const dotIdx = (5 * WIDTH + 5) * 4;
    data.set([10, 20, 30, 255], dotIdx);
    const image: TGAImage = { width: WIDTH, height: HEIGHT, pixelDepth: 32, data };

    expect(removeSingleNoiseAt(image.data, WIDTH, HEIGHT, 5, 5)).toBe(true);

    const reloaded = saveAndReload(image);

    expect(pixelAt(reloaded, 5, 5)).toEqual([255, 255, 255, 0]);
  });

  it('バケツ塗りした色は開き直しても保たれる', () => {
    const image = makeFilledImage([240, 240, 240]);

    floodFill(image.data, WIDTH, HEIGHT, 8, 8, RED, baseOptions, null);

    const reloaded = saveAndReload(image);

    expect(pixelAt(reloaded, 8, 8)).toEqual([200, 30, 40, 255]);
  });

  it('消して塗り直した部分も、保存を挟んで塗った色が残る', () => {
    const image = makeFilledImage([240, 240, 240]);

    drawBrushLine(image.data, WIDTH, HEIGHT, 2, 8, 13, 8, 1.5, RED, true);
    drawBrushLine(image.data, WIDTH, HEIGHT, 2, 8, 13, 8, 1.5, RED, false);

    const reloaded = saveAndReload(image);

    expect(pixelAt(reloaded, 8, 8)).toEqual([200, 30, 40, 255]);
  });

  it('保存を 2 回繰り返しても内容が変化しない', () => {
    const image = makeFilledImage([200, 30, 40]);
    drawBrushLine(image.data, WIDTH, HEIGHT, 2, 8, 13, 8, 1.5, RED, true);

    const once = saveAndReload(image);
    const twice = saveAndReload(once);

    expect(Array.from(twice.data)).toEqual(Array.from(once.data));
  });
});
