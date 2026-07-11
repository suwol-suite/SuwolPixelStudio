# `.suwolpixel` v1

## Container

MIME type은 `application/x-suwol-pixel-studio`이며 ZIP 컨테이너는 다음 entry를 가진다.

```text
mimetype
manifest.json
document.json
images/<image-id>.rgba
thumbnail.png
```

`mimetype`은 압축하지 않는다. `images/*.rgba`는 row-major straight RGBA8 bytes이며 투명 pixel은 zero RGBA다. `document.json`에는 pixel byte 배열을 넣지 않는다.

## Manifest

```json
{
  "format": "suwol-pixel-studio",
  "schemaVersion": 1,
  "createdWith": "0.1.0",
  "documentId": "document-uuid",
  "mimeType": "application/x-suwol-pixel-studio"
}
```

Parser는 manifest와 document를 Zod strict schema로 검증한다. v1 문서는 계속 읽을 수 있으며 loader가 메모리에서 v2의 빈 palette를 추가한 뒤 v3 Frame/Cel 구조로 순차 migration한다. v1 writer는 더 이상 기본 출력이 아니며 이 문서는 호환 명세로 유지한다.

## Archive limits

압축 해제 전에 EOCD와 central directory를 검사한다.

- 최대 256 entries
- 최대 archive/expanded bytes 320MB
- 1MB 이상 entry에서 최대 압축 비율 1000:1
- absolute path, `..`, backslash, drive prefix 거부
- duplicate entry와 POSIX symlink 거부
- 알려지지 않은 entry 거부
- 각 image blob이 metadata의 `width × height × 4`와 정확히 일치해야 함

검증이 하나라도 실패하면 document를 만들지 않는다.

## Write protocol

Renderer는 immutable snapshot을 비동기 ZIP으로 직렬화한다. Main은 opaque handle을 실제 path로 해석해 같은 디렉터리에 임시 파일을 쓰고 flush한다. 기존 파일은 backup으로 rename한 후 임시 파일을 target으로 교체한다. 실패하면 backup을 복원한다.

성공한 captured revision만 saved revision이 된다. PNG export는 이 protocol을 사용하지만 document saved revision은 변경하지 않는다.
