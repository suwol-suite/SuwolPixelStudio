# Animation model

M3 문서는 Frame, Cel, image를 정규화한다. `frameOrder`만 시간 순서를 결정하고 Frame은 stable ID와 `durationMs`를 가진다. Cel은 Layer ID, Frame ID, image ID, 위치, opacity를 참조하며 `celByLayerAndFrame`이 단일 Cel 조회를 보장한다.

Linked Cel은 같은 image ID를 공유한다. 편집은 공유 image를 변경하므로 모든 참조 Frame에 즉시 보인다. Unlink는 현재 bytes를 새 image로 복제한 뒤 해당 Cel만 새 ID로 교체한다. 모든 명령 뒤 실제 Cel 참조 수로 `refCount`를 다시 계산하고 0이 된 image/surface를 제거한다.

Frame/Cel/Tag 변경은 Command 또는 Transaction을 통해서만 이루어진다. 다중 Frame 복제·삭제·duration 변경은 한 history step이다. active Frame, Timeline 선택, playback, Onion Skin은 View State이며 archive revision과 Undo 대상이 아니다.

`validateDocumentIntegrity`는 최소 Frame 1개, order/record 일치, 존재하는 Layer·Frame·image 참조, 1 Cel per Layer/Frame, refCount 일치, Tag endpoint 유효성을 검사한다.
