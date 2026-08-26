import { describe, it, expect } from 'vitest';
import { findDroppedVideoFile } from './videoSource';

/**
 * ドロップされたものの中から動画を見つける。
 *
 * ⚠️ ここで守りたいのは「フォルダを落とされたとき中を見る」こと。
 * dataTransfer.files にはフォルダ自体しか入らないので、そこだけを見ていると
 * ロールの入ったフォルダを落としても「画像が見つかりません」で終わってしまう。
 */

function file(name: string): File {
  return new File([new Uint8Array(4)] as unknown as BlobPart[], name);
}

/** File System Access API のファイルハンドル */
function fileHandle(name: string) {
  return { kind: 'file', name, getFile: async () => file(name) };
}

/** File System Access API のディレクトリハンドル */
function dirHandle(name: string, children: any[]) {
  return { kind: 'directory', name, async *values() { yield* children; } };
}

/** webkitGetAsEntry() が返す読み取り専用のファイルエントリ */
function fileEntry(name: string) {
  return { isFile: true, isDirectory: false, name, file: (ok: (f: File) => void) => ok(file(name)) };
}

/**
 * 同・ディレクトリエントリ。
 * readEntries() の 100 件制限を模して、1 回に 100 件までしか返さない。
 */
function dirEntry(name: string, children: any[]) {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader() {
      let at = 0;
      return {
        readEntries(ok: (e: any[]) => void) {
          const batch = children.slice(at, at + 100);
          at += batch.length;
          ok(batch);
        },
      };
    },
  };
}

describe('ドロップされた動画の検出', () => {
  it('素のファイルから動画を拾う', async () => {
    const found = await findDroppedVideoFile([file('memo.txt'), file('roll.mp4')], [], []);
    expect(found?.name).toBe('roll.mp4');
  });

  it('複数あれば自然順の先頭を開く', async () => {
    const files = [file('c10.mp4'), file('c2.mp4'), file('c1.mp4')];
    expect((await findDroppedVideoFile(files, [], []))?.name).toBe('c1.mp4');
  });

  it('★ フォルダを落としたら中の .mp4 を開く', async () => {
    // dataTransfer.files にはフォルダ自体しか入らないので、ここが本命
    const dir = dirHandle('Roll', [fileHandle('A_part_t1.mp4'), fileHandle('memo.txt')]);
    expect((await findDroppedVideoFile([], [dir], []))?.name).toBe('A_part_t1.mp4');
  });

  it('フォルダの中に .mov があっても開く', async () => {
    const dir = dirHandle('Roll', [fileHandle('cut01.mov')]);
    expect((await findDroppedVideoFile([], [dir], []))?.name).toBe('cut01.mov');
  });

  it('セル画像だけのフォルダでは何も返さない', async () => {
    const dir = dirHandle('Cut001', [fileHandle('a0001.tga'), fileHandle('a0002.tga')]);
    expect(await findDroppedVideoFile([], [dir], [])).toBeNull();
  });

  it('サブフォルダの中の動画も見つける', async () => {
    const dir = dirHandle('Roll', [dirHandle('t1', [fileHandle('cut.mp4')])]);
    expect((await findDroppedVideoFile([], [dir], []))?.name).toBe('cut.mp4');
  });

  it('直下にあるものを、サブフォルダの中より優先する', async () => {
    const dir = dirHandle('Roll', [
      dirHandle('old', [fileHandle('aaa.mp4')]),
      fileHandle('zzz.mp4'),
    ]);
    expect((await findDroppedVideoFile([], [dir], []))?.name).toBe('zzz.mp4');
  });

  it('深すぎる階層までは潜らない', async () => {
    let deep: any = dirHandle('d4', [fileHandle('cut.mp4')]);
    for (const name of ['d3', 'd2', 'd1', 'd0']) deep = dirHandle(name, [deep]);
    expect(await findDroppedVideoFile([], [deep], [])).toBeNull();
  });

  it('読み取り専用エントリ経由でもフォルダの中を見る', async () => {
    // getAsFileSystemHandle() が無い環境 (Firefox / Safari) の経路
    const entry = dirEntry('Roll', [fileEntry('memo.txt'), fileEntry('roll.mov')]);
    expect((await findDroppedVideoFile([], [], [entry]))?.name).toBe('roll.mov');
  });

  it('エントリ経由で 100 件を超えても取りこぼさない', async () => {
    // readEntries() の 100 件制限。1 回で済ませると 101 件目以降が消える
    const many = Array.from({ length: 120 }, (_, i) => fileEntry(`img${i + 1}.tga`));
    const entry = dirEntry('Mixed', [...many, fileEntry('roll.mp4')]);
    expect((await findDroppedVideoFile([], [], [entry]))?.name).toBe('roll.mp4');
  });

  it('走査で例外が出ても落ちない', async () => {
    const broken = { kind: 'directory', name: 'x', values() { throw new Error('boom'); } };
    await expect(findDroppedVideoFile([], [broken], [])).resolves.toBeNull();
  });

  it('何も無ければ null', async () => {
    expect(await findDroppedVideoFile([], [], [])).toBeNull();
  });
});
