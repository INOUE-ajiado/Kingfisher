# Kingfisher 詳細設計仕様書（Paintman互換・完全版）

**WEB-BASED ANIMATION PAINTING TOOL**

* **Document Version:** 1.0 (Detailed Design)
* **Target Environment:** Web Browsers (Chrome, Edge, Safari)
* **Tech Stack:** React / TypeScript / Rust (Wasm) / WebGPU
* **Date:** 2026年8月22日

---

## 1. 画面レイアウト・コンポーネント設計 (UI Layer)

Paintman特有の「フローティング／ドッキング可能なマルチウィンドウUI」を再現するため、画面レイアウト管理ライブラリ（例: `GoldenLayout` または `rc-dock`）を採用し、以下のパネル（コンポーネント）を配置する。

### 1.1. パネル構成図と役割
| コンポーネント名 | 状態・機能詳細 | 内部実装のポイント |
| :--- | :--- | :--- |
| **Workspace (メイン)** | `LayoutManager` が全体をラップし、各パネルの配置情報をローカルストレージに永続化（次回起動時に復元）。 | Reactコンポーネントの動的マウント。 |
| **CellWindow (セル窓)** | TGA画像を表示するメインキャンバス。複数ファイルを開いた場合はタブ表示。 | 内部に `<canvas>` を持ち、WebGPUコンテキストを初期化。 |
| **ToolPalette (ツール)** | ペン、バケツ、閉領域フィル、消しゴム、スポイト、投げ縄、ズーム、パン。 | アイコンの選択状態（Active）をZustandで管理。 |
| **ToolOptions (オプション)** | 選択中のツールに応じて変化。バケツ選択時は「隙間閉じ（0〜10px）」「含み塗り（トレス線選択：赤/青/緑/黒）」のチェックボックスを表示。 | 状態変更時、Wasmエンジン側に即座にパラメータを同期。 |
| **ColorChart (カラーチャート)** | パーツ毎の色指定。Paintman同様、「Alt+クリック」でキャンバスから色を拾い登録。パレットの切り替え（ノーマル/影/ハイライト）タブ。 | パレットデータはJSONとしてエクスポート/インポート可能にする。 |
| **FileBrowser (ファイル)** | `File System Access API` で取得したフォルダ内の連番TGA（`0001.tga`, `0002.tga`）をリスト表示。 | 選択時、即座にWorkerへプリフェッチ指示を送信。 |
| **LightTable (ライトテーブル)** | 前後のセルを半透明で重ねる（オニオンスキン）。透過率（0〜100%）と表示枚数（前3枚、後3枚など）を設定。 | WebGPU側でマルチテクスチャとしてブレンド描画する指示を出す。 |

---

## 2. コアエンジン・アルゴリズム設計 (Rust / Wasm Layer)

Paintman最大の強みである「彩色特化のピクセル処理」をRustで実装し、WebAssemblyとして実行する。

### 2.1. 隙間閉じアルゴリズム (Gap Closing Flood Fill)
単なる再帰的なバケツ塗りではなく、指定ピクセル数の「線の途切れ」を検知して液漏れを防ぐ。
* **アプローチ:** モルフォロジー演算（膨張・収縮）の応用。
* **処理フロー:**
    1. 塗りつぶし開始時、Wasm内部で一時的なマスクバッファ（1bit/pixel）を生成。
    2. 線画（黒や色トレス線）に対して、ユーザーが指定した隙間ピクセル数（N）の分だけ「膨張（Dilation）」処理を仮想的に行い、一時的な境界線を生成する。
    3. その仮想境界線の内側でFlood Fill（塗りつぶし）を実行。
    4. 塗りつぶし完了後、膨張した境界線を元に戻す（収縮）。

### 2.2. 含み塗りアルゴリズム (Include Trace-line Fill)
色トレス線（影の境界の青線や、ハイライトの赤線）を「境界として認識しつつ、その線自体も塗りつぶす」機能。
* **パラメータ:** `target_color` (塗る色), `trace_colors` (含み塗りの対象とするトレス色リスト。例: `[Red, Blue]`)。
* **処理フロー:**
    1. Flood Fillでピクセルを探索中、隣接ピクセルが `trace_colors` に一致するか判定。
    2. 一致した場合、そのピクセルを `target_color` に置き換える。
    3. ただし、**トレス線を超えて外側へは探索を広げない**（トレス線ピクセルで探索をストップさせる）。これにより、線を消しながら領域内だけを塗ることが可能になる。

