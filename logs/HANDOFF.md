# Kingfisher 作業引き継ぎ

別マシンの Claude Code でこの続きから作業するための資料です。
**まずこのファイルを読み、次に「未解決の課題」から着手してください。**

- リポジトリ: `git@github.com:INOUE-ajiado/Kingfisher.git`
- 本番: https://kingfisher-paint-2026.web.app (Firebase Hosting / project `kingfisher-paint-2026`)
- 記録日: **2026-08-25** (自宅 PC セッション。前回 2026-08-24 は会社 PC)

## 🆕 2026-08-26 の更新

このセクションより下は 2026-08-25 時点の記述です。以下が最新の状況で、
**正はいつも MCP の `kingfisher_known_issues` / `kingfisher_domain_rules`** です。

- **課題 3・4 は決定済み** — どちらも現状維持を仕様として確定しました (下の各節を参照)。
- **リネームの衝突判定を修正** — サブフォルダをまたぐ選択で、`_go/` と `_ao/` に
  同じコマ番号を振る通常の操作が「名前が重複します」と誤判定され、中止されていました。
  変更後の相対パスで比較するよう修正 (`findRenameConflicts` / `needsTwoPhaseRename` /
  複製の連番)。回帰テスト 8 件を追加し、修正前のコードで 5 件が落ちることを確認済み。
- **課題 2 の 6 件目の実体を修正** — 投げ縄の状態にビューの区別が無く、プレビューが
  左キャンバス固定でした。**Win B で投げ縄を引くと輪郭線が Win A に出ます**
  (塗り自体は Win B に入る)。報告された症状そのものです。
- テストは **163 件**。tsc / test / build 通過。main へマージし、**デプロイ済み**
  (本番バンドル `index-OWqYNesI.js` / パスワードハッシュ照合済み)、GitHub へ push 済み。
- **課題 1 の実機確認はまだ残っています。** 実機で問題が出たら `git revert d5dbec9` で戻せます。
- **運用が変わりました**: 修正のたびにマージで止めず、**デプロイと push まで一続きで行う**
  (2026-08-26 ユーザー指示)。デプロイ前後のパスワードハッシュ照合は従来どおり必須。

## 🚀 まず MCP を使ってください

このリポジトリには Kingfisher 専用の MCP サーバーが入っています (`mcp/`)。
`.mcp.json` を置いてあるので Claude Code が自動で読み込みます。

作業を始めるとき、まず `kingfisher_briefing` を呼んでください。
不具合の調査前は `kingfisher_known_issues`、独自仕様に触れる前は
`kingfisher_domain_rules` を呼ぶと、このドキュメントを読み込むより確実です。

> ⚠️ `.mcp.json` は Claude Code の **起動時** に読まれます。
> clone 直後に `claude` を起動すれば認識されます (初回は承認プロンプトが出ます)。

## このフォルダの中身

| ファイル | 内容 |
|---|---|
| `HANDOFF.md` | このファイル。状況と次の一手 |
| `conversation.md` | 2026-08-24 の会話全文 (会社 PC / ユーザー 38 発言) |
| `session-raw-transcript.jsonl` | 同上の生ログ (3.8MB) |
| `conversation-2026-08-25.md` | 2026-08-25 の会話全文 (自宅 PC / ユーザー 23 発言) |
| `session-2026-08-25-raw-transcript.jsonl` | 同上の生ログ (2.8MB) |

---

## リポジトリの状態

**すべてコミット済み・push 済み・本番デプロイ済みです。**

