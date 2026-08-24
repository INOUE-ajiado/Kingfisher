import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePaintStore, extractFrameNumber } from './usePaintStore';
import { buildSequentialRenamePlan } from '../engine/renamePlan';
import { TGAImage } from '../engine/tga';
import { createUiSlice } from './slices/uiSlice';
import { createViewSlice } from './slices/viewSlice';
import { createWindowSlice } from './slices/windowSlice';
import { createFileSlice } from './slices/fileSlice';
import { createDocumentSlice } from './slices/documentSlice';
import { createToolSlice } from './slices/toolSlice';
import { createEditSlice } from './slices/editSlice';
import { createLightTableSlice } from './slices/lightTableSlice';

/**
 * グローバルストアのテスト。
 *
 * ストアは責務ごとのスライスへ分割されているため、
 * 「スライスが正しく合成されているか」と「スライスをまたぐ参照が動くか」を重点的に見る。
 * 操作履歴 (Undo / Redo) は history.test.ts で個別に扱う。
 */

const s = () => usePaintStore.getState();

/** ストア初期化直後の状態 (アクション込み) を控えておく */
const initialState = usePaintStore.getState();

function makeImage(fill: number): TGAImage {
  return { width: 4, height: 4, pixelDepth: 32, data: new Uint8ClampedArray(64).fill(fill) };
}

beforeEach(() => {
  // 状態をまるごと巻き戻す。Map は参照が共有されるので明示的に空にする。
  usePaintStore.setState(initialState, true);
  s().clearImageCache();
});

describe('スライスの合成', () => {
  it('どのスライスのキーも欠けずに合成されている', () => {
    // キー数を直接書くと項目を足すたびに壊れるので、
    // 各スライスが実際に返すキーが全てストアに載っているかを確かめる
    const factories = [
      createUiSlice,
      createViewSlice,
      createWindowSlice,
      createFileSlice,
      createDocumentSlice,
      createToolSlice,
      createEditSlice,
      createLightTableSlice,
    ];
    const storeKeys = new Set(Object.keys(s()));

    for (const factory of factories) {
      const slice = (factory as any)(() => {}, () => s(), {});
      for (const key of Object.keys(slice)) {
        expect(storeKeys.has(key), `${key} が合成されていない`).toBe(true);
      }
    }
  });

  it('値が undefined のキーが無い', () => {
    const entries = Object.entries(s());
    expect(entries.every(([, v]) => v !== undefined)).toBe(true);
  });

  it('各スライスの代表的なアクションが呼べる', () => {
    expect(typeof s().toggleDarkMode).toBe('function'); // ui
    expect(typeof s().toggleIsSplitView).toBe('function'); // view
    expect(typeof s().resolveFileNameForView).toBe('function'); // file
    expect(typeof s().saveActiveCell).toBe('function'); // document
    expect(typeof s().setGapCloseLevel).toBe('function'); // tool
    expect(typeof s().replaceColorGlobal).toBe('function'); // edit
    expect(typeof s().setOnionSkinFrames).toBe('function'); // lightTable
  });
});

describe('ui スライス', () => {
  it('ダークモードを切り替える', () => {
    const before = s().isDarkMode;
    s().toggleDarkMode();
    expect(s().isDarkMode).toBe(!before);
  });

  it('ズームイン後に等倍へ戻せる', () => {
    s().zoomIn();
    expect(s().canvasTransform.scale).toBeGreaterThan(1);
    s().resetCanvasTransform();
    expect(s().canvasTransform.scale).toBe(1);
  });
});

describe('tool スライス', () => {
  it('ツールとツールオプションを更新する', () => {
    s().setActiveTool('brush');
    expect(s().activeTool).toBe('brush');

    s().setGapCloseLevel(7);
    expect(s().toolOptions.gapCloseLevel).toBe(7);

    s().setContiguous(false);
    expect(s().toolOptions.contiguous).toBe(false);

    s().setSampleSize('5x5');
    expect(s().toolOptions.sampleSize).toBe('5x5');
  });

  it('前景色と背景色を入れ替える', () => {
    const fg = s().currentColor;
    const bg = s().backgroundColor;
    s().swapColors();
    expect(s().currentColor).toEqual(bg);
    expect(s().backgroundColor).toEqual(fg);
  });
});

