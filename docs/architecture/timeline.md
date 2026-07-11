# Timeline

Timeline 행은 Layer, 열은 Frame이다. Layer header와 Frame header는 고정되고 본문 수직 스크롤은 Layer 이름 transform과 동기화된다. Frame header와 Cel은 키보드 접근 가능한 button이며 duration과 Tag range handle은 label이 있는 native input이다.

`timelineVisibleRange`가 scroll offset, viewport width, cell width, overscan으로 렌더 범위를 계산한다. 500 Frame 문서에서도 보이는 열과 여유 열만 React element로 만들며 앞뒤 폭은 spacer column으로 유지한다. Cel thumbnail은 image ID+revision 키의 최대 128개 LRU를 사용하므로 Linked Cel은 동일 thumbnail을 재사용한다.

단일, Shift 연속, Ctrl/Cmd 개별 Frame 선택과 같은 Layer Cel 연속 선택을 View State로 관리한다. drag reorder, 확대/축소, 컨텍스트 메뉴와 Escape 해제를 제공한다. 복잡한 다중 Cel 이동은 M3에서 지원하지 않는다.
