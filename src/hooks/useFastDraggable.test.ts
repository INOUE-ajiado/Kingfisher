import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clampToViewport, VIEWPORT_KEEP_VISIBLE } from './useFastDraggable';

/**
 * 独立ウィンドウの位置クランプ。
 *
 * 右方向・下方向に制限が無いと、画面外へドラッグしたウィンドウを
 * 回収できなくなる (タイトルバーごと消えるため戻すボタンも押せない)。
 */

const VIEWPORT = { width: 1280, height: 800 };

beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: VIEWPORT.width, innerHeight: VIEWPORT.height });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clampToViewport', () => {
  it('画面内の位置はそのまま通す', () => {
    expect(clampToViewport(300, 200)).toEqual({ x: 300, y: 200 });
  });

  it('左上へはみ出す位置を 0 に丸める', () => {
    expect(clampToViewport(-500, -300)).toEqual({ x: 0, y: 0 });
  });

  it('右下へはみ出しても掴める分だけ画面内に残す', () => {
    const { x, y } = clampToViewport(99999, 99999);
    expect(x).toBe(VIEWPORT.width - VIEWPORT_KEEP_VISIBLE.x);
    expect(y).toBe(VIEWPORT.height - VIEWPORT_KEEP_VISIBLE.y);
    // タイトルバーを掴める幅・高さが必ず残る
    expect(VIEWPORT.width - x).toBeGreaterThanOrEqual(VIEWPORT_KEEP_VISIBLE.x);
    expect(VIEWPORT.height - y).toBeGreaterThanOrEqual(VIEWPORT_KEEP_VISIBLE.y);
  });

  it('ブラウザを縮めた後は新しいビューポートに合わせて丸める', () => {
    const far = clampToViewport(1200, 700);
    expect(far).toEqual({ x: VIEWPORT.width - VIEWPORT_KEEP_VISIBLE.x, y: 700 });

    // ウィンドウが狭くなると、以前は画面内だった位置も引き戻される
    vi.stubGlobal('window', { innerWidth: 600, innerHeight: 400 });
    const reclamped = clampToViewport(far.x, far.y);
    expect(reclamped.x).toBe(600 - VIEWPORT_KEEP_VISIBLE.x);
    expect(reclamped.y).toBe(400 - VIEWPORT_KEEP_VISIBLE.y);
  });

  it('ビューポートが極端に小さくても負の値を返さない', () => {
    vi.stubGlobal('window', { innerWidth: 50, innerHeight: 10 });
    expect(clampToViewport(999, 999)).toEqual({ x: 0, y: 0 });
  });
});
