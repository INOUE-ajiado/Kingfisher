import { describe, it, expect } from 'vitest';
import { applyMoveToList, buildMoveToFolderPlan, invalidFolderName } from './folderPlan';

/**
 * 「新しいフォルダにまとめる」の下ごしらえ。
 *
 * 制作データを動かす操作なので、ここで守りたいのは
 *  - 作る場所を勝手に決めないこと (選んだファイルの置き場所に作る)
 *  - 上書きになる組み合わせを、動かす前に全部見つけること
 */

describe('フォルダ名', () => {
  it('使えない文字と空を弾く', () => {
    expect(invalidFolderName('作画')).toBeNull();
    expect(invalidFolderName('  ')).toContain('空');
    expect(invalidFolderName('a/b')).toContain('使えない文字');
    expect(invalidFolderName('..')).toContain('不正');
  });
});

describe('まとめる計画', () => {
  const list = ['Cut/a/a0001.tga', 'Cut/a/a0002.tga', 'Cut/a/a0003.tga', 'Cut/b/b0001.tga'];

  it('同じフォルダのファイルは、その中に新しいフォルダを作る', () => {
    const plan = buildMoveToFolderPlan(['Cut/a/a0001.tga', 'Cut/a/a0002.tga'], 'ボツ', list);

    expect(plan.problems).toEqual([]);
    expect(plan.folderPath).toBe('Cut/a/ボツ');
    expect(plan.items).toEqual([
      { from: 'Cut/a/a0001.tga', to: 'Cut/a/ボツ/a0001.tga' },
      { from: 'Cut/a/a0002.tga', to: 'Cut/a/ボツ/a0002.tga' },
    ]);
  });

  it('ばらけているときはルート直下に作る', () => {
    const plan = buildMoveToFolderPlan(['Cut/a/a0001.tga', 'Cut/b/b0001.tga'], 'まとめ', list);

    expect(plan.problems).toEqual([]);
    expect(plan.folderPath).toBe('まとめ');
    expect(plan.items.map((i) => i.to)).toEqual(['まとめ/a0001.tga', 'まとめ/b0001.tga']);
  });

  it('同じ名前が重なるなら中止する (move は黙って上書きする)', () => {
    const plan = buildMoveToFolderPlan(['Cut/a/a0001.tga', 'Cut/b/a0001.tga'], 'まとめ', [
      'Cut/a/a0001.tga',
      'Cut/b/a0001.tga',
    ]);

    expect(plan.problems.join()).toContain('同じ名前のファイルが重なります');
  });

  it('移動先に同じ名前があるなら中止する', () => {
    const plan = buildMoveToFolderPlan(['Cut/a/a0001.tga'], 'ボツ', [
      'Cut/a/a0001.tga',
      'Cut/a/ボツ/a0001.tga',
    ]);

    expect(plan.problems.join()).toContain('移動先に同じ名前のファイルがあります');
  });

  it('すでにそのフォルダの中なら、何もしないと伝える', () => {
    const plan = buildMoveToFolderPlan(['Cut/a/ボツ/a0001.tga'], 'ボツ', ['Cut/a/ボツ/a0001.tga']);

    expect(plan.items).toEqual([]);
    expect(plan.problems.join()).toContain('すでにそのフォルダの中');
  });

  it('一覧は移したものだけ差し替える', () => {
    const items = [{ from: 'Cut/a/a0002.tga', to: 'Cut/a/ボツ/a0002.tga' }];
    expect(applyMoveToList(list, items)).toEqual([
      'Cut/a/a0001.tga',
      'Cut/a/ボツ/a0002.tga',
      'Cut/a/a0003.tga',
      'Cut/b/b0001.tga',
    ]);
  });
});
