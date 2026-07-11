# ADR-004: Selection mask bitset

## Decision

M2 selection은 lazy `Uint8Array` bitset과 cached bounds/count로 표현한다. 복합 subtract/intersect 결과를 보존하고 객체-per-pixel allocation을 금지한다.
