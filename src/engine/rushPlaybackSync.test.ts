import { describe, it, expect, vi } from 'vitest';
import {
  commandSeek,
  commandStep,
  commandToggle,
  createThrottledWriter,
  expectedPosition,
  shouldResync,
} from './rushPlaybackSync';

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

describe('書き込みの間引き', () => {
  const s = (position: number) => ({ playing: true, position, live: true });

  it('最初の 1 回はすぐ書き、続く操作は最後の 1 つだけ後でまとめて書く', () => {
    vi.useFakeTimers();
    const written: number[] = [];
    const w = createThrottledWriter((st) => written.push(st.position), 200);

    w.push(s(1));
    expect(written).toEqual([1]);

    w.push(s(2));
    w.push(s(3));
    w.push(s(4));
    expect(written).toEqual([1]); // まだ書かない
    vi.advanceTimersByTime(200);
    expect(written).toEqual([1, 4]); // 途中は捨てて最後だけ
    vi.useRealTimers();
  });

  it('ドラッグ 3 秒ぶん (毎秒 60 回) でも書き込みは 16 回に収まる', () => {
    vi.useFakeTimers();
    const written: number[] = [];
    const w = createThrottledWriter((st) => written.push(st.position), 200);
    for (let i = 0; i < 180; i++) {
      w.push(s(i));
      vi.advanceTimersByTime(1000 / 60);
    }
    w.flush();
    expect(written.length).toBeLessThanOrEqual(16);
    expect(written[written.length - 1]).toBe(179); // 最後の位置は必ず届く
    vi.useRealTimers();
  });

  it('間隔が空いていれば毎回すぐ書く', () => {
    vi.useFakeTimers();
    const written: number[] = [];
    const w = createThrottledWriter((st) => written.push(st.position), 200);
    w.push(s(1));
    vi.advanceTimersByTime(300);
    w.push(s(2));
    expect(written).toEqual([1, 2]);
    vi.useRealTimers();
  });

  it('cancel すると溜めていたものは書かない', () => {
    vi.useFakeTimers();
    const written: number[] = [];
    const w = createThrottledWriter((st) => written.push(st.position), 200);
    w.push(s(1));
    w.push(s(2));
    w.cancel();
    vi.advanceTimersByTime(1000);
    expect(written).toEqual([1]);
    vi.useRealTimers();
  });
});
