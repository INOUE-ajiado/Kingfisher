import { describeFunctionError } from './rushFunctions';

/**
 * ラッシュの通信の失敗を、画面に出せる言葉へ直す。
 *
 * ⚠️ 画面ごとに書き分けないこと。同じ失敗に別の文言が出ると、
 * 問い合わせを受けたときに、どこで何が起きたのか分からなくなる。
 */
export function describeRushError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code || '';
  if (code.startsWith('functions/')) return describeFunctionError(err);
  if (code.includes('permission-denied') || code.includes('unauthorized')) {
    return '権限がありません (@ajiado.co.jp でログインしているか、このルームのオペレーターかを確認してください)';
  }
  if (code.includes('unavailable') || code.includes('retry-limit-exceeded')) {
    return 'クラウドに接続できません。ネットワークを確認してください';
  }
  if (code.includes('not-found') || code.includes('failed-precondition')) {
    return 'クラウド側 (Firestore / Storage) が準備されていません。管理者に連絡してください';
  }
  const message = (err as { message?: string } | null)?.message;
  return message || '通信に失敗しました。時間をおいてお試しください。';
}

/**
 * 共有そのものが終わっているか (終了・期限切れ・見つからない)。
 *
 * ⚠️ 文言や code だけで判断しないこと。パスワード違いも同じ code (permission-denied) で返るため、
 * 入れ直せるはずの場面で画面ごと閉じてしまう。関数が添える reason を見る。
 */
export function isRushShareClosed(err: unknown): boolean {
  const reason = (err as { details?: { reason?: string } } | null)?.details?.reason;
  return reason === 'revoked' || reason === 'expired' || reason === 'not-found';
}
