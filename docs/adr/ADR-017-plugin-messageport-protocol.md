# ADR-017: MessagePort protocol

## 결정

Host와 Worker/panel은 version, UUID request ID, kind를 가진 구조화 MessagePort 메시지만 교환한다. 알 수 없는 메시지와 과대·중복·과속 요청은 거부한다.

## 결과

Raw IPC는 plugin에 노출되지 않으며 transferable pixel buffer를 효율적으로 전달한다.
