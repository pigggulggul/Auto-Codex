# 원본 좌표 조사

48px 격자와 원본 픽셀 좌표를 표시한 도식이다. JSON의 영역은 투명하지 않은 픽셀의 연결 요소로, 사물·벽·문을 구분하거나 가려진 경계를 복원하지 않는다. 작은 20픽셀 미만 영역은 제외된다. 원본 배치의 자동 판정이나 편집 가능 프리셋 완성의 증거가 아니다.

각 디자인의 `<이름>.tiles.json`은 첫 레이어의 48px 타일을 기존 Room Builder 타일셋과 RGBA 픽셀 단위로 대조한 결과다. `exact`는 픽셀이 동일한 후보가 있다는 뜻이며, 중복 후보 중 의미상 올바른 벽·바닥 분류나 충돌 처리가 확인됐다는 뜻은 아니다. `unresolved`는 일치하는 단일 타일을 찾지 못한 부분이다. 격자로 나누고 남는 가장자리 픽셀은 `partialRight`와 `partialBottom`으로 기록한다.

| 디자인 | 크기 | 도식 | 레이어 연결 영역 좌표 |
|---|---:|---|---|
| Condominium_Design_2 | 672×288 | [격자](Condominium_Design_2.svg) | [좌표](Condominium_Design_2.json) (1, 15개) |
| Condominium_Design | 672×528 | [격자](Condominium_Design.svg) | [좌표](Condominium_Design.json) (1, 10개) |
| Generic_Home_1 | 672×642 | [격자](Generic_Home_1.svg) | [좌표](Generic_Home_1.json) (1, 24개) |
| Gym_2 | 576×336 | [격자](Gym_2.svg) | [좌표](Gym_2.json) (1, 11개) |
| Gym | 912×720 | [격자](Gym.svg) | [좌표](Gym.json) (1, 46개) |
| Ice_Cream_Shop_Design | 576×480 | [격자](Ice_Cream_Shop_Design.svg) | [좌표](Ice_Cream_Shop_Design.json) (1, 16, 1개) |
| Japanese_Home_1 | 912×642 | [격자](Japanese_Home_1.svg) | [좌표](Japanese_Home_1.json) (1, 38개) |
| Museum_entrance | 768×1056 | [격자](Museum_entrance.svg) | [좌표](Museum_entrance.json) (1, 31개) |
| Museum_room_1 | 960×816 | [격자](Museum_room_1.svg) | [좌표](Museum_room_1.json) (1, 35개) |
| Museum_room_2 | 768×1584 | [격자](Museum_room_2.svg) | [좌표](Museum_room_2.json) (1, 40개) |
| Museum_room_3 | 816×1008 | [격자](Museum_room_3.svg) | [좌표](Museum_room_3.json) (1, 30개) |
| Museum_room_4 | 768×480 | [격자](Museum_room_4.svg) | [좌표](Museum_room_4.json) (1, 10개) |
| Shooting_Range_Design | 480×498 | [격자](Shooting_Range_Design.svg) | [좌표](Shooting_Range_Design.json) (1, 10개) |
| Tv_Studio_Design | 528×480 | [격자](Tv_Studio_Design.svg) | [좌표](Tv_Studio_Design.json) (1, 10개) |
