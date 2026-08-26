import { describe, it, expect } from 'vitest';
import { compareNatural, sortNatural } from './naturalOrder';
import { buildMergedFrameData } from '../store/types';

/**
 * 連番の並び。
 *
 * 撮影・仕上げのデータはゼロ埋めが揃っていないことが普通にあり、
 * 辞書順で並べると a1, a10, a11, a2 … となって「1 の次が 10」「1 が最後に来る」
 * という見え方になる。ツリーと連番表で並びが食い違わないことまで含めて固定する。
 */

describe('自然順の並び', () => {
  it('ゼロ埋めされていない連番を数値の順に並べる', () => {
    const files = ['a10.tga', 'a2.tga', 'a1.tga', 'a11.tga', 'a3.tga'];
    expect(sortNatural(files)).toEqual(['a1.tga', 'a2.tga', 'a3.tga', 'a10.tga', 'a11.tga']);
  });

  it('報告された並び (2,3,4,5,1) にならない', () => {
    const files = ['a2.tga', 'a3.tga', 'a4.tga', 'a5.tga', 'a1.tga'];
    expect(sortNatural(files).map((f) => f.replace(/\D/g, ''))).toEqual(['1', '2', '3', '4', '5']);
  });

  it('ゼロ埋め済みの連番はそのまま正しく並ぶ', () => {
    const files = ['A0010.tga', 'A0002.tga', 'A0001.tga'];
    expect(sortNatural(files)).toEqual(['A0001.tga', 'A0002.tga', 'A0010.tga']);
  });

  it('ゼロ埋めが混ざっていても数値として並ぶ', () => {
    expect(sortNatural(['a01.tga', 'a2.tga', 'a010.tga'])).toEqual(['a01.tga', 'a2.tga', 'a010.tga']);
  });

  it('3 桁を超えても桁で崩れない', () => {
    const files = ['c1000.tga', 'c99.tga', 'c100.tga', 'c9.tga'];
    expect(sortNatural(files)).toEqual(['c9.tga', 'c99.tga', 'c100.tga', 'c1000.tga']);
  });

  it('サブフォルダごとにまとまり、その中で連番になる', () => {
    const files = ['_go/a10.tga', '_ao/a2.tga', '_go/a2.tga', '_ao/a10.tga', '_ao/a1.tga'];
    expect(sortNatural(files)).toEqual([
      '_ao/a1.tga',
      '_ao/a2.tga',
      '_ao/a10.tga',
      '_go/a2.tga',
      '_go/a10.tga',
    ]);
  });

  it('日本語のファイル名でも落ちない', () => {
    const files = ['カット10.tga', 'カット2.tga', 'カット1.tga'];
    expect(sortNatural(files)).toEqual(['カット1.tga', 'カット2.tga', 'カット10.tga']);
  });

  it('数字を含まない名前が混ざっても並びが決まる', () => {
    const sorted = sortNatural(['memo.tga', 'a2.tga', 'a1.tga']);
    expect(sorted).toHaveLength(3);
    expect(sorted.indexOf('a1.tga')).toBeLessThan(sorted.indexOf('a2.tga'));
  });

  it('全順序になっている (同値でも順序が決まる)', () => {
    // 照合器が同値と見なす組み合わせでも 0 を返さない
    expect(compareNatural('a.tga', 'a.tga')).toBe(0);
    expect(compareNatural('A.tga', 'a.tga')).not.toBe(0);
    // 逆向きは符号が反転する
    expect(Math.sign(compareNatural('A.tga', 'a.tga'))).toBe(-Math.sign(compareNatural('a.tga', 'A.tga')));
  });
});

describe('ツリーと連番表の並びが一致する', () => {
  it('ゼロ埋めされていない連番でも同じ順になる', () => {
    // ツリーは fileListA の順、連番表は unifiedFileList の順を使う。
    // ここが食い違うと「ツリーだけ並びがおかしい」という見え方になる
    const raw = ['a10.tga', 'a2.tga', 'a1.tga', 'a11.tga', 'a3.tga'];

    const treeOrder = sortNatural(raw);
    const { unifiedFiles } = buildMergedFrameData(treeOrder, []);

    expect(unifiedFiles).toEqual(treeOrder);
  });

  it('A と B で異名連番でも、それぞれのツリーが連番順になる', () => {
    const listA = sortNatural(['a10.tga', 'a1.tga', 'a2.tga']);
    const listB = sortNatural(['b_go10.tga', 'b_go1.tga', 'b_go2.tga']);

    expect(listA).toEqual(['a1.tga', 'a2.tga', 'a10.tga']);
    expect(listB).toEqual(['b_go1.tga', 'b_go2.tga', 'b_go10.tga']);

    const { unifiedFiles } = buildMergedFrameData(listA, listB);
    expect(unifiedFiles).toEqual(listA);
  });
});
