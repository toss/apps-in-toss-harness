---
"@apps-in-toss/debugger": patch
---

대시보드와 `/attach` 페이지의 QR 이미지가 PNG를 받기 전부터 정사각형 크기(`width`·`height` 속성과 `aspect-ratio`)를 갖는다. QR이 새로 로딩되는 동안 이미지 크기를 몰라 화면이 잠깐 깨지던 증상이 없어진다.
