import { describe, it, expect } from 'vitest';
import {
  buildRushInviteUrl,
  computeRoomAccessKey,
  guessVideoContentType,
  hasOperatorPrivilege,
  normalizeRoomId,
  readRoomIdFromSearch,
} from './rushAccess';

describe('computeRoomAccessKey', () => {
  it('同じルーム ID と合言葉からは同じ鍵ができる (大文字小文字・前後の空白は ID 側で吸収)', async () => {
    const a = await computeRoomAccessKey('RUSH-ABC123', 'secret');
    const b = await computeRoomAccessKey('  rush-abc123 ', 'secret');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('合言葉が違えば鍵も違う (照合が効く)', async () => {
    const right = await computeRoomAccessKey('RUSH-ABC123', 'secret');
    const wrong = await computeRoomAccessKey('RUSH-ABC123', 'Secret');
    expect(wrong).not.toBe(right);
  });

  it('同じ合言葉でもルームが違えば鍵は違う (別ルームの鍵を流用できない)', async () => {
    const a = await computeRoomAccessKey('RUSH-AAAAAA', 'secret');
    const b = await computeRoomAccessKey('RUSH-BBBBBB', 'secret');
    expect(a).not.toBe(b);
  });

  it('鍵に合言葉がそのまま現れない', async () => {
    const key = await computeRoomAccessKey('RUSH-ABC123', 'secret');
    expect(key).not.toContain('secret');
  });
});

describe('hasOperatorPrivilege', () => {
  const room = { hostEmail: 'Host@ajiado.co.jp', operatorEmails: ['op@ajiado.co.jp'] };

  it('作成者とオペレーターは大文字小文字を問わず権限あり', () => {
    expect(hasOperatorPrivilege(room, 'host@ajiado.co.jp')).toBe(true);
    expect(hasOperatorPrivilege(room, ' OP@ajiado.co.jp ')).toBe(true);
  });

  it('それ以外・未ログイン・ルーム無しは権限なし', () => {
    expect(hasOperatorPrivilege(room, 'viewer@ajiado.co.jp')).toBe(false);
    expect(hasOperatorPrivilege(room, null)).toBe(false);
    expect(hasOperatorPrivilege(null, 'host@ajiado.co.jp')).toBe(false);
    expect(hasOperatorPrivilege({ hostEmail: '', operatorEmails: [] }, '')).toBe(false);
  });
});

describe('guessVideoContentType', () => {
  it('ブラウザが型を返したらそれを使う', () => {
    expect(guessVideoContentType('a.mp4', 'video/mp4')).toBe('video/mp4');
  });

  it('型が空の .mov (Windows の Chrome) は拡張子から補う', () => {
    expect(guessVideoContentType('STOP_009.MOV', '')).toBe('video/quicktime');
    expect(guessVideoContentType('a.webm', '')).toBe('video/webm');
    expect(guessVideoContentType('a.mp4', 'application/octet-stream')).toBe('video/mp4');
  });
});

describe('招待リンク', () => {
  it('作ったリンクから同じルーム ID を読み戻せる', () => {
    const url = new URL(buildRushInviteUrl('https://kingfisher-paint-2026.web.app', 'rush-abc123'));
    expect(url.pathname).toBe('/');
    expect(readRoomIdFromSearch(url.search)).toBe('RUSH-ABC123');
  });

  it('?room が無い・空なら null', () => {
    expect(readRoomIdFromSearch('')).toBeNull();
    expect(readRoomIdFromSearch('?room=')).toBeNull();
    expect(readRoomIdFromSearch('?foo=1')).toBeNull();
  });

  it('リンクに合言葉は含めない', () => {
    expect(buildRushInviteUrl('https://example.com', 'RUSH-1')).not.toMatch(/pass/i);
  });

  it('normalizeRoomId は前後の空白を落として大文字にする', () => {
    expect(normalizeRoomId('  rush-x1 ')).toBe('RUSH-X1');
  });
});

describe('外部共有', () => {
  it('共有 ID は 22 文字の URL に使える文字で、毎回違う', async () => {
    const { generateShareId } = await import('./rushAccess');
    const ids = new Set(Array.from({ length: 200 }, () => generateShareId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('共有 URL から ID を読み戻せる。形の違うパスは受け付けない', async () => {
    const { buildShareUrl, generateShareId, parseShareIdFromPath } = await import('./rushAccess');
    const id = generateShareId();
    expect(parseShareIdFromPath(new URL(buildShareUrl('https://example.com', id)).pathname)).toBe(id);
    expect(parseShareIdFromPath(`/watch/${id}/`)).toBe(id);
    expect(parseShareIdFromPath('/watch/short')).toBeNull();
    expect(parseShareIdFromPath('/')).toBeNull();
    expect(parseShareIdFromPath(`/watch/${id}/extra`)).toBeNull();
    expect(parseShareIdFromPath('/watch/../../etc')).toBeNull();
  });

  it('外部用の鍵はルームの鍵と混ざらない (同じ文字列・同じ合言葉でも別の鍵)', async () => {
    const { computeShareAccessKey } = await import('./rushAccess');
    const share = await computeShareAccessKey('RUSH-ABC123', 'secret');
    const room = await computeRoomAccessKey('RUSH-ABC123', 'secret');
    expect(share).toMatch(/^[0-9a-f]{64}$/);
    expect(share).not.toBe(room);
    expect(await computeShareAccessKey('RUSH-ABC123', 'secreT')).not.toBe(share);
  });

  it('停止が期限より優先し、期限ちょうどで切れる', async () => {
    const { shareStatus } = await import('./rushAccess');
    expect(shareStatus({ revoked: false, expiresAt: 1000 }, 999)).toBe('open');
    expect(shareStatus({ revoked: false, expiresAt: 1000 }, 1000)).toBe('expired');
    expect(shareStatus({ revoked: true, expiresAt: 1000 }, 0)).toBe('revoked');
  });

  it('視聴者名は空白を詰め、空や長すぎる名前は受け付けない', async () => {
    const { normalizeViewerName, MAX_VIEWER_NAME_LENGTH } = await import('./rushAccess');
    expect(normalizeViewerName('  山田　 太郎 ')).toBe('山田 太郎');
    expect(normalizeViewerName('   ')).toBeNull();
    expect(normalizeViewerName('あ'.repeat(MAX_VIEWER_NAME_LENGTH))).not.toBeNull();
    expect(normalizeViewerName('あ'.repeat(MAX_VIEWER_NAME_LENGTH + 1))).toBeNull();
  });

  it('最後の合図から 75 秒で視聴中から外れる', async () => {
    const { isViewerOnline } = await import('./rushAccess');
    expect(isViewerOnline(0, 74_999)).toBe(true);
    expect(isViewerOnline(0, 75_000)).toBe(false);
  });
});

describe('外部共有の安全側の既定', () => {
  it('短いパスワードは受け付けない (URL を持つ人は何度でも試せるため)', async () => {
    const { isValidSharePassword, MIN_SHARE_PASSWORD_LENGTH } = await import('./rushAccess');
    expect(MIN_SHARE_PASSWORD_LENGTH).toBeGreaterThanOrEqual(8);
    expect(isValidSharePassword('abc')).toBe(false);
    expect(isValidSharePassword('abcdefg')).toBe(false);
    expect(isValidSharePassword('  abcdefg  ')).toBe(false);
    expect(isValidSharePassword('abcdefgh')).toBe(true);
  });

  it('共有の文書が消えていたら「終了」として扱う', async () => {
    const { shareStatusFromDoc } = await import('./rushAccess');
    const future = Date.now() + 60_000;
    expect(shareStatusFromDoc(null, future, Date.now())).toBe('revoked');
    expect(shareStatusFromDoc(undefined, future, Date.now())).toBe('open');
    expect(shareStatusFromDoc(undefined, Date.now() - 1, Date.now())).toBe('expired');
    expect(shareStatusFromDoc({ revoked: true, expiresAt: future }, future, Date.now())).toBe('revoked');
    expect(shareStatusFromDoc({ revoked: false, expiresAt: future }, 0, Date.now())).toBe('open');
  });
});

describe('視聴ページの振り分け', () => {
  it('/watch/… は ID が読めない形でも視聴ページ扱いにする (ログイン画面へ落とさない)', async () => {
    const { isWatchPath } = await import('./rushAccess');
    expect(isWatchPath('/watch/oPFWQ7h1HjP_aYuZitcvTw')).toBe(true);
    expect(isWatchPath('/watch/short')).toBe(true); // 途中で切れた URL
    expect(isWatchPath('/watch/')).toBe(true);
    expect(isWatchPath('/watch')).toBe(true);
    expect(isWatchPath('/')).toBe(false);
    expect(isWatchPath('/?room=RUSH-AAAAAA')).toBe(false); // 社内向けの招待はアプリ側
    expect(isWatchPath('/watchdog')).toBe(false);
  });
});

describe('参加者の一覧に残す範囲', () => {
  it('合図が新しければ在席、しばらく無ければ離席、さらに古ければ一覧から外す', async () => {
    const { isViewerOnline, isPresenceVisible } = await import('./rushAccess');
    const now = 10 * 60 * 1000;
    const 分 = 60 * 1000;
    // 30 秒前 = 在席
    expect(isViewerOnline(now - 30_000, now)).toBe(true);
    expect(isPresenceVisible(now - 30_000, now)).toBe(true);
    // 2 分前 = 離席だが一覧には残る
    expect(isViewerOnline(now - 2 * 分, now)).toBe(false);
    expect(isPresenceVisible(now - 2 * 分, now)).toBe(true);
    // 6 分前 = 一覧から外す
    expect(isPresenceVisible(now - 6 * 分, now)).toBe(false);
  });

  it('同じ札を使い回す (開き直しても別人にならない)', async () => {
    const { stablePresenceId } = await import('./rushAccess');
    const store: Record<string, string> = {};
    // sessionStorage を差し替えて確かめる
    const original = globalThis.sessionStorage;
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
      },
      configurable: true,
    });

    const first = stablePresenceId('room-A');
    expect(stablePresenceId('room-A')).toBe(first);
    expect(stablePresenceId('room-B')).not.toBe(first);

    Object.defineProperty(globalThis, 'sessionStorage', { value: original, configurable: true });
  });

  it('保存できない環境でも札は作れる', async () => {
    const { stablePresenceId } = await import('./rushAccess');
    const original = globalThis.sessionStorage;
    Object.defineProperty(globalThis, 'sessionStorage', {
      get() {
        throw new Error('使えません');
      },
      configurable: true,
    });
    expect(stablePresenceId('room-C')).toMatch(/^[a-z0-9]+$/);
    Object.defineProperty(globalThis, 'sessionStorage', { value: original, configurable: true });
  });
});
