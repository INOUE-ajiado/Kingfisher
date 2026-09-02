import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRenderSignal,
  resetRenderSignalForTest,
  subscribeRenderSignal,
  triggerRenderSignal,
} from './renderSignal';

/**
 * 「描き直せ」の合図はストアの外に置く。
 *
 * ⚠️ ストアに入れると、ブラシを引くたびに全パネルが描き直される。
 * 線を 1 本引く間ずっとファイルツリーまで再描画されていた (2026-09-03 の監査)。
 */

beforeEach(() => {
  resetRenderSignalForTest();
});

describe('描き直しの合図', () => {
  it('叩くたびに数が進む (useSyncExternalStore が変化を見分けられる)', () => {
    const before = getRenderSignal();

    triggerRenderSignal();
    triggerRenderSignal();

    expect(getRenderSignal()).toBe(before + 2);
  });

  it('購読している側だけに届く', () => {
    let calls = 0;
    const stop = subscribeRenderSignal(() => {
      calls += 1;
    });

    triggerRenderSignal();
    expect(calls).toBe(1);

    stop();
    triggerRenderSignal();
    // ⚠️ 外したあとに呼ばれないこと。残ると描き直しが止まらなくなる
    expect(calls).toBe(1);
  });

  it('購読が無くても落ちない', () => {
    expect(() => triggerRenderSignal()).not.toThrow();
  });
});
