# Selections and transforms

`BitSelectionMask`는 캔버스 pixel당 1bit를 lazy allocation하며 exact bounds와 selected count를 cache한다. `replace`, `add`, `subtract`, `intersect`는 복합 결과를 사각형 하나로 축약하지 않는다. Selection은 문서별 view state이고 일반 저장·Undo 대상이 아니다.

Move는 원본 영역 snapshot 하나와 source/destination union patch를 사용한다. 원본 clear와 destination write는 같은 transaction이며 selection 좌표 callback도 transaction에 포함되어 Undo/Redo와 함께 이동한다. Drag 중에는 detached floating preview만 overlay에 표시한다.

Copy는 선택 밖 pixel을 transparent로 만든 tight RGBA payload를 내부 clipboard에 보존한다. OS 경계에는 PNG만 전달한다. Paste는 문서를 바꾸지 않는 `FloatingSelection`을 만들며 Enter, 저장 또는 다른 편집 시작 때 한 patch로 확정하고 Escape로 버린다.

Crop과 resize는 모든 pixel layer의 surface를 교체하는 한 command다. History 비용은 이전·새 surface byte 합으로 계산한다. Canvas Resize는 9 anchor offset과 RGBA fill을 사용하고 Sprite Resize는 `floor(destination * source / destinationSize)` nearest-neighbor mapping을 사용한다.
