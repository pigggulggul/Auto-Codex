# Pet sprite contract

펫은 `public/pets/` 아래에 두며, 로더가 읽을 manifest 목록은 `public/pets/catalog.json`에서 관리합니다.

```text
public/pets/
  catalog.json
  agumon/
    pet.json
    spritesheet.webp
  another-pet/
    pet.json
    spritesheet.webp
```

`catalog.json`은 manifest 상대 경로만 포함합니다.

```json
{
  "pets": ["agumon/pet.json", "another-pet/pet.json"]
}
```

각 `pet.json`에는 최소한 `id`, `displayName`, `description`, `spritesheetPath`가 필요합니다. v2 스프라이트에는 `spriteVersionNumber: 2`를 지정합니다. 로더는 manifest 값만 믿지 않고 실제 이미지 크기도 검사합니다.

## Atlas 규격

| 버전 | 전체 크기 | 셀 | 행×열 |
|---|---:|---:|---:|
| v1 | 1536×1872 | 192×208 | 9×8 |
| v2 | 1536×2288 | 192×208 | 11×8 |

표준 행 매핑:

| 행 | 애니메이션 | UI 상태 |
|---:|---|---|
| 0 | idle | `idle`, `connecting` |
| 1 | run right | 오른쪽 이동·업무 인계 |
| 2 | run left | 왼쪽 이동·업무 인계 |
| 3 | waving | `success` |
| 4 | jumping | 예약된 축하 동작 |
| 5 | failed | `error` |
| 6 | waiting | `waitingApproval` |
| 7 | working | `editing`, `running` |
| 8 | review | `thinking`, `reading` |
| 9–10 | look directions | v2 전용 확장 동작 |

`SpritePet`은 각 행의 프레임별 duration을 사용하며 `prefers-reduced-motion`에서는 첫 프레임만 표시합니다. manifest나 이미지가 잘못된 펫은 제외되고, 사용할 수 있는 펫이 하나도 없으면 CSS 캐릭터로 대체됩니다.

캐릭터 애니메이션은 App Server의 실제 `turn/*`, `item/*`, 승인 이벤트에서 파생된 상태를 표시합니다. 화면상의 이동이나 장식 자체는 명령 실행의 증거로 취급하지 않습니다.