describe('file スライス — 異名連番のファイル名解決', () => {
  beforeEach(() => {
    // A: a_0001..0003 / B: b_go0001..0002 (ファイル名は違うが同じフレーム番号)
    s().setFolderHandleA(null, 'dirA', ['a_0001.tga', 'a_0002.tga', 'a_0003.tga']);
    s().setFolderHandleB(null, 'dirB', ['b_go0001.tga', 'b_go0002.tga']);
  });

  it('フレーム番号でマージされ、統合リストは 3 フレームになる', () => {
    expect(s().unifiedFileList.length).toBe(3);
    expect(s().mergedFrameNumbers).toEqual(['0001', '0002', '0003']);
  });

  it('ビューごとに正しい実ファイル名を返す', () => {
    expect(s().resolveFileNameForView(1, 0)).toBe('a_0002.tga');
    expect(s().resolveFileNameForView(1, 1)).toBe('b_go0002.tga');
  });

  it('片側にしか存在しないフレームは null を返す', () => {
    expect(s().resolveFileNameForView(2, 0)).toBe('a_0003.tga');
    expect(s().resolveFileNameForView(2, 1)).toBeNull();
  });
});

describe('file スライス — フォルダを開いた直後の表示コマ', () => {
  it('B のフレームが A と重ならなくても、Win B が表示できるコマを選ぶ', () => {
    // A は 0001-0003、あとから B に 0005-0006 だけをドロップする
    // (一部のセルだけリテイクを受け取る、実際によくある形)
    s().setFolderHandleA(null, 'dirA', ['a_0001.tga', 'a_0002.tga', 'a_0003.tga']);
    s().setCustomDropFolderB(
      'retake',
      new Map([
        ['retake/b_0005.tga', new File([], 'b_0005.tga')],
        ['retake/b_0006.tga', new File([], 'b_0006.tga')],
      ]),
      ['retake/b_0005.tga', 'retake/b_0006.tga']
    );

    // ファイルツリーには B のコマが並ぶ
    expect(s().mergedFrameNumbers).toEqual(['0001', '0002', '0003', '0005', '0006']);

    // ⚠️ splitFileIndex を 0 に固定すると、そのコマに B の実体が無いため
    //    Win B が「NO RETAKE DATA」のままになる
    expect(s().resolveFileNameForView(s().splitFileIndex, 1)).not.toBeNull();
  });

  it('A 側も同様に、実体のあるコマから始まる', () => {
    s().setFolderHandleB(null, 'dirB', ['b_0001.tga', 'b_0002.tga']);
    s().setCustomDropFolderA(
      'orig',
      new Map([['orig/a_0004.tga', new File([], 'a_0004.tga')]]),
      ['orig/a_0004.tga']
    );

    expect(s().resolveFileNameForView(s().currentFileIndex, 0)).not.toBeNull();
  });
});

describe('file スライス — Win B ツリーからの選択', () => {
  /** FileBrowser の handleSelectFromTreeB と同じ計算 */
  const clickTreeB = (localIdx: number) => {
    const path = s().fileListB[localIdx];
    if (!path) return;
    const idx = s().mergedFrameNumbers.indexOf(extractFrameNumber(path));
    s().setSplitFileIndex(idx >= 0 ? idx : localIdx);
  };

  it('A と B でファイル名が違っても、選んだコマへ Win B が移動する', () => {
    s().setFolderHandleA(null, 'dirA', ['a_0001.tga', 'a_0002.tga', 'a_0003.tga']);
    s().setFolderHandleB(null, 'dirB', ['b_go0001.tga', 'b_go0002.tga', 'b_go0003.tga']);
    s().toggleIsSplitView();

    clickTreeB(2);
    expect(s().splitFileIndex).toBe(2);
    expect(s().resolveFileNameForView(s().splitFileIndex, 1)).toBe('b_go0003.tga');
  });

  it('連動 ON でも Win B は選んだコマへ移動する', () => {
    s().setFolderHandleA(null, 'dirA', ['a_0001.tga', 'a_0002.tga', 'a_0003.tga']);
    s().setFolderHandleB(null, 'dirB', ['b_go0001.tga', 'b_go0002.tga', 'b_go0003.tga']);
    s().toggleIsSplitView();
    s().toggleSyncMode();

    clickTreeB(2);
    expect(s().splitFileIndex).toBe(2);
  });

  it('Win A が空でも Win B は独立して移動できる', () => {
    s().setCustomDropFolderB(
      'retake',
      new Map([
        ['retake/b_0001.tga', new File([], 'b_0001.tga')],
        ['retake/b_0002.tga', new File([], 'b_0002.tga')],
      ]),
      ['retake/b_0001.tga', 'retake/b_0002.tga']
    );
    s().toggleIsSplitView();
    expect(s().fileListA.length).toBe(0);

    clickTreeB(1);
    expect(s().splitFileIndex).toBe(1);
    expect(s().resolveFileNameForView(s().splitFileIndex, 1)).toBe('retake/b_0002.tga');
  });
});

