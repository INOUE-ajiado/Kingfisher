import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { usePaintStore } from './usePaintStore';

/**
 * ロール再生の状態。
 *
 * ここで守りたいのは 2 つ。
 *  - blob URL を必ず手放すこと (数 GB のロールを何本も開く使い方をする)
 *  - 再生できないときに「なぜ / どうすれば」まで出すこと
 */

const s = () => usePaintStore.getState();

/** ISO-BMFF の箱を 1 つ組み立てる */
function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

function stsd(format: string): Uint8Array {
  const payload = new Uint8Array(20);
  new DataView(payload.buffer).setUint32(4, 1); // entry_count
  new DataView(payload.buffer).setUint32(8, 16); // entry size
  for (let i = 0; i < 4; i++) payload[12 + i] = format.charCodeAt(i);
  return box('stsd', payload);
}

/** 末尾に moov を持つ .mov を模したファイル */
function movFile(format: string, name = 'A_part_t1.mov'): File {
  const bytes = [box('ftyp', new Uint8Array(4)), box('mdat', new Uint8Array(256)), box('moov', box('trak', stsd(format)))];
  return new File(bytes as unknown as BlobPart[], name, { type: 'video/quicktime' });
}

let created: string[] = [];
let revoked: string[] = [];

beforeEach(() => {
  created = [];
  revoked = [];
  let n = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => {
      const url = `blob:test/${++n}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => revoked.push(url),
  });
  const emptyView = () => ({
    isOpen: false,
    isFloating: false,
    files: [],
    folderName: '',
    fileName: '',
    file: null,
    objectUrl: null,
    currentPath: null,
    status: 'idle' as const,
    message: '',
    codec: null,
    fps: 24,
    fpsSource: 'default' as const,
  });
  usePaintStore.setState({
    roll: {
      views: { rollA: emptyView(), rollB: emptyView() },
      activeId: 'rollA',
      sync: false,
      syncOffset: 0,
      fileSync: false,
      fileSyncOffset: 0,
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('ロールの読み込み', () => {
  it('開くとウィンドウが出て、再生用の URL ができる', () => {
    s().loadRollFile('rollA', movFile('avc1'));

    expect(s().roll.views.rollA.isOpen).toBe(true);
    expect(s().roll.views.rollA.fileName).toBe('A_part_t1.mov');
    expect(s().roll.views.rollA.objectUrl).toBe(created[0]);
    // まず再生させてみる方針なので、この時点では ready
    expect(s().roll.views.rollA.status).toBe('ready');
  });

  it('差し替えると前の URL を手放す', () => {
    s().loadRollFile('rollA', movFile('avc1', 'first.mov'));
    s().loadRollFile('rollA', movFile('avc1', 'second.mov'));

    expect(revoked).toEqual([created[0]]);
    expect(s().roll.views.rollA.objectUrl).toBe(created[1]);
  });

  it('閉じると URL を手放し、素材だけ捨てる', () => {
    s().toggleRollFloating('rollA');
    s().loadRollFile('rollA', movFile('avc1'));
    s().closeRollWindow('rollA');

    expect(revoked).toContain(created[0]);
    expect(s().roll.views.rollA.objectUrl).toBeNull();
    expect(s().roll.views.rollA.fileName).toBe('');
    // ウィンドウの切り離し状態は次に開いたときのために残す
    expect(s().roll.views.rollA.isFloating).toBe(true);
  });
});

describe('再生できないコーデック', () => {
  it('ProRes ならコーデック名と変換コマンドを出す', async () => {
    s().loadRollFile('rollA', movFile('apch'));
    await s().reportRollPlaybackFailure('rollA');

    const { status, message, codec } = s().roll.views.rollA;
    expect(status).toBe('unsupported');
    expect(codec?.label).toContain('ProRes');
    expect(message).toContain('ProRes');
    expect(message).toContain('ffmpeg');
    // 入力ファイル名がそのまま使えるコマンドになっていること
    expect(message).toContain('A_part_t1.mov');
  });

  it('判別できなくても黙らず、打つ手を出す', async () => {
    s().loadRollFile('rollA', new File([new Uint8Array(32)] as unknown as BlobPart[], 'broken.mov'));
    await s().reportRollPlaybackFailure('rollA');

    expect(s().roll.views.rollA.status).toBe('error');
    expect(s().roll.views.rollA.message).toContain('ffmpeg');
  });

  it('素材が無ければ何もしない', async () => {
    await s().reportRollPlaybackFailure('rollA');
    expect(s().roll.views.rollA.status).toBe('idle');
  });
});

describe('コマ送りの基準 fps', () => {
  it('自動推定を採り込む', () => {
    s().setRollFps('rollA', 23.976, 'auto');
    expect(s().roll.views.rollA.fps).toBe(23.976);
    expect(s().roll.views.rollA.fpsSource).toBe('auto');
  });

  it('手動で決めた値を自動推定で上書きしない', () => {
    s().setRollFps('rollA', 25, 'manual');
    s().setRollFps('rollA', 29.97, 'auto');

    expect(s().roll.views.rollA.fps).toBe(25);
    expect(s().roll.views.rollA.fpsSource).toBe('manual');
  });

  it('ありえない値は受け付けない', () => {
    s().setRollFps('rollA', 0, 'manual');
    s().setRollFps('rollA', Number.NaN, 'manual');
    expect(s().roll.views.rollA.fps).toBe(24);
  });
});

describe('2 面 (修正前 / 修正後の見比べ)', () => {
  it('片方を開いても、もう片方は空のまま', () => {
    s().loadRollFile('rollA', movFile('avc1', 'before.mov'));

    expect(s().roll.views.rollA.fileName).toBe('before.mov');
    expect(s().roll.views.rollB.isOpen).toBe(false);
    expect(s().roll.views.rollB.objectUrl).toBeNull();
  });

  it('それぞれ別のロールを開ける', () => {
    s().loadRollFile('rollA', movFile('avc1', 'before.mov'));
    s().loadRollFile('rollB', movFile('avc1', 'after.mov'));

    expect(s().roll.views.rollA.fileName).toBe('before.mov');
    expect(s().roll.views.rollB.fileName).toBe('after.mov');
    // それぞれ別の URL を持つ
    expect(s().roll.views.rollA.objectUrl).not.toBe(s().roll.views.rollB.objectUrl);
  });

  it('片方を閉じても、もう片方は残る', () => {
    s().loadRollFile('rollA', movFile('avc1', 'before.mov'));
    s().loadRollFile('rollB', movFile('avc1', 'after.mov'));
    s().closeRollWindow('rollB');

    expect(s().roll.views.rollA.fileName).toBe('before.mov');
    expect(s().roll.views.rollB.objectUrl).toBeNull();
    // 閉じた側の URL だけ手放す
    expect(revoked).toEqual([created[1]]);
  });

  it('一覧は面ごとに持つ (ツリーも面ごとに 1 本ずつ並べるため)', () => {
    const videosA = [
      { path: 'RollA/before.mov', file: movFile('avc1', 'before.mov') },
      { path: 'RollA/after.mov', file: movFile('avc1', 'after.mov') },
    ];
    const videosB = [{ path: 'RollB/retake.mov', file: movFile('avc1', 'retake.mov') }];

    s().setRollFolderFiles('rollA', videosA, 'RollA');
    s().setRollFolderFiles('rollB', videosB, 'RollB');

    expect(s().roll.views.rollA.files.map((v) => v.path)).toEqual([
      'RollA/before.mov',
      'RollA/after.mov',
    ]);
    expect(s().roll.views.rollB.files.map((v) => v.path)).toEqual(['RollB/retake.mov']);

    // 自分の一覧に無いものは開かない (相手の一覧へ流れ込まない)
    s().selectRollFile('rollB', 'RollA/before.mov');
    expect(s().roll.views.rollB.currentPath).toBeNull();

    s().selectRollFile('rollA', 'RollA/before.mov');
    s().selectRollFile('rollB', 'RollB/retake.mov');
    expect(s().roll.views.rollA.currentPath).toBe('RollA/before.mov');
    expect(s().roll.views.rollB.currentPath).toBe('RollB/retake.mov');
  });

  it('2 面目を開くとき、一覧が空なら相手のものを引き継ぐ', () => {
    // 1 つのフォルダを 2 面で見比べる使い方。ここで引き継がないと
    // ツリーの 2 本目が空のまま並び、同じフォルダを落とし直す羽目になる
    const videos = [
      { path: 'Roll/before.mov', file: movFile('avc1', 'before.mov') },
      { path: 'Roll/after.mov', file: movFile('avc1', 'after.mov') },
    ];
    s().loadRollFiles('rollA', videos, 'Roll');
    s().openRollWindow('rollB');

    expect(s().roll.views.rollB.files).toHaveLength(2);
    expect(s().roll.views.rollB.folderName).toBe('Roll');
    // 引き継ぐのは一覧だけ。何を開くかは選ばれてから決まる
    expect(s().roll.views.rollB.currentPath).toBeNull();

    // 既に自分の一覧を持っている面は上書きしない
    s().loadRollFiles('rollB', [{ path: 'Other/x.mov', file: movFile('avc1', 'x.mov') }], 'Other');
    s().closeRollWindow('rollA');
    s().loadRollFiles('rollA', videos, 'Roll');
    s().openRollWindow('rollB');
    expect(s().roll.views.rollB.folderName).toBe('Other');
  });

  it('開いた面がアクティブになる', () => {
    s().loadRollFile('rollB', movFile('avc1'));
    expect(s().roll.activeId).toBe('rollB');
  });
});

describe('連動', () => {
  const openBoth = () => {
    s().loadRollFile('rollA', movFile('avc1', 'before.mov'));
    s().loadRollFile('rollB', movFile('avc1', 'after.mov'));
  };

  it('片方しか開いていなければ連動しない', () => {
    s().loadRollFile('rollA', movFile('avc1'));
    s().toggleRollSync(0);
    expect(s().roll.sync).toBe(false);
  });

  it('両方開いていれば連動できる', () => {
    openBoth();
    s().toggleRollSync(0);
    expect(s().roll.sync).toBe(true);
  });

  it('開始時の時刻差を覚える', () => {
    // 片方を頭出ししてから連動させる使い方があるので、差を保つ
    openBoth();
    s().toggleRollSync(1.5);
    expect(s().roll.syncOffset).toBeCloseTo(1.5, 6);
  });

  it('もう一度押すと解除される', () => {
    openBoth();
    s().toggleRollSync(1.5);
    s().toggleRollSync();
    expect(s().roll.sync).toBe(false);
  });
});

describe('ツリーの選択の連動', () => {
  /** 3 本ずつ入った 2 つのフォルダを、面ごとに読み込む */
  const loadBoth = () => {
    const videos = (prefix: string) =>
      ['c1', 'c2', 'c3'].map((n) => ({
        path: `${prefix}/${n}.mov`,
        file: movFile('avc1', `${n}.mov`),
      }));
    s().loadRollFiles('rollA', videos('Before'), 'Before');
    s().loadRollFiles('rollB', videos('After'), 'After');
  };

  const pathA = () => s().roll.views.rollA.currentPath;
  const pathB = () => s().roll.views.rollB.currentPath;

  it('片方に一覧が無ければ連動しない', () => {
    s().loadRollFile('rollA', movFile('avc1'));
    s().toggleRollFileSync();
    expect(s().roll.fileSync).toBe(false);
  });

  it('開始時のずれを覚え、押しただけでは動かさない', () => {
    // 「A の 1 本目と B の 2 本目が同じカット」という並びに合わせてから連動させる
    loadBoth();
    s().selectRollFile('rollB', 'After/c2.mov');
    s().toggleRollFileSync();

    expect(s().roll.fileSync).toBe(true);
    expect(s().roll.fileSyncOffset).toBe(1);
    expect(pathA()).toBe('Before/c1.mov');
    expect(pathB()).toBe('After/c2.mov');
  });

  it('片方で選ぶと、もう片方もずれを保って動く', () => {
    loadBoth();
    s().selectRollFile('rollB', 'After/c2.mov');
    s().toggleRollFileSync();

    s().selectRollFile('rollA', 'Before/c2.mov');
    expect(pathB()).toBe('After/c3.mov');

    // 逆向きも同じ差で追う
    s().selectRollFile('rollB', 'After/c2.mov');
    expect(pathA()).toBe('Before/c1.mov');
  });

  it('コマ送り (前後のロールへ) からも連動する', () => {
    loadBoth();
    s().toggleRollFileSync();
    s().stepRoll('rollA', 1);
    expect(pathA()).toBe('Before/c2.mov');
    expect(pathB()).toBe('After/c2.mov');
  });

  it('一覧の端では止まるが、ずれ自体は保つ', () => {
    loadBoth();
    s().selectRollFile('rollB', 'After/c2.mov');
    s().toggleRollFileSync(); // ずれ +1

    s().selectRollFile('rollA', 'Before/c3.mov');
    expect(pathB()).toBe('After/c3.mov'); // これ以上先が無いので端で止まる
    expect(s().roll.fileSyncOffset).toBe(1);

    // 端で切り詰めた分をずれに書き戻していないこと (戻せば元の差で付いてくる)
    s().selectRollFile('rollA', 'Before/c1.mov');
    expect(pathB()).toBe('After/c2.mov');
  });

  it('連動していなければ相手は動かない', () => {
    loadBoth();
    s().selectRollFile('rollA', 'Before/c3.mov');
    expect(pathB()).toBe('After/c1.mov');
  });

  it('差を揃えるとロール B がロール A と同じ位置へ来る', () => {
    loadBoth();
    s().selectRollFile('rollB', 'After/c3.mov');
    s().toggleRollFileSync();
    s().alignRollFiles();

    expect(s().roll.fileSyncOffset).toBe(0);
    expect(pathB()).toBe('After/c1.mov');
  });

  it('連動で開いた URL も手放す', () => {
    loadBoth();
    s().toggleRollFileSync();
    const before = revoked.length;
    s().selectRollFile('rollA', 'Before/c2.mov');
    // 2 面とも差し替わるので、前の URL は 2 本とも解放される
    expect(revoked.length).toBe(before + 2);
  });

  it('面を閉じたら連動も解ける', () => {
    loadBoth();
    s().toggleRollFileSync();
    s().closeRollWindow('rollB');
    expect(s().roll.fileSync).toBe(false);
  });
});
