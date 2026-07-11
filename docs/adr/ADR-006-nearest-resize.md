# ADR-006: Deterministic nearest resize

## Decision

Sprite Resize는 browser canvas scaling 대신 순수 RGBA mapping `floor(destination * sourceSize / destinationSize)`를 사용한다. Alpha-zero pixel은 zero RGBA로 정규화한다.
