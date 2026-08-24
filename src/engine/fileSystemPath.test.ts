import { describe, it, expect } from 'vitest';
import { splitFilePath, resolveFileHandle } from './fileSystemPath';

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
