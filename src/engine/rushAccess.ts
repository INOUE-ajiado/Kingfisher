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

// ─── 外部共有 (社外の人がログインなしで視聴する URL) ───────────────────────────

/**
 * 外部共有の ID。推測されないよう 128 bit の乱数を base64url にした 22 文字。
 * URL (/watch/{ID}) を知っていることが入口の条件になる。
 */
export function generateShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 再生状態の文書 ID。外部の視聴者も読むので、これも推測できない乱数にする */
export function generatePlaybackId(): string {
  return `pb_${generateShareId()}`;
}

/**
 * 外部共有の合言葉から access 文書の鍵を作る。
 * ルームの鍵 (computeRoomAccessKey) とは接頭辞を変え、同じ合言葉でも別の鍵になるようにする。
 */
export async function computeShareAccessKey(shareId: string, password: string): Promise<string> {
  const data = new TextEncoder().encode(`kingfisher-rush-share:${shareId.trim()}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function buildShareUrl(origin: string, shareId: string): string {
  return `${origin}/watch/${shareId}`;
}

/** /watch/{ID} から ID を取り出す。当てはまらなければ null */
export function parseShareIdFromPath(pathname: string): string | null {
  const m = /^\/watch\/([A-Za-z0-9_-]{16,64})\/?$/.exec(pathname);
  return m ? m[1] : null;
}

/**
 * 視聴ページとして扱うパスか。
 *
 * ⚠️ ID が読めない形でも true を返すこと。ここで false にすると、URL がメールで折り返されて
 * 途中で切れていた場合に、社外の人へペイント画面 (ログイン必須) が出てしまう。
 * ID が変なら、視聴ページ側で「URL が途中で切れていませんか」と案内する。
 */
export function isWatchPath(pathname: string): boolean {
  return /^\/watch(\/|$)/.test(pathname);
}

export const SHARE_EXPIRY_OPTIONS: { label: string; ms: number }[] = [
  { label: '1 時間', ms: 60 * 60 * 1000 },
  { label: '24 時間', ms: 24 * 60 * 60 * 1000 },
  { label: '3 日', ms: 3 * 24 * 60 * 60 * 1000 },
  { label: '7 日', ms: 7 * 24 * 60 * 60 * 1000 },
];
export const DEFAULT_SHARE_EXPIRY_MS = SHARE_EXPIRY_OPTIONS[1].ms;
/** 規則でも同じ上限を課している (firestore.rules) */
export const MAX_SHARE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

export type ShareStatus = 'open' | 'revoked' | 'expired';

export function shareStatus(share: { revoked?: boolean; expiresAt: number }, now: number): ShareStatus {
  if (share.revoked) return 'revoked';
  if (!(now < share.expiresAt)) return 'expired';
  return 'open';
}

export const MAX_VIEWER_NAME_LENGTH = 40;

/** 視聴者名を整える。空・長すぎるときは null */
export function normalizeViewerName(name: string): string | null {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (!trimmed || trimmed.length > MAX_VIEWER_NAME_LENGTH) return null;
  return trimmed;
}

/** 最後の合図からこれ以上経った視聴者は「離席」とみなす (合図は 30 秒おき) */
export const VIEWER_ONLINE_WINDOW_MS = 75 * 1000;

export function isViewerOnline(lastSeenAt: number, now: number): boolean {
  return now - lastSeenAt < VIEWER_ONLINE_WINDOW_MS;
}

/**
 * 外部共有のパスワードの最小の長さ。
 *
 * ⚠️ 短くしないこと。共有の URL を持っている人は、合言葉を何度でも試せる (回数制限は無い)。
 * 8 文字あれば、自動生成の文字種 (31 種) でも総当たりは現実的でなくなる。
 */
export const MIN_SHARE_PASSWORD_LENGTH = 8;

export function isValidSharePassword(password: string): boolean {
  return password.trim().length >= MIN_SHARE_PASSWORD_LENGTH;
}

/**
 * 一覧に出す共有の状態。
 * doc が null (文書ごと消えている) なら、開いていないものとして扱う。
 * undefined はまだ読めていない状態なので、期限だけで判断する。
 */
export function shareStatusFromDoc(
  doc: { revoked?: boolean; expiresAt: number } | null | undefined,
  fallbackExpiresAt: number,
  now: number
): ShareStatus {
  if (doc === null) return 'revoked';
  return shareStatus({ revoked: doc?.revoked ?? false, expiresAt: doc?.expiresAt ?? fallbackExpiresAt }, now);
}
