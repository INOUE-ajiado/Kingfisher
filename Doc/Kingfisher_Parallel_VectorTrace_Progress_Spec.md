# Kingfisher 並列ベクター変換・進捗トラッキング仕様書

**Document Version:** 1.3 (Progress Tracking & Parallel Wasm Spec)
**Target Feature:** Web WorkerとWasm Threadsを用いたSVGトレースの非同期処理と、リアルタイム進捗表示機能

---

## 1. Web Worker × Wasm Threads 通信設計

UIスレッドをブロックせずに処理の経過をフロントエンドに伝えるため、双方向の非同期メッセージングを構築する。

*   **処理の委譲**: React側は画像データ（`SharedArrayBuffer`）と設定値をWorkerに送信する。
*   **Rustからのコールバック**: Rust（Wasm）内に進捗を通知するコールバック関数を渡し、処理のチャンクが終わるたびにRustからJavaScript（Worker）へ現在の状況を報告させる。
*   **イベントディスパッチ**: Workerは受け取った情報を `{ type: 'PROGRESS', percent: 45, message: 'エッジ抽出中...' }` という形式で、定期的にメインスレッドへ `postMessage` する。

## 2. 進捗（プログレス）算出アルゴリズム

全体の処理を100%とし、各工程の計算負荷に応じたウェイト（比重）を割り当てる。これにより、シークバーが途中で止まったように見える現象を防ぐ。

*   **フェーズ1: カラークラスタリング (0% 〜 20%)**
    画像を色ごとに分割する工程。ピクセル数に比例して進捗を更新。
*   **フェーズ2: 輪郭抽出 / Marching Squares (20% 〜 60%)**
    抽出された色領域の数ごとに進捗を分割。並列処理（Threads）の各スレッドから上がってくる完了数をマージして計算。
*   **フェーズ3: ベジェ変換 / Potrace (60% 〜 95%)**
    頂点の間引きと曲線フィッティング。最も重い処理であるため、ポリゴン単位で細かく進捗を通知する。
*   **フェーズ4: SVG構築 (95% 〜 100%)**
    最終的な文字列（DOMパス）の構築とメモリ解放。

## 3. UIコンポーネント要件（シークバー＆ログ）

ベクター出力モーダル内に、処理状態を可視化するUIを追加する。

*   **プログレスバー**: 0%〜100%で伸びるシークバー。Reactの `transition` を用いて、数値が飛んでも滑らかにバーが伸びるようにする。
*   **ターミナル型ログビューア**: モーダル下部に黒背景のテキストエリアを配置。
    *   `[DEBUG] 12:40:29: Wasm Threads (4 workers) initialized.`
    *   `[DEBUG] 12:40:30: Processing color cluster 3/15...`
    *   常に最新のログが見えるよう、追加時に最下部へ自動スクロール（Auto-scroll）させる。

## 4. 状態管理 (Zustand Store) 拡張

進捗トラッキング用の専用ステートを定義する。

```typescript
interface VectorTraceStore {
  isProcessing: boolean;
  progressPercent: number; // 0.0 to 100.0
  debugLogs: string[];     // ログ文字列の配列

  // アクション
  setProgress: (percent: number) => void;
  addLog: (message: string) => void;
  resetProgress: () => void;
}
```
