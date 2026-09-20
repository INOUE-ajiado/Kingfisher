import { describe, it, expect } from 'vitest';
import { commandSeek, commandStep, commandToggle, expectedPosition, shouldResync } from './rushPlaybackSync';

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

describe('オペレーターの操作 → 全員に配る再生状態', () => {
  const playing = { playing: true, position: 3, live: true };
  const paused = { playing: false, position: 3, live: true };

  it('再生中に押すと止まり、止まっているときに押すと再生する', () => {
    expect(commandToggle(playing, 5, 10)).toEqual({ playing: false, position: 5, live: true });
    expect(commandToggle(paused, 5, 10)).toEqual({ playing: true, position: 5, live: true });
  });

  it('終わりまで見たあとに押すと頭から再生する', () => {
    expect(commandToggle(paused, 10, 10).position).toBe(0);
    expect(commandToggle(paused, 9.99, 10).position).toBe(0);
    expect(commandToggle(paused, 9.9, 10).position).toBe(9.9);
  });

  it('シークは再生中かどうかを変えない', () => {
    expect(commandSeek(playing, 7, 10)).toEqual({ playing: true, position: 7, live: true });
    expect(commandSeek(paused, 7, 10)).toEqual({ playing: false, position: 7, live: true });
  });

  it('コマ送りは止めてから動かす', () => {
    expect(commandStep(playing, 3, 1, 24, 10)).toEqual({ playing: false, position: 3 + 1 / 24, live: true });
    expect(commandStep(playing, 3, -10, 24, 10).position).toBeCloseTo(3 - 10 / 24);
  });

  it('端をはみ出さない。尺が分からないうちは下だけ止める', () => {
    expect(commandStep(paused, 9.99, 10, 24, 10).position).toBe(10);
    expect(commandStep(paused, 0.01, -10, 24, 10).position).toBe(0);
    expect(commandSeek(paused, 99, Number.NaN).position).toBe(99);
  });
});
