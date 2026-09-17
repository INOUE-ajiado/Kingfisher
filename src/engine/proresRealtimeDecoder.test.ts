import { describe, it, expect } from 'vitest';
import { parseProResMovMetadata, ProResRealtimeDecoder } from './proresRealtimeDecoder';
import { parseMovVideoTrack } from './prores/movSampleTable';

/** ISO-BMFF の箱を 1 つ組み立てる */
function box(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
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

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** 映像フォーマットを 1 つ持つ stsd 箱 */
function stsd(format: string, width = 1920, height = 1080): Uint8Array {
  const payload = new Uint8Array(48);
  const view = new DataView(payload.buffer);
  view.setUint32(0, 0); // version+flags
  view.setUint32(4, 1); // entry_count
  view.setUint32(8, 48); // entry size
  for (let i = 0; i < 4; i++) payload[12 + i] = format.charCodeAt(i);
  view.setUint16(40, width);
  view.setUint16(42, height);
  return box('stsd', payload);
}

/** mdhd (version 0): timescale と duration だけ意味を持たせる */
function mdhd(timescale: number, duration: number): Uint8Array {
  return box('mdhd', u32(0, 0, 0, timescale, duration, 0));
}

interface TrackSpec {
  format: string;
  width?: number;
  height?: number;
  timescale: number;
  sizes: number[];
  /** [first_chunk (1 始まり), samples_per_chunk] */
  stsc: Array<[number, number]>;
  chunkOffsets: number[];
  stts: Array<[number, number]>;
}

function trak(t: TrackSpec): Uint8Array {
  const stbl = concat(
    stsd(t.format, t.width, t.height),
    box('stts', concat(u32(0, t.stts.length), ...t.stts.map(([n, d]) => u32(n, d)))),
    box('stsc', concat(u32(0, t.stsc.length), ...t.stsc.map(([c, n]) => u32(c, n, 1)))),
    box('stsz', concat(u32(0, 0, t.sizes.length), u32(...t.sizes))),
    box('stco', concat(u32(0, t.chunkOffsets.length), u32(...t.chunkOffsets))),
  );
  const total = t.stts.reduce((n, [c, d]) => n + c * d, 0);
  return box('trak', box('mdia', concat(mdhd(t.timescale, total), box('minf', box('stbl', stbl)))));
}

/** ProRes フレームヘッダーだけを持つ偽のコマ */
function fakeFrame(size: number, width: number, height: number): Uint8Array {
  const f = new Uint8Array(size);
  const v = new DataView(f.buffer);
  v.setUint32(0, size);
  f.set(fourccBytes('icpf'), 4);
  v.setUint16(8, 148);
  v.setUint16(16, width);
  v.setUint16(18, height);
  f[20] = 2 << 6;
  return f;
}

describe('MOV の索引 (movSampleTable)', () => {
  it('1 チャンクに複数コマ入っていても各コマの位置を正しく出す', () => {
    const moov = trak({
      format: 'apch',
      timescale: 24000,
      sizes: [100, 110, 120, 130, 140, 150],
      // チャンク 1 は 4 コマ、チャンク 2 以降は 2 コマ
      stsc: [[1, 4], [2, 2]],
      chunkOffsets: [1000, 5000],
      stts: [[6, 1001]],
    });
    const track = parseMovVideoTrack(moov)!;
    expect(track.samples).toEqual([
      { offset: 1000, size: 100 },
      { offset: 1100, size: 110 },
      { offset: 1210, size: 120 },
      { offset: 1330, size: 130 },
      { offset: 5000, size: 140 },
      { offset: 5140, size: 150 },
    ]);
    expect(track.fps).toBeCloseTo(23.976, 3);
    expect(track.sampleTimes).toEqual([0, 1001, 2002, 3003, 4004, 5005]);
  });

  it('音声や timecode のトラックを飛ばして ProRes の映像トラックを選ぶ', () => {
    const audio = box('trak', box('mdia', concat(mdhd(48000, 48000), box('minf', box('stbl', concat(
      box('stsd', concat(u32(0, 1), u32(16), fourccBytes('mp4a'))),
      box('stsz', concat(u32(0, 0, 1), u32(100))),
      box('stco', concat(u32(0, 1), u32(500))),
    ))))));
    const video = trak({
      format: 'apcn', width: 3840, height: 2160, timescale: 25,
      sizes: [2000, 2500], stsc: [[1, 1]], chunkOffsets: [10000, 12500], stts: [[2, 1]],
    });
    const track = parseMovVideoTrack(concat(audio, video))!;
    expect(track.fourcc).toBe('apcn');
    expect(track.width).toBe(3840);
    expect(track.fps).toBe(25);
    expect(track.samples.length).toBe(2);
  });

  it('ProRes が無ければ null', () => {
    const h264 = trak({ format: 'avc1', timescale: 24, sizes: [1], stsc: [[1, 1]], chunkOffsets: [0], stts: [[1, 1]] });
    expect(parseMovVideoTrack(h264)).toBeNull();
  });
});

describe('parseProResMovMetadata', () => {
  it('ファイル全体から索引を作り、寸法はコマのヘッダーを正とする', async () => {
    const frames = [fakeFrame(300, 1920, 1080), fakeFrame(320, 1920, 1080), fakeFrame(340, 1920, 1080)];
    const ftyp = box('ftyp', fourccBytes('qt  '));
    // moov の大きさは中身の数値に依らないので、仮の位置で一度組んで長さを知る
    const build = (dataStart: number) => box('moov', trak({
      format: 'apch', width: 1440, height: 1080, timescale: 24000,
      sizes: frames.map((f) => f.length), stsc: [[1, 3]], chunkOffsets: [dataStart], stts: [[3, 1001]],
    }));
    const dataStart = ftyp.length + build(0).length + 8;
    const fileBits = concat(ftyp, build(dataStart), box('mdat', concat(...frames)));

    const meta = await parseProResMovMetadata(new File([fileBits], 'roll.mov'));
    expect(meta).not.toBeNull();
    expect(meta!.fourcc).toBe('apch');
    expect(meta!.width).toBe(1920);
    expect(meta!.height).toBe(1080);
    expect(meta!.totalFrames).toBe(3);
    expect(meta!.samples.map((s) => s.offset)).toEqual([dataStart, dataStart + 300, dataStart + 620]);
    expect(meta!.duration).toBeCloseTo(3003 / 24000, 6);
    expect(meta!.samples[1].pts).toBeCloseTo(1001 / 24000, 6);
  });

  it('索引の指す先が ProRes のフレームでなければ null (変換に回す)', async () => {
    const ftyp = box('ftyp', fourccBytes('qt  '));
    const moov = box('moov', trak({
      format: 'apch', timescale: 24, sizes: [64], stsc: [[1, 1]], chunkOffsets: [0], stts: [[1, 1]],
    }));
    const meta = await parseProResMovMetadata(new File([concat(ftyp, moov)], 'broken.mov'));
    expect(meta).toBeNull();
  });
});

describe('ProResRealtimeDecoder クラス', () => {
  it('dispose で待っている呼び出しは null で終わり、以後も null を返す', async () => {
    const meta = {
      fourcc: 'apch',
      width: 1920,
      height: 1080,
      fps: 24,
      duration: 1,
      totalFrames: 1,
      samples: [{ offset: 100, size: 50, pts: 0, duration: 1 / 24 }],
    };
    const decoder = new ProResRealtimeDecoder(new File([new Uint8Array(200)], 'test.mov'), meta);
    // Worker を起こしていないので、頼んだコマは待ち行列に残る
    const pending = decoder.getFrame(0);
    decoder.dispose();
    await expect(pending).resolves.toBeNull();
    await expect(decoder.getFrame(0)).resolves.toBeNull();
  });
});
