---
'@apps-in-toss/agent-plugin': patch
---

플러그인 표시 이름 `displayName: "Apps in Toss"`를 plugin.json과 루트
marketplace.json 엔트리에 추가했다. 짧은 식별자 `ait`(명령 네임스페이스
`/ait:<verb>`·설치 참조 `ait@apps-in-toss`)는 그대로 유지되므로 기존 설치본에
영향이 없고, 플러그인 목록·브라우저 표시만 사람이 알아보는 이름으로 바뀐다 —
공식 marketplace의 displayName 관행(Convex·Hostinger 등)과 동일 패턴.
