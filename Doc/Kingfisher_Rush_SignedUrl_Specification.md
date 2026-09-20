# Kingfisher ラッシュ 署名付き URL 方式 仕様書

**状態: 実装済み (2026-09-21)。** 本番へ反映し、下記のとおり動作を確認した。

実装した結果、設計から変わった点:

- 合言葉のハッシュと動画の在りかは、当初案の「サーバーだけが読む access 文書」ではなく
  **`rushShareSecrets/{共有ID}`** に置いた。発行と後始末はオペレーターができ、読み取りは誰にも許さない。
- 視聴者は `rushShares/{共有ID}/viewers/{視聴者ID}`。登録は関数だけが行い、視聴者にできるのは
  在席の合図 (`lastSeenAt`) の更新だけ。
- `sealRushVideo` を足した。アップロードの直後に呼び、動画のダウンロードトークンを外して
  `Cache-Control` を付ける (`getDownloadURL()` は呼ばない)。

確認できたこと (本番・一時データ):

| 確認 | 結果 |
|---|---|
| 署名付き URL で取得 | 200 |
| 署名を外した URL | 403 |
| 署名を書き換えた URL | 403 |
| 署名の寿命 | 30 分 |
| 旧方式のダウンロード URL (既存の動画) | 403 (封印済み) |
| 合言葉違い / 11 回目 | 拒否 / 10 分間の停止 |
| 停止後・期限切れ | 拒否 |
| 社内向けの関数を未ログインで呼ぶ | 拒否 |

---

## 1. 何のために作るか

外部共有 (`/watch/{共有ID}`) を止めても、**いったん配られた動画そのものは取り消せない**。
今は Firebase Storage の「ダウンロード URL」(`?alt=media&token=…`) をそのまま視聴者へ渡しており、
この URL は期限を持たず、規則 (storage.rules) も通らずに読めてしまう。

そのため現状はこうなっている。

| 操作 | 画面 | 動画そのもの |
|---|---|---|
| 共有を停止 | すぐ閉じる | **URL を控えていれば見られる** |
| 期限切れ | すぐ閉じる | **URL を控えていれば見られる** |
| ルームを削除 | 入れない | 動画は削除されるので見られない |

この設計の目的は、**停止・期限切れから決められた時間内に、動画そのものへも届かなくする**こと。

### 併せて直す弱点

- 合言葉の照合が手元 (ブラウザ) で行われているため、**試行回数を制限できない**。
- 動画の在りか (`videoUrl`) が、合言葉を知っている人のブラウザに渡っている。

---

## 2. 方式の比較

| 方式 | 取り消しの効き方 | 費用 | 実装の重さ | 採否 |
|---|---|---|---|---|
| **A. 署名付き URL を関数が発行** | 署名の寿命 (例 30 分) で切れる | 関数の呼び出しのみ。転送料は今と同じ | 中 | **採用** |
| B. 関数が動画を中継 (proxy) | 即座 | 転送料が関数側にも二重にかかる。Range 対応が面倒 | 大 | 不採用 |
| C. 認証付きの読み取り + Storage 規則 | 即座 | 規則からの Firestore 参照が毎回課金 | 大 | 不採用 (下記) |

**C を採らない理由:** `<video>` タグは Authorization ヘッダーを付けられない。
Firebase SDK の `getBlob()` は動画全体をメモリに読み込むため、数百 MB の素材では使えない。
つまり規則で守る経路では「流しながら見る」ができない。

**A の弱点:** 署名の寿命の間は、URL を控えた人が見られる。寿命を短くするほど取り消しは速くなるが、
再生中の差し替えが増える。**寿命 30 分**を既定とする (第 6 章)。

---

## 3. 全体像

### 今 (取り消せない)

```
ブラウザ ──合言葉のハッシュ──> Firestore (access 文書)
        <──── videoUrl (期限なし・規則も通らない) ────
        ───────────────> Storage (誰でも読める URL)
```

### これから

