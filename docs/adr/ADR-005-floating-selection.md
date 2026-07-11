# ADR-005: Floating selection

## Decision

Paste는 즉시 surface를 변경하지 않는다. Detached RGBA payload를 overlay에서 이동하고 Enter·저장·다른 편집 전에 한 patch로 확정하며 Escape는 history 없이 취소한다.
