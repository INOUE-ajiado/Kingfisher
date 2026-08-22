# Kingfisher 高密度・ゼロマージンUIレイアウト実装仕様書

**Document Version:** 1.0 (Zero-Margin Layout Spec)
**Target Feature:** ワークスペース全体のUIレイアウトおよびCSS設計方針

---

## 1. 背景とデザイン原則（アンチ・モダンWebレイアウト）

近年の一般的なWebアプリケーション開発では、コンテナ（コンテンツ）の外側に余白（Margin）や隙間（Gap）を設ける「フラット＆クリーン」なデザインが主流となっている。
しかし、Kingfisherのようなプロフェッショナル向けアニメーション制作ツールにおいて、このアプローチは**キャンバスの作業領域を不必要に圧迫する致命的な設計ミス**となる。

本プロジェクトでは、従来のデスクトップアプリケーション（Paintman等）の堅牢なUIを踏襲し、**「ウィンドウパネル間のマージン・隙間を一切排除した、高密度（Edge-to-Edge）なレイアウト」**を絶対原則とする。

> ⚠️ **【重要】フロントエンド実装者への警告**
> 意図的に余白を設けるUIコンポーネントライブラリ（Material-UIのデフォルト設定など）や、Tailwind CSS等の `gap-4`、`p-4` といったレイアウト目的の無駄な余白付けを禁止する。

---

## 2. レイアウトの基本ルール

画面全体を隙間なく分割するため、以下のCSSアーキテクチャを徹底する。

### 2.1. 境界線による区切り（No Gap, Only Border）
*   パネル（ウィンドウ）同士の区切りは、余白（Margin/Gap）ではなく、**「1pxの単色Border（境界線）」のみ**で表現する。
*   各パネルの外側マージンは常に `margin: 0;` とする。

### 2.2. CSS Grid / Flexbox の厳格な運用
*   画面全体（Root）は `height: 100vh; width: 100vw; overflow: hidden;` とし、ブラウザのスクロールバーを絶対に発生させない。
*   FlexboxやCSS Gridでレイアウトを組む際、`gap` プロパティは使用しない。

### 2.3. 内部余白（Padding）の最小化
*   パネル内部の余白（Padding）は、テキストやアイコンが境界線に接触して読めなくなるのを防ぐための「最低限（2px 〜 4px）」に留める。
*   ツールアイコンなどは、ボタン要素のサイズ自身で領域を確保し、コンテナ側で過剰なPaddingを持たせない。

---

## 3. CSS実装ベースライン (雛形)

上記原則を強制するためのグローバルCSSの基本構造。すべてのコンポーネントはこのルールに従って配置される。

```css
/* 1. リセットとボックスサイズの統一 */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* 2. アプリケーションのルート設定（スクロール禁止、全画面） */
#root, .app-container {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background-color: var(--win-border-dark); /* 隙間埋め用ベース色 */
}

/* 3. ワークスペース（ツールバー等を除いたメイン領域） */
.workspace {
  flex: 1;
  display: flex;
  /* ⚠️ ここで gap は絶対に指定しない */
}

/* 4. パネル（各ウィンドウ）の基本スタイル */
.panel {
  display: flex;
  flex-direction: column;
  background-color: var(--win-bg);
  /* 区切りは1pxのボーダーのみ。隣接するボーダーが重ならないよう片側のみ指定等の工夫をする */
  border-right: 1px solid var(--win-border-darker);
  border-bottom: 1px solid var(--win-border-darker);
}

/* 5. キャンバスを包む領域（余白ゼロで100%埋める） */
.canvas-container {
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden; /* キャンバス外の描画をカット */
}
```

---

## 4. UIコンポーネントごとのマージン規定

*   **トップメニューバー**: `height: 20px; padding: 0 4px;` (縦幅を極限まで削る)
*   **ツールパレット (左端)**: `width: 32px; padding: 0;` (アイコンがピッタリ収まる幅のみ)
*   **ファイルブラウザ (右パネル)**: リストアイテムの縦幅（`line-height`）は文字が読める最小サイズに設定し、1画面に表示できるファイル数を最大化する。
