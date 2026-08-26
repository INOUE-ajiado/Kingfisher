/**
 * 撮影上がりロール (.mov / .mp4) をブラウザで再生するための下ごしらえ。
 *
 * 方針は「デコードを一切自前でやらない」こと。ブラウザのネイティブデコーダに
 * 任せればハードウェア再生になり、バンドルもメモリも増えない。
 * そのために必要なのは次の 2 つだけ:
 *
 *  1. MIME の付け替え … .mov の File は type が 'video/quicktime' になる。
 *     Chrome の <video> はこの MIME を受け付けない (canPlayType が空を返す)。
 *     中身が H.264 なら再生できるので、MIME だけ 'video/mp4' に差し替える。
 *  2. コーデックの判別 … ProRes などは原理的に再生できない。
 *     「再生できません」だけでは打つ手が分からないので、実際のコーデック名を
 *     出して変換を促す。
 */

import { readAllDirectoryEntries } from './fileSystemPath';
import { compareNatural } from './naturalOrder';

/** Kingfisher が再生を試みる動画ファイル */
export const VIDEO_FILE_PATTERN = /\.(mov|mp4|m4v|webm)$/i;

export function isVideoFile(fileName: string): boolean {
  return VIDEO_FILE_PATTERN.test(fileName);
}

/**
 * <video> に渡せる Blob を作る。
 *
 * ⚠️ new Blob([file]) としないこと。ファイル全体をメモリへ読み込んでしまい、
 * 数 GB のロールで破綻する。Blob.slice は範囲とタイプを付け替えた「見え方」を
 * 返すだけで実データはコピーしないので、これを使う。
 */
export function toPlayableBlob(file: Blob): Blob {
  return file.slice(0, file.size, 'video/mp4');
}

/** stsd から取れる映像フォーマットの 4 文字コードと、その扱い */
export interface CodecInfo {
  fourcc: string;
  label: string;
  /** ブラウザで再生できるか。'maybe' は環境 (GPU・OS) に依存する */
  playable: 'yes' | 'no' | 'maybe';
}

const CODECS: Record<string, { label: string; playable: CodecInfo['playable'] }> = {
  avc1: { label: 'H.264', playable: 'yes' },
  avc3: { label: 'H.264', playable: 'yes' },
  vp09: { label: 'VP9', playable: 'yes' },
  av01: { label: 'AV1', playable: 'yes' },
  hvc1: { label: 'HEVC (H.265)', playable: 'maybe' },
  hev1: { label: 'HEVC (H.265)', playable: 'maybe' },
  mp4v: { label: 'MPEG-4 Visual', playable: 'maybe' },
  apco: { label: 'Apple ProRes 422 Proxy', playable: 'no' },
  apcs: { label: 'Apple ProRes 422 LT', playable: 'no' },
  apcn: { label: 'Apple ProRes 422', playable: 'no' },
  apch: { label: 'Apple ProRes 422 HQ', playable: 'no' },
  ap4h: { label: 'Apple ProRes 4444', playable: 'no' },
  ap4x: { label: 'Apple ProRes 4444 XQ', playable: 'no' },
  AVdn: { label: 'Avid DNxHD / DNxHR', playable: 'no' },
  jpeg: { label: 'Motion JPEG', playable: 'no' },
  mjpa: { label: 'Motion JPEG A', playable: 'no' },
  mjpb: { label: 'Motion JPEG B', playable: 'no' },
  rle: { label: 'QuickTime Animation (RLE)', playable: 'no' },
  png: { label: 'PNG (QuickTime)', playable: 'no' },
  '2vuy': { label: '非圧縮 8bit 4:2:2', playable: 'no' },
  v210: { label: '非圧縮 10bit 4:2:2', playable: 'no' },
  cvid: { label: 'Cinepak', playable: 'no' },
};

export function describeCodec(fourcc: string): CodecInfo {
  const known = CODECS[fourcc];
  if (known) return { fourcc, label: known.label, playable: known.playable };
  return { fourcc, label: `不明なコーデック (${fourcc})`, playable: 'no' };
}

const ascii = (bytes: Uint8Array, at: number, len = 4): string =>
  String.fromCharCode(...bytes.subarray(at, at + len)).replace(/\0+$/, '');

/**
 * moov の中から映像トラックの 4 文字コードを取り出す。
 *
 * 箱を再帰的に辿らず、`stsd` を直接走査する。stsd の中身は
 * [size 4][type 'stsd' 4][version+flags 4][entry_count 4][entry_size 4][format 4]
 * なので、'stsd' の先頭から 16 バイト先が求めるフォーマット。
 * 音声やタイムコードの stsd も混ざるため、映像として知っているものを優先する。
 */
