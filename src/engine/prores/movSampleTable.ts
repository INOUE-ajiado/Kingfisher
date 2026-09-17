/**
 * QuickTime (.mov) の映像トラックから、各コマのファイル内位置と時刻を組み立てる。
 *
 * ⚠️ 「1 チャンク = 1 コマ」ではない。stsc でチャンクごとのコマ数が決まる
 * (Premiere / Media Encoder の ProRes 書き出しは 1 チャンクに 4 コマ入れることが多い)。
 * ⚠️ fps は stts とトラックの timescale から出す。23.976 (24000/1001) を 24 と丸めない。
 */

export interface MovSample {
  offset: number;
  size: number;
}

export interface MovVideoTrack {
  fourcc: string;
  width: number;
  height: number;
  timescale: number;
  /** 各コマの位置とサイズ (表示順) */
  samples: MovSample[];
  /** 各コマの開始時刻 (timescale 単位) */
  sampleTimes: number[];
  /** トラック全体の長さ (timescale 単位) */
  durationUnits: number;
  fps: number;
}

interface Box {
  type: string;
  start: number;
  end: number;
}

function* boxes(d: DataView, start: number, end: number): Generator<Box> {
  let at = start;
  while (at + 8 <= end) {
    let size = d.getUint32(at);
    const type = String.fromCharCode(d.getUint8(at + 4), d.getUint8(at + 5), d.getUint8(at + 6), d.getUint8(at + 7));
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return;
      size = d.getUint32(at + 8) * 4294967296 + d.getUint32(at + 12);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) return;
    yield { type, start: at + header, end: at + size };
    at += size;
  }
}

function child(d: DataView, parent: Box, type: string): Box | null {
  for (const b of boxes(d, parent.start, parent.end)) if (b.type === type) return b;
  return null;
}

const PRORES = /^ap(ch|cn|cs|co|4h|4x)$/;

/**
 * moov の中身 (ヘッダーを除いた本体) から ProRes の映像トラックを探して索引を作る。
 * 見つからなければ null。
 */
