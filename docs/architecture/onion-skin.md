# Onion Skin

Onion Skin은 활성 Frame을 기준으로 wrap 없이 이전/다음 Frame을 선택한다. previous/next 수, opacity, tint와 `activeLayer | composite` source는 문서별 View State다.

CPU reference compositor는 Cel 위치 clipping, Cel opacity, Layer visibility/opacity, Linked image를 반영한다. tint와 거리별 opacity는 합성 단계에서 적용하고 원본 PixelSurface를 수정하지 않는다. PixelRenderer는 체크보드 위에 Onion 결과와 현재 Frame을 합성한 뒤 selection/tool/floating overlay와 grid를 그린다.

thumbnail/texture 재사용 키는 image ID와 revision이다. Linked Cel은 같은 image texture를 공유하고 LRU가 오래된 thumbnail을 회수한다. 설정 변경은 image bytes나 document revision을 무효화하지 않는다.