export function findVideoFourccInMoov(moov: Uint8Array): string | null {
  const candidates: string[] = [];

  for (let i = 0; i + 20 <= moov.length; i++) {
    if (moov[i] !== 0x73 || moov[i + 1] !== 0x74 || moov[i + 2] !== 0x73 || moov[i + 3] !== 0x64) continue;
    const fourcc = ascii(moov, i + 16);
    if (/^[\x20-\x7e]{2,4}$/.test(fourcc)) candidates.push(fourcc);
  }

  if (candidates.length === 0) return null;
  return candidates.find((c) => c in CODECS) ?? candidates[0];
}

/** ISO-BMFF の箱ヘッダ。size が 0 ならファイル末尾まで、1 なら 64bit 長 */
interface BoxHeader {
  type: string;
  headerSize: number;
  totalSize: number;
}

function readBoxHeader(head: Uint8Array): BoxHeader | null {
  if (head.length < 8) return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const size32 = view.getUint32(0);
  const type = ascii(head, 4);

  if (size32 === 1) {
    if (head.length < 16) return null;
    // 64bit 長。Number で扱える範囲を超えるファイルは想定しない
    const high = view.getUint32(8);
    const low = view.getUint32(12);
    return { type, headerSize: 16, totalSize: high * 4294967296 + low };
  }
  return { type, headerSize: 8, totalSize: size32 };
}

/**
 * 動画ファイルの映像コーデックを調べる。
 *
 * ⚠️ ファイル全体を読まないこと。トップレベルの箱を 16 バイトずつ辿って
 * moov だけを読む。撮影上がりの .mov は moov が末尾にあることが多いので、
 * 先頭だけ見る実装では見つけられない。
 *
 * 判別できない場合は null。呼び出し側は「実際に再生してみる」を優先し、
 * これは失敗したときの説明に使うこと。
 */
export async function probeVideoCodec(file: Blob): Promise<CodecInfo | null> {
  const MAX_MOOV = 64 * 1024 * 1024; // 常識的な上限。これを超える moov は諦める
  let offset = 0;

  while (offset + 8 <= file.size) {
    const head = new Uint8Array(await file.slice(offset, offset + 16).arrayBuffer());
    const box = readBoxHeader(head);
    if (!box) return null;

    if (box.type === 'moov') {
      const end = box.totalSize === 0 ? file.size : offset + box.totalSize;
      if (end - offset > MAX_MOOV) return null;
      const moov = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      const fourcc = findVideoFourccInMoov(moov);
      return fourcc ? describeCodec(fourcc) : null;
    }

    // size 0 は「末尾まで」の意味なので、これ以上進めない
    if (box.totalSize === 0) return null;
    // 壊れた箱で無限ループしないよう、必ず前へ進める
    if (box.totalSize < box.headerSize) return null;

    offset += box.totalSize;
  }

  return null;
}

/**
 * 時刻からコマ番号を求める。
 *
 * 境界のちょうど上に乗ったときに前後どちらへ倒れるかが揺れないよう、
 * わずかに内側へ寄せてから切り捨てる。
 */
export function frameIndexAt(time: number, fps: number): number {
  if (!(fps > 0) || !Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor(time * fps + 1e-6));
}

/**
 * コマ番号の「まん中」の時刻を返す。
 * 端ちょうどを指すとデコーダによって隣のコマが出るため、必ず中央を狙う。
 */
export function timeForFrame(index: number, fps: number, duration = Infinity): number {
  if (!(fps > 0)) return 0;
  const t = (Math.max(0, index) + 0.5) / fps;
  if (!Number.isFinite(duration)) return t;
  return Math.min(Math.max(0, duration - 1e-3), t);
}

/** 現在時刻から delta コマ進めた (戻した) 時刻 */
export function steppedTime(time: number, delta: number, fps: number, duration = Infinity): number {
  return timeForFrame(frameIndexAt(time, fps) + delta, fps, duration);
}

/**
 * requestVideoFrameCallback で集めた mediaTime の列から fps を推定する。
 *
 * 平均ではなく中央値を使う。デコードの詰まりや seek をまたいだ外れ値に
 * 引きずられると、コマ送りの幅がまるごとずれてしまう。
 * 撮影データで使う値へ寄せ、近いものがなければ推定値をそのまま返す。
 */
export const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60];

