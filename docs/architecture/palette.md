# Palette

Palette는 v4 `PixelDocument`에 저장되는 stable entry 집합이다. RGBA 문서에서는 제작 metadata로 사용하고 indexed 문서에서는 각 pixel byte가 palette slot을 직접 참조한다. 각 color는 stable UUID, slot index, optional name, RGBA tuple을 가지며 최대 256개다.

추가·삭제·이름·순서·기본 palette load는 Editor Command를 거쳐 Undo/Redo와 autosave에 포함된다. Indexed 문서에서 slot 순서를 바꾸거나 제거할 때는 모든 image를 원자적으로 remap한다. Swatch click은 foreground, context action은 background를 설정한다.

최근 색상은 문서 model이 아니라 검증된 global Preferences다. 사용자 색상 확정 때 중복 제거 후 최신 순서로 최대 12개를 localStorage에 저장한다.
