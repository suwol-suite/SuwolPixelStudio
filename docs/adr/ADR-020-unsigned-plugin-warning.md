# ADR-020: Unsigned plugin 경고

## 결정

M4에는 서명 PKI가 없으므로 모든 외부 package를 unsigned로 표시하고 설치 전 권한과 제작자 정보를 명시한다.

## 결과

서명된 것처럼 오인시키지 않는다. 향후 서명 검증은 manifest/설치 정책을 호환 확장한다.