describe('file スライス — コマ送り', () => {
  beforeEach(() => {
    s().setFolderHandleA(null, 'dirA', ['0001.tga', '0002.tga', '0003.tga']);
  });

  it('次 / 前のセルへ移動する', () => {
    s().nextCell();
    expect(s().currentFileIndex).toBe(1);
    s().prevCell();
    expect(s().currentFileIndex).toBe(0);
  });

  it('先頭 / 末尾を超えない', () => {
    s().prevCell();
    expect(s().currentFileIndex).toBe(0);
    s().nextCell();
    s().nextCell();
    s().nextCell();
    expect(s().currentFileIndex).toBe(2);
  });
});

describe('document スライス — 未保存の検知', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    s().setFolderHandleA(null, 'dirA', ['0001.tga', '0002.tga', '0003.tga']);
    usePaintStore.setState({ currentImage: makeImage(10), activeViewIndex: 0 });
  });

  it('ペイント操作で未保存フラグが立つ', () => {
    expect(s().isDirtyA).toBe(false);
    s().saveUndoState('バケツ塗り');
    expect(s().isDirtyA).toBe(true);
  });

  it('未保存のままコマ送りすると確認が出る', () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('window', { confirm: confirmSpy });

    s().saveUndoState('バケツ塗り');
    s().nextCell();

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(s().currentFileIndex).toBe(1);
    expect(s().isDirtyA).toBe(false); // 破棄したのでクリアされる
  });

  it('確認をキャンセルすると移動しない', () => {
    vi.stubGlobal('window', { confirm: () => false });

    s().saveUndoState('バケツ塗り');
    s().nextCell();

    expect(s().currentFileIndex).toBe(0); // 留まる
    expect(s().isDirtyA).toBe(true); // 未保存のまま
  });

  it('未保存が無ければ確認は出ない', () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('window', { confirm: confirmSpy });

    s().nextCell();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(s().currentFileIndex).toBe(1);
  });

  it('再生中は毎コマ確認を出さない', () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('window', { confirm: confirmSpy });

    s().saveUndoState('バケツ塗り');
    usePaintStore.setState({ isPlaying: true });
    s().nextCell();

    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe('document スライス — 保存', () => {
  beforeEach(() => {
    s().setFolderHandleA(null, 'dirA', ['a_0001.tga']);
    s().setFolderHandleB(null, 'dirB', ['b_go0001.tga']);
  });

  it('アクティブビュー側のフォルダとファイル名へ書き込む', async () => {
    const written: { name: string; firstByte: number }[] = [];
    const makeHandle = (label: string) => ({
      getFileHandle: async (name: string) => ({
        createWritable: async () => ({
          write: async (buf: ArrayBuffer) => {
            // TGA ヘッダー 18 バイトの直後が最初の画素 (BGRA)
            written.push({ name: `${label}/${name}`, firstByte: new Uint8Array(buf)[18] });
          },
          close: async () => {},
        }),
      }),
    });

    usePaintStore.setState({
      folderHandleA: makeHandle('dirA'),
      folderHandleB: makeHandle('dirB'),
      currentImage: makeImage(11),
      splitImage: makeImage(22),
      activeViewIndex: 1, // Win B をアクティブに
    });

    const result = await s().saveActiveCell();

    expect(result.ok).toBe(true);
    // B 側のフォルダへ、B 側の名前で、B 側の画素が書かれること
    expect(written).toEqual([{ name: 'dirB/b_go0001.tga', firstByte: 22 }]);
  });

  it('書き込み可能なフォルダが無ければ理由を返す', async () => {
    usePaintStore.setState({
      folderHandleA: null,
      currentImage: makeImage(1),
      activeViewIndex: 0,
    });

    const result = await s().saveActiveCell();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('フォルダ');
  });

  it('閲覧専用の画像は保存しない', async () => {
    usePaintStore.setState({
      folderHandleA: { getFileHandle: async () => { throw new Error('呼ばれてはいけない'); } },
      currentImage: { ...makeImage(1), isReadOnly: true },
      activeViewIndex: 0,
    });

    const result = await s().saveActiveCell();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('閲覧専用');
  });
});

describe('file スライス — フォルダハンドルと実体の対応', () => {
  it('filesMap を渡すとそのまま保持する', () => {
    const map = new Map([['dirA/a_0001.tga', new File([], 'a_0001.tga')]]);
    s().setFolderHandleA({ name: 'dirA' }, 'dirA', ['dirA/a_0001.tga'], map);

    expect(s().fileMapA).toBe(map);
  });

  it('filesMap を渡さないと前のフォルダの残骸を消す', () => {
    s().setCustomDropFolderA(
      'dropped',
      new Map([['dropped/x_0001.tga', new File([], 'x_0001.tga')]]),
      ['dropped/x_0001.tga']
    );
    expect(s().fileMapA.size).toBe(1);

    // 別フォルダを開き直したのに古い実体が残ると、
    // ハンドル経由の読み出しが失敗したとき前のフォルダの画像が出てしまう
    s().setFolderHandleA({ name: 'dirA' }, 'dirA', ['dirA/a_0001.tga']);
    expect(s().fileMapA.size).toBe(0);
  });
});

describe('document スライス — 保存後のスナップショット', () => {
  it('保存に成功したら開いた時点の File を捨てる', async () => {
    const map = new Map([['dirA/a_0001.tga', new File([], 'a_0001.tga')]]);
    s().setFolderHandleA({ name: 'dirA' }, 'dirA', ['dirA/a_0001.tga'], map);

    usePaintStore.setState({
      folderHandleA: {
        getDirectoryHandle: async () => { throw new Error('サブフォルダは無い'); },
        getFileHandle: async () => ({
          createWritable: async () => ({ write: async () => {}, close: async () => {} }),
        }),
      },
      currentImage: makeImage(7),
      activeViewIndex: 0,
      rootFolderName: 'dirA',
    });

    const result = await s().saveActiveCell();

    expect(result.ok).toBe(true);
    // 残すと、次の読み込みで保存前の内容が返ってしまう
    expect(s().fileMapA.has('dirA/a_0001.tga')).toBe(false);
  });
});

describe('document スライス — 書き込み許可', () => {
  it('許可されなければ書き込みを試さず理由を返す', async () => {
    s().setFolderHandleA(null, 'dirA', ['dirA/a_0001.tga']);
    usePaintStore.setState({
      folderHandleA: {
        name: 'dirA',
        queryPermission: async () => 'prompt',
        requestPermission: async () => 'denied',
        getFileHandle: async () => { throw new Error('呼ばれてはいけない'); },
      },
      currentImage: makeImage(3),
      activeViewIndex: 0,
    });

    const result = await s().saveActiveCell();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('書き込みが許可されませんでした');
  });

  it('許可されれば保存へ進む', async () => {
    s().setFolderHandleA(null, 'dirA', ['dirA/a_0001.tga']);
    const written: string[] = [];
    usePaintStore.setState({
      folderHandleA: {
        name: 'dirA',
        queryPermission: async () => 'prompt',
        requestPermission: async () => 'granted',
        // パスの先頭 'dirA' はハンドル名として剥がされるので直下のファイルになる
        getFileHandle: async (n: string) => {
          written.push(n);
          return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
        },
      },
      currentImage: makeImage(3),
      activeViewIndex: 0,
    });

    const result = await s().saveActiveCell();
    expect(result.ok).toBe(true);
    expect(written).toEqual(['a_0001.tga']);
  });
});

describe('document スライス — 名前を付けて保存', () => {
  const origPicker = (globalThis as any).showSaveFilePicker;
  afterEach(() => {
    if (origPicker === undefined) delete (globalThis as any).showSaveFilePicker;
    else (globalThis as any).showSaveFilePicker = origPicker;
  });

  function setupCell() {
    s().setFolderHandleA(null, 'dirA', ['dirA/a_0001.tga']);
    usePaintStore.setState({
      folderHandleA: {
        name: 'dirA',
        getFileHandle: async () => { throw new Error('上書きしてはいけない'); },
      },
      currentImage: makeImage(5),
      activeViewIndex: 0,
      isDirtyA: true,
    });
  }

  it('元ファイルを上書きせず、選んだ先へ書き出す', async () => {
    setupCell();
    let suggested = '';
    const written: number[] = [];
    (globalThis as any).showSaveFilePicker = async (opts: any) => {
      suggested = opts.suggestedName;
      return {
        name: 'retake_0001.tga',
        createWritable: async () => ({
          write: async (buf: ArrayBuffer) => { written.push(new Uint8Array(buf)[18]); },
          close: async () => {},
        }),
      };
    };

    const result = await s().saveActiveCellAs();

    expect(result.ok).toBe(true);
    // 連番のパスではなくファイル名だけを初期値にする
    expect(suggested).toBe('a_0001.tga');
    expect(written).toEqual([5]);
    expect(result.message).toContain('retake_0001.tga');
  });

  it('書き出しても連番の元ファイルは未保存のまま', async () => {
    setupCell();
    (globalThis as any).showSaveFilePicker = async () => ({
      name: 'elsewhere.tga',
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    });

    await s().saveActiveCellAs();

    // 書き出し先は連番の一部ではないので、保存済みに見せてはいけない
    expect(s().isDirtyA).toBe(true);
  });

  it('ダイアログを閉じただけなら通知しない', async () => {
    setupCell();
    (globalThis as any).showSaveFilePicker = async () => {
      const err: any = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    };

    const result = await s().saveActiveCellAs();
    expect(result.ok).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.message).toBe('');
  });

  it('閲覧専用の画像は書き出さない', async () => {
    setupCell();
    usePaintStore.setState({ currentImage: { ...makeImage(1), isReadOnly: true } });
    (globalThis as any).showSaveFilePicker = async () => { throw new Error('呼ばれてはいけない'); };

    const result = await s().saveActiveCellAs();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('閲覧専用');
  });
});

