# ADR-018: Host 소유 plugin transaction

## 결정

Plugin write는 operation 목록으로 수집해 기존 Editor Core command batch에 적용한다. 성공한 전체 작업만 plugin metadata가 붙은 한 history 단계로 commit한다.

## 결과

오류·취소·runtime 종료 전 commit 실패는 rollback되고 plugin 제거 후에도 Undo/Redo가 안전하다.
