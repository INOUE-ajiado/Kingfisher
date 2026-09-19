import { describe, it, expect } from 'vitest';
import {
  clampZoom,
  framesPerTile,
  maxZoom,
  nearestFrame,
  positionAtTime,
  scrollLeftAfterZoom,
  scrollToRevealPlayhead,
  sliderFromZoom,
  tileAt,
  tileCount,
  timeAtPosition,
  timelineWidth,
  totalFrames,
  visibleTileRange,
  zoomFromSlider,
} from './rushTimeline';

const FPS = 24;
const TILE = 80;
const VIEW = 800;

describe('拡大率の範囲', () => {
  it('最大まで拡大するとタイル 1 枚が 1 コマになる', () => {
    const duration = 10; // 240 コマ
    const max = maxZoom(duration, FPS, VIEW, TILE);
    const width = timelineWidth(VIEW, max);
    expect(tileCount(width, TILE)).toBe(240);
    expect(framesPerTile(width, TILE, duration, FPS)).toBeCloseTo(1);
    // 各タイルが 1 コマずつ、順に並ぶ
    const frames = Array.from({ length: 240 }, (_, i) => tileAt(i, width, TILE, duration, FPS).frame);
    expect(frames).toEqual(Array.from({ length: 240 }, (_, i) => i));
  });

  it('短すぎて全体が 1 画面に収まる動画は拡大しない (最大 1)', () => {
    expect(maxZoom(0.2, FPS, VIEW, TILE)).toBe(1); // 5 コマ × 80px = 400px < 800px
  });

  it('範囲外の倍率は丸める', () => {
    expect(clampZoom(0.3, 10)).toBe(1);
    expect(clampZoom(50, 10)).toBe(10);
    expect(clampZoom(Number.NaN, 10)).toBe(1);
  });

  it('スライダーは対数で割り付け、往復しても同じ値に戻る', () => {
    const max = 100;
    expect(zoomFromSlider(0, max)).toBe(1);
    expect(zoomFromSlider(1, max)).toBeCloseTo(100);
    expect(zoomFromSlider(0.5, max)).toBeCloseTo(10);
    expect(sliderFromZoom(zoomFromSlider(0.37, max), max)).toBeCloseTo(0.37);
    expect(sliderFromZoom(5, 1)).toBe(0);
  });
});

describe('タイルの割り付け', () => {
  it('全体表示ではタイルが動画全体に散らばる (先頭は 0 コマ目、最後は終わり近く)', () => {
    const duration = 60; // 1440 コマ
    const width = timelineWidth(VIEW, 1);
    const count = tileCount(width, TILE);
    expect(count).toBe(10);
    expect(tileAt(0, width, TILE, duration, FPS).frame).toBe(0);
    expect(tileAt(count - 1, width, TILE, duration, FPS).frame).toBe(1296);
  });

  it('最後のタイルが端数ならタイルの幅を詰める', () => {
    const tile = tileAt(9, 750, TILE, 10, FPS);
    expect(tile.left).toBe(720);
    expect(tile.width).toBe(30);
  });

  it('見えている範囲のタイルだけを返す (前後に余分を含む)', () => {
    expect(visibleTileRange(0, VIEW, TILE, 100, 2)).toEqual({ first: 0, last: 11 });
    expect(visibleTileRange(1600, VIEW, TILE, 100, 2)).toEqual({ first: 18, last: 31 });
    expect(visibleTileRange(7600, VIEW, TILE, 100, 2)).toEqual({ first: 93, last: 99 });
    expect(visibleTileRange(0, VIEW, TILE, 0)).toBeNull();
  });
});

describe('位置と時刻', () => {
  it('クリックした位置のコマの真ん中へシークする (タイムコードの floor で同じコマに読める)', () => {
    const duration = 10;
    const width = 2400; // 1 コマ 10px
    const t = timeAtPosition(125, width, duration, FPS); // 12 コマ目の中
    expect(Math.floor(t * FPS)).toBe(12);
    expect(t).toBeCloseTo(12.5 / FPS);
  });

  it('端をはみ出しても最初 / 最後のコマに収まる', () => {
    expect(Math.floor(timeAtPosition(-50, 2400, 10, FPS) * FPS)).toBe(0);
    expect(Math.floor(timeAtPosition(99999, 2400, 10, FPS) * FPS)).toBe(239);
    expect(timeAtPosition(10, 0, 10, FPS)).toBe(0);
  });

  it('時刻から位置へ戻せる', () => {
    expect(positionAtTime(5, 2400, 10)).toBe(1200);
    expect(positionAtTime(20, 2400, 10)).toBe(2400);
    expect(positionAtTime(1, 2400, 0)).toBe(0);
  });

  it('総コマ数は端数を切り上げる', () => {
    expect(totalFrames(10, FPS)).toBe(240);
    expect(totalFrames(10.01, FPS)).toBe(241);
    expect(totalFrames(0, FPS)).toBe(1);
  });
});

describe('拡大・縮小とスクロール', () => {
  it('カーソルの下にあった時刻が、拡大後も同じ場所に残る', () => {
    const anchorX = 300;
    const scroll = 400;
    const oldZoom = 2;
    const newZoom = 5;
    const next = scrollLeftAfterZoom(scroll, anchorX, VIEW, oldZoom, newZoom);
    const ratioBefore = (scroll + anchorX) / timelineWidth(VIEW, oldZoom);
    const ratioAfter = (next + anchorX) / timelineWidth(VIEW, newZoom);
    expect(ratioAfter).toBeCloseTo(ratioBefore);
  });

  it('縮小してはみ出すスクロール位置は範囲に収める', () => {
    expect(scrollLeftAfterZoom(3000, 700, VIEW, 5, 1)).toBe(0);
    expect(scrollLeftAfterZoom(0, 0, VIEW, 1, 3)).toBe(0);
  });

  it('再生ヘッドが見えていればスクロールしない', () => {
    expect(scrollToRevealPlayhead(500, 0, VIEW, 4000)).toBeNull();
  });

  it('再生ヘッドが右へ抜けたらページをめくる (左寄りに置き直す)', () => {
    const next = scrollToRevealPlayhead(1000, 0, VIEW, 4000);
    expect(next).toBe(1000 - VIEW * 0.15);
  });

  it('全体が収まっているときはスクロールしない', () => {
    expect(scrollToRevealPlayhead(1000, 0, VIEW, VIEW)).toBeNull();
  });

  it('終わり近くでは最後までしかスクロールしない', () => {
    expect(scrollToRevealPlayhead(3990, 0, VIEW, 4000)).toBe(3200);
  });
});

describe('仮の絵に使うサムネイル', () => {
  it('一番近いコマを選ぶ', () => {
    const frames = [0, 24, 48, 96];
    expect(nearestFrame(frames, 30)).toBe(24);
    expect(nearestFrame(frames, 40)).toBe(48);
    expect(nearestFrame(frames, 500)).toBe(96);
    expect(nearestFrame(frames, -3)).toBe(0);
    expect(nearestFrame([], 3)).toBeNull();
  });
});
