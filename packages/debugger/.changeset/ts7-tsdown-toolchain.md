---
'@apps-in-toss/debugger': patch
---

빌드 툴체인을 TypeScript 7.0과 tsdown 0.23.1로 올렸다. 빌드 도구만 바뀌었고 런타임 코드와 JS 산출물은 그대로다. 알려진 제약으로, TS 7.0.2는 함수에 붙인 expando 속성을 내부 d.ts에서 빠뜨린다(7.1에서 상류 수정). 공개 타입에는 해당되지 않는다.
