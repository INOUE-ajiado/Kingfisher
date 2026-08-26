import { describe, it, expect, beforeEach } from 'vitest';
import { usePaintStore } from './usePaintStore';
import { SubDirectoryItem } from './types';

/**
 * フォルダの開き方ごとに、もう片方のウィンドウをどう扱うか。
 *
 * ⚠️ ここは 2 画面 + 連動の使い方に直結する。片側を開いたときに
 * もう片側を空にしてしまうと、連動させる相手がいなくなる。
 */

const s = () => usePaintStore.getState();
const initialState = usePaintStore.getState();

beforeEach(() => {
  usePaintStore.setState(initialState, true);
});

function subDir(name: string, files: string[]): SubDirectoryItem {
  return {
    name,
    handle: { name: 'Cut001', kind: 'directory' },
    filesMap: new Map(files.map((f) => [f, new File([], f)])),
    fileList: files,
    isImageFolder: true,
  };
}

/** Win B に別のフォルダを開いた状態を作る */
function givenWinBIsOpen() {
  const files = ['B_folder/b0001.tga', 'B_folder/b0002.tga'];
  s().setFolderHandleB(
    { name: 'B_folder', kind: 'directory' },
    'B_folder',
    files,
    new Map(files.map((f) => [f, new File([], f)]))
  );
}

describe('サブフォルダを持たないフォルダを Win A として開く', () => {
  it('Win B の中身を残す', () => {
    givenWinBIsOpen();
    const files = ['A_folder/a0001.tga', 'A_folder/a0002.tga'];

    s().openPlainFolderAsA(
      { name: 'A_folder', kind: 'directory' },
      'A_folder',
      files,
      new Map(files.map((f) => [f, new File([], f)]))
    );

    expect(s().fileListA).toEqual(files);
    // ここが空になると 2 画面で開いて連動させることができなくなる
    expect(s().fileListB).toEqual(['B_folder/b0001.tga', 'B_folder/b0002.tga']);
  });

  it('両方のコマが統合リストに並ぶ (連動の前提)', () => {
    givenWinBIsOpen();
    const files = ['A_folder/a0001.tga', 'A_folder/a0002.tga'];
    s().openPlainFolderAsA({ name: 'A_folder' }, 'A_folder', files, new Map());

    expect(s().unifiedFileList).toHaveLength(2);
    expect(s().resolveFileNameForView(0, 0)).toBe('A_folder/a0001.tga');
    expect(s().resolveFileNameForView(0, 1)).toBe('B_folder/b0001.tga');
  });

  it('前に開いたカットのサブフォルダ一覧は捨てる', () => {
    // 残すとドロップダウンに前のカットの _go / _ao が並び、選ぶとそちらへ飛ぶ
    s().setCutRootFolder({ name: 'Cut001' }, 'Cut001', [
      subDir('_go', ['Cut001/_go/0001.tga']),
      subDir('_ao', ['Cut001/_ao/0001.tga']),
    ]);
    expect(s().availableSubDirectories.length).toBe(2);

    s().openPlainFolderAsA({ name: 'Flat' }, 'Flat', ['Flat/a0001.tga'], new Map());

    expect(s().availableSubDirectories).toEqual([]);
    expect(s().selectedSubDirA).toBeNull();
    expect(s().rootFolderName).toBe('Flat');
  });
});

describe('setCutRootFolder との違い', () => {
  it('カットを開くと A と B の両方が組み直される', () => {
    givenWinBIsOpen();

    s().setCutRootFolder({ name: 'Cut001' }, 'Cut001', [
      subDir('_go', ['Cut001/_go/0001.tga']),
      subDir('_ao', ['Cut001/_ao/0001.tga']),
    ]);

    expect(s().fileListA).toEqual(['Cut001/_go/0001.tga']);
    expect(s().fileListB).toEqual(['Cut001/_ao/0001.tga']);
  });

  it('⚠️ サブフォルダが 1 つだと Win B を空にする — 単独フォルダをここへ流さないこと', () => {
    givenWinBIsOpen();

    s().setCutRootFolder({ name: 'Flat' }, 'Flat', [subDir('(Root)', ['Flat/a0001.tga'])]);

    // この挙動があるため、単独フォルダは openPlainFolderAsA を通す
    expect(s().fileListB).toEqual([]);
  });
});
