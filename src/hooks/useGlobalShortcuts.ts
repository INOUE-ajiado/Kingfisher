import { useEffect } from 'react';
import { usePaintStore } from '../store/usePaintStore';

/**
 * ⚡ Kingfisher グローバルショートカット・ブラウザ挙動オーバーライドフック
 * (Doc/Kingfisher_Shortcut_Override_Specification.md 仕様書準拠)
 */
export const useGlobalShortcuts = () => {
  const {
    nextCell,
    prevCell,
    undo,
    redo,
    setActiveTool,
    setActivePaletteTab,
    toggleShowUnpaintedFlash,
    referenceCanvas,
    toggleReferenceFloating,
    setActiveModal,
    zoomIn,
    zoomOut,
    resetCanvasTransform,
    toggleShowRuler,
  } = usePaintStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. 入力フォーム (INPUT, TEXTAREA, SELECT, contentEditable) にフォーカスがある場合は、文字入力を邪魔しないように除外
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const keyLower = e.key.toLowerCase();

      // 🟢 2. Ctrl / Cmd 組み合わせのブラウザ挙動オーバーライド
      if (e.ctrlKey || e.metaKey) {
        // Ctrl + S (通常: ページ保存 → 変更: アクティブセルの上書き保存 / ブラウザ保存ダイアログ遮断)
        // ⚠️ Shift の有無で分岐すること。見ないと Ctrl+Shift+S まで
        //    上書き保存に流れ、保存先を聞かずに元ファイルを潰す。
        if (keyLower === 's') {
          e.preventDefault();
          e.stopPropagation();
          // ストアの保存処理を直接呼ぶ (DOM 上のボタン有無に依存しない)
          const store = usePaintStore.getState();
          const saving = e.shiftKey ? store.saveActiveCellAs() : store.saveActiveCell();
          saving.then((result) => {
            if (!result.ok && !result.cancelled) alert(result.message);
          });
          return;
        }

        // Ctrl + F (通常: ページ内検索 → 変更: 未塗り漏れ点滅表示 Unpainted Flash)
        if (keyLower === 'f') {
        e.preventDefault();
        e.stopPropagation();
        toggleShowUnpaintedFlash();
        return;
      }

      // ⚠️ Ctrl+O / Ctrl+Shift+O はここで扱わない。
      // メニューでは「参照画像として開く」「フォルダを開く」に割り当てられており、
      // どちらもファイル選択ダイアログを開く MenuBar 側の処理が要るため、そちらで拾う。
      // 以前はここで環境設定モーダルを開いており、しかも Shift を見ていなかったので
      // Ctrl+Shift+O (フォルダを開く) まで環境設定に流れていた。

      // Ctrl + K (環境設定 & 画像補正)
      if (keyLower === 'k') {
        e.preventDefault();
        e.stopPropagation();
        setActiveModal('preferences');
        return;
      }

      // Ctrl + H (全セル一括色置換)
      if (keyLower === 'h') {
        e.preventDefault();
        e.stopPropagation();
        setActiveModal('replaceColor');
        return;
      }

      // Ctrl + R (ルーラーの表示切替)
      if (keyLower === 'r') {
        e.preventDefault();
        e.stopPropagation();
        toggleShowRuler();
        return;
      }

      // Ctrl + 1 (等倍表示 100%)
      if (keyLower === '1') {
        e.preventDefault();
        e.stopPropagation();
        resetCanvasTransform();
        return;
      }

      // Ctrl + + / Ctrl + - (ズームイン / ズームアウト)
      // '+' は US 配列では Shift+'='、JIS 配列では Shift+';'。e.key で吸収する
      if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
        e.preventDefault();
        e.stopPropagation();
        zoomIn();
        return;
      }
      if (e.key === '-' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        e.stopPropagation();
        zoomOut();
        return;
      }

      // Ctrl + P (通常: 印刷ダイアログ → 変更: 鉛筆ツール)
      if (keyLower === 'p') {
        e.preventDefault();
        e.stopPropagation();
        setActiveTool('pencil');
        return;
      }

      // Ctrl + Z / Ctrl + Y (Undo / Redo)
      if (keyLower === 'z') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      if (keyLower === 'y') {
        e.preventDefault();
        e.stopPropagation();
        redo();
        return;
      }
      }

      // 🟢 3. ファンクションキー ＆ 単一キー操作のオーバーライド
      //
      // ⚠️ ここから下は修飾キーを押していないときだけ動かす。
      // 意図した Ctrl 組み合わせは上のブロックですべて return 済みなので、
      // ここに Ctrl/Alt/Cmd 付きで届くものは「割り当てていない組み合わせ」。
      // 以前は 1 / 2 / 3 に修飾キーの判定が無く、Ctrl+1 でブラウザのタブが
      // 切り替わると同時にパレットのタブまで変わっていた。
      const hasModifier = e.ctrlKey || e.altKey || e.metaKey;

      if (e.key === 'F1') {
      e.preventDefault();
      e.stopPropagation();
      window.open('/Kingfisher_Manual.html', '_blank');
      return;
      }

      if (hasModifier) return;

      // コマ送りキー (PageDown / ↓ / テンキー3)
      // ⚠️ どのキーで動いたかを DEBUG ログへ残す。2 画面連動の追跡でここが要る
      if (e.key === 'PageDown' || e.key === 'ArrowDown' || e.code === 'Numpad3') {
      e.preventDefault();
      nextCell(`キー ${e.key === 'ArrowDown' ? '↓' : e.key}`);
      return;
      }

      // コマ戻しキー (PageUp / ↑ / テンキー9)
      if (e.key === 'PageUp' || e.key === 'ArrowUp' || e.code === 'Numpad9') {
      e.preventDefault();
      prevCell(`キー ${e.key === 'ArrowUp' ? '↑' : e.key}`);
      return;
      }

      // パレットタブ切替 (1: Normal, 2: Shadow, 3: Highlight)
      if (e.key === '1') {
      setActivePaletteTab('normal');
      return;
      }
      if (e.key === '2') {
      setActivePaletteTab('shadow');
      return;
      }
      if (e.key === '3') {
      setActivePaletteTab('highlight');
      return;
      }

      // 単音ツールキー切替 (F, G, U, B, P, E, N, I, M, L, W, H, Z)
      if (keyLower === 'f') {
        setActiveTool('fill');
      } else if (keyLower === 'g') {
        setActiveTool('gradient');
      } else if (keyLower === 'u') {
        setActiveTool('closedFill');
      } else if (keyLower === 'b') {
        setActiveTool('brush');
      } else if (keyLower === 'p') {
        setActiveTool('pencil');
      } else if (keyLower === 'e') {
        setActiveTool('eraser');
      } else if (keyLower === 'n') {
        setActiveTool('noiseEraser');
      } else if (keyLower === 'i') {
        setActiveTool('eyedropper');
      } else if (keyLower === 'h') {
        setActiveTool('pan');
      } else if (keyLower === 'z') {
        setActiveTool('zoom');
      } else if (keyLower === 'm') {
        setActiveTool('pointer');
      } else if (keyLower === 'l') {
        setActiveTool('lasso');
      }
    };

    // 仕様書準拠: キャプチャリングフェーズ ({ capture: true }) で最上位で優先キャッチ
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [
    nextCell,
    prevCell,
    undo,
    redo,
    setActiveTool,
    setActivePaletteTab,
    toggleShowUnpaintedFlash,
    referenceCanvas,
    toggleReferenceFloating,
    setActiveModal,
    zoomIn,
    zoomOut,
    resetCanvasTransform,
    toggleShowRuler,
  ]);
};
