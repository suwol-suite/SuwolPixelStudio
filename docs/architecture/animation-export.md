# Animation export

Renderer는 저장과 분리된 immutable snapshot을 만든 뒤 RGBA `ArrayBuffer` 소유권을 Animation Export Worker로 transfer한다. Worker는 PNG Sequence, Sprite Sheet+JSON, GIF, APNG를 인코딩하고 progress/result/error message만 돌려준다. Cancel은 Worker를 terminate하며 문서와 saved revision은 변하지 않는다.

디렉터리 선택은 Main의 사용자 승인 dialog에서만 가능하다. Renderer는 실제 경로 대신 opaque `DirectoryHandle`을 받고, 결과는 평면 relative filename과 binary buffer batch로만 전달한다. Main은 파일명, 확장자, 중복, 수량, 전체 bytes를 검증하고 temp directory에서 fsync 후 backup/rename한다. 실패 시 이미 이동한 파일을 rollback하고 temp/backup을 정리한다.

GIF는 deterministic 256색 palette, 완전 투명 index 0, alpha threshold와 배경 합성을 사용한다. APNG는 8-bit RGBA, `acTL/fcTL/IDAT/fdAT`와 millisecond delay를 사용한다. Sprite Sheet JSON은 image, sheet size, Frame별 위치·크기·duration·ID, Tag를 기록한다.
