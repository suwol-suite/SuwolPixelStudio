# Pixel Rendering Architecture

## 렌더 경로

`@suwol/pixel-renderer`는 WebGL2를 우선 사용하고 초기화할 수 없으면 Canvas 2D로 전환한다. 두 경로 모두 CPU reference compositor가 만든 straight RGBA8 결과와 동일한 viewport를 사용한다.

WebGL2 texture는 `NEAREST` filtering과 clamp를 사용한다. 최초 load와 layer 구조 변경은 전체 texture를 올리고, stroke는 각 layer에서 changed rect만 읽어 CPU 합성한 tightly packed bytes를 `texSubImage2D`로 갱신한다. 따라서 포인터 이동 중 전체 layer 또는 전체 composite buffer를 복제하지 않는다. Shader는 alpha 위에 checkerboard를 합성한다.

Canvas 2D fallback은 `imageSmoothingEnabled = false`를 유지하고 offscreen image와 checkerboard를 nearest-neighbor로 확대한다. Changed rect만 `putImageData`로 교체하고 checkerboard는 문서 픽셀 수가 아니라 보이는 화면 tile 수에 비례해 그린다. fallback 활성화와 context loss는 Renderer logger의 진단 경계로 전달된다.

## Render scheduling

`PixelRenderer.requestRender()`는 requestAnimationFrame 한 개만 예약한다. Pixel update, viewport 변화, resize 또는 pointer input이 있을 때만 render하며 상시 loop를 돌지 않는다. React revision 변화로 WebGL context를 다시 만들지 않는다.

## Viewport

문서↔화면 변환은 `Viewport` 한 곳에서 수행한다. Zoom은 cursor 아래 document coordinate를 고정하고, 100% 이상에서는 선언된 integer 중심 단계를 사용한다. Fit은 smoothing 없이 fractional zoom을 허용한다.

Space+drag와 가운데 버튼은 pan만 변경하며 document revision을 변경하지 않는다. 확대 상태의 pointer는 `screenToPixel()`에서 integer document coordinate로 변환된다.

## Overlay

별도 2D overlay canvas가 high zoom pixel grid와 1px tool preview를 그린다. Overlay 변화는 document texture upload를 유발하지 않는다.
