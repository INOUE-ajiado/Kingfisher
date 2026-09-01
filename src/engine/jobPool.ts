/**
 * 決まった本数で並行に流す、小さな仕事の割り振り。
 *
 * 回転のように「1 枚ずつ読んで・変換して・書き戻す」処理は、
 * 順番に回すと 1 枚あたりの待ち時間がそのまま積み上がる。
 * 空いた手から次を取らせれば、遅い 1 枚が全体を止めない。
 */

export interface JobOutcome<T> {
  /** 入力の並び順。結果は必ずこの順に戻す */
  index: number;
  value?: T;
  error?: string;
}

/**
 * items を lanes 本の手で並行に処理する。
 *
 * ⚠️ 1 件の失敗で全体を止めないこと。理由を持たせて先へ進み、
 * 呼び出し側が「何件できて、何件見送ったか」を伝えられるようにする。
 * ⚠️ 結果は入力の並び順に戻すこと。終わった順に返すと、ログとファイルの
 * 並びが食い違って追えなくなる。
 * ⚠️ lanes は 1 以上に丸めること。0 だと 1 件も進まないまま返る。
 */
export async function runInLanes<I, T>(
  items: I[],
  lanes: number,
  run: (item: I, index: number, lane: number) => Promise<T>
): Promise<JobOutcome<T>[]> {
  const results: JobOutcome<T>[] = items.map((_, index) => ({ index }));
  const width = Math.max(1, Math.min(Math.floor(lanes) || 1, items.length));

  let next = 0;
  const takeNext = (): number => {
    const i = next;
    next += 1;
    return i;
  };

  const worker = async (lane: number): Promise<void> => {
    for (let i = takeNext(); i < items.length; i = takeNext()) {
      try {
        results[i].value = await run(items[i], i, lane);
      } catch (err: any) {
        results[i].error = String(err?.message || err);
      }
    }
  };

  await Promise.all(Array.from({ length: width }, (_, lane) => worker(lane)));
  return results;
}

/**
 * 何本で流すか。
 *
 * ⚠️ 枚数より多く立てないこと。使わない手を作るだけ無駄になる。
 * ⚠️ 上限を設けること。スキャン 1 枚は数十 MB になり、
 * 同時に開きすぎるとメモリで詰まる。
 */
export function laneCount(itemCount: number, hardwareConcurrency?: number, max = 8): number {
  const cores = hardwareConcurrency && hardwareConcurrency > 0 ? hardwareConcurrency : 4;
  return Math.max(1, Math.min(itemCount, cores, max));
}