```
ブラウザ ──共有ID + 合言葉──> Cloud Functions (asia-northeast1)
                                  │ 1. 共有が生きているか (停止・期限)
                                  │ 2. 合言葉の照合 (ハッシュはサーバーだけが持つ)
                                  │ 3. 試行回数の制限
                                  │ 4. 視聴者として登録
                                  ▼
                            署名付き URL (30 分)
        <── url / 期限 / playbackId / viewerId ──
        ─── 署名付き URL ───> Storage (署名が切れたら読めない)
```

動画のオブジェクトからは**ダウンロードトークンを消す**。
これにより、署名付き URL 以外の経路では (社内・社外を問わず) 読めなくなる。

---

## 4. データの持ち方

### 4.1 Firestore

```
rushShares/{共有ID}                     ← 誰でも読める (URL を知っていれば)
    roomId, roomName, createdAt, expiresAt, revoked

rushShareSecrets/{共有ID}               ← 【新設】クライアントからは一切読めない
    passwordHash        … SHA-256(共有ID + 合言葉) の 16 進。関数だけが照合する
    videoPath           … Storage 上のパス (URL ではない)
    playbackId, createdByEmail, createdAt

rushShares/{共有ID}/viewers/{視聴者ID}   ← 【変更】鍵の下から移す
    name, joinedAt, lastSeenAt
    作成は関数のみ。視聴者は lastSeenAt の更新だけできる。一覧はオペレーターのみ

rushRooms/{ルームID}/access/{鍵}         ← 社内向け。今のまま (合言葉の鍵で守る)
    videoPath を正とし、videoUrl は置かない
```

**⚠️ `rushShareSecrets` はクライアントから読めないようにすること。**
ここが読めると、合言葉を知らなくても動画の在りかとハッシュが手に入る。

### 4.2 Storage

- 置き場所は今のまま `rushVideos/{ルームID}/{時刻}_{乱数}_{名前}`。
- 実データの確認 (2026-09-21): 本番にある 1 本は **1.5 GB / video/quicktime**、
  **ダウンロードトークンあり・Cache-Control なし**。下の移行 (第 9 章) の対象。
- **ダウンロードトークンを持たせない。** 今の実装は `getDownloadURL()` を呼ぶため必ずトークンが作られる。
  新方式ではアップロード後に関数がメタデータからトークンを消す (`firebaseStorageDownloadTokens` を空にする)。
- `storage.rules` の `allow get` は社内向けに残す (社員が SDK 経由で扱う余地を残すため)。
  署名付き URL は規則を通らないので、規則の緩さは外部公開には影響しない。

---

## 5. Cloud Functions の仕様

Node 22 / firebase-functions v2 / **asia-northeast1** / callable (`onCall`)。
関数は `functions/` にサブプロジェクトとして置く (ルートのビルドとは別)。

### 5.1 `joinRushShare` (未ログインから呼ばれる)

```
入力: { shareId, password, name }
出力: { viewerId, playbackId, roomName, videoUrl, expiresAt }
```

1. `rushShares/{shareId}` を読む。無い → `not-found` / 停止・期限切れ → `permission-denied` (理由を添える)
2. 試行回数を確認 (5.4)
3. `rushShareSecrets/{shareId}` の `passwordHash` と照合。違う → `permission-denied` + 失敗を記録
4. 視聴者名を整える (40 文字以内・空でない)。だめなら `invalid-argument`
5. `rushShares/{shareId}/viewers/{乱数ID}` を作る
6. `videoPath` に署名付き URL を発行して返す

### 5.2 `refreshRushShareVideoUrl` (未ログインから呼ばれる)

```
入力: { shareId, viewerId, password }
出力: { videoUrl, expiresAt }
```

再生中の URL の更新用。共有が生きていること・合言葉が合っていること・
その視聴者 ID が存在することを確かめてから、新しい署名付き URL を返す。
ついでに `lastSeenAt` も更新する (在席の合図を兼ねる)。

### 5.3 `getRushRoomVideoUrl` (社内。Google ログイン必須)

```
入力: { roomId, accessKey }
出力: { videoUrl, expiresAt }
```

