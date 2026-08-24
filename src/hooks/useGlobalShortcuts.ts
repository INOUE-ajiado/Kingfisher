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
        if (keyLower === 's') {
          e.preventDefault();
          e.stopPropagation();
          // ストアの保存処理を直接呼ぶ (DOM 上のボタン有無に依存しない)
          usePaintStore
            .getState()
            .saveActiveCell()
            .then((result) => {
              if (!result.ok) alert(result.message);
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

        // Ctrl + O (通常: ローカルファイルを開く → 変更: 参照画像として開くモーダル/ダイアログ)
        if (keyLower === 'o') {
          e.preventDefault();
          e.stopPropagation();
          usePaintStore.getState().setActiveModal('preferences');
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
      if (e.key === 'F1') {
        e.preventDefault();
        e.stopPropagation();
        window.open('/Kingfisher_Manual.html', '_blank');
        return;
      }

      // コマ送りキー (PageDown / ↓ / テンキー3)
      if (e.key === 'PageDown' || e.key === 'ArrowDown' || e.code === 'Numpad3') {
        e.preventDefault();
        nextCell();
        return;
      }

      // コマ戻しキー (PageUp / ↑ / テンキー9)
      if (e.key === 'PageUp' || e.key === 'ArrowUp' || e.code === 'Numpad9') {
        e.preventDefault();
        prevCell();
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
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
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
  ]);
};
