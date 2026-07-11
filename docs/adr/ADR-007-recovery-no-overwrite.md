# ADR-007: Recovery never overwrites source

## Decision

Recovery snapshot은 userData에 별도 저장하고 복구 시 새 dirty document로 연다. 원본 경로를 자동 승인하거나 덮어쓰지 않으며 이후 저장은 사용자 dialog를 거친다.
