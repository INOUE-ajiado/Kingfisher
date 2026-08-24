import { describe, it, expect } from 'vitest';
import { floodFill, sampleColorAt, ToolOptions, RGBAColor } from './paintAlgorithm';

/**
 * 彩色コアアルゴリズムのテスト。
 *
 * Kingfisher は「純白 (255,255,255) = 透明」を前提にしているため、
 * テスト用キャンバスも白かつ alpha 0 で初期化し、線画だけを不透明で描く。
 */

const W = 60;
const H = 40;

function newCanvas(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255;
    d[i + 1] = 255;
    d[i + 2] = 255;
    d[i + 3] = 0; // 純白 = 透明
  }
  return d;
}

function setPx(d: Uint8ClampedArray, x: number, y: number, r: number, g: number, b: number, a: number) {
  const i = (y * W + x) * 4;
  d[i] = r;
  d[i + 1] = g;
  d[i + 2] = b;
  d[i + 3] = a;
}

function getPx(d: Uint8ClampedArray, x: number, y: number) {
  const i = (y * W + x) * 4;
  return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
}

/** (5,5)-(30,30) の黒枠。gapAtTop > 0 なら上辺の中央に隙間を空ける */
function drawBox(d: Uint8ClampedArray, gapAtTop = 0) {
  const x0 = 5;
  const x1 = 30;
  const y0 = 5;
  const y1 = 30;
  const gapStart = 17;

  for (let x = x0; x <= x1; x++) {
    const inGap = gapAtTop > 0 && x >= gapStart && x < gapStart + gapAtTop;
    if (!inGap) setPx(d, x, y0, 0, 0, 0, 255);
    setPx(d, x, y1, 0, 0, 0, 255);
  }
  for (let y = y0; y <= y1; y++) {
    setPx(d, x0, y, 0, 0, 0, 255);
    setPx(d, x1, y, 0, 0, 0, 255);
  }
}

function countFilled(d: Uint8ClampedArray, color: { r: number; g: number; b: number }) {
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] === color.r && d[i + 1] === color.g && d[i + 2] === color.b && d[i + 3] === 255) n++;
  }
  return n;
}

const baseOptions: ToolOptions = {
  gapCloseLevel: 0,
  enableIncludeTrace: false,
  retainTraceLine: false,
  traceColors: { red: false, blue: false, green: false },
  tolerance: 0,
  brushSize: 5,
  expandContract: 0,
  contiguous: true,
  sampleSize: '1x1',
  referenceLayer: 'current',
};

const YELLOW: RGBAColor = { r: 255, g: 255, b: 0, a: 255 };

/** 枠内 (24x24) の面積 */
const BOX_INTERIOR = 576;

describe('floodFill — 基本動作', () => {
  it('閉じた領域の内側だけを塗る', () => {
    const d = newCanvas();
    drawBox(d);
    floodFill(d, W, H, 15, 15, YELLOW, baseOptions);

    expect(getPx(d, 15, 15)).toEqual({ r: 255, g: 255, b: 0, a: 255 });
    expect(getPx(d, 50, 35).a).toBe(0); // 枠の外は透明のまま
    expect(countFilled(d, YELLOW)).toBe(BOX_INTERIOR);
  });

  it('線そのものをクリックしても全面が塗り潰されない', () => {
    // 「透明画素は常に通り抜け可能」というルールは、基準色が透明のときだけ成立する。
    // 線をクリックした場合は透明部分を壁として扱わないとセル全域へ流出する。
    const d = newCanvas();
    drawBox(d);
    floodFill(d, W, H, 5, 5, YELLOW, baseOptions); // 枠の角 (黒線) をクリック

    expect(countFilled(d, YELLOW)).toBe(100); // 枠の周囲長のみ
    expect(getPx(d, 15, 15).a).toBe(0); // 内側は無傷
    expect(getPx(d, 50, 35).a).toBe(0); // 外側も無傷
  });
});

describe('隙間閉じ (gapCloseLevel)', () => {
  it('OFF のときは 3px の切れ目から液漏れする', () => {
    const d = newCanvas();
    drawBox(d, 3);
    floodFill(d, W, H, 15, 15, YELLOW, baseOptions);

    expect(getPx(d, 50, 35).a).toBe(255); // 枠の外まで漏れている
    expect(countFilled(d, YELLOW)).toBeGreaterThan(BOX_INTERIOR * 2);
  });

  it('ON にすると 3px の切れ目を塞いで液漏れを止める', () => {
    const d = newCanvas();
    drawBox(d, 3);
    floodFill(d, W, H, 15, 15, YELLOW, { ...baseOptions, gapCloseLevel: 6 });

    expect(getPx(d, 15, 15).g).toBe(255); // 内側は塗られる
    expect(getPx(d, 50, 35).a).toBe(0); // 外側へ漏れない
    // 枠内とほぼ同じ面積に収まる
    expect(countFilled(d, YELLOW)).toBeLessThan(BOX_INTERIOR * 1.2);
  });

  it('設定値より広い開口部は塗り抜ける', () => {
    const d = newCanvas();
    drawBox(d, 10); // gapCloseLevel(6) より広い 10px の大穴
    floodFill(d, W, H, 15, 15, YELLOW, { ...baseOptions, gapCloseLevel: 6 });

    expect(getPx(d, 50, 35).a).toBe(255);
  });
});

