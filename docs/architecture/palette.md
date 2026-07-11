# Palette

Palette는 v2 `PixelDocument`에 저장되는 RGBA metadata이며 indexed color가 아니다. 각 color는 stable UUID, optional name, RGBA tuple을 가진다. 최대 256개이고 duplicate RGBA는 허용하되 UI가 경고한다.

추가·삭제·이름·순서·기본 palette load는 Editor Command를 거쳐 Undo/Redo와 autosave에 포함된다. Swatch click은 foreground, context action은 background를 설정한다. Palette 변경은 surface나 WebGL texture를 갱신하지 않는다.

최근 색상은 문서 model이 아니라 검증된 global Preferences다. 사용자 색상 확정 때 중복 제거 후 최신 순서로 최대 12개를 localStorage에 저장한다.
