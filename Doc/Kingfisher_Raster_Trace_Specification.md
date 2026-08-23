# Kingfisher 画像トレース（背景透過エクスポート）実装仕様書

**Document Version:** 1.0 (Raster Background Removal Spec)
**Target Feature:** TGA画像から背景色を高度なアルゴリズムで除去し、透過PNG/TGAとしてエクスポートする機能

---

## 1. 概要と目的

スキャンされた線画や、背景がベタ塗りされているセル画像に対し、指定した背景色（主に純白やクロマキー用の緑・青）を透過処理して出力する。
Photoshopの「背景の削除」や「色域指定」に相当する機能であり、前項の「ベクター出力」とは異なり**ラスター形式（ピクセルデータ）のまま透明度（アルファチャンネル）を付与**する。

前回の「線画透過・アルファチャンネル化 高度技術仕様書」で定義した Unmultiply（白マット除去）技術を応用し、フリンジ（エッジの白残り）のない完璧な透過画像を手軽に出力できる専用モーダルを提供する。

---

## 2. UI/UX 設計（モーダルレイアウト）

「ベクター出力」と統一感を持たせたワイド画面のモーダル（`ExportTraceModal.tsx`）を構築する。

### 2.1. プレビュー領域（右側）
*   **市松模様背景**: 透過された部分が視覚的にわかるよう、プレビューの背景にはPhotoshopライクなグレーと白の市松模様（Checkerboard）を敷く。
*   **リアルタイム更新**: 左側のパラメータを動かすと、数十ミリ秒以内に透過結果がプレビューに反映される。

### 2.2. パラメータ設定領域（左側）
以下の3つの主要コントロールを配置する。

1.  **抽出モード (Extraction Mode)**
    *   `[ 線画抽出 (Unmultiply) ]`: 白背景の線画用。アンチエイリアスのグレーを半透明の黒として完璧に復元するモード。
    *   `[ カラーキートレース (Color Key) ]`: アニメの彩色セルなど、特定の色を抜くモード。
2.  **対象カラー (Key Color)**
    *   デフォルトは純白 (`#FFFFFF`)。カラースポイトアイコンを配置し、プレビュー画面をクリックして「抜きたい背景色」を自由に指定可能にする。
3.  **許容値 (Tolerance) / 0 〜 100**
    *   指定した対象カラーから「どれくらい近い色までを透明とみなすか」の閾値。

---

## 3. 画像処理アルゴリズム (Rust / Wasm)

Web Worker内でRustを実行し、メインスレッドをブロックせずに巨大な画像配列のアルファ値（Aチャンネル）を一括変換する。

### 3.1. 線画抽出モード (Unmultiply) の処理
背景が白 ($W = 1.0$) である前提で、ピクセルのRGB値から本来の不透明度 $lpha$ を数学的に逆算する。

$$ lpha = 1.0 - \max(R, G, B) $$

※もし色が黒以外の色トレス線を含む場合は、以前定義した最小チャンネル法 $lpha = 1.0 - \min(R, G, B)$ を使用する。

### 3.2. カラーキーモード (Color Key) の処理
指定色 $C_{key}$ と対象ピクセル色 $C_{pix}$ のユークリッド距離 $D$ を計算し、許容値 $T$ （Tolerance）と比較する。

$$ D = \sqrt{(C_{key}.R - C_{pix}.R)^2 + (C_{key}.G - C_{pix}.G)^2 + (C_{key}.B - C_{pix}.B)^2} $$

*   $D < T$ の場合、対象ピクセルのアルファ値 $lpha$ を $0$ （完全透明）にする。
*   $T$ 付近の境界ピクセルには、Smoothstep関数を用いて $lpha$ を $0.0 \sim 1.0$ の間で滑らかに補間し、ジャギー（エッジのギザギザ）を防ぐ。

---

## 4. エクスポート処理とフォーマット

透過処理が完了したピクセルバッファ（RGBA配列）を、ユーザーの用途に合わせて最適なフォーマットでダウンロードさせる。

*   **出力フォーマットの選択**:
    *   `[ PNG出力 (.png) ]`: 汎用性が高く、Webや他の画像ソフトで即座に使える形式。Canvas APIの `toBlob('image/png')` を利用して高速にエンコードする。
    *   `[ 32bit TGA出力 (.tga) ]`: アニメ業界の標準である、アルファチャンネルを持った無圧縮TGA形式。Rust側でTGAヘッダを構築してバイナリ出力する。

### 4.1. ダウンロードのフック実装例
```typescript
const handleDownloadTransparent = async (format: 'png' | 'tga') => {
    setIsProcessing(true);
    // Wasm Workerに透過処理をリクエスト
    const processedBuffer = await worker.processTransparency(currentImage, options);
    
    // Blob化してダウンロード
    const mimeType = format === 'png' ? 'image/png' : 'application/x-tga';
    const blob = new Blob([processedBuffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    // ダウンロードトリガー
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}_traced.${format}`;
    a.click();
    
    URL.revokeObjectURL(url);
    setIsProcessing(false);
};
```
