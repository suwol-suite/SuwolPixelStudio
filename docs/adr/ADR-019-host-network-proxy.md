# ADR-019: Host Network Proxy

## 결정

Plugin의 직접 network를 CSP와 bootstrap에서 막고 Main proxy만 허용한다. Exact hostname grant, scheme/header/size 제한, redirect 및 DNS private-IP 재검증을 적용한다.

## 결과

Localhost와 외부 domain 권한이 분리된다. Credential vault는 M4에 포함하지 않는다.
