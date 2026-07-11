# Playback

Playback은 `requestAnimationFrame`의 monotonic timestamp 차이를 입력으로 사용한다. 순수 함수 `advancePlayback`은 duration 배열, index, 방향, 현재 Frame 내부 경과 시간, elapsed delta를 받아 Loop/Once/Ping-pong 결과를 계산한다. 테스트는 wall clock 대신 명시적 delta를 주입한다.

큰 delta는 여러 Frame을 순회하고 1시간으로 제한해 runaway 입력을 방지한다. Once는 끝에서 정지하고, Ping-pong은 양 끝 Frame을 중복 재생하지 않고 방향을 바꾼다. reverse Tag는 Frame range 자체를 뒤집고 ping-pong Tag는 scheduler mode를 덮어쓴다.

재생 중 active Frame만 View State에서 이동하며 문서 clone, revision 증가, Undo 기록은 없다. 편집 도구는 재생 중 비활성화된다.
