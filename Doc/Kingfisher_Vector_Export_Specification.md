# Kingfisher ベクター出力（SVGトレース）機能 実装仕様書

**Document Version:** 1.0 (Vectorization Pipeline Spec)
**Target Feature:** TGAセルデータからスケーラブルなSVGベクターデータへの自動変換・出力機能

---

## 1. 概要と技術選定の背景

アニメーションの彩色済みセル画像（ラスターデータ）を、解像度非依存のベクターデータとして出力する機能を実装する。
実装にあたり、以下の技術的アプローチを比較検討し、「1. ベクターデータ化 (SVG)」を本システムの標準出力手法として採用する。

### 1.1. 出力手法の比較と評価
1.  **ベクターデータ化 (HTML / SVG) 【採用】**
    *   **仕組み**: 画像のエッジを解析し、ベジェ曲線の座標データ（`<path d="M... C... Z">`）に変換する。
    *   **評価**: 拡大縮小で劣化せず、ファイルサイズが最適化される。アニメのベタ塗りセルとの親和性が極めて高く、CSS/JSによる後処理（色変更やアニメーション制御）が容易なため、本機能の主軸とする。
2.  **Box-Shadowピクセルアート (CSS) 【不採用】**
    *   **評価**: 1080pや4Kのセル画像に適用した場合、CSSが数百万行に達しブラウザがクラッシュするため、実用性に欠ける。
3.  **Canvas API 描画 (JavaScript) 【内部処理として利用】**
    *   **評価**: エクスポート形式としては不適切（結局はラスターになるため）だが、Kingfisherの内部的な描画パイプライン（WebGPU）としては既に活用されている。
4.  **Base64 エンコード (HTML / CSS) 【不採用】**
    *   **評価**: 結局はラスター画像のテキスト化であり、ベクター化（解像度非依存化）という本来の目的を満たさない。

---

## 2. システム・アーキテクチャ (Rust/Wasm)

TGA画像のベクトル化（オートトレース）は計算コストが非常に高いため、JavaScriptではなく**Rust (WebAssembly)** 側で処理を実行し、生成されたSVG文字列をフロントエンドに返すアーキテクチャを採用する。

### 2.1. 処理パイプライン
1.  **カラークラスタリング (減色処理)**:
    アニメの彩色セルは色が限られている特性を活かし、K-Means法等を用いてピクセルをインデックスカラー（色ごとの領域）に分割する。
2.  **エッジ検出とポリゴン化 (Marching Squares)**:
    色ごとの領域（ブロブ）に対してマーチングスクエア・アルゴリズムを適用し、ピクセル単位の輪郭座標（ポリゴン）を抽出する。
3.  **カーブ・フィッティング (Potraceアルゴリズム)**:
    抽出されたギザギザのポリゴンに対し、Douglas-Peuckerアルゴリズムで頂点を間引き、最適化された3次ベジェ曲線（Cubic Bezier Curve）へと変換（フィッティング）する。
4.  **SVG文字列の構築**:
    生成されたベジェ曲線のパスを `<path>` タグにまとめ、元の色を `fill` 属性として付与した完全なSVG形式の文字列をRust内で構築する。

---

## 3. Rust (WebAssembly) 実装仕様

Rust側にベクトル化を行う関数をエクスポートする。外部クレート（`potrace` や `svg` クレート）の利用を推奨する。

```rust
// Rust (Wasm) 側のベクトル化関数のインターフェース例
#[wasm_bindgen]
pub fn export_to_svg(
    image_data: &[u8], 
    width: u32, 
    height: u32, 
    tolerance: f64 // カーブの滑らかさの閾値
) -> String {
    // 1. RGBAバッファから色領域を抽出
    let color_regions = extract_color_regions(image_data, width, height);
    
    let mut svg_paths = Vec::new();
    
    // 2. 各色領域に対してベクトル化を実行
    for region in color_regions {
        // Potraceアルゴリズム等によるポリゴン→ベジェ曲線変換
        let bezier_path = trace_to_bezier(&region.bitmap, tolerance);
        
        // SVGの <path> タグを生成
        let path_str = format!(
            "<path d="{}" fill="#{:02x}{:02x}{:02x}" />",
            bezier_path.to_svg_d_string(),
            region.color.r, region.color.g, region.color.b
        );
        svg_paths.push(path_str);
    }
    
    // 3. 最終的なSVG文字列を結合して返す
    format!(
        "<svg viewBox="0 0 {} {}" xmlns="http://www.w3.org/2000/svg">{}</svg>",
        width, height, svg_paths.join("\n")
    )
}
```

---

## 4. UI/UX および メニュー仕様

### 4.1. メニューの追加
トップメニューバーの「ファイル(F)」メニュー内に以下の項目を追加する。

*   **ファイル(F) > エクスポート > ベクター出力 (SVG)...**

### 4.2. オプション・ダイアログ
メニューを選択後、出力を最適化するためのダイアログを表示する。
*   **スムージング (Tolerance)**: スライダー (0.1 〜 5.0)。数値を上げるとパスの頂点が減り滑らかになるが、ディテールが失われる。
*   **背景の透過**: チェックボックス。純白 (RGB: 255, 255, 255) の領域をパス化せずに透明な背景として扱うかどうかの設定。

### 4.3. ダウンロード処理 (JavaScript)
Rustから返却されたSVG文字列をBlobに変換し、ブラウザのダウンロード機能を用いてユーザーのローカルへ保存させる。

```javascript
// TypeScript (React) 側の処理例
const handleExportVector = async () => {
    // 1. WasmからSVG文字列を取得
    const svgString = wasm.export_to_svg(currentBuffer, width, height, tolerance);
    
    // 2. Blob化してダウンロードリンクを発火
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentFileName.replace('.tga', '')}_vector.svg`;
    a.click();
    
    URL.revokeObjectURL(url);
};
```

---

## 5. 期待される効果
アニメーションの彩色済みセルは境界がはっきりしているため、本アルゴリズムを適用することで、容量が非常に軽く、かつ4K/8K解像度へスケールしてもジャギー（ピクセルの粗）が一切出ない高品質なアセットとして出力可能となる。これはWebアニメーションや高解像度ゲームエンジンへの組み込みにおいて絶大なメリットをもたらす。
