# Kingfisher 作業引き継ぎ

別マシンの Claude Code でこの続きから作業するための資料です。
**まずこのファイルを読み、次に「未解決の課題」から着手してください。**

- リポジトリ: `git@github.com:INOUE-ajiado/Kingfisher.git`
- 作業ディレクトリ: `/Users/inouemacmini/Desktop/Kingfisher`
- 本番: https://kingfisher-paint-2026.web.app (Firebase Hosting / project `kingfisher-paint-2026`)
- 記録日: 2026-08-24

## 🚀 まず MCP を使ってください

このリポジトリには Kingfisher 専用の MCP サーバーが入っています (`mcp/`)。
`.mcp.json` を置いてあるので Claude Code が自動で読み込みます。

作業を始めるとき、まず `kingfisher_briefing` を呼んでください。
プロジェクトの前提・注意事項・未解決の課題がまとめて得られます。
不具合の調査前は `kingfisher_known_issues`、独自仕様に触れる前は
`kingfisher_domain_rules` を呼ぶと、このドキュメントを読み込むより確実です。

詳細は `mcp/README.md` を参照してください。

## このフォルダの中身

| ファイル | 内容 |
|---|---|
| `HANDOFF.md` | このファイル。状況と次の一手 |
| `conversation.md` | 会話の全文 (ユーザー 38 発言 / Claude 138 応答) |
| `session-raw-transcript.jsonl` | Claude Code の生ログ。ツール実行の詳細を含む (3.8MB) |

---

## リポジトリの状態

**すべてコミット済み・push 済み・本番デプロイ済みです。** 未コミットの変更はありません。

```bash
git clone git@github.com:INOUE-ajiado/Kingfisher.git
cd Kingfisher && npm install
npm test        # 90 件通ること
npm run dev
```

運用は「ブランチを切る → コミット → `main` へ `--no-ff` マージ → push → デプロイ」。
`main` に直接コミットしないこと (`kingfisher_git_status` が警告します)。

```bash
git checkout -b improve/<topic>
# コミット
git checkout main && git merge --no-ff improve/<topic>
git push origin main
npm run build && firebase deploy --only hosting --project kingfisher-paint-2026
```

デプロイ前に必ず: `.env` が無い環境ではビルドが `AuthGuard.tsx` のフォールバックハッシュを使う。
本番バンドルのハッシュと一致することを確認してからデプロイすること
(一致しないとログインパスワードが変わって誰も入れなくなる)。

```bash
HTML=$(curl -s https://kingfisher-paint-2026.web.app/)
JS=$(echo "$HTML" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
curl -s "https://kingfisher-paint-2026.web.app$JS" | grep -c '2cfbedf50a09b0767c5d4c17ecb94f4b81fc17a160ef609c0b7566f5fcea2974'
```

---

## 🔴 未解決の課題 (ここから着手)

### 1. Win B でツールが使えない ← 最優先・原因未確定

ユーザー報告:「WinB に対してツールを使用しようとすると WinA に判定が吸われる」。

**調査済みで正常だったもの**(同じ調査を繰り返さないこと):
- `<canvas ref={rightCanvasRef} onMouseDown={(e) => handleMouseDown(e, false)}>` の配線
- `targetImg = isLeftView ? currentImage : splitImage` の分岐
- Win A は Win B の DOM 上の親ではない (兄弟)
- `saveUndoState` は `activeViewIndex` を見るので Win B 側に積まれる

**直前に打った手** (ユーザー未確認):
- Win B のキャンバスにも閲覧専用の通知バナーを追加 (Win A にしか無かった)
- 「NO CELL DATA」カードの `pointer-events-auto` を除去 (クリックを吸っていた)

**次にユーザーへ確認すべきこと**:
- Win B クリック時にオレンジの通知が出るか → 出れば `isReadOnly`(TGA 以外) が原因
- Win B に「NO CELL DATA」が出ていないか → 出ていれば `splitImage` が null
- Win B のタイトルバーに `🔒 閲覧専用` バッジが出ていないか
- Win B クリック後に保存ボタンが `未保存 B` に変わるか (変われば処理は走っている)

`handleMouseDown` で右クリックのパンより後・ツール分岐より前にある早期 return は
`isReadOnly` ガードだけ。ここが最有力。

### 2. ColorChart の独立ウィンドウが重い ← 対策済みだが効果未確認

`document.body` へポータル描画するようにした (`FloatingPortal.tsx`)。
理由: ColorChart だけが右サイドパネル (`overflow-y-auto`) の内側にあり、
`position: fixed` でもスクロール領域の一部として扱われて再描画が起きるため。

**まだ重い場合**は見立てが外れているので、DevTools の Performance で
1フレームの内訳を実測してから判断すること。推測で手を打たないこと。

### 3. 動作未確認のまま溜まっている修正

以下はすべて実装・テスト済みだが、ユーザーの実機確認が取れていない。

