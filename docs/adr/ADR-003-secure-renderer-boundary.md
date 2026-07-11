# ADR-003: 안전한 Renderer 경계

## 상태

승인됨 — M0

## 배경

Renderer는 복잡한 UI와 향후 문서 내용을 다루므로 웹 콘텐츠 취약점이 OS 권한으로 이어지지 않아야 한다. 파일 시스템·shell·Electron IPC를 직접 노출하면 작은 UI 결함도 데스크톱 권한 침해로 확대될 수 있다.

## 결정

BrowserWindow는 context isolation, sandbox, web security를 활성화하고 Node integration을 비활성화한다. Preload는 `contextBridge`로 동결된 typed API만 노출한다. IPC 채널은 고정 상수이며 Main에서 Zod 검증을 적용한다. Production은 `suwol-pixel://app` custom protocol과 제한된 CSP를 사용한다.

## 이유

최소 권한 API는 Renderer가 침해되더라도 사용할 수 있는 기능을 제한한다. 고정 채널과 command allowlist는 임의 IPC 호출을 막는다. custom protocol은 `file://` 의존성을 제거하면서 내부 경로를 Main이 통제하게 한다.

## 결과

- Renderer에서 `process`, `require`, Node 모듈, raw `ipcRenderer`에 접근할 수 없다.
- 외부 URL은 사용자 정보가 없는 HTTPS만 OS 브라우저로 열 수 있다.
- 새 창, 외부 내비게이션, permission request는 기본 거부된다.
- 새 IPC 기능은 공유 계약, Main 검증, preload wrapper, 테스트를 함께 추가해야 한다.
- Production에서 DevTools와 외부 network connection이 기본 비활성화된다.

## 검토한 대안

- `nodeIntegration: true`: 구현은 빠르지만 Renderer 침해가 OS 권한으로 직결된다.
- raw `ipcRenderer` 노출: 유연하지만 허용되지 않은 채널 호출을 막기 어렵다.
- generic invoke API: 채널 allowlist가 Renderer 입력에 의존하게 되어 계약이 약해진다.
- Production `file://` 로드: 간단하지만 보안 origin과 리소스 정책을 명확히 통제하기 어렵다.