### 2.3. 閉領域フィル (Closed Area Fill)
投げ縄ツールで囲んだ領域に対し、線画で囲まれた「未着色（白）」のピクセルのみを一括で塗りつぶす機能。
* **処理フロー:**
    1. UI側で投げ縄の頂点リスト（Polygon）を取得し、Wasmへ渡す。
    2. Wasm側でポリゴンのバウンディングボックス（矩形）を算出し、ラスタライズ（ポリゴン内にあるピクセルを特定）。
    3. ポリゴン内のピクセル群を走査し、「色トレス線で囲まれた閉空間」かつ「現在が透明（白）」であるピクセル群に対して、一括で指定色を代入する。

---

## 3. レンダリング・パイプライン設計 (WebGPU Layer)

CPU（Wasm）で計算されたピクセルバッファを、画面に超高速で描画し、Paintman特有の「ライトテーブル」などの視覚効果を処理する。

### 3.1. メモリ構造（SharedArrayBuffer）
* `Layer 0: LineArt (線画)`
* `Layer 1: Paint (彩色)`
TGAファイル自体は1レイヤーの画像だが、Wasm内で仮想的に「線画」と「塗った色」を別管理し、GPUへの転送バッファを構築する。

### 3.2. フラグメントシェーダー (WGSL) の実装仕様
GPU内で以下の処理を並列実行し、60fpsを維持する。

1. **純白の透過処理:**
    TGAの `RGB(255, 255, 255)` を検知した場合、Alpha値を `0.0`（完全透明）として扱う。
2. **ライトテーブル（オニオンスキン）合成:**
    現在編集中のセルの下（または上）に、前後のセル画像を複数枚（テクスチャバッファとして）バインドする。
    ```wgsl
    // WGSL擬似コード: 現在のセルと前のセル（半透明）の合成
    let current_pixel = textureSample(currentTexture, texSampler, uv);
    let prev_pixel = textureSample(prevTexture, texSampler, uv);
    
    // 前のセルを透過率30%で下に敷く
    let blended = mix(prev_pixel * 0.3, current_pixel, current_pixel.a);
    ```

---

## 4. グローバル状態管理設計 (Zustand Store)

アプリケーション全体で共有する状態を定義する。

```typescript
// store/usePaintStore.ts
interface PaintStore {
  // --- ツール関連 ---
  activeTool: 'pointer' | 'brush' | 'fill' | 'closedFill' | 'eraser' | 'lasso' | 'eyedropper' | 'pan';
  toolOptions: {
    gapCloseLevel: number;        // 0(OFF) 〜 10ピクセル
    enableIncludeTrace: boolean;  // 含み塗りの有効化
    targetTraceColors: RGBA[];    // 含み塗り対象の色リスト（赤、青など）
    tolerance: number;            // 許容誤差（アンチエイリアス対応用）
  };

  // --- カラー・パレット関連 ---
  currentColor: RGBA;
  colorPalettes: Record<string, PaletteItem[]>; // "Aセル", "Bセル" などタブごとのパレット
  activePaletteId: string;

  // --- ファイル・ライトテーブル関連 ---
  fileList: string[];             // フォルダ内のTGAファイル一覧
  currentFileIndex: number;       // 現在アクティブなファイル
  lightTable: {
    enabled: boolean;
    prevFrames: number;           // 何枚前まで表示するか
    nextFrames: number;           // 何枚後まで表示するか
    opacity: number;              // 透過率
  };
}
```

---

## 5. ショートカット・ワークフロー設計 (Event Handling)

アニメの彩色工程はスピードが命であるため、マウスをキャンバスから動かさずにキーボードで全操作が完結するよう設計する。Reactの合成イベントではなく、DOM直の `keydown` リスナーで最優先処理を行う。

| キー | 割り当てアクション | 処理内容 |
| :--- | :--- | :--- |
| **↓ / PageDown** | 次のセルへ | 保存（オンメモリ）後、Workerからプリフェッチ済みの次セルバッファを瞬時にSwap。 |
| **↑ / PageUp** | 前のセルへ | 前のセルへ戻る（ライトテーブルの参照画像も即座にシフト）。 |
| **Alt + クリック** | スポイト | キャンバス上の色を取得し、`currentColor` を更新。 |
| **[ / ]** | 隙間閉じ増減 | `gapCloseLevel` の値を1段階増減させる。 |
| **Ctrl + S** | TGA上書き保存 | Wasmバッファからバイナリを生成し、`File System Access API` でOS上の元ファイルを**ダイアログ無しで**直接上書き。 |
| **T** | 含み塗りON/OFF | 含み塗りモードのトグル切り替え。 |