describe('file スライス — リネーム', () => {
  /**
   * move() を持つファイルハンドルの模擬。
   * ⚠️ 実際の move() は同名ファイルを黙って上書きする。中身の同一性を
   * 追えるようにしておかないと、上書きでデータが消えても気づけない。
   */
  function makeDir(files: string[]) {
    const contents = new Map(files.map((f) => [f, `content:${f}`]));
    const dir: any = {
      name: 'dirA',
      contents,
      getFileHandle: async (n: string) => {
        if (!contents.has(n)) throw new Error(`no file: ${n}`);
        return {
          move: async (newName: string) => {
            const body = contents.get(n)!;
            contents.delete(n);
            contents.set(newName, body); // 既存があれば上書き (本物と同じ挙動)
          },
        };
      },
      getDirectoryHandle: async (n: string) => { throw new Error(`no dir: ${n}`); },
    };
    return dir;
  }

  const namesOf = (dir: any) => Array.from(dir.contents.keys()).sort();

  function setup(files: string[]) {
    const dir = makeDir(files);
    s().setFolderHandleA(dir, 'dirA', files.slice(), new Map(files.map((f) => [f, new File([], f)])));
    return dir;
  }

  it('先頭・末尾テキストと桁数を指定して連番リネームする', async () => {
    const dir = setup(['A0005.tga', 'A0006.tga', 'A0007.tga']);

    const plan = buildSequentialRenamePlan(s().fileListA, {
      prefix: 'C001_', suffix: '_go', startNumber: 1, digits: 4,
    });
    const result = await s().renameFiles(0, plan);

    expect(result.ok).toBe(true);
    expect(result.renamed).toBe(3);
    expect(namesOf(dir)).toEqual(['C001_0001_go.tga', 'C001_0002_go.tga', 'C001_0003_go.tga']);
    // ストアの一覧も追随する
    expect(s().fileListA).toEqual(['C001_0001_go.tga', 'C001_0002_go.tga', 'C001_0003_go.tga']);
  });

  it('番号をずらすだけの入れ替えも成立する', async () => {
    const dir = setup(['A0001.tga', 'A0002.tga', 'A0003.tga']);

    // 1つ繰り上げる: A0001->A0000, A0002->A0001, A0003->A0002
    const plan = buildSequentialRenamePlan(s().fileListA, {
      prefix: 'A', suffix: '', startNumber: 0, digits: 4,
    });
    const result = await s().renameFiles(0, plan);

    expect(result.ok).toBe(true);
    expect(namesOf(dir)).toEqual(['A0000.tga', 'A0001.tga', 'A0002.tga']);
  });

  it('番号を繰り上げても既存のコマを上書きしない', async () => {
    const dir = setup(['A0001.tga', 'A0002.tga', 'A0003.tga']);

    // 1つ繰り下げる: A0001->A0002, A0002->A0003, A0003->A0004
    // 順に move() すると A0001 が既存の A0002 を潰してしまう向き
    const plan = buildSequentialRenamePlan(s().fileListA, {
      prefix: 'A', suffix: '', startNumber: 2, digits: 4,
    });
    const result = await s().renameFiles(0, plan);

    expect(result.ok).toBe(true);
    expect(namesOf(dir)).toEqual(['A0002.tga', 'A0003.tga', 'A0004.tga']);
    // 中身が 1 つも失われていないこと (上書きが起きると 3 件未満になる)
    expect(new Set(dir.contents.values()).size).toBe(3);
    expect(dir.contents.get('A0002.tga')).toBe('content:A0001.tga');
    expect(dir.contents.get('A0004.tga')).toBe('content:A0003.tga');
  });

  it('対象外の既存ファイルと衝突したら 1 件も変更しない', async () => {
    const dir = setup(['A0001.tga', 'keep.tga']);
    const before = namesOf(dir);

    const result = await s().renameFiles(0, [
      { path: 'A0001.tga', from: 'A0001.tga', to: 'keep.tga' },
    ]);

    expect(result.ok).toBe(false);
    expect(result.renamed).toBe(0);
    expect(result.message).toContain('衝突');
    expect(namesOf(dir)).toEqual(before);
  });

  it('使えない文字が含まれていたら中止する', async () => {
    const dir = setup(['A0001.tga']);

    const result = await s().renameFiles(0, [
      { path: 'A0001.tga', from: 'A0001.tga', to: 'bad?name.tga' },
    ]);

    expect(result.ok).toBe(false);
    expect(namesOf(dir)).toEqual(['A0001.tga']);
  });

  it('書き込み可能なフォルダが無ければ理由を返す', async () => {
    s().setFolderHandleA(null, 'dirA', ['A0001.tga']);

    const result = await s().renameFiles(0, [
      { path: 'A0001.tga', from: 'A0001.tga', to: 'B0001.tga' },
    ]);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('フォルダ');
  });

  it('名前が変わらなければ何もしない', async () => {
    setup(['A0001.tga']);

    const result = await s().renameFiles(0, [
      { path: 'A0001.tga', from: 'A0001.tga', to: 'A0001.tga' },
    ]);

    expect(result.ok).toBe(true);
    expect(result.renamed).toBe(0);
  });
});

