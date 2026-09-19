/**
 * ラッシュルームの合言葉と権限の判定。
 *
 * Firebase に触れない純粋な関数だけを置く (テストから直接呼べるように)。
 *
 * ⚠️ 合言葉そのものや、そのハッシュをルームの文書へ書かないこと。
 * ルームの文書は社内の誰でも一覧で読めるので、置いた時点で誰でも照合を
 * すり抜けられる。代わりに「ルーム ID と合言葉から作った鍵」を
 * 文書 ID にした下位文書 (access/{鍵}) に動画の在りかを置き、
 * 鍵を知っている人だけが辿り着けるようにしている (一覧は規則で禁止)。
 */

/** ルーム ID と合言葉から、access 文書の ID になる鍵 (SHA-256 の 16 進) を作る */
export async function computeRoomAccessKey(roomId: string, password: string): Promise<string> {
  const normalizedId = normalizeRoomId(roomId);
  const data = new TextEncoder().encode(`kingfisher-rush:${normalizedId}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 入力されたルーム ID を保存時の表記 (前後の空白なし・大文字) に揃える */
export function normalizeRoomId(roomId: string): string {
  return roomId.trim().toUpperCase();
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
}

/** 作成者か、オペレーターとして登録された人なら true */
export function hasOperatorPrivilege(
  room: { hostEmail?: string | null; operatorEmails?: string[] | null } | null | undefined,
  email: string | null | undefined
): boolean {
  const me = normalizeEmail(email);
  if (!me || !room) return false;
  if (normalizeEmail(room.hostEmail) === me) return true;
  return (room.operatorEmails || []).some((e) => normalizeEmail(e) === me);
}

/**
 * アップロードする動画の Content-Type。
 *
 * Windows の Chrome は .mov の File.type を空で返すことがある。
 * 空のまま送ると Storage の規則 (video/* のみ許可) で弾かれるので、拡張子から補う。
 */
export function guessVideoContentType(fileName: string, fileType: string): string {
  if (fileType.startsWith('video/')) return fileType;
  const ext = fileName.toLowerCase().split('.').pop() || '';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'm4v') return 'video/x-m4v';
  return 'video/mp4';
}

/** 招待リンク。開くとログイン後に参加画面が ID 入りで開く (合言葉は含めない) */
export function buildRushInviteUrl(origin: string, roomId: string): string {
  return `${origin}/?room=${encodeURIComponent(normalizeRoomId(roomId))}`;
}

/** URL の ?room= を読む。無ければ null */
export function readRoomIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('room');
  return value && value.trim() ? normalizeRoomId(value) : null;
}