describe('連続 / 非連続 (contiguous)', () => {
  /** 元の枠に加えて、離れた位置に独立した箱をもう一つ置く */
  function canvasWithTwoBoxes() {
    const d = newCanvas();
    drawBox(d);
    for (let x = 40; x <= 50; x++) {
      setPx(d, x, 5, 0, 0, 0, 255);
      setPx(d, x, 15, 0, 0, 0, 255);
    }
    for (let y = 5; y <= 15; y++) {
      setPx(d, 40, y, 0, 0, 0, 255);
      setPx(d, 50, y, 0, 0, 0, 255);
    }
    return d;
  }

  it('true なら繋がっている領域だけを塗る', () => {
    const d = canvasWithTwoBoxes();
    floodFill(d, W, H, 15, 15, YELLOW, { ...baseOptions, contiguous: true });
    expect(getPx(d, 45, 10).a).toBe(0);
  });

  it('false なら離れた同色領域もまとめて塗る', () => {
    const d = canvasWithTwoBoxes();
    floodFill(d, W, H, 15, 15, YELLOW, { ...baseOptions, contiguous: false });
    expect(getPx(d, 45, 10)).toEqual({ r: 255, g: 255, b: 0, a: 255 });
  });
});

describe('領域の拡張 / 縮小 (expandContract)', () => {
  function filledCount(expandContract: number) {
    const d = newCanvas();
    drawBox(d);
    floodFill(d, W, H, 15, 15, YELLOW, { ...baseOptions, expandContract });
    return countFilled(d, YELLOW);
  }

  it('プラスで領域が広がる (アンチエイリアス線の下へ潜り込む)', () => {
    expect(filledCount(3)).toBeGreaterThan(filledCount(0));
  });

  it('マイナスで領域が狭まる', () => {
    const contracted = filledCount(-3);
    expect(contracted).toBeLessThan(filledCount(0));
    expect(contracted).toBeGreaterThan(0);
  });
});

describe('色トレス線 (含み塗り / 塗り残し)', () => {
  /** 枠の内部を赤いトレス線が横切るキャンバス */
  function canvasWithRedTrace() {
    const d = newCanvas();
    drawBox(d);
    for (let x = 6; x <= 29; x++) setPx(d, x, 18, 255, 0, 0, 255);
    return d;
  }
  const redOnly = { red: true, blue: false, green: false };

  it('含み塗り ON なら赤トレス線が壁になる', () => {
    const d = canvasWithRedTrace();
    floodFill(d, W, H, 15, 10, YELLOW, {
      ...baseOptions,
      enableIncludeTrace: true,
      traceColors: redOnly,
    });
    expect(getPx(d, 15, 25).a).toBe(0); // 線の向こう側は塗られない
  });

  it('含み塗り OFF なら赤トレス線を越えて塗る', () => {
    const d = canvasWithRedTrace();
    floodFill(d, W, H, 15, 10, YELLOW, { ...baseOptions, enableIncludeTrace: false });
    expect(getPx(d, 15, 25).g).toBe(255);
  });

  it('retainTraceLine なら線自体は塗り残す', () => {
    const d = canvasWithRedTrace();
    floodFill(d, W, H, 15, 10, YELLOW, {
      ...baseOptions,
      enableIncludeTrace: false,
      retainTraceLine: true,
      traceColors: redOnly,
    });
    expect(getPx(d, 15, 18)).toEqual({ r: 255, g: 0, b: 0, a: 255 }); // 赤のまま
    expect(getPx(d, 15, 25).g).toBe(255); // 線の向こう側は塗られている
  });
});

describe('サンプル範囲 (sampleSize)', () => {
  it('1x1 は中心の画素をそのまま採る', () => {
    const d = newCanvas();
    setPx(d, 10, 10, 0, 0, 0, 255);
    expect(sampleColorAt(d, W, H, 10, 10, '1x1')).toMatchObject({ r: 0, g: 0, b: 0 });
  });

  it('3x3 は周囲を平均する', () => {
    const d = newCanvas();
    setPx(d, 10, 10, 0, 0, 0, 255); // 中心だけ黒、周囲は白
    const s = sampleColorAt(d, W, H, 10, 10, '3x3');
    expect(s.r).toBeGreaterThan(200);
    expect(s.r).toBeLessThan(255);
  });

  it('画像の端でもはみ出さずに採取できる', () => {
    const d = newCanvas();
    expect(() => sampleColorAt(d, W, H, 0, 0, '5x5')).not.toThrow();
    expect(sampleColorAt(d, W, H, 0, 0, '5x5').r).toBe(255);
  });
});

describe('参照レイヤー (referenceLayer)', () => {
  it('reference 指定なら別画像の線で塗りが止まる', () => {
    const canvas = newCanvas(); // 編集対象は真っさら
    const ref = newCanvas();
    drawBox(ref); // 境界線は参照画像側にだけ存在する

    floodFill(canvas, W, H, 15, 15, YELLOW, { ...baseOptions, referenceLayer: 'reference' }, ref);
    expect(countFilled(canvas, YELLOW)).toBe(BOX_INTERIOR);
  });

  it('current 指定なら参照画像は無視される', () => {
    const canvas = newCanvas();
    const ref = newCanvas();
    drawBox(ref);

    floodFill(canvas, W, H, 15, 15, YELLOW, { ...baseOptions, referenceLayer: 'current' }, ref);
    expect(countFilled(canvas, YELLOW)).toBe(W * H); // 遮るものが無いので全面
  });
});