describe('file スライス — 複製と削除', () => {
  /** getFile / createWritable / removeEntry を持つディレクトリの模擬 */
  function makeDir(files: string[]) {
    const contents = new Map(files.map((f) => [f, `content:${f}`]));
    const dir: any = {
      name: 'dirA',
      contents,
      getFileHandle: async (n: string, opts?: any) => {
        if (!contents.has(n)) {
          if (!opts?.create) throw new Error(`no file: ${n}`);
          contents.set(n, '');
        }
        return {
          getFile: async () => ({ arrayBuffer: async () => contents.get(n) }),
          createWritable: async () => ({
            write: async (body: any) => contents.set(n, body),
            close: async () => {},
          }),
        };
      },
      removeEntry: async (n: string) => {
        if (!contents.has(n)) throw new Error(`no file: ${n}`);
        contents.delete(n);
      },
      getDirectoryHandle: async (n: string) => { throw new Error(`no dir: ${n}`); },
    };
    return dir;
  }

  const namesOf = (dir: any) => Array.from(dir.contents.keys()).sort();

  function setup(files: string[]) {
    const dir = makeDir(files);
    s().setFolderHandleA(dir, 'dirA', files.slice(), new Map(files.map((f) => [f, new File([], f)])));
    return dir;
  }

  it('複製は元ファイルを残したまま _copy を作る', async () => {
    const dir = setup(['A0001.tga', 'A0002.tga']);

    const result = await s().duplicateFiles(0, ['A0001.tga', 'A0002.tga']);

    expect(result.ok).toBe(true);
    expect(namesOf(dir)).toEqual(['A0001.tga', 'A0001_copy.tga', 'A0002.tga', 'A0002_copy.tga']);
    // 中身が元と同じであること
    expect(dir.contents.get('A0001_copy.tga')).toBe('content:A0001.tga');
    // 一覧にも反映される
    expect(s().fileListA).toContain('A0001_copy.tga');
  });

  it('複製を繰り返しても既存を潰さない', async () => {
    const dir = setup(['A0001.tga']);

    await s().duplicateFiles(0, ['A0001.tga']);
    await s().duplicateFiles(0, ['A0001.tga']);

    expect(namesOf(dir)).toEqual(['A0001.tga', 'A0001_copy.tga', 'A0001_copy2.tga']);
  });

  it('削除すると実体と一覧の両方から消える', async () => {
    const dir = setup(['A0001.tga', 'A0002.tga', 'A0003.tga']);

    const result = await s().deleteFiles(0, ['A0001.tga', 'A0003.tga']);

    expect(result.ok).toBe(true);
    expect(result.renamed).toBe(2);
    expect(namesOf(dir)).toEqual(['A0002.tga']);
    expect(s().fileListA).toEqual(['A0002.tga']);
  });

  it('書き込み可能なフォルダが無ければ何もしない', async () => {
    s().setFolderHandleA(null, 'dirA', ['A0001.tga']);

    expect((await s().duplicateFiles(0, ['A0001.tga'])).ok).toBe(false);
    expect((await s().deleteFiles(0, ['A0001.tga'])).ok).toBe(false);
  });
});

