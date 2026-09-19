import { describe, it, expect } from 'vitest';
import { expectedPosition, shouldResync } from './rushPlaybackSync';

describe('視聴者のいるべき位置', () => {
  it('再生中は受け取ってから経った分だけ進める', () => {
    const state = { playing: true, position: 10, live: true };
    expect(expectedPosition(state, 1000, 3500, 60)).toBeCloseTo(12.5);
  });

  it('停止中は経過時間を足さない (ホストの止めたコマに留まる)', () => {
    const state = { playing: false, position: 10, live: true };
    expect(expectedPosition(state, 1000, 9000, 60)).toBe(10);
  });

  it('終わりを越えない。尺が分からないうちは上限なし', () => {
    const state = { playing: true, position: 59, live: false };
    expect(expectedPosition(state, 0, 5000, 60)).toBe(60);
    expect(expectedPosition(state, 0, 5000, Number.NaN)).toBe(64);
  });

  it('時計が巻き戻っても位置は戻らない', () => {
    const state = { playing: true, position: 10, live: false };
    expect(expectedPosition(state, 5000, 4000, 60)).toBe(10);
  });
});

describe('位置を直すか', () => {
  it('再生中は 0.5 秒までの揺れを許す (シークし直すと映像が止まるため)', () => {
    expect(shouldResync(10.4, 10, true, 24)).toBe(false);
    expect(shouldResync(10.6, 10, true, 24)).toBe(true);
  });

  it('停止中は半コマでもずれていれば直す', () => {
    expect(shouldResync(10.01, 10, false, 24)).toBe(false);
    expect(shouldResync(10 + 1 / 24, 10, false, 24)).toBe(true);
  });
});
