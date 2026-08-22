# Kingfisher オニオンスキン＆ライトテーブル機能 実装指示書

**Document Version:** 1.0 (Onion Skin & Light Table Spec)
**Target Feature:** 複数セルの透過表示、カラーコーディング、およびタップ移動（位置調整）対応

---

## 1. 概要と基本コンセプト

アニメーションの作画および彩色工程において、動きの連続性を確認・修正するための「オニオンスキン（前後フレームの自動透過表示）」と、任意の参照セルをずらして重ねる「ライトテーブル」の機能を統合して提供する。

Kingfisherの強みである**WebGPU**を活用し、最大10枚以上の高解像度セルを重ねても、60fpsのリアルタイムパフォーマンスを維持するレンダリングアーキテクチャを構築する。

---

## 2. UI/UX 仕様

セルウィンドウ（キャンバス）の近傍、または専用の「ライトテーブルパネル」に以下のコントロール群を配置する。

### 2.1. オニオンスキン設定（基本）
*   **有効化トグル**: `[ON/OFF]`
*   **表示枚数**: 
    *   前のフレーム: `[ 0 〜 5 枚 ]`
    *   後のフレーム: `[ 0 〜 5 枚 ]`
*   **不透明度の減衰（Opacity Gradient）**:
    *   開始不透明度: `[ 30% ]`
    *   1フレームごとの下げ幅: `[ 10% ]` (例: 1枚前は30%、2枚前は20%、3枚前は10%となる)

### 2.2. カラーコーディング（表示色設定）
前後のフレームを識別しやすくするため、カラーフィルターを適用する。
*   **表示モード**: `[ カラー (元の色) / ハーフカラー / モノクロ (単色化) ]`
    *   *モノクロモード時*: 元の画像情報をグレースケール化した上で、指定色を乗算（Multiply）する。
*   **前フレームの表示色**: デフォルト `[ 赤 (Red) ]`
*   **後フレームの表示色**: デフォルト `[ 緑 (Green) または 青 (Blue) ]`

### 2.3. 個別ライトテーブル機能（高度な配置）
*   現在のタイムライン前後に依存せず、任意のTGAファイルをドラッグ＆ドロップで「サブレイヤー」として一時登録できるリストを設ける。
*   登録された各セルに対して、個別に**X/Yのオフセット（平行移動）**と**回転角**を指定できる（タップ割りの再現）。

---

## 3. レンダリング・アーキテクチャ (WebGPU)

複数枚の画像を重ねる処理を、CPUではなくGPUのフラグメントシェーダー（WGSL）内で完結させる。

### 3.1. テクスチャバインディング
*   現在のキャンバスを描画するパイプラインに対し、オニオンスキンとして表示する対象の画像データを最大N枚、動的なテクスチャ配列（`texture_2d<f32>` の配列）としてバインドする。
*   各テクスチャに対し、ユニフォームバッファ（Uniform Buffer）経由で以下のパラメータを渡す。
    *   `opacity`: 不透明度 (0.0〜1.0)
    *   `tint_color`: カラーコーディング用の乗算色 (vec3)
    *   `transform_matrix`: ライトテーブル用の位置ズレ・回転を適用する変換行列 (mat3x3)

### 3.2. WGSL シェーダー処理フロー (擬似コード)
フラグメントシェーダー内で、下層のオニオンスキンから順にブレンド（アルファ合成）を行っていく。

```wgsl
// WGSL内でのモノクロ+カラーコーディング処理の例
fn apply_onion_skin(tex_color: vec4<f32>, tint: vec3<f32>, opacity: f32) -> vec4<f32> {
    // 1. グレースケール化 (輝度の算出)
    let luminance = dot(tex_color.rgb, vec3<f32>(0.299, 0.587, 0.114));
    
    // 2. 指定色（赤や緑）による着色
    let tinted_color = vec3<f32>(luminance) * tint;
    
    // 3. 減衰不透明度の適用
    return vec4<f32>(tinted_color, tex_color.a * opacity);
}
```

### 3.3. 最適化手法
*   見えないフレーム（不透明度が0、または画面外にパンしている状態）は、GPUにテクスチャをバインドしない（カリング）。
*   オニオンスキンの色変更（赤→青など）や不透明度の変更は、画像データの再ロードを行わず、Uniformパラメータの更新のみで行う。これにより、設定変更時のUIラグをゼロにする。

---

## 4. 状態管理 (Zustand Store)

```typescript
interface OnionSkinStore {
  isEnabled: boolean;
  pastFrames: number;
  futureFrames: number;
  startOpacity: number;
  opacityStep: number;
  displayMode: 'color' | 'half-color' | 'monochrome';
  pastColor: { r: number, g: number, b: number };
  futureColor: { r: number, g: number, b: number };
  
  // ライトテーブル用個別登録セル
  lightTableItems: Array<{
    fileHandle: FileSystemFileHandle;
    offsetX: number;
    offsetY: number;
    rotation: number;
    opacity: number;
  }>;
}
```