describe('document スライス — 画像キャッシュ', () => {
  it('キーにフォルダ名が含まれ、別フォルダの同名ファイルと衝突しない', () => {
    s().setFolderHandleA(null, 'cut_A', ['0001.tga']);
    const keyA = s().getImageCacheKey(0, '0001.tga');
    s().setFolderHandleA(null, 'cut_B', ['0001.tga']);
    const keyB = s().getImageCacheKey(0, '0001.tga');

    expect(keyA).toContain('cut_A');
    expect(keyB).toContain('cut_B');
    expect(keyA).not.toBe(keyB);
  });

  it('保存・取り出し・破棄ができる', () => {
    const key = s().getImageCacheKey(0, '0001.tga');
    s().putCachedImage(key, makeImage(7));
    expect(s().getCachedImage(key)?.data[0]).toBe(7);

    s().invalidateCachedImage(key);
    expect(s().getCachedImage(key)).toBeNull();
  });

  it('上限を超えると古いものから捨てる', () => {
    for (let i = 0; i < 20; i++) s().putCachedImage(`key-${i}`, makeImage(i));

    expect(s().cacheImages.size).toBeLessThanOrEqual(16);
    expect(s().getCachedImage('key-0')).toBeNull(); // 最古は追い出される
    expect(s().getCachedImage('key-19')?.data[0]).toBe(19); // 最新は残る
  });
});

