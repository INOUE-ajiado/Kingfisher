# Kingfisher グローバルショートカット・ブラウザ挙動オーバーライド仕様書

**Document Version:** 1.0 (Shortcut Manager Spec)
**Target Feature:** ブラウザのデフォルトショートカットを無効化し、アプリ独自の操作を優先させるイベント管理

---

## 1. 技術的な仕組み

JavaScriptの `KeyboardEvent` における **`e.preventDefault()`** と **`e.stopPropagation()`** を使用します。
ユーザーがキーを押した際、ブラウザがデフォルトの処理（保存ダイアログを出す等）を実行する前に、Kingfisherのグローバルイベントリスナーがその入力を検知し、デフォルトの挙動をキャンセル（無効化）して独自の関数を発火させます。

---

## 2. オーバーライド可能なキーと不可能なキーの分類

ブラウザの仕様（セキュリティおよびユーザビリティ保護）により、制御できるキーとできないキーが分かれます。

### 🟢 完全に上書き（無効化）可能なショートカット
Kingfisherの機能として安全に割り当て可能なものです。
*   `Ctrl + S` (通常: ページ保存 → 変更: **セルの上書き保存**)
*   `Ctrl + F` (通常: ページ内検索 → 変更: **未塗り漏れ点滅表示**)
*   `Ctrl + O` (通常: ファイルを開く → 変更: **参照画像として開く**)
*   `Ctrl + P` (通常: 印刷 → 変更: 鉛筆ツール等)
*   `Ctrl + Z` / `Ctrl + Y` (通常: 戻る/進む → 変更: **キャンバスのUndo/Redo**)
*   `Alt` キー単体押し (通常: ブラウザメニューにフォーカス → 変更: **スポイトツールへの一時切り替え**)

### 🔴 上書き不可能（ブラウザに奪われる）なショートカット
これらはOSやブラウザが強制的に処理するため、アプリ側には割り当てないよう設計する必要があります。
*   `Ctrl + W` (タブを閉じる)
*   `Ctrl + T` (新しいタブを開く)
*   `Ctrl + N` (新しいウィンドウを開く) ※アプリをPWA（プログレッシブウェブアプリ）としてインストールした場合は奪えることがあります。
*   `Ctrl + Tab` (タブの切り替え)
*   `F11` (フルスクリーン) ※JSからのフルスクリーンAPI呼び出しは可能ですが、キー自体の挙動はブラウザ依存です。

---

## 3. 実装ロジック (React カスタムフック例)

アプリケーションの最上位（ルートコンポーネント）で、`keydown` イベントを監視するカスタムフックを定義します。

```typescript
import { useEffect } from 'react';

export const useGlobalShortcuts = () => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. 入力フォーム（input, textarea）にフォーカスがある場合は、文字入力を邪魔しないように除外
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // 2. Ctrl + S (保存) の無効化と独自処理
      if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault(); // ブラウザの保存ダイアログを阻止！
        triggerCustomSave();
      }

      // 3. Ctrl + F (検索) の無効化と独自処理
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault(); // ブラウザの検索バーを阻止！
        toggleUnpaintedFlash();
      }
      
      // ... 他のショートカットも同様に定義
    };

    // 'keydown' イベントを document の最上位でキャッチする（キャプチャリングフェーズの使用も検討）
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, []);
};
```

---

## 4. ユーザー体験（UX）への配慮

*   **入力欄での例外処理**: 許容値（Tolerance）などを入力する数値ボックスやテキストエリアにフォーカスがあるときは、`Ctrl+C` (コピー) や `Ctrl+V` (ペースト) などのデフォルト挙動を妨害しないよう、イベントリスナー内でターゲット要素を判定して処理をスキップさせます（上記コード例の1の部分）。
