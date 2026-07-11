# Recovery

Autosave는 dirty revision만 1.5초 debounce 후 v4 archive, strict metadata, 최대 128px 첫 Frame thumbnail로 분리 저장한다. Main은 `userData/recovery` 아래 revision별 archive/thumbnail을 먼저 atomic write하고 고정 metadata를 마지막에 교체한다. autosave 중 종료되면 이전 metadata가 이전 revision 파일을 계속 가리키며, 새 orphan은 다음 정상 저장에서 정리된다. 기존 고정 파일명 recovery도 계속 읽는다. Renderer는 경로나 generic filesystem API를 받지 않는다.

시작 시 list는 entry별로 검증한다. 손상 JSON은 `corrupt` item으로 격리되어 삭제할 수 있고 다른 문서의 복구를 막지 않는다. Thumbnail 누락은 UI fallback으로 처리하며 archive write 성공 여부와 분리한다.

복구는 archive를 새 dirty document로 열고 원본 handle을 재사용하거나 덮어쓰지 않는다. 사용자가 이후 저장 위치를 선택한다. 정상 저장·clean close는 해당 recovery를 삭제한다.