describe('lightTable スライス', () => {
  it('オニオンスキンの前後コマ数を更新する', () => {
    s().setOnionSkinFrames(3, 2);
    expect(s().lightTable.pastFrames).toBe(3);
    expect(s().lightTable.futureFrames).toBe(2);
  });

  it('コマ数は 0〜30 に収まる', () => {
    s().setOnionSkinFrames(99, -1);
    expect(s().lightTable.pastFrames).toBe(30);
    expect(s().lightTable.futureFrames).toBe(0);
  });

  it('既定ではオニオンスキンは OFF', () => {
    expect(s().lightTable.enabled).toBe(false);
    expect(s().lightTable.showAllFrames).toBe(false);
  });

  it('カット全体モードを切り替えられる', () => {
    s().setOnionSkinShowAllFrames(true);
    expect(s().lightTable.showAllFrames).toBe(true);
    s().setOnionSkinShowAllFrames(false);
    expect(s().lightTable.showAllFrames).toBe(false);
  });

  it('不透明度は startOpacity に反映される', () => {
    s().setLightTableOpacity(55);
    expect(s().lightTable.startOpacity).toBe(55);
  });

  it('旧名エイリアスが残っていない', () => {
    // 同じ意味の値が 2 組あると片方だけ更新される事故が起きるため撤去済み
    const lt = s().lightTable as unknown as Record<string, unknown>;
    expect('prevFrames' in lt).toBe(false);
    expect('nextFrames' in lt).toBe(false);
    expect('opacity' in lt).toBe(false);
    expect('colorMode' in lt).toBe(false);
  });
});

