# Kingfisher 線画透過・アルファチャンネル化 高度技術仕様書

**Document Version:** 2.0 (Advanced Technical & System Architecture Spec)
**Subject:** 映像合成理論（Matting）に基づく線画透過アルゴリズムと、WebGPU Compute Shaderを用いた超並列処理パイプラインの定義

---

## 1. 課題の数理的定義（The Matting Problem）

Paintman等のアニメーションツールにおける「白背景の透過処理」は、コンピュータグラフィックスの分野において**「ブルー・スクリーン・マッティング（Matting）」**や**「アルファ・ブレンディングの逆変換（Unmultiply）」**として古くから研究されている課題である。

一般的なアルファ・ブレンディングの方程式（Porter-Duffの合成式）は以下のように定義される。

$$C = \alpha C_F + (1 - \alpha)C_B$$

ここで、各変数は以下の意味を持つ。
*   $C$: 観測されるピクセルの色（スキャンされた画像データ）
*   $C_F$: 本来の線画（前景）の色
*   $C_B$: 背景色（アニメのキャンバスである純白：RGBすべて1.0）
*   $\alpha$: 求めたい不透明度（アルファチャンネル）

課題は、**既知の $C$ と $C_B=(1,1,1)$ から、未知の $C_F$ と $\alpha$ の2つを同時に求めなければならない（不良設定問題）**ことにある。単純なクロマキー（閾値判定）では、アンチエイリアス部分の $\alpha$ が0または1に二値化されるか、$C_F$ の色が白と混ざった状態（フリンジ）で残るため、品質を満たさない。

---

## 2. アルゴリズムのアプローチ（映像合成技術の応用）

### 2.1. 最小チャンネル法 (Minimum Channel / Luminance Keying)
アニメの線画（主線：黒、色トレス線：赤・青・緑など純色に近い色）の特性を利用し、Smith & Blinn (1996) などのマッティング理論を応用した**「純白背景からのUnmultiplyモデル」**を採用する。

アニメの線画において、背景からの「白の混入度」は、RGBのうち最も値が大きい（最も白に近い）チャンネルに依存する。したがって、透過度 $\alpha$ は以下で近似できる。

$$\alpha = 1.0 - \min(R, G, B)$$

$\alpha$ が求まれば、前述の方程式を $C_F$ について解くことで、本来の色を完全に復元できる。

$$C_F = \frac{C - (1 - \alpha)}{\alpha}$$

### 2.2. アニメ業界特有の「純白判定」ルール
アニメ業界のデータ運用（Paintmanの仕様）における絶対的なルールとして、**「RGB(255, 255, 255) は完全透明」「RGB(254, 254, 254) は白目などに塗られる不透明な白」**という厳格な定義がある。

上記アルゴリズムをそのまま適用すると、(254, 254, 254) が $\alpha = 1 / 255$ のほぼ透明なピクセルとして誤爆してしまう。これを防ぐため、以下のPiecewise（区分的）な条件分岐をアルゴリズムに組み込む。

*   $\max(R, G, B) == 1.0$ (255) かつ $\min(R, G, B) == 1.0$ (255) の場合のみ、背景とみなし $\alpha = 0.0$ とする。
*   塗りつぶし領域（ペイントデータ）と線画領域を別レイヤーとして仮想的に分離して管理し、透過処理は「線画レイヤー（LineArt）」に対してのみ適用する。

---

## 3. Paintmanを凌駕するシステムアーキテクチャ

Paintmanなどの旧来のソフトウェアはCPUバウンド（シングルスレッドによる逐次処理）であり、数千〜数万ピクセルをループ処理するため、4K画像等では処理遅延が避けられない。Kingfisherでは以下の3段階のアーキテクチャで「限界速度」を実現する。

### 3.1. 表示プレビュー：Fragment Shaderによるゼロ遅延処理
UI上で透過モードをプレビューする際は、前述の数式を**Fragment Shader (WGSL)**に実装し、GPUのピクセル描画パイプライン内で計算させる。元データ（Wasm側のメモリ）は一切変更しない「非破壊処理」のため、切り替えコストは0msである。

### 3.2. 実データ変換（保存時）：Compute Shaderによる超並列処理
透過させた状態のTGA（32bit）を物理的に出力する（エクスポートする）場合、Fragment Shaderではなく**WebGPU Compute Shader**を使用する。

Compute Shaderは画面の描画とは独立して、GPU内のVRAMバッファを直接書き換えることができる汎用計算（GPGPU）機能である。
*   処理画像を $16 \times 16$ ピクセル単位の「Workgroup」に分割する。
*   GPUの数千コアが、画像を並列かつ一瞬で透過計算し、出力用バッファ（`StorageBuffer`）に書き込む。
*   計算完了後、GPUからメインメモリへ非同期（`mapAsync`）でデータを引き戻す。

### 3.3. CPUへのフォールバック：Wasm SIMD (v128)
WebGPUが利用できない古いブラウザ環境では、Rustの `core::arch::wasm32::v128` を用いたSIMD処理にフォールバックする。4ピクセル（128bit）を1回のCPUサイクルで同時に透過計算することで、JavaScriptのループ処理と比較して約4〜8倍の高速化を実現する。

---

## 4. Compute Shader (WGSL) 実装仕様

TGA変換（保存）時に実行されるCompute Shaderのコード仕様である。

```wgsl
@group(0) @binding(0) var<storage, read> input_buffer: array<u32>;
@group(0) @binding(1) var<storage, read_write> output_buffer: array<u32>;

struct Config {
    width: u32,
    height: u32,
}
@group(1) @binding(0) var<uniform> config: Config;

// 16x16のピクセルブロック単位で並列実行
@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    if (x >= config.width || y >= config.height) {
        return;
    }
    
    let index = y * config.width + x;
    let pixel = input_buffer[index];
    
    // 32bit UIntからRGBA(0.0〜1.0)への分解
    let r = f32((pixel >> 24u) & 0xFFu) / 255.0;
    let g = f32((pixel >> 16u) & 0xFFu) / 255.0;
    let b = f32((pixel >> 8u) & 0xFFu) / 255.0;
    
    // アニメ業界の純白判定ルール
    if (r == 1.0 && g == 1.0 && b == 1.0) {
        output_buffer[index] = 0u; // 完全透明(0x00000000)
        return;
    }
    
    // 最小チャンネルからのAlpha推定とUnmultiply計算
    let min_c = min(r, min(g, b));
    let alpha = 1.0 - min_c;
    
    // 背景(白)成分の除去
    let inv_alpha = 1.0 / alpha;
    let white_bg = 1.0 - alpha;
    let orig_r = clamp((r - white_bg) * inv_alpha, 0.0, 1.0);
    let orig_g = clamp((g - white_bg) * inv_alpha, 0.0, 1.0);
    let orig_b = clamp((b - white_bg) * inv_alpha, 0.0, 1.0);
    
    // 32bit UIntへ再パック
    let out_r = u32(orig_r * 255.0) << 24u;
    let out_g = u32(orig_g * 255.0) << 16u;
    let out_b = u32(orig_b * 255.0) << 8u;
    let out_a = u32(alpha * 255.0);
    
    output_buffer[index] = out_r | out_g | out_b | out_a;
}