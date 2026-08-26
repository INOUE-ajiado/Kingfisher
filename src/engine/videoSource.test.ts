import { describe, it, expect } from 'vitest';
import {
  isVideoFile,
  toPlayableBlob,
  describeCodec,
  findVideoFourccInMoov,
  probeVideoCodec,
  frameIndexAt,
  timeForFrame,
  steppedTime,
  estimateFps,
} from './videoSource';

/** ISO-BMFF の箱を 1 つ組み立てる */
function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

function u32(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v));
  return out;
}

function fourccBytes(code: string): Uint8Array {
  return new Uint8Array([...code].map((c) => c.charCodeAt(0)));
}

/** 映像フォーマットを 1 つ持つ stsd 箱 */
function stsd(format: string): Uint8Array {
  return box('stsd', new Uint8Array([
    ...u32(0, 1),               // version+flags, entry_count
    ...u32(16),                 // entry size
    ...fourccBytes(format),
  ]));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

describe('動画ファイルの判定', () => {
  it('mov / mp4 / m4v / webm を受け入れる', () => {
    expect(['a.mov', 'a.MOV', 'a.mp4', 'a.m4v', 'a.webm'].every(isVideoFile)).toBe(true);
  });

  it('セル画像は動画として扱わない', () => {
    expect(['a.tga', 'a.png', 'a.jpg', 'movie'].some(isVideoFile)).toBe(false);
  });
});

describe('再生用 Blob への付け替え', () => {
  it('.mov の MIME を video/mp4 にする', () => {
    // Chrome の <video> は video/quicktime を受け付けないが、中身が H.264 なら再生できる
    const file = new Blob([new Uint8Array(1024)], { type: 'video/quicktime' });
    const playable = toPlayableBlob(file);

    expect(playable.type).toBe('video/mp4');
    expect(playable.size).toBe(file.size);
  });
});

describe('コーデックの説明', () => {
  it('H.264 は再生できる', () => {
    expect(describeCodec('avc1')).toEqual({ fourcc: 'avc1', label: 'H.264', playable: 'yes' });
  });

  it('ProRes は再生できないと分かる名前で返す', () => {
    const info = describeCodec('apcn');
    expect(info.playable).toBe('no');
    expect(info.label).toContain('ProRes');
  });

  it('知らない 4 文字コードでも落ちない', () => {
    const info = describeCodec('zzzz');
    expect(info.playable).toBe('no');
    expect(info.label).toContain('zzzz');
  });
});

describe('moov からの映像フォーマット抽出', () => {
  it('stsd の中の 4 文字コードを取り出す', () => {
    const moov = box('moov', box('trak', stsd('apcn')));
    expect(findVideoFourccInMoov(moov)).toBe('apcn');
  });

  it('音声の stsd が先にあっても映像を選ぶ', () => {
    // 実ファイルでは映像・音声・タイムコードの stsd が並ぶ
    const moov = box('moov', concat(box('trak', stsd('mp4a')), box('trak', stsd('avc1'))));
    expect(findVideoFourccInMoov(moov)).toBe('avc1');
  });

  it('stsd が無ければ null', () => {
    expect(findVideoFourccInMoov(box('moov', u32(0)))).toBeNull();
  });
});

describe('コーデックの判別 (ファイル全体を読まない)', () => {
  it('moov が末尾にある .mov でも判別できる', async () => {
    // 撮影上がりの .mov は moov が末尾に置かれることが多い
    const file = new Blob([
      box('ftyp', fourccBytes('qt  ')),
      box('mdat', new Uint8Array(4096)),
      box('moov', box('trak', stsd('ap4h'))),
    ]);

    await expect(probeVideoCodec(file)).resolves.toMatchObject({ fourcc: 'ap4h', playable: 'no' });
  });

  it('先頭に moov があっても判別できる', async () => {
    const file = new Blob([
      box('ftyp', fourccBytes('isom')),
      box('moov', box('trak', stsd('avc1'))),
      box('mdat', new Uint8Array(64)),
    ]);

    await expect(probeVideoCodec(file)).resolves.toMatchObject({ fourcc: 'avc1', playable: 'yes' });
  });

  it('ISO-BMFF でなければ null (判別できないだけで例外にしない)', async () => {
    await expect(probeVideoCodec(new Blob([new Uint8Array(64)]))).resolves.toBeNull();
  });

  it('壊れた箱で無限ループしない', async () => {
    // size が 0 の箱は「末尾まで」の意味。ここで進めなくなる
    const broken = new Uint8Array(16);
    broken.set(fourccBytes('junk'), 4);
    await expect(probeVideoCodec(new Blob([broken]))).resolves.toBeNull();
  });
});

describe('コマ送りの時刻計算', () => {
  it('時刻からコマ番号を求める', () => {
    expect(frameIndexAt(0, 24)).toBe(0);
    expect(frameIndexAt(0.5 / 24, 24)).toBe(0);
    expect(frameIndexAt(1 / 24, 24)).toBe(1);
    expect(frameIndexAt(1, 24)).toBe(24);
  });

  it('コマの中央の時刻を返す (端は隣のコマが出るため狙わない)', () => {
    expect(timeForFrame(0, 24)).toBeCloseTo(0.5 / 24, 6);
    expect(timeForFrame(10, 24)).toBeCloseTo(10.5 / 24, 6);
  });

  it('1 コマ進めて戻すと元のコマに戻る', () => {
    const fps = 23.976;
    const start = timeForFrame(100, fps);
    const next = steppedTime(start, 1, fps);
    expect(frameIndexAt(next, fps)).toBe(101);
    expect(frameIndexAt(steppedTime(next, -1, fps), fps)).toBe(100);
  });

  it('先頭より前へは戻らない', () => {
    expect(frameIndexAt(steppedTime(timeForFrame(0, 24), -1, 24), 24)).toBe(0);
  });

  it('尺の終端を越えない', () => {
    const duration = 2;
    expect(steppedTime(1.99, 5, 24, duration)).toBeLessThan(duration);
  });

  it('1 秒送りは fps ぶんのコマを進む', () => {
    // 秒数を直接足すとコマの境界からずれ、その後のコマ送りが半コマずれる
    const fps = 24;
    const start = timeForFrame(0, fps);
    const later = steppedTime(start, fps, fps);
    expect(frameIndexAt(later, fps)).toBe(fps);
    expect(later - start).toBeCloseTo(1, 6);
  });

  it('1 秒戻しても境界に乗ったまま', () => {
    const fps = 23.976;
    const start = timeForFrame(100, fps);
    const back = steppedTime(start, -24, fps);
    expect(frameIndexAt(back, fps)).toBe(76);
  });

  it('fps が 0 でも壊れない', () => {
    expect(frameIndexAt(1, 0)).toBe(0);
    expect(timeForFrame(5, 0)).toBe(0);
  });
});

describe('fps の推定', () => {
  it('24fps の並びから 24 を返す', () => {
    const times = Array.from({ length: 12 }, (_, i) => i / 24);
    expect(estimateFps(times)).toBe(24);
  });

  it('23.976 を 24 と取り違えない', () => {
    const times = Array.from({ length: 12 }, (_, i) => i / 23.976);
    expect(estimateFps(times)).toBe(23.976);
  });

  it('デコードの詰まりが 1 回混ざっても引きずられない', () => {
    // 中央値を使うので、飛んだ 1 コマぶんに全体が引っ張られない
    const times = [0, 1 / 24, 2 / 24, 3 / 24, 0.4, 0.4 + 1 / 24, 0.4 + 2 / 24, 0.4 + 3 / 24];
    expect(estimateFps(times)).toBe(24);
  });

  it('材料が足りなければ null', () => {
    expect(estimateFps([0, 1 / 24])).toBeNull();
  });
});