export function parseMovVideoTrack(moov: Uint8Array): MovVideoTrack | null {
  const d = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  for (const trak of boxes(d, 0, moov.length)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(d, trak, 'mdia');
    const minf = mdia && child(d, mdia, 'minf');
    const stbl = minf && child(d, minf, 'stbl');
    const stsd = stbl && child(d, stbl, 'stsd');
    if (!mdia || !stbl || !stsd || stsd.end - stsd.start < 16 + 32) continue;

    // stsd: version/flags(4) entry_count(4) → 1 件目: size(4) format(4) … width は format から +28
    const fmtAt = stsd.start + 12;
    const fourcc = String.fromCharCode(d.getUint8(fmtAt), d.getUint8(fmtAt + 1), d.getUint8(fmtAt + 2), d.getUint8(fmtAt + 3));
    if (!PRORES.test(fourcc)) continue;
    const width = d.getUint16(fmtAt + 28);
    const height = d.getUint16(fmtAt + 30);

    const mdhd = child(d, mdia, 'mdhd');
    if (!mdhd) continue;
    const v1 = d.getUint8(mdhd.start) === 1;
    const timescale = d.getUint32(mdhd.start + (v1 ? 20 : 12)) || 600;

    const stsz = child(d, stbl, 'stsz');
    const stsc = child(d, stbl, 'stsc');
    const stco32 = child(d, stbl, 'stco');
    const stco = stco32 ?? child(d, stbl, 'co64');
    const stts = child(d, stbl, 'stts');
    if (!stsz || !stsc || !stco) continue;

    const sizes: number[] = [];
    const defaultSize = d.getUint32(stsz.start + 4);
    const sampleCount = d.getUint32(stsz.start + 8);
    for (let i = 0; i < sampleCount; i++) {
      if (defaultSize) sizes.push(defaultSize);
      else if (stsz.start + 12 + i * 4 + 4 <= stsz.end) sizes.push(d.getUint32(stsz.start + 12 + i * 4));
      else break;
    }

    const is64 = stco32 === null;
    const chunkCount = d.getUint32(stco.start + 4);
    const chunkOffsets: number[] = [];
    for (let i = 0; i < chunkCount; i++) {
      const at = stco.start + 8 + i * (is64 ? 8 : 4);
      if (at + (is64 ? 8 : 4) > stco.end) break;
      chunkOffsets.push(is64 ? d.getUint32(at) * 4294967296 + d.getUint32(at + 4) : d.getUint32(at));
    }

    // stsc: (first_chunk, samples_per_chunk, desc_id) の並び。次の first_chunk まで同じ数
    const stscCount = d.getUint32(stsc.start + 4);
    const runs: Array<[number, number]> = [];
    for (let i = 0; i < stscCount && stsc.start + 8 + i * 12 + 12 <= stsc.end; i++) {
      runs.push([d.getUint32(stsc.start + 8 + i * 12), d.getUint32(stsc.start + 12 + i * 12)]);
    }

    const samples: MovSample[] = [];
    let s = 0;
    for (let r = 0; r < runs.length && s < sizes.length; r++) {
      const firstChunk = runs[r][0] - 1;
      const lastChunk = r + 1 < runs.length ? runs[r + 1][0] - 1 : chunkOffsets.length;
      const perChunk = runs[r][1];
      for (let c = firstChunk; c < lastChunk && s < sizes.length; c++) {
        let at = chunkOffsets[c];
        for (let k = 0; k < perChunk && s < sizes.length; k++) {
          samples.push({ offset: at, size: sizes[s] });
          at += sizes[s];
          s++;
        }
      }
    }
    if (samples.length === 0) continue;

    const sampleTimes: number[] = [];
    let t = 0;
    if (stts) {
      const n = d.getUint32(stts.start + 4);
      for (let i = 0; i < n && sampleTimes.length < samples.length; i++) {
        const at = stts.start + 8 + i * 8;
        if (at + 8 > stts.end) break;
        const count = d.getUint32(at);
        const delta = d.getUint32(at + 4);
        for (let k = 0; k < count && sampleTimes.length < samples.length; k++) {
          sampleTimes.push(t);
          t += delta;
        }
      }
    }
    // stts が足りなければ最後の間隔 (無ければ 1/24 秒) で埋める
    const lastDelta = sampleTimes.length > 1 ? sampleTimes[sampleTimes.length - 1] - sampleTimes[sampleTimes.length - 2] : Math.round(timescale / 24);
    while (sampleTimes.length < samples.length) {
      sampleTimes.push(t);
      t += lastDelta || 1;
    }

    const durationUnits = t;
    const fps = durationUnits > 0 ? (samples.length * timescale) / durationUnits : 24;

    return { fourcc, width, height, timescale, samples, sampleTimes, durationUnits, fps };
  }
  return null;
}

/** File の先頭から最上位の箱をたどって moov の本体を読む。無ければ null */
export async function readMoov(file: Blob, maxBytes = 128 * 1024 * 1024): Promise<Uint8Array | null> {
  let at = 0;
  while (at + 8 <= file.size) {
    const head = new DataView(await file.slice(at, at + 16).arrayBuffer());
    if (head.byteLength < 8) return null;
    let size = head.getUint32(0);
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
    let header = 8;
    if (size === 1) {
      if (head.byteLength < 16) return null;
      size = head.getUint32(8) * 4294967296 + head.getUint32(12);
      header = 16;
    } else if (size === 0) {
      size = file.size - at;
    }
    if (size < header) return null;
    if (type === 'moov') {
      if (size - header > maxBytes) return null;
      return new Uint8Array(await file.slice(at + header, at + size).arrayBuffer());
    }
    at += size;
  }
  return null;
}
