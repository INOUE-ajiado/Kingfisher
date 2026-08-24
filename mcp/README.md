# Kingfisher MCP サーバー

AI に渡す前提知識を「読み手の解釈」に委ねず、**構造化された事実**として提供するための
MCP (Model Context Protocol) サーバーです。

## なぜ作ったか

このプロジェクトには、コードを普通に読むだけでは誤解しやすい前提がいくつもあります。

- `Doc/` の仕様書には Rust/Wasm・WebGPU と書かれているが、実装は素の TypeScript
- 純白 RGB(255,255,255) は透明として扱う独自仕様
- ファイル識別子はファイル名ではなくルートからの相対パス
- Win A / Win B は異名連番でファイル名が異なる
- UI にあるのに動いていないツールオプションが過去に何度もあった

これらを毎回説明し直すと、説明の抜けや解釈のずれがそのまま実装の誤りになります。
このサーバーは、その前提を**毎回同じ形で**渡します。

## 設定

リポジトリ直下の `.mcp.json` で登録済みです。Claude Code はこれを自動で読み込みます。

```json
{
  "mcpServers": {
    "kingfisher": { "command": "node", "args": ["mcp/server.js"] }
  }
}
```

依存は `@modelcontextprotocol/sdk` のみ (devDependency)。ビルド不要で `node mcp/server.js` で動きます。

## 提供するツール

### 人が管理する知識 (`mcp/knowledge/project.json`)

| ツール | 用途 |
|---|---|
| `kingfisher_briefing` | **作業開始時に最初に呼ぶ。** 概要・実装済みと未実装の切り分け・注意事項・進め方の約束事・未解決の課題 |
| `kingfisher_domain_rules` | 独自仕様。画像処理・ファイル操作・ウィンドウ操作に触れる前に呼ぶ |
| `kingfisher_known_issues` | 未解決の課題と過去の不具合一覧。**「調査済みで正常だった箇所」が含まれるので同じ調査を繰り返さずに済む** |

### コードから毎回読み取る事実 (ライブ検査)

| ツール | 用途 |
|---|---|
| `kingfisher_store_api` | ストアのスライス構成と公開 API。`src/store/types.ts` を都度解析 |
| `kingfisher_tool_options_status` | ツールオプションが実際に塗りアルゴリズムへ届いているかを検査 |
| `kingfisher_dead_files` | どこからも import されていないファイル |
| `kingfisher_git_status` | ブランチ・未コミット・直近のコミット。`main` にいると警告 |
| `kingfisher_verify` | 型チェック・テスト・ビルドを実行 |
| `kingfisher_search` | `src` 配下を文脈付きで検索 |

古くなると害になる情報 (API 一覧・オプションの状態) は、あえて JSON に書かず
毎回コードから読み取ります。知識ファイルには「コードを読んでも分からないこと」だけを置きます。

## 知識の更新

仕様や方針が変わったら `mcp/knowledge/project.json` を編集してください。
サーバーのコードを触る必要はありません。

| セクション | 内容 |
|---|---|
| `criticalWarnings` | 踏むと事故になること (デプロイ前のハッシュ照合、main へ直接コミットしない等) |
| `domainRules` | 独自仕様。`location` に実装場所を書く |
| `openIssues` | 未解決の課題。`verifiedOk` に調査済みの箇所を残す |
| `knownFixedBugs` | 修正済みの不具合。症状から原因を引けるようにしておく |
| `workflow.conventions` | 進め方の約束事 |

## 動作確認

```bash
node mcp/server.js < /dev/null   # 何も出なければ起動している (stdio 待ち)
```

ツールを個別に叩きたい場合は、`initialize` → `notifications/initialized` → `tools/call`
の順に JSON-RPC を stdin へ流します。
