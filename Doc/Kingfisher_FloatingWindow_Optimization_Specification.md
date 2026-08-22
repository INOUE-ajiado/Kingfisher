# Kingfisher フローティング（参照）ウィンドウ 高速ドラッグ実装仕様書

**Document Version:** 1.0 (Floating Window Optimization)
**Target Feature:** 参照ウィンドウのシームレスで軽量なドラッグ（移動）ロジック

---

## 1. 現状の課題と「重くなる」原因

Reactなどのモダンフレームワークでドラッグによるウィンドウ移動を実装した際、動作がカクつく（非効率になる）主な原因は以下の2点です。

*   **React Stateの過剰な再レンダリング**: `mousemove` イベントのたびに座標 (X, Y) を `useState` で更新すると、毎秒60回コンポーネントが再レンダリングされます。特にWebGPUキャンバスを含む重いウィンドウでは致命的なラグが発生します。
*   **Layout Thrashing (再計算)**: ウィンドウの移動にCSSの `top` や `left` プロパティを使用すると、ブラウザのレイアウト（リフロー）が毎回発生し、CPUに多大な負荷がかかります。

---

## 2. 最速・高効率を実現する技術アプローチ

Paintmanを超える軽快なUIを実現するため、以下の最新かつ最も負担の少ないロジックを採用します。

*   **アプローチ1: `useRef` によるReact Stateの完全バイパス**
    ドラッグ中のマウス座標の計算とDOMの更新には `useState` を一切使わず、`useRef` を用いて直接DOMノードのスタイルを書き換えます。再レンダリングを完全にゼロに抑え、ドロップ完了時にのみ状態を確定させます。
*   **アプローチ2: GPUコンポジトリの活用 (`translate3d`)**
    移動には `top` / `left` ではなく、`transform: translate3d(x, y, 0)` を使用します。CPUのレイアウト計算をスキップし、GPUハードウェアアクセラレーションによって直接描画されるため、60fpsの滑らかな移動が可能になります。
*   **アプローチ3: Pointer Events APIの採用**
    `mousemove` ではなく、最新標準の `pointermove` を使用します。マウスだけでなくペンタブレットの操作でも完全に同一の滑らかなロジックで動作します。

---

## 3. 推奨技術スタックとアーキテクチャ

重いDND（Drag & Drop）ライブラリを導入する必要はありません。アプリのパフォーマンスを極限まで高めるため、以下の軽量な構成を推奨します。

*   **カスタムフック**: Vanilla JSベースの独自フック (`useFastDraggable`)
*   **イベントキャプチャ**: `setPointerCapture` を活用し、高速でドラッグしてカーソルがウィンドウ外に外れても追従させる。
*   **CSS最適化**: `will-change: transform;` をウィンドウに付与し、ブラウザにGPUレイヤーの事前確保を指示する。

### 3.1. 実装ロジックの疑似コード (React)

```typescript
export function useFastDraggable(ref: React.RefObject<HTMLDivElement>) {
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const currentPos = useRef({ x: 0, y: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    startPos.current = { x: e.clientX - currentPos.current.x, y: e.clientY - currentPos.current.y };
    e.currentTarget.setPointerCapture(e.pointerId); // カーソル外れ防止
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current || !ref.current) return;
    // ⚠️ useStateを使わず、Refで直接DOMのtransformを更新（超高速）
    const x = e.clientX - startPos.current.x;
    const y = e.clientY - startPos.current.y;
    currentPos.current = { x, y };
    ref.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    isDragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    // ※ ここで初めてZustand等に最終座標を保存する
  };

  return { onPointerDown, onPointerMove, onPointerUp };
}
```

---

## 4. 期待される効果

このアーキテクチャを適用することで、ウィンドウ内にどれほど重いWebGPUキャンバスが配置されていても、ドラッグ操作自体はReactのライフサイクルから完全に切り離されます。「ネイティブOSのウィンドウを動かしているのと全く同じ感覚」のシームレスな操作性が実現します。