export function estimateFps(mediaTimes: number[]): number | null {
  const deltas: number[] = [];
  for (let i = 1; i < mediaTimes.length; i++) {
    const d = mediaTimes[i] - mediaTimes[i - 1];
    if (d > 1e-4 && d < 1) deltas.push(d);
  }
  if (deltas.length < 3) return null;

  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  const raw = 1 / median;

  // ⚠️ 「許容範囲に入った最初の値」で決めないこと。23.976 と 24 の差は 0.1% しかなく、
  // 先頭から探すと 24fps の素材まで 23.976 に吸われてコマ送りの幅がずれる。
  // いちばん近いものを選び、そのうえで離れすぎていなければ採用する。
  const nearest = COMMON_FPS.reduce((best, f) =>
    Math.abs(f - raw) < Math.abs(best - raw) ? f : best
  );
  if (Math.abs(nearest - raw) / nearest < 0.02) return nearest;
  return Math.round(raw * 1000) / 1000;
}

/** ドロップされたフォルダを何段まで潜って動画を探すか */
const DROP_SEARCH_DEPTH = 3;

async function firstVideoInDirectoryHandle(dir: any, depth = 0): Promise<File | null> {
  const videos: any[] = [];
  const subdirs: any[] = [];

  for await (const entry of dir.values()) {
    if (entry.kind === 'file') {
      if (isVideoFile(entry.name)) videos.push(entry);
    } else if (entry.kind === 'directory') {
      subdirs.push(entry);
    }
  }

  if (videos.length > 0) {
    videos.sort((a, b) => compareNatural(a.name, b.name));
    return videos[0].getFile();
  }
  if (depth >= DROP_SEARCH_DEPTH) return null;

  subdirs.sort((a, b) => compareNatural(a.name, b.name));
  for (const sub of subdirs) {
    const found = await firstVideoInDirectoryHandle(sub, depth + 1);
    if (found) return found;
  }
  return null;
}

/** FileSystemFileEntry から File を取り出す (取れなければ null) */
function entryToFile(entry: any): Promise<File | null> {
  return new Promise((resolve) => entry.file((f: File) => resolve(f), () => resolve(null)));
}

async function firstVideoInDirectoryEntry(dirEntry: any, depth = 0): Promise<File | null> {
  const entries = await readAllDirectoryEntries(dirEntry.createReader());

  const videos = entries.filter((e: any) => e.isFile && isVideoFile(e.name));
  if (videos.length > 0) {
    videos.sort((a: any, b: any) => compareNatural(a.name, b.name));
    return entryToFile(videos[0]);
  }
  if (depth >= DROP_SEARCH_DEPTH) return null;

  const subdirs = entries.filter((e: any) => e.isDirectory);
  subdirs.sort((a: any, b: any) => compareNatural(a.name, b.name));
  for (const sub of subdirs) {
    const found = await firstVideoInDirectoryEntry(sub, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * ドロップされたものの中から、最初に見つかる動画ファイルを 1 つ返す。
 *
 * ⚠️ dataTransfer.files だけを見ないこと。フォルダを落とした場合、そこには
 * フォルダ自体しか入っておらず、中の .mov / .mp4 は見えない。
 * 「ロールの入ったフォルダを落としたのに開けない」のはこれが原因になる。
 *
 * ⚠️ 呼び出し側は items の読み取りを同期的に済ませてから渡すこと。
 * dataTransfer.items はハンドラを抜けた時点で無効になる。
 *
 * 同じ場所に複数あるときは自然順の先頭を開く。深さは DROP_SEARCH_DEPTH まで。
 */
export async function findDroppedVideoFile(
  plainFiles: File[],
  handles: any[],
  entries: any[]
): Promise<File | null> {
  const direct = plainFiles.filter((f) => isVideoFile(f.name));
  if (direct.length > 0) {
    direct.sort((a, b) => compareNatural(a.name, b.name));
    return direct[0];
  }

  for (const handle of handles) {
    if (handle?.kind === 'file' && isVideoFile(handle.name)) return handle.getFile();
  }
  for (const handle of handles) {
    if (handle?.kind !== 'directory') continue;
    try {
      const found = await firstVideoInDirectoryHandle(handle);
      if (found) return found;
    } catch (e) {
      console.error('Failed to scan dropped folder for video:', e);
    }
  }

  for (const entry of entries) {
    if (entry?.isFile && isVideoFile(entry.name)) {
      const file = await entryToFile(entry);
      if (file) return file;
    }
  }
  for (const entry of entries) {
    if (!entry?.isDirectory) continue;
    try {
      const found = await firstVideoInDirectoryEntry(entry);
      if (found) return found;
    } catch (e) {
      console.error('Failed to scan dropped folder for video:', e);
    }
  }

  return null;
}
