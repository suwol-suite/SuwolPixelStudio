# ADR-015: Node 없는 Chromium plugin sandbox

## 결정

외부 plugin은 opaque custom origin frame이 생성한 Chromium Worker에서만 실행한다. Node `vm`, Utility Process와 Node Worker는 신뢰 경계로 사용하지 않는다. Panel은 host와 cross-origin인 `allow-scripts allow-same-origin` iframe이며 popup·form·top-navigation 권한은 없다.

## 결과

Plugin은 Node/Electron/host DOM에 접근할 수 없고 capability API만 사용한다. Native plugin은 M4 범위 밖이다.