1. 呼び出し元が `@ajiado.co.jp` かつメール確認済みか (`context.auth.token`)
2. `rushRooms/{roomId}/access/{accessKey}` が存在するか (= 合言葉を知っている)
3. その `videoPath` に署名付き URL を発行

### 5.4 試行回数の制限

```
rushShareAttempts/{共有ID}   ← クライアントからは読めない
    failures: [ 失敗した時刻… ]   (直近 10 件だけ残す)
```

直近 10 分の失敗が **10 回**を超えたら、その共有への照合を 10 分間断る (`resource-exhausted`)。
成功したら失敗の記録を消す。

> ⚠️ 共有ごとに数えること。IP ごとにすると、同じ事務所から複数人が見るときに巻き込まれる。

### 5.5 共通のエラー

| コード | 画面の文言 |
|---|---|
| `not-found` | この URL の共有は見つかりませんでした |
| `permission-denied` (revoked) | この共有は終了しました |
| `permission-denied` (expired) | この共有は有効期限が切れています |
| `permission-denied` (password) | パスワードが違います |
| `resource-exhausted` | 試行が多すぎます。10 分ほど待ってからお試しください |

---

## 6. 署名付き URL の寿命と差し替え

- **寿命: 30 分** (V4 署名, `action: 'read'`)。
- 残り **5 分**を切ったら、クライアントが `refreshRushShareVideoUrl` を呼んで差し替える。
- 差し替えの手順 (再生を途切れさせないため):
  1. 今の `currentTime` と再生中かどうかを控える
  2. `<video>` の `src` を新しい URL にする
  3. `loadedmetadata` を待って `currentTime` を戻し、再生中だったら再生し直す
  4. 直後に再生状態 (rushPlayback) へ追従させ、ずれを吸収する

> ⚠️ 差し替えは一瞬映像が止まる。再生中に毎回起きると目障りなので、寿命を 30 分より短くしないこと。

**取り消しの効き方:** 停止・期限切れの後、視聴者の画面は即座に閉じる (今と同じ)。
控えられた URL は**最長 30 分**で使えなくなる。ここが今回の目的。

---

## 7. クライアントの変更

| ファイル | 変更 |
|---|---|
| `src/engine/rushFunctions.ts` (新規) | `httpsCallable` の薄い包み。エラーコードを日本語へ直す |
| `src/components/guest/RushGuestWatch.tsx` | 合言葉の照合を関数へ。URL の更新タイマーを持つ |
| `src/engine/rushShareService.ts` | 発行時に `rushShareSecrets` を書く。`videoUrl` は持たない |
| `src/engine/rushService.ts` | 社内の再生も `getRushRoomVideoUrl` 経由に。アップロード後にトークンを消す |
| `src/components/panels/RushWindow.tsx` | 動画 URL の取得と更新を差し込む |
| `firestore.rules` | `rushShareSecrets` / `rushShareAttempts` は全面禁止。`viewers` を共有直下へ移す |

`computeShareAccessKey` (手元でのハッシュ計算) は、外部共有では使わなくなる。
社内ルームの鍵 (`computeRoomAccessKey`) は今のまま残す。

---

## 8. 権限とインフラ

1. **API の有効化**: `cloudfunctions`, `cloudbuild`, `artifactregistry`, `run`, `eventarc`, `iamcredentials`
2. **署名の権限**: 関数の実行サービスアカウントに `roles/iam.serviceAccountTokenCreator` を自分自身へ付与する
   (鍵ファイルを置かずに署名するため)。
   ```
   gcloud iam service-accounts add-iam-policy-binding <関数のSA> \
     --member="serviceAccount:<関数のSA>" --role="roles/iam.serviceAccountTokenCreator"
   ```
3. **firebase.json** に `functions` を追加。デプロイは
   `firebase deploy --only functions,firestore:rules,hosting`
4. **CSP**: `connect-src` に `https://asia-northeast1-kingfisher-paint-2026.cloudfunctions.net` を追加。
   署名付き URL は `storage.googleapis.com` から配られるため、`media-src` にも同ホストを追加する。

