import { describe, it, expect } from 'vitest';
import {
  splitFilePath,
  resolveFileHandle,
  isSupportedImageFile,
  collectImageFilesRecursively,
} from './fileSystemPath';

/**
 * ファイルツリーを階層表示するため、ファイルの識別子はルートからの相対パスになっている。
 * 読み込み・保存はそのパスからディレクトリを辿ってハンドルを引く必要がある。
 */

describe('splitFilePath', () => {
  it('区切りで分解する', () => {
    expect(splitFilePath('a/A0001.tga')).toEqual(['a', 'A0001.tga']);
  });

  it('先頭がルートフォルダ名なら取り除く', () => {
    expect(splitFilePath('Cat/a/A0001.tga', 'Cat')).toEqual(['a', 'A0001.tga']);
  });

  it('ファイル名だけの場合はそのまま', () => {
    expect(splitFilePath('A0001.tga', 'Cat')).toEqual(['A0001.tga']);
  });

  it('ルート名と同名のファイル単体は消さない', () => {
    expect(splitFilePath('Cat', 'Cat')).toEqual(['Cat']);
  });
});

describe('resolveFileHandle', () => {
  /** ディレクトリ構造を模したダミーハンドル */
  function makeDir(name: string, children: Record<string, any>): any {
    return {
      name,
      getDirectoryHandle: async (n: string) => {
        const child = children[n];
        if (!child || !child.getFileHandle) throw new Error(`no dir: ${n}`);
        return child;
      },
      getFileHandle: async (n: string) => {
        const child = children[n];
        if (!child || child.getFileHandle) throw new Error(`no file: ${n}`);
        return child;
      },
    };
  }

  const fileA = { kind: 'file', label: 'A0001.tga' };
  const root = makeDir('Cat', { a: makeDir('a', { 'A0001.tga': fileA }) });

  it('相対パスを辿ってファイルへ到達する', async () => {
    await expect(resolveFileHandle(root, 'Cat/a/A0001.tga', 'Cat')).resolves.toBe(fileA);
  });

  it('ルート名が付いていなくても辿れる', async () => {
    await expect(resolveFileHandle(root, 'a/A0001.tga', 'Cat')).resolves.toBe(fileA);
  });

  it('存在しないパスは失敗する', async () => {
    await expect(resolveFileHandle(root, 'a/missing.tga', 'Cat')).rejects.toThrow();
  });

  it('空のパスは弾く', async () => {
    await expect(resolveFileHandle(root, '', 'Cat')).rejects.toThrow('Invalid file path');
  });
});

describe('isSupportedImageFile', () => {
  it('tga / png / jpg / jpeg を受け入れる', () => {
    for (const n of ['A0001.tga', 'a.PNG', 'b.jpg', 'c.JPEG']) {
      expect(isSupportedImageFile(n)).toBe(true);
    }
  });

  it('それ以外は弾く', () => {
    for (const n of ['note.txt', 'sheet.pdf', 'x.tga.bak', 'psd']) {
      expect(isSupportedImageFile(n)).toBe(false);
    }
  });
});

describe('collectImageFilesRecursively', () => {
  /** values() を持つディレクトリハンドルの模擬 */
  function dir(name: string, entries: any[]): any {
    return { kind: 'directory', name, values: async function* () { yield* entries; } };
  }
  function file(name: string): any {
    return { kind: 'file', name, getFile: async () => new File([], name) };
  }

  it('サブフォルダの中まで辿り、ルートからの相対パスをキーにする', async () => {
    const root = dir('Cut001', [
      file('note.txt'),
      file('A0001.tga'),
      dir('_go', [file('A0002.tga'), dir('sub', [file('A0003.png')])]),
    ]);

    const map = new Map<string, File>();
    await collectImageFilesRecursively(root, 'Cut001', map);

    expect(Array.from(map.keys()).sort()).toEqual([
      'Cut001/A0001.tga',
      'Cut001/_go/A0002.tga',
      'Cut001/_go/sub/A0003.png',
    ]);
  });

  it('階層違いの同名ファイルが衝突しない', async () => {
    const root = dir('Cut001', [
      dir('a', [file('0001.tga')]),
      dir('b', [file('0001.tga')]),
    ]);

    const map = new Map<string, File>();
    await collectImageFilesRecursively(root, 'Cut001', map);

    expect(map.size).toBe(2);
    expect(map.has('Cut001/a/0001.tga')).toBe(true);
    expect(map.has('Cut001/b/0001.tga')).toBe(true);
  });

  it('集めたキーはそのままルートのハンドルから解決できる', async () => {
    const cel = { kind: 'file', label: 'A0002.tga' };
    const scanRoot = dir('Cut001', [dir('_go', [file('A0002.tga')])]);

    const map = new Map<string, File>();
    await collectImageFilesRecursively(scanRoot, 'Cut001', map);
    const [path] = Array.from(map.keys());

    // 走査で作ったパスと、保存に使うハンドルの起点が揃っていること
    const resolveRoot = {
      name: 'Cut001',
      getDirectoryHandle: async (n: string) => {
        if (n !== '_go') throw new Error(`no dir: ${n}`);
        return { getFileHandle: async (f: string) => (f === 'A0002.tga' ? cel : Promise.reject()) };
      },
      getFileHandle: async () => Promise.reject(new Error('not a file here')),
    };

    await expect(resolveFileHandle(resolveRoot, path, 'Cut001')).resolves.toBe(cel);
  });
});
