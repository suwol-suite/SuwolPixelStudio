# ADR-001: Electron 데스크톱 런타임

## 상태

승인됨 — M0

## 배경

Suwol Pixel Studio는 네이티브 메뉴, 데스크톱 창 수명 주기, 패키징을 제공하면서 React 기반 작업 공간을 실행해야 한다. M0는 편집 기능보다 안전하고 재현 가능한 데스크톱 기반을 확립하는 단계다.

## 결정

Electron 43, Electron Forge 7.11.2, Vite 8.1.4, React 19와 strict TypeScript를 pnpm workspace로 구성한다. Main, preload, Renderer를 별도 진입점과 디렉터리로 유지하며 Forge makers로 현재 OS 배포 산출물을 생성한다.

## 이유

Electron은 요구된 네이티브 메뉴와 다중 OS 배포를 제공한다. Forge는 개발·패키징·maker 수명 주기를 통합하고, Vite는 세 진입점을 빠르고 명시적으로 번들링한다. pnpm workspace는 공유 계약과 Registry 패키지를 앱 코드에서 분리한다.

## 결과

- 앱은 웹 브라우저가 아니라 Electron 데스크톱 프로세스로 배포된다.
- Main과 Renderer의 실패·로그·테스트 경계가 분리된다.
- Electron과 배포 도구 업데이트는 호환성 검증과 exact version 변경이 필요하다.
- OS별 maker 산출물은 해당 OS에서 생성해야 한다.

## 검토한 대안

- 브라우저 전용 PWA: 네이티브 메뉴와 데스크톱 배포 요구를 충족하지 못한다.
- Tauri: M0 지정 기술 스택과 Electron API 요구에 맞지 않는다.
- 단일 패키지 구조: 초기에는 단순하지만 IPC 계약과 Registry 책임이 쉽게 섞인다.
