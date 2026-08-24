import { describe, it, expect } from 'vitest';
import {
  baseName,
  splitExtension,
  replaceBaseName,
  buildSequentialRenamePlan,
  buildSingleRenamePlan,
  findInvalidNames,
  findRenameConflicts,
  needsTwoPhaseRename,
  omitUnchanged,
} from './renamePlan';

/**
 * リネームは制作データを直接書き換えるので、
 * 「何がどう変わるか」と「衝突するか」を実行前に確定できることを担保する。
 */

describe('パスの分解', () => {
  it('相対パスからファイル名を取り出す', () => {
    expect(baseName('Cut001/_go/A0001.tga')).toBe('A0001.tga');
    expect(baseName('A0001.tga')).toBe('A0001.tga');
  });

  it('拡張子を分ける', () => {
    expect(splitExtension('A0001.tga')).toEqual({ stem: 'A0001', ext: '.tga' });
    expect(splitExtension('README')).toEqual({ stem: 'README', ext: '' });
    // 先頭のドットは隠しファイル扱い
    expect(splitExtension('.env')).toEqual({ stem: '.env', ext: '' });
  });

  it('ファイル名だけを差し替える', () => {
    expect(replaceBaseName('Cut001/_go/A0001.tga', 'B0001.tga')).toBe('Cut001/_go/B0001.tga');
    expect(replaceBaseName('A0001.tga', 'B0001.tga')).toBe('B0001.tga');
  });
});

describe('連番リネームの計画', () => {
  const paths = ['_go/A0005.tga', '_go/A0006.tga', '_go/A0007.tga'];

  it('先頭・末尾のテキストと連番を組み合わせる', () => {
    const plan = buildSequentialRenamePlan(paths, {
      prefix: 'C001_',
      suffix: '_go',
      startNumber: 1,
      digits: 4,
    });

    expect(plan.map((i) => i.to)).toEqual(['C001_0001_go.tga', 'C001_0002_go.tga', 'C001_0003_go.tga']);
  });

  it('桁数を変えられる', () => {
    const to = (digits: number) =>
      buildSequentialRenamePlan(paths, { prefix: '', suffix: '', startNumber: 1, digits }).map((i) => i.to);

    expect(to(2)).toEqual(['01.tga', '02.tga', '03.tga']);
    expect(to(6)).toEqual(['000001.tga', '000002.tga', '000003.tga']);
  });

  it('桁数より大きい番号は切り捨てず伸ばす', () => {
    const plan = buildSequentialRenamePlan(paths, {
      prefix: 'A',
      suffix: '',
      startNumber: 99,
      digits: 2,
    });

    expect(plan.map((i) => i.to)).toEqual(['A99.tga', 'A100.tga', 'A101.tga']);
  });

  it('開始番号と刻みを指定できる', () => {
    const plan = buildSequentialRenamePlan(paths, {
      prefix: '',
      suffix: '',
      startNumber: 10,
      digits: 3,
      step: 5,
    });

    expect(plan.map((i) => i.to)).toEqual(['010.tga', '015.tga', '020.tga']);
  });

  it('拡張子は元のものを引き継ぐ', () => {
    const plan = buildSequentialRenamePlan(['a/x.TGA', 'a/y.png'], {
      prefix: 'n',
      suffix: '',
      startNumber: 1,
      digits: 2,
    });

    expect(plan.map((i) => i.to)).toEqual(['n01.TGA', 'n02.png']);
  });

  it('渡した順序がそのまま連番の順序になる', () => {
    const plan = buildSequentialRenamePlan(['a/z.tga', 'a/a.tga'], {
      prefix: '',
      suffix: '',
      startNumber: 1,
      digits: 1,
    });

    expect(plan).toEqual([
      { path: 'a/z.tga', from: 'z.tga', to: '1.tga' },
      { path: 'a/a.tga', from: 'a.tga', to: '2.tga' },
    ]);
  });
});

describe('単体リネームの計画', () => {
  it('拡張子を省略したら元のものを補う', () => {
    expect(buildSingleRenamePlan('_go/A0001.tga', 'B0001')).toEqual({
      path: '_go/A0001.tga',
      from: 'A0001.tga',
      to: 'B0001.tga',
    });
  });

  it('拡張子を明示したらそのまま使う', () => {
    expect(buildSingleRenamePlan('_go/A0001.tga', 'B0001.png').to).toBe('B0001.png');
  });

  it('前後の空白は落とす', () => {
    expect(buildSingleRenamePlan('_go/A0001.tga', '  B0001  ').to).toBe('B0001.tga');
  });
});

describe('不正な名前の検出', () => {
  it('使えない文字と空名を弾く', () => {
    const plan = [
      { path: 'a/1.tga', from: '1.tga', to: 'ok.tga' },
      { path: 'a/2.tga', from: '2.tga', to: 'bad/name.tga' },
      { path: 'a/3.tga', from: '3.tga', to: 'q?.tga' },
      { path: 'a/4.tga', from: '4.tga', to: '.tga' },
    ];

    expect(findInvalidNames(plan).map((i) => i.from)).toEqual(['2.tga', '3.tga', '4.tga']);
  });
});

describe('衝突の検出', () => {
  const existing = ['_go/A0001.tga', '_go/A0002.tga', '_go/keep.tga'];

  it('計画の中で同じ名前ができたら duplicate', () => {
    const plan = [
      { path: '_go/A0001.tga', from: 'A0001.tga', to: 'same.tga' },
      { path: '_go/A0002.tga', from: 'A0002.tga', to: 'same.tga' },
    ];

    expect(findRenameConflicts(plan, existing)).toEqual([{ to: 'same.tga', reason: 'duplicate' }]);
  });

  it('対象外の既存ファイルと同名になったら exists', () => {
    const plan = [{ path: '_go/A0001.tga', from: 'A0001.tga', to: 'keep.tga' }];

    expect(findRenameConflicts(plan, existing)).toEqual([{ to: 'keep.tga', reason: 'exists' }]);
  });

  it('番号をずらすだけの入れ替えは衝突としない', () => {
    // A0002 -> A0001, A0001 -> A0000 のような繰り上げ。
    // 一時名を経由すれば成立するので止めてはいけない。
    const plan = [
      { path: '_go/A0001.tga', from: 'A0001.tga', to: 'A0000.tga' },
      { path: '_go/A0002.tga', from: 'A0002.tga', to: 'A0001.tga' },
    ];

    expect(findRenameConflicts(plan, existing)).toEqual([]);
    expect(needsTwoPhaseRename(plan)).toBe(true);
  });

  it('別ディレクトリの同名は衝突しない', () => {
    const plan = [{ path: '_go/A0001.tga', from: 'A0001.tga', to: 'shared.tga' }];
    expect(findRenameConflicts(plan, ['_go/A0001.tga', 'b/shared.tga'])).toEqual([]);
  });

  it('入れ替えが無ければ 2 段階は不要', () => {
    const plan = [{ path: '_go/A0001.tga', from: 'A0001.tga', to: 'Z0001.tga' }];
    expect(needsTwoPhaseRename(plan)).toBe(false);
  });
});

describe('変化しない項目の除外', () => {
  it('名前が同じものは落とす', () => {
    const plan = [
      { path: 'a/1.tga', from: '1.tga', to: '1.tga' },
      { path: 'a/2.tga', from: '2.tga', to: '9.tga' },
    ];

    expect(omitUnchanged(plan).map((i) => i.to)).toEqual(['9.tga']);
  });
});