```bash
git clone git@github.com:INOUE-ajiado/Kingfisher.git
cd Kingfisher && npm install
npm test        # 155 件通ること
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

### 1. 2026-08-25 の変更は実機で一度も確認していない ← 最優先

型チェック・テスト (155 件)・ビルドは通り、**本番へデプロイ済み**。
しかし File System Access API の実操作 (実フォルダ選択・保存・リネーム・削除) は
**ブラウザで一度も試していません**。ファイルを直接書き換える機能が多いので、
**必ずコピーしたフォルダで**確認してください。

確認する順番:

1. **階層のあるカットフォルダを開いて保存できるか** — 今回いちばん大きく変えた箇所
2. **D&D したフォルダへ保存できるか** — 新しくできるようになった
3. **連番リネーム** — 先頭/末尾テキスト・開始番号・桁数
4. **削除・複製 (コピー)**
5. **ツリーの選択が飛ばない / 巻き戻らない / 項目が飛ばされないか**

初回の保存・リネーム時に Chrome が書き込み許可を聞きます (これは意図した変更)。

問題があれば `git revert 0bc437d` などで戻せます。

### 2. Win B でツールが使えない (実体は複数、順に対処済み・最終確認待ち)

報告は「WinB に対してツールを使用しようとすると WinA に判定が吸われる」。
**原因は 1 つではありませんでした。** 見つかった実体は 5 件で、すべて修正済み:

- 閲覧専用の通知が単一の真偽値で、Win B で弾かれたのに Win A にも出ていた
- 独立ウィンドウの枠線が固定色で `activeViewIndex` を反映していなかった
- フォルダを開いた直後の表示コマを無条件で 0 にしており、B の実体が無いコマを指していた
- ファイルツリーが片側だけのとき 1 本になり、Win B を移動する手段が無かった
- ツリーの選択インデックスとフレーム番号の対応が 1 対 1 でなかった

**調査済みで正常だったもの** (同じ調査を繰り返さないこと):

- `<canvas ref={rightCanvasRef} onMouseDown={(e) => handleMouseDown(e, false)}>` の配線
- `targetImg = isLeftView ? currentImage : splitImage` の分岐
- Win A は Win B の **DOM 上・React ツリー上のどちらでも親ではない** (兄弟)。
  `CellWindow` はポータルを使っていないので、イベントが Win A へ抜ける経路は無い
- `currentImage` と `splitImage` は別オブジェクト (`cloneTGAImage` を通している)
- `saveUndoState` / `jumpToHistory` / `commitLiveState` はすべて `activeViewIndex` で分岐
- `useFloatingWindow` の `windowStyle` はドッキング中 `undefined`。
  `useFastDraggable` は `enabled:false` で `transform` を消している
- `CellWindow` のオーバーレイは 6 箇所すべて `pointer-events-none`

**まだ起きる場合の切り分け**: Win B のタイトルバーに `*` が付くか / 保存ボタンが
「未保存 B」になるか。付くなら処理は Win B に入っており、表示側の問題。

### 3. 「名前を付けて保存」の仕様 — ✅ 2026-08-26 決定済み

**現状の挙動を仕様として確定しました。** 書き出し先は開いているフォルダの連番に
含まれないため、保存しても**元ファイルの未保存状態はクリアしません**。一般的なアプリは
保存先を編集対象に切り替えますが、フォルダの連番が UI 全体を駆動している以上、
それをやると表示中のカットごと変わってしまうため踏み込みません。

⚠️ ユーザーからの再依頼が無い限り、一般的なアプリに合わせる変更を提案しないこと。

### 4. Firefox / Safari では D&D したフォルダを保存できない — ✅ 2026-08-26 決定済み

**仕様として許容することを確定しました。** 書き込み可能なハンドルを得る
`getAsFileSystemHandle()` が Chromium 系のみで、非対応環境では読み込みだけできる扱いです。
もともと File System Access API 前提の構成で、対象ブラウザは Chromium 系です。

⚠️ Firefox / Safari 対応や、そのための警告 UI を提案しないこと。

### 5. ColorChart の独立ウィンドウが重い (対策済み・効果未確認)

`document.body` へポータル描画するようにした (`FloatingPortal.tsx`)。
**まだ重い場合**は見立てが外れているので、DevTools の Performance で
1フレームの内訳を実測してから判断すること。推測で手を打たないこと。

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
- **意図的にコードを壊してテストが落ちることを確認する検証が有効**
  (2026-08-25 はこれで、2 段階リネームを外すと 3 ファイルが 1 つに潰れることを発見した)

---

## アーキテクチャ (2026-08-25 時点)

```
src/
├── engine/                     React 非依存の純粋ロジック
│   ├── paintAlgorithm.ts       塗り (隙間閉じ・含み塗り・拡張縮小)
│   ├── tga.ts                  TGA デコード/エンコード (純白=透明)
│   ├── imageDecode.ts          拡張子を問わない読み込み・複製
│   ├── fileSystemPath.ts       相対パス解決・再帰走査・拡張子判定
│   │                           リネーム/コピー/削除・書き込み許可
│   ├── renamePlan.ts           リネーム計画 (連番・衝突検出・複製名)
│   ├── rasterTrace / vectorTrace / pegStabilizer
│   └── webgpuRenderer.ts       ⚠️ 未接続・保留 (触っても影響なし)
├── store/
│   ├── usePaintStore.ts        スライスを合成するだけ (33行)
│   ├── types.ts                全型定義 + buildMergedFrameData
│   └── slices/                 ui / view / window / file / document / tool / edit / lightTable
├── hooks/
│   ├── useFloatingWindow.ts    引きはがし・移動・リサイズ・ドッキング・重なり順
│   ├── useFrameLoader.ts       読み込み・先読み・オニオンスキン
│   ├── usePrefetchWorker.ts    TGA デコードを Web Worker へ
│   └── useFastDraggable / useResizableWindow / useGlobalShortcuts
└── components/
    ├── panels/  CellWindow(主画面) / ReferenceCanvasView / FileBrowser / ColorChart / …
    ├── modals/  RenameModal / ExportVector / ExportTrace / Preferences / …
    └── common/  ContextMenu / DockPlaceholder / FloatingPortal / CornerResizeHandles / AuthGuard
