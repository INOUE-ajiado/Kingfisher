import { describe, it, expect } from 'vitest';
import { scanCutRootFolder, ROOT_SUBDIR_NAME } from './cutFolder';

/**
 * カットフォルダの走査は「メニューバー > フォルダを開く」と
 * 「ファイルブラウザ > カットフォルダを開く」の両方から呼ばれる。
 * 経路が分かれていた頃は同じフォルダでも結果が違ったので、
 * ここで振る舞いを 1 つに固定する。
 */

/** values() を持つディレクトリハンドルの模擬 */
function dir(name: string, entries: any[]): any {
  return { kind: 'directory', name, values: async function* () { yield* entries; } };
}
function file(name: string): any {
  return { kind: 'file', name, getFile: async () => new File([], name) };
}

describe('scanCutRootFolder', () => {
  it('直下のサブフォルダごとに、配下すべてを再帰的に集める', async () => {
    const root = dir('Cut001', [
      dir('_go', [file('A0001.tga'), dir('sub', [file('A0002.tga')])]),
      dir('_ao', [file('A0001.tga')]),
    ]);

    const subDirs = await scanCutRootFolder(root, 'Cut001');

    expect(subDirs.map((d) => d.name)).toEqual(['_ao', '_go']);
    expect(subDirs.find((d) => d.name === '_go')!.fileList).toEqual([
      'Cut001/_go/A0001.tga',
      'Cut001/_go/sub/A0002.tga',
    ]);
  });

  it('相対パスはルート名から始まり、ハンドルはルートを持つ', async () => {
    // ここが食い違うと resolveFileHandle が辿れず、保存だけが落ちる
    const root = dir('Cut001', [dir('_go', [file('A0001.tga')])]);

    const [go] = await scanCutRootFolder(root, 'Cut001');

    expect(go.fileList[0].startsWith('Cut001/')).toBe(true);
    expect(go.handle).toBe(root);
  });

  it('アンダースコアで始まるフォルダを先に並べる', async () => {
    const root = dir('Cut001', [
      dir('b', [file('A0001.tga')]),
      dir('_go', [file('A0001.tga')]),
      dir('a', [file('A0001.tga')]),
    ]);

    const subDirs = await scanCutRootFolder(root, 'Cut001');

    expect(subDirs.map((d) => d.name)).toEqual(['_go', 'a', 'b']);
  });

  it('画像が無いサブフォルダは載せない', async () => {
    // 載せるとツリーには出るのに開けない項目になる
    const root = dir('Cut001', [
      dir('_go', [file('A0001.tga')]),
      dir('docs', [file('memo.txt')]),
    ]);

    const subDirs = await scanCutRootFolder(root, 'Cut001');

    expect(subDirs.map((d) => d.name)).toEqual(['_go']);
  });

  it('サブフォルダが無く直下に画像があれば (Root) 1 件を返す', async () => {
    // setFolderHandleA で済ませると前のカットのサブフォルダ一覧が残るため、
    // この経路でも setCutRootFolder を通せる形で返す
    const root = dir('Flat', [file('A0001.tga'), file('A0002.tga')]);

    const subDirs = await scanCutRootFolder(root, 'Flat');

    expect(subDirs).toHaveLength(1);
    expect(subDirs[0].name).toBe(ROOT_SUBDIR_NAME);
    expect(subDirs[0].fileList).toEqual(['Flat/A0001.tga', 'Flat/A0002.tga']);
    expect(subDirs[0].handle).toBe(root);
  });

  it('.jpg だけのフォルダも画像フォルダとして扱う', async () => {
    // 経路によって .tga と .png しか見ない独自判定が残っていた
    const root = dir('Cut001', [dir('sheet', [file('timesheet.jpg')])]);

    const subDirs = await scanCutRootFolder(root, 'Cut001');

    expect(subDirs.map((d) => d.name)).toEqual(['sheet']);
    expect(subDirs[0].isImageFolder).toBe(true);
  });

  it('画像がどこにも無ければ空を返す', async () => {
    const root = dir('Empty', [file('memo.txt'), dir('docs', [file('note.md')])]);

    await expect(scanCutRootFolder(root, 'Empty')).resolves.toEqual([]);
  });
});