describe('view スライス — 左右連動', () => {
  beforeEach(() => {
    s().setFolderHandleA(null, 'dirA', ['0001.tga', '0002.tga', '0003.tga', '0004.tga', '0005.tga']);
    s().setFolderHandleB(null, 'dirB', ['0001.tga', '0002.tga', '0003.tga', '0004.tga', '0005.tga']);
    usePaintStore.setState({ isSplitView: true, syncMode: false });
  });

  it('初期状態では連動しない', () => {
    expect(usePaintStore.getState().syncMode).toBe(false);
  });

  it('連動を押しても、それぞれが選んでいるコマは動かない', () => {
    usePaintStore.setState({ currentFileIndex: 1, splitFileIndex: 3 });

    s().toggleSyncMode();

    expect(s().syncMode).toBe(true);
    expect(s().currentFileIndex).toBe(1); // 勝手に揃えられない
    expect(s().splitFileIndex).toBe(3);
    expect(s().syncFrameOffset).toBe(2); // 差分を記録する
  });

  it('連動中はコマ差を保ったまま追従する', () => {
    usePaintStore.setState({ currentFileIndex: 1, splitFileIndex: 3 });
    s().toggleSyncMode();

    s().nextCell();
    expect(s().currentFileIndex).toBe(2);
    expect(s().splitFileIndex).toBe(4); // 差 2 を維持

    s().setCurrentFileIndex(0);
    expect(s().splitFileIndex).toBe(2); // 直接選択でも差を維持
  });

  it('Win B 側を選んでも Win A が同じ差で追従する', () => {
    usePaintStore.setState({ currentFileIndex: 0, splitFileIndex: 2 });
    s().toggleSyncMode();

    s().setSplitFileIndex(4);
    expect(s().currentFileIndex).toBe(2);
  });

  it('連動を解除すると相手は動かなくなる', () => {
    usePaintStore.setState({ currentFileIndex: 1, splitFileIndex: 3 });
    s().toggleSyncMode();
    s().toggleSyncMode();

    expect(s().syncMode).toBe(false);
    s().setCurrentFileIndex(4);
    expect(s().splitFileIndex).toBe(3); // 据え置き
  });
});

describe('view スライス — 参照ウィンドウとの分割比', () => {
  it('初期値は左右均等', () => {
    expect(s().mainAreaSplitRatio).toBe(0.5);
  });

  it('境界線を動かすと取り分が変わる', () => {
    s().setMainAreaSplitRatio(0.7);
    expect(s().mainAreaSplitRatio).toBeCloseTo(0.7);
  });

  it('片側が潰れないよう両端で止まる', () => {
    s().setMainAreaSplitRatio(0);
    expect(s().mainAreaSplitRatio).toBe(0.15);

    s().setMainAreaSplitRatio(1);
    expect(s().mainAreaSplitRatio).toBe(0.85);

    s().setMainAreaSplitRatio(-5);
    expect(s().mainAreaSplitRatio).toBe(0.15);
  });
});

describe('window スライス — 独立ウィンドウの位置・サイズ・重なり順', () => {
  it('位置とサイズが保持される (ドッキング往復で失われない)', () => {
    s().setFloatingWindowPosition('winA', 300, 200);
    s().setFloatingWindowSize('winA', 900, 700);

    expect(s().floatingWindows.winA).toMatchObject({ x: 300, y: 200, width: 900, height: 700 });
    // 他のウィンドウには影響しない
    expect(s().floatingWindows.winB.x).toBe(200);
  });

  it('最前面に持ち上げると z-index が上がる', () => {
    const before = s().getWindowZIndex('reference');
    s().bringWindowToFront('reference');

    expect(s().floatingWindowOrder[s().floatingWindowOrder.length - 1]).toBe('reference');
    expect(s().getWindowZIndex('reference')).toBeGreaterThan(before);
    // 最前面のウィンドウが他のどれよりも手前に来る
    const others = ['winA', 'winB', 'colorChart'] as const;
    for (const id of others) {
      expect(s().getWindowZIndex('reference')).toBeGreaterThan(s().getWindowZIndex(id));
    }
  });

  it('重なり順に同じウィンドウが重複しない', () => {
    s().bringWindowToFront('winB');
    s().bringWindowToFront('winB');
    s().bringWindowToFront('colorChart');

    const order = s().floatingWindowOrder;
    expect(new Set(order).size).toBe(order.length);
    expect(order.length).toBe(4);
  });
});

describe('スライスをまたぐ参照', () => {
  it('edit スライスが document スライスのアクティブ画像を対象にする', () => {
    usePaintStore.setState({
      currentImage: makeImage(1),
      splitImage: makeImage(255), // 全面が純白 = 透過対象
      activeViewIndex: 1,
    });

    s().convertWhiteToAlphaGlobal();

    expect(s().splitImage!.data[3]).toBe(0); // Win B が透過された
    expect(s().isDirtyB).toBe(true); // Win B が未保存になった
    expect(s().isDirtyA).toBe(false); // Win A は無関係
  });

  it('2画面表示を閉じるとアクティブビューが Win A に戻る', () => {
    vi.stubGlobal('window', { confirm: () => true });
    usePaintStore.setState({ isSplitView: true, activeViewIndex: 1 });

    s().toggleIsSplitView();

    expect(s().isSplitView).toBe(false);
    expect(s().activeViewIndex).toBe(0);
    vi.unstubAllGlobals();
  });
});
