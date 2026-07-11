# ADR-022: v3 optional plugin-data

## 결정

`.suwolpixel` schema version은 3을 유지하고 `plugin-data/<plugin-id>.json`을 선택 entry로 추가한다. 기존 v3 reader의 핵심 document 구조는 변하지 않으며 새 reader는 entry가 없어도 빈 namespace로 처리한다.

## 결과

설치되지 않은 plugin metadata도 손실 없이 보존한다. Namespace당 1MB, 전체 5MB이며 변경은 document transaction과 Undo 정책을 따른다. Preference는 별도 plugin storage에 둔다.
