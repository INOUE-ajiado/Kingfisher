import { describe, it, expect, vi } from 'vitest';
import { parseProResMovMetadata, ProResRealtimeDecoder } from './proresRealtimeDecoder';

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

function concat(...parts: Uint8Array[]): Uint8Array {
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

describe('ProRes MOV メタデータの構造化パース', () => {
  it('apch (ProRes 422 HQ) の MOV メタデータを正しくパースできる', async () => {
    const stblPayload = concat(
      stsd('apch', 1920, 1080),
      box('stsz', concat(u32(0, 0, 3), u32(500, 600, 700))), // version, default_size=0, count=3
      box('stco', concat(u32(0, 3), u32(1000, 1500, 2100)))  // version, count=3
    );

    const minfPayload = box('minf', box('stbl', stblPayload));
    const mdiaPayload = box('mdia', minfPayload);
    const trakPayload = box('trak', mdiaPayload);
    const moovPayload = box('moov', trakPayload);

    const fileBits = concat(
      box('ftyp', fourccBytes('qt  ')),
      moovPayload
    );

    const file = new File([fileBits], 'test_prores.mov', { type: 'video/quicktime' });
    const meta = await parseProResMovMetadata(file);

    expect(meta).not.toBeNull();
    if (meta) {
      expect(meta.fourcc).toBe('apch');
      expect(meta.width).toBe(1920);
      expect(meta.height).toBe(1080);
      expect(meta.totalFrames).toBe(3);
      expect(meta.samples.length).toBe(3);
      expect(meta.samples[0].offset).toBe(1000);
      expect(meta.samples[0].size).toBe(500);
      expect(meta.samples[1].offset).toBe(1500);
      expect(meta.samples[1].size).toBe(600);
    }
  });

  it('音声を誤判定せず ProRes ビデオトラックを選択する', async () => {
    const audioStsd = box('stsd', concat(u32(0, 1), u32(16), fourccBytes('mp4a')));
    const audioTrak = box('trak', box('mdia', box('minf', box('stbl', concat(
      audioStsd,
      box('stsz', concat(u32(0, 0, 1), u32(100))),
      box('stco', concat(u32(0, 1), u32(500)))
    )))));

    const videoStsd = stsd('apcn', 3840, 2160);
    const videoTrak = box('trak', box('mdia', box('minf', box('stbl', concat(
      videoStsd,
      box('stsz', concat(u32(0, 0, 2), u32(2000, 2500))),
      box('stco', concat(u32(0, 2), u32(10000, 12500)))
    )))));

    const moovPayload = box('moov', concat(audioTrak, videoTrak));
    const fileBits = concat(box('ftyp', fourccBytes('qt  ')), moovPayload);

    const file = new File([fileBits], 'multi_track.mov', { type: 'video/quicktime' });
    const meta = await parseProResMovMetadata(file);

    expect(meta).not.toBeNull();
    if (meta) {
      expect(meta.fourcc).toBe('apcn');
      expect(meta.width).toBe(3840);
      expect(meta.height).toBe(2160);
      expect(meta.totalFrames).toBe(2);
    }
  });
});

describe('ProResRealtimeDecoder クラス', () => {
  it('dispose メソッドでリソースが解放される', () => {
    const meta = {
      fourcc: 'apch',
      width: 1920,
      height: 1080,
      fps: 24,
      duration: 1,
      totalFrames: 1,
      samples: [{ offset: 100, size: 50, pts: 0, duration: 1 / 24 }],
    };
    const file = new File([new Uint8Array(200)], 'test.mov');
    const decoder = new ProResRealtimeDecoder(file, meta);

    expect(() => decoder.dispose()).not.toThrow();
  });
});
