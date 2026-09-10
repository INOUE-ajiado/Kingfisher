import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readMultipleDroppedFolders, DropItems } from './dropFolder';

function mockFile(name: string): File {
  return new File([new Uint8Array(4)], name, { type: name.endsWith('.mp4') || name.endsWith('.mov') ? 'video/mp4' : 'image/png' });
}

function mockFileHandle(name: string) {
  return {
    kind: 'file',
    name,
    getFile: async () => mockFile(name),
  };
}

function mockDirHandle(name: string, children: any[]) {
  return {
    kind: 'directory',
    name,
    async *values() {
      yield* children;
    },
  };
}

describe('readMultipleDroppedFolders (複数フォルダドロップ自動制御)', () => {
  beforeEach(() => {
    vi.stubGlobal('alert', vi.fn());
  });

  it('3つ以上のフォルダが選択されてドロップされた場合、エラーアラートを表示する', async () => {
    const d1 = mockDirHandle('dir1', [mockFileHandle('a.png')]);
    const d2 = mockDirHandle('dir2', [mockFileHandle('b.png')]);
    const d3 = mockDirHandle('dir3', [mockFileHandle('c.png')]);

    const items: DropItems = {
      plainFiles: [],
      handlePromises: [Promise.resolve(d1), Promise.resolve(d2), Promise.resolve(d3)],
      entries: [],
    };

    const mockStore = {};
    const res = await readMultipleDroppedFolders(items, mockStore);

    expect(res.handled).toBe(true);
    expect(res.error).toBe('too_many_folders');
    expect(alert).toHaveBeenCalledWith('フォルダの挿入は２フォルダまでです');
  });

  it('画像フォルダと画像フォルダの場合、WinAとWinBへ自動設定される', async () => {
    const d1 = mockDirHandle('FolderA', [mockFileHandle('cut001.png')]);
    const d2 = mockDirHandle('FolderB', [mockFileHandle('cut002.png')]);

    const items: DropItems = {
      plainFiles: [],
      handlePromises: [Promise.resolve(d1), Promise.resolve(d2)],
      entries: [],
    };

    const mockStore = {
      setFolderHandleA: vi.fn(),
      setFolderHandleB: vi.fn(),
    };

    const res = await readMultipleDroppedFolders(items, mockStore);

    expect(res.handled).toBe(true);
    expect(mockStore.setFolderHandleA).toHaveBeenCalled();
    expect(mockStore.setFolderHandleB).toHaveBeenCalled();
  });

  it('ロール映像フォルダとロール映像フォルダの場合、ロールAとロールBへ自動設定される', async () => {
    const d1 = mockDirHandle('RollA', [mockFileHandle('roll1.mp4')]);
    const d2 = mockDirHandle('RollB', [mockFileHandle('roll2.mp4')]);

    const items: DropItems = {
      plainFiles: [],
      handlePromises: [Promise.resolve(d1), Promise.resolve(d2)],
      entries: [],
    };

    const mockStore = {
      loadRollFiles: vi.fn(),
      selectRollFile: vi.fn(),
      openRollWindow: vi.fn(),
    };

    const res = await readMultipleDroppedFolders(items, mockStore);

    expect(res.handled).toBe(true);
    expect(mockStore.loadRollFiles).toHaveBeenCalledWith('rollA', expect.any(Array), 'RollA');
    expect(mockStore.loadRollFiles).toHaveBeenCalledWith('rollB', expect.any(Array), 'RollB');
    expect(mockStore.openRollWindow).toHaveBeenCalled();
  });

  it('画像フォルダとロール映像フォルダの場合、種別不一致エラーメッセージを表示する', async () => {
    const d1 = mockDirHandle('ImgFolder', [mockFileHandle('cut001.png')]);
    const d2 = mockDirHandle('RollFolder', [mockFileHandle('roll1.mp4')]);

    const items: DropItems = {
      plainFiles: [],
      handlePromises: [Promise.resolve(d1), Promise.resolve(d2)],
      entries: [],
    };

    const mockStore = {};

    const res = await readMultipleDroppedFolders(items, mockStore);

    expect(res.handled).toBe(true);
    expect(res.error).toBe('mismatch');
    expect(alert).toHaveBeenCalledWith('フォルダの種別不一致エラー\n\nフォルダを確認してください');
  });

  it('1つのフォルダのみドロップされた場合はhandled=falseを返し単体処理へ委ねる', async () => {
    const d1 = mockDirHandle('SingleFolder', [mockFileHandle('cut001.png')]);

    const items: DropItems = {
      plainFiles: [],
      handlePromises: [Promise.resolve(d1)],
      entries: [],
    };

    const mockStore = {};

    const res = await readMultipleDroppedFolders(items, mockStore);

    expect(res.handled).toBe(false);
  });
});
