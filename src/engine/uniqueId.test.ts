import { describe, it, expect } from 'vitest';
import { nextId } from './uniqueId';

/**
 * ⚠️ ID が重複すると、消す・書き換える処理 (filter / map) が
 * 巻き添えで別のものまで巻き込む。「1 つ消したつもりが 2 つ消える」形になる。
 */

describe('二度と重複しない ID', () => {
  it('続けて呼んでも重ならない (Date.now() はここで重なっていた)', () => {
    const ids = Array.from({ length: 1000 }, () => nextId('x'));

    expect(new Set(ids).size).toBe(1000);
  });

  it('接頭辞が付いて、どこの ID か読める', () => {
    expect(nextId('light')).toMatch(/^light-\d+-[a-z0-9]+$/);
  });

  it('接頭辞が違えば当然ぶつからない', () => {
    expect(nextId('light')).not.toBe(nextId('color'));
  });
});
