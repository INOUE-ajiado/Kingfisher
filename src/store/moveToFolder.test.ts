import { describe, it, expect, beforeEach } from 'vitest';
import { usePaintStore } from './usePaintStore';

/**
 * 選んだファイルを新しいフォルダへまとめる。
 *
 * ⚠️ 制作データを元の場所から動かす操作。ここで見ているのは
 *  - 実際にフォルダが作られ、中身がそこへ移ること
 *  - 一覧と読み込み済みの実体が、移動後の状態に揃うこと
 *  - 衝突があるときに 1 件も動かさないこと
 */

const s = () => usePaintStore.getState();
const initialState = usePaintStore.getState();

beforeEach(() => {
  usePaintStore.setState(initialState, true);
});

/** move() を持つ (Chromium 111+ 相当の) ダミーフォルダ */
function makeDir(name: string): any {
  const dirs = new Map<string, any>();
  const files = new Map<string, any>();
  return {
    name,
    kind: 'directory',
    dirs,
    files,
    getDirectoryHandle: async (n: string, options?: { create?: boolean }) => {
      let child = dirs.get(n);
      if (!child) {
        if (!options?.create) throw new Error(`no dir: ${n}`);
        child = makeDir(n);
        dirs.set(n, child);
      }
      return child;
    },
    getFileHandle: async (n: string) => {
      const file = files.get(n);
      if (!file) throw new Error(`no file: ${n}`);
      return file;
    },
    removeEntry: async (n: string) => {
      files.delete(n);
    },
  };
}

/** Cut/a に 3 枚ある状態を作る */
async function givenFolderA(): Promise<any> {
  const root = makeDir('Cut');
  const a = await root.getDirectoryHandle('a', { create: true });
  const names = ['a0001.tga', 'a0002.tga', 'a0003.tga'];

  names.forEach((n) => {
    const handle: any = {
      name: n,
      move: async (targetDir: any, newName: string) => {
        a.files.delete(n);
        targetDir.files.set(newName, handle);
      },
    };
    a.files.set(n, handle);
  });

  const list = names.map((n) => `Cut/a/${n}`);
  s().setFolderHandleA(root, 'Cut', list, new Map(list.map((p) => [p, new File([], p)])));
  return root;
}

describe('新しいフォルダにまとめる', () => {
  it('フォルダを作って、選んだファイルをそこへ移す', async () => {
    const root = await givenFolderA();

    const result = await s().moveFilesToNewFolder(0, ['Cut/a/a0001.tga', 'Cut/a/a0003.tga'], 'ボツ');

    expect(result.ok).toBe(true);
    expect(result.renamed).toBe(2);

    const a = root.dirs.get('a');
    expect(Array.from(a.files.keys())).toEqual(['a0002.tga']);
    expect(Array.from(a.dirs.get('ボツ').files.keys())).toEqual(['a0001.tga', 'a0003.tga']);
  });

  it('一覧を移動後のパスへ揃える', async () => {
    await givenFolderA();

    await s().moveFilesToNewFolder(0, ['Cut/a/a0001.tga'], 'ボツ');

    expect(s().fileListA).toEqual(['Cut/a/a0002.tga', 'Cut/a/a0003.tga', 'Cut/a/ボツ/a0001.tga']);
  });

  it('移した分は読み込み済みの実体から外す (開いた場所を指したままにしない)', async () => {
    await givenFolderA();

    await s().moveFilesToNewFolder(0, ['Cut/a/a0001.tga'], 'ボツ');

    expect(s().fileMapA.has('Cut/a/a0001.tga')).toBe(false);
    expect(s().fileMapA.has('Cut/a/ボツ/a0001.tga')).toBe(false);
    expect(s().fileMapA.has('Cut/a/a0002.tga')).toBe(true);
  });

  it('移動先に同名があるときは 1 件も動かさない', async () => {
    const root = await givenFolderA();
    const a = root.dirs.get('a');
    const boxed = await a.getDirectoryHandle('ボツ', { create: true });
    boxed.files.set('a0001.tga', { name: 'a0001.tga' });
    s().setFolderHandleA(root, 'Cut', [...s().fileListA, 'Cut/a/ボツ/a0001.tga'], s().fileMapA);

    const result = await s().moveFilesToNewFolder(0, ['Cut/a/a0001.tga', 'Cut/a/a0002.tga'], 'ボツ');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('移動先に同じ名前のファイルがあります');
    expect(Array.from(a.files.keys())).toEqual(['a0001.tga', 'a0002.tga', 'a0003.tga']);
  });

  it('書き込めるフォルダとして開いていなければ断る', async () => {
    const result = await s().moveFilesToNewFolder(0, ['Cut/a/a0001.tga'], 'ボツ');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('書き込み可能なフォルダとして開かれていません');
  });
});
