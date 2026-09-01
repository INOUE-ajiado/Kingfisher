import { describe, it, expect } from 'vitest';
import { isPointerInsideMenu } from './contextMenuHit';

/**
 * メニューの中を押したときに閉じてしまうと、項目の click が届かず
 * どの項目も実行できない。その一点を守るための判定。
 */

const node = (inside: boolean) => ({ nodeType: 1, __inside: inside });
const menu = { contains: (n: any) => !!n?.__inside };

describe('メニューの中かどうか', () => {
  it('中を押したときは中と答える (閉じない)', () => {
    expect(isPointerInsideMenu(menu, node(true))).toBe(true);
  });

  it('外を押したときは外と答える (閉じる)', () => {
    expect(isPointerInsideMenu(menu, node(false))).toBe(false);
  });

  it('メニューがまだ無いときは外とみなす', () => {
    expect(isPointerInsideMenu(null, node(true))).toBe(false);
  });

  it('Node でない相手 (window など) は外とみなす', () => {
    expect(isPointerInsideMenu(menu, {})).toBe(false);
    expect(isPointerInsideMenu(menu, null)).toBe(false);
  });
});
