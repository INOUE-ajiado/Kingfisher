/**
 * 片づけの判断だけを切り出したもの (Firebase に触れない)。
 * ここだけを単体で走らせて、消してよいかの線引きを確かめられるようにしている。
 */

export type SweepDecision = 'keep-referenced' | 'keep-young' | 'delete';

/**
 * この動画をどうするか。
 *
 * ⚠️ 参照されているものは、いくら古くても消さない。
 * ⚠️ 参照が無くても、上げたばかりのものは消さない (ルームを作っている最中かもしれない)。
 */
export function decideSweep(params: {
  name: string;
  referenced: Iterable<string>;
  timeCreated?: string;
  now: number;
  minAgeMs: number;
}): SweepDecision {
  for (const ref of params.referenced) {
    if (ref === params.name) return 'keep-referenced';
  }
  const createdAt = Date.parse(String(params.timeCreated ?? ''));
  if (Number.isFinite(createdAt) && params.now - createdAt < params.minAgeMs) return 'keep-young';
  return 'delete';
}
