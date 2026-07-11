# ADR-016: Capability 기반 async API

## 결정

모든 plugin 기능은 manifest grant에 연결된 async capability로 제공한다. 실제 문서·파일·저장소 객체는 전달하지 않는다.

## 결과

권한 회수, timeout, size/rate limit과 오류 격리를 중앙에서 적용할 수 있다.
