# Raster tools

모든 raster algorithm은 `@suwol/editor-core`의 순수 함수다. UI preview와 commit이 동일한 point list를 사용한다.

- Line: integer Bresenham, Shift 0°/45°/90° constraint
- Rectangle: inclusive normalized drag rect, duplicate 없는 outline/filled scan
- Ellipse: pixel-center integer implicit equation과 4-neighbor boundary, anti-aliasing 없음
- Fill: non-recursive scanline span fill, RGBA tolerance 0, 4-connectivity

선택 mask와 canvas bounds는 write 전에 적용한다. Shape drag는 overlay만 갱신하고 pointer-up에서 최소 bounds patch 하나를 commit한다. 262,144 pixels를 넘는 unrestricted fill은 transferable RGBA snapshot을 Worker로 보내며 revision이 바뀌거나 Escape를 누르면 결과를 폐기한다.