> ⚠️ 4 を忘れると、本番だけ動画が再生できない・関数を呼べない、という形で出る。開発サーバーでは気づけない。

---

## 9. 移行

今あるデータは「ルーム 1 件・動画 1 本」なので、作業は小さい。

1. 関数と規則を先に出す (まだ誰も使っていない状態で動作確認)
2. 既存のルームの `access` 文書に `videoPath` を入れる (URL から復元できる)
3. 既存の動画のダウンロードトークンを消し、あわせて `Cache-Control: private, max-age=3600` を付ける
4. 新しいクライアントを出す
5. 発行済みの外部共有はすべて停止する (古い URL を残さない)

> ⚠️ 3 と 4 の順序を逆にしないこと。先にクライアントだけ出すと、まだトークンのある動画が配られる。
> 3 を先にやると、古いクライアントを開いている人の再生が止まる。**4 を出す直前に 3 を行う。**

---

## 10. 失敗したときの振る舞い

| 状況 | 画面 |
|---|---|
| 関数が落ちている | 「配信サーバーに接続できません」+ 再試行ボタン |
| 署名の更新に失敗 | 再生は続ける (今の URL が切れるまで)。3 回失敗したら上の表示 |
| 試行回数の超過 | 待ち時間を出す |
| 動画が消えている | 「映像が見つかりません。担当者にご連絡ください」 |

---

## 11. 費用

- Cloud Functions (第 2 世代): 呼び出しは月 200 万回まで無料。1 回の視聴で数回〜十数回。**実質ゼロ**。
- 署名の発行自体は無料。
- Storage の転送料は今と変わらない。**ここが一番大きい**。
  転送料は約 12〜18 円/GB なので、本番にある 1.5 GB の素材なら **1 回の通し視聴で約 20〜27 円**。
  10 人で試写すれば 1 回あたり 200〜270 円になる。コマのサムネイル切り出しで裏からもう一度読むと倍。
  → Cache-Control を付けて二重取得を防ぐこと (新しいアップロードでは対応済み。既存の 1 本は移行で付ける)。
- Cloud Build / Artifact Registry の保管: デプロイのたびに数十 MB。月に数円程度。

---

## 12. 実装の段階とテスト

| 段階 | 内容 | 確認方法 |
|---|---|---|
| 1 | `functions/` の骨組み・署名の発行だけ | 関数エミュレータ (Java 不要) で URL を発行し、curl で 30 分後に切れることを確認 |
| 2 | `joinRushShare` / 試行回数の制限 | 一時データで、誤ったパスワード 11 回目が断られることを確認 |
| 3 | 視聴ページの差し替え | ヘッドレス Chrome で入室・視聴・URL の更新をまたいだ再生 |
| 4 | 社内の再生を関数経由に | オペレーター画面とサムネイル切り出しが動くこと |
| 5 | 移行 (第 9 章) | 古い URL が 30 分以内に 403 になることを実測 |

- 規則は今までどおり Rules のテスト API で確認する (`rushShareSecrets` が誰からも読めないこと)。
- **Firestore エミュレータは Java が要るため使えない。** 関数エミュレータは Node だけで動く。
  本番の Firestore を見る場合は、`gcloud auth application-default login` で資格情報が要る (人手が必要)。

---

## 13. 決めておくこと

| 項目 | 既定案 | 備考 |
|---|---|---|
| 署名の寿命 | 30 分 | 短くすると取り消しが速く、差し替えが増える |
| 社内の再生も関数経由にするか | する | しないと、動画のトークンを消せず取り消しが効かない |
| 合言葉の照合を関数へ移すか | 移す | 試行回数の制限に必要 |
| 視聴者の登録を関数へ移すか | 移す | 名前の重複や偽装を後から絞れる |

## 14. やらないこと

- 動画の再エンコードや HLS 化 (セグメントごとの署名)。手間に見合わない。
- 透かしの焼き込み (映像への埋め込み)。今の画面上の重ね表示で足りる。
- 視聴者ごとに動画を複製する方式。保管料と時間がかかる。
