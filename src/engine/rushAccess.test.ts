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
