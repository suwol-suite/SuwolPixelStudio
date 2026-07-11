# ADR-021: Plugin Safe Mode

## 결정

설정과 `--disable-plugins`를 독립 입력으로 사용한다. Safe Mode는 외부 runtime/contribution만 끄고 Plugin Manager와 내장 편집·저장·Recovery는 유지한다.

## 결과

문제 plugin을 제거·비활성화할 복구 경로가 항상 남는다. Command-line Safe Mode는 실행 중 해제할 수 없다.
