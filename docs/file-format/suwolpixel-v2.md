# `.suwolpixel` v2

v2는 v1 ZIP entry 구조와 binary RGBA image blob을 유지하면서 문서 palette를 추가한다. v2 reader는 호환성을 위해 유지되며 기본 writer와 recovery snapshot은 v3를 생성한다.

```json
{
  "schemaVersion": 2,
  "palette": {
    "colors": [
      { "id": "palette-uuid", "name": "Ink", "rgba": [20, 30, 40, 255] }
    ]
  }
}
```

- 최대 256 colors
- `id`는 안정적인 영구 식별자이며 array index가 아니다.
- `name`은 optional, `rgba`는 straight RGBA8이다.
- pixel은 palette index가 아니라 기존 RGBA8 image blob으로 유지한다.
- unknown field는 보존하지 않고 strict parser가 거부한다.
- manifest와 document version이 다르거나 future version이면 거부한다.

v1 migration은 나머지 model/image bytes를 그대로 유지하고 `schemaVersion: 2`, `palette: { colors: [] }`를 추가한다. 이어서 v2→v3 migration이 기본 Frame과 Layer별 Cel을 만든다. 로드 후 저장하면 v3가 된다. Archive path·size·entry·compression·symlink 검사는 v1과 동일하다.