```

### 独自仕様で間違えやすい点

`kingfisher_domain_rules` に構造化して入れてあります。特に踏みやすいのは次の 4 つ:

- **純白 RGB(255,255,255) = 透明 (α=0)。** 保存時は α=0 を純白へ戻す
- **パスの起点とフォルダハンドルの起点を必ず揃える。**
  ずれると読み込みは fileMap のフォールバックで通り、**保存だけが落ちる**ので気づきにくい
- **フレーム対応表は 1 ファイル 1 エントリ。** 番号が重なるサブフォルダで潰れると、
  ツリーの選択が飛ぶ・巻き戻る・項目が飛ばされる
- **`move()` は同名を黙って上書きする。** 連番リネームは一時名を経由する 2 段階で

### テスト

`npm test` で 155 件。`src/**/*.test.ts` を vitest が拾う。
`tsconfig.json` はテストを除外しているのでビルドは止まらない。
テスト込みの型チェックは `npm run typecheck`。

---

## これまでに直した主な不具合 (再発したら参照)

`kingfisher_known_issues` が同じ一覧を返します。

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
| ファイルツリーがフラットになる | フォルダを開く経路が相対パスを持たず 1 階層しか走査していなかった |
| Win B のファイルツリーが出ない | 統合リスト (A 側の代表名) から 1 本だけ組み立てていた |
| Win B に画像が出ない (ツリーには並ぶ) | 開いた直後の表示コマを無条件で 0 にしていた |
| Win B のツリーで選んでも移動しない | ツリーを 2 本出す条件が「両方にファイルがある」だった |
| Win B を触ると Win A が反応したように見える | 閲覧専用の通知が単一の真偽値で両方に出ていた |
| サブフォルダの画像がツリーに出ない | Open A/B が直下 1 階層しか走査していなかった |
| .png が経路によって見えたり見えなかったり | 拡張子の判定が 5 箇所に散っていた |
| 階層のあるカットで保存だけ失敗 | folderHandle にサブフォルダのハンドルを持たせていた |
| 保存したのに古い画像が出る | 開いた時点の File スナップショットが fileMap に残っていた |
| 別フォルダの同名コマが消える | `<input webkitdirectory>` のキーがファイル名だけだった |
| 名前を付けて保存が上書きになる | メニューもショートカットも上書き保存と同じハンドラだった |
| ツリーの選択が飛ぶ・巻き戻る・飛ばされる | フレーム番号での逆引きが 1 対 1 でなかった |
