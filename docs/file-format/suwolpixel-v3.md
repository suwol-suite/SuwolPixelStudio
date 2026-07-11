# `.suwolpixel` v3

M4는 schema version을 올리지 않고 선택적 `plugin-data/<plugin-id>.json` entry를 추가한다. Entry가 없는 기존 v3는 그대로 유효하다. Namespace는 reverse-domain plugin ID이고 namespace당 1MB, 전체 5MB로 제한된다. 설치되지 않은 plugin의 JSON도 재저장 시 보존한다.

v3 writer는 ZIP container에 strict `manifest.json`, `document.json`, `images/<imageId>.rgba`, 선택적 `thumbnail.png`를 기록한다. RGBA bytes는 JSON에 넣지 않는다. archive entry 수·이름·압축 해제 크기·전체 크기·symlink와 path traversal을 검사한다.

`document.json`의 핵심 구조는 다음과 같다.

```text
schemaVersion: 3
canvas: { width, height }
layerOrder + layers
frameOrder + frames[id]: { id, durationMs }
cels[id]: { id, layerId, frameId, imageId, x, y, opacity }
celByLayerAndFrame["<layerId>::<frameId>"]: celId
images[id]: { id, width, height, revision }
tags[id]: { id, name, fromFrameId, toFrameId, color, playback }
palette, revision
```

저장된 image refCount는 신뢰하지 않는다. loader가 Cel을 기준으로 다시 계산하고 missing reference, duplicate Layer/Frame Cel, orphan image, 잘못된 Tag endpoint를 거부한다.

Migration은 반드시 v1→v2→v3 순서다. v1→v2는 빈 palette를 추가한다. v2→v3는 기존 Layer의 `imageId`를 첫 Frame의 Cel로 이동하고 기본 100ms Frame, 빈 Tag record, Cel index를 만든다. v1/v2 reader는 유지되지만 writer와 Recovery는 항상 v3를 생성한다.
