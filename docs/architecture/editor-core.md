# Editor Core Architecture

## 책임

`@suwol/editor-core`는 React와 Electron에 의존하지 않는 순수 TypeScript 도메인 패키지다. `PixelDocument`는 ID 기반 metadata만 보유하고, 실제 RGBA bytes는 `ImageId → PixelSurface` map에 분리한다.

## 상태 경계

- Document State: canvas color mode, Layer tree/Frame/Cel/Tag, TileSet/Tilemap/Slice, palette, metadata, image refCount, revision
- Pixel Storage: 연속 `Uint8Array`를 소유하는 RGBA 또는 indexed `PixelSurface`와 별도 `Uint32` tilemap storage
- Workspace State: Renderer의 `WorkspaceStore`가 열린 session, 활성 문서, opaque file handle을 관리
- View State: 문서별 viewport, tool, active layer, foreground/background color, selection/floating selection
- Preferences: 검증된 settings schema, 전역 최근 색상과 localStorage

React에는 document id, revision, layer metadata와 dirty 상태만 전달한다. 전체 pixel buffer는 React state에 들어가지 않는다.

## PixelSurface

좌표 원점은 왼쪽 위이며 rect는 half-open 범위다. Point write는 캔버스 밖에서 무시되고 region 연산은 surface bounds로 clip된다. Region input byte 길이는 clip 전 rect 크기로 검증한다. Alpha가 0인 pixel은 `(0,0,0,0)`으로 정규화된다.

`getBytes()`와 `clone()`은 복사본을 반환한다. 단일 pixel 변경은 내부 연속 buffer의 4 bytes만 바꾸며 전체 surface를 복사하지 않는다.

## Command와 History

모든 문서 mutation은 `EditorCommand` 또는 진행 중인 `StrokeTransaction`을 통한다. Stroke는 pointer-down에서 시작해 Bresenham으로 point를 보간하고, 같은 pixel을 여러 번 방문해도 최초 before RGBA만 기록한다. Commit 시 changed bounds 한 개의 `PixelPatch`로 확정한다.

History는 execute/undo/redo마다 monotonic document revision을 증가시킨다. Undo 후 새 command는 redo branch를 제거한다. Patch와 구조 command의 estimated bytes 합이 256MB를 넘으면 오래된 undo entry부터 제거한다.

`TransactionCommand`는 하위 command 실행 중 실패하면 이미 적용한 command를 역순으로 undo한다. 진행 중 stroke는 cancel/escape에서 최초 bytes로 rollback되며 revision을 만들지 않는다.

M2 raster 도구는 최소 bounds `PixelPatchCommand`를 사용한다. Move는 pixel patch와 selection 좌표 callback을 한 transaction으로 묶고, Crop/Resize는 필요한 전체 surface 교체 비용을 history budget에 반영한다. Palette mutation도 command를 사용하지만 canvas texture는 갱신하지 않는다.

## Dirty와 저장

`EditorSession`은 `savedRevision`을 별도로 가진다. 저장은 먼저 snapshot과 captured revision을 얻고, 파일 write가 성공한 뒤 captured revision만 saved로 표시한다. 직렬화·쓰기 중 새 edit가 생기면 현재 revision과 saved revision이 달라 dirty가 유지된다.