- 「フォルダを開く」のツリー表示 (相対パス化)。**保存が壊れていないか要確認**
- D&D の安定化 (点滅・取りこぼし)
- ズーム維持 / 境界線ドラッグ / ファイルツリーの A・B 並列表示
- 連動仕様の変更 / オニオンスキンの右パネル集約

---

## 📌 このプロジェクトで守るべき前提

### Doc/ は仕様書ではない

`Doc/` の 24 本の Markdown は**アジャイル開発の道筋の痕跡**であり、達成済み仕様ではない。
「Rust/Wasm」「WebGPU」「SharedArrayBuffer」と書かれているが実装は全て素の TypeScript + Canvas 2D。
**機能の有無は必ずコードを読んで確認すること。**

### AuthGuard は社内配布前提

パスワードは DevTools で突破可能だが、社内配布のみなので許容。**強化を提案しないこと。**

### 作業の進め方 (ユーザーの好み)

- 日本語で回答する
- **推測で断定しない。** 検証したことと推測を分けて書く
- 原因が確定できないときは、ユーザーに**ツール不要の判定方法**を提示する
  (例: カーソルの形、保存ボタンの色、履歴パネルの増加)
- 修正したら `npx tsc --noEmit` → `npm test` → `npm run build` を必ず通す
- 意図的にコードを壊してテストが落ちることを確認する検証が有効だった

---

## アーキテクチャ (2026-08-24 時点)

```
src/
├── engine/                     React 非依存の純粋ロジック
│   ├── paintAlgorithm.ts       塗り (隙間閉じ・含み塗り・拡張縮小)
│   ├── tga.ts                  TGA デコード/エンコード (純白=透明)
│   ├── imageDecode.ts          拡張子を問わない読み込み・複製
│   ├── fileSystemPath.ts       相対パス → ファイルハンドル解決
│   ├── rasterTrace / vectorTrace / pegStabilizer
│   └── webgpuRenderer.ts       ⚠️ 未接続・保留 (触っても影響なし)
├── store/
│   ├── usePaintStore.ts        スライスを合成するだけ (31行)
│   ├── types.ts                全型定義
│   └── slices/                 ui / view / window / file / document / tool / edit / lightTable
├── hooks/
│   ├── useFloatingWindow.ts    引きはがし・移動・リサイズ・ドッキング・重なり順
│   ├── useFrameLoader.ts       読み込み・先読み・オニオンスキン
│   ├── usePrefetchWorker.ts    TGA デコードを Web Worker へ
│   └── useFastDraggable / useResizableWindow / useGlobalShortcuts
└── components/
    ├── panels/  CellWindow(主画面) / ReferenceCanvasView / FileBrowser / ColorChart / …
    └── common/  DockPlaceholder / FloatingPortal / CornerResizeHandles / AuthGuard
```

### 独自仕様で間違えやすい点

- **純白 RGB(255,255,255) = 透明 (α=0)。** 保存時は α=0 を純白へ戻す
- **ファイル識別子は相対パス** (`Cat/_go/A0001.tga`)。ツリー階層表示のため。
  `getFileHandle()` は名前1つしか受け取れないので `resolveFileHandle()` を使うこと
- **A/B は異名連番**。ファイル名から `extractFrameNumber` でフレーム番号を取り出して対応付ける。
  ビューごとの実ファイル名は `resolveFileNameForView(index, view)` で解決する
- **左右連動はコマ差を保つ。** `syncFrameOffset` = splitFileIndex - currentFileIndex

### テスト

`npm test` で 90 件。`src/**/*.test.ts` を vitest が拾う。
`tsconfig.json` はテストを除外しているのでビルドは止まらない。
テスト込みの型チェックは `npm run typecheck`。

---

## これまでに直した主な不具合 (再発したら参照)

| 症状 | 原因 |
|---|---|
| Ctrl+S が効かない | 存在しない DOM 要素をクリックしようとしていた |
| Win B の保存が別ファイルに書かれる | 保存先に A 側の代表名を使っていた |
| Win B の Undo が効かない | splitImage がコンポーネントのローカル state だった |
| Ctrl+Z が 2手戻る / 1手目が戻せない | 履歴の基準状態が無く undo の条件がずれていた |
| コマ送りで編集が消える | 未保存の確認が無かった |
| 隙間閉じが効かない | UI から値は渡るが floodFill が参照していなかった |
| 線をクリックすると全面が塗り潰される | 透明画素を常に通り抜け可能にしていた |
| ドッキングに戻すとパネルがズレる | 直接書いた transform を消していなかった |
| D&D が点滅して挿入できない | ハイライト時に flex-1 が外れて要素が縮んでいた |
| D&D で 101 枚目以降が欠落 | readEntries() の 100 件制限を繰り返していなかった |
| D&D で複数選択が取りこぼされる | await を挟んだ後に dataTransfer.items を読んでいた |
| コマ送りでズームが戻る | 画像が変わるたびに自動フィットしていた |
