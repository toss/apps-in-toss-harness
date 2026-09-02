# @apps-in-toss/agent-plugin

## 0.1.32

### Patch Changes

- 디자인 가이드 자산 폴백이 있는데도 시도되지 않던 문제를 고친다. 폴백 자체는 직전
  판에서 셸 블록으로 접어 지어내기를 없앴지만, 그 블록까지 **가는 길**은 여전히
  산문이었다 — Step 3이 `주입 실패(스크립트=못찾음)`를 찍고 "이때만 5-B 말미의 자산
  폴백 fence를 쓴다"고 적어 두면, 모델이 그 판정을 들고 Step 4·5를 지나 190줄 뒤의
  블록을 찾아가야 했다. 측정에서 다섯 run 중 둘이 그 길을 가지 않았다. 자산은 다섯
  샌드박스 전부 살아 있었으므로 시도만 했으면 성공했을 자리다. 둘 다 실패를 정직하게
  공시했으니 거짓 보고는 아니고, 잃은 것은 복구 기회뿐이다.

  같은 처리를 한 번 더 했다. 스크립트 경로 탐색·호출·재시도·자산 탐색·복사·entry
  배선·캐리어 append·최종 판정을 **한 블록**에 담고, Step 3에서 조건 없이 실행한다.
  판정을 낸 셸과 폴백을 실행하는 셸이 같은 프로세스라 건널 이동이 없다. 5-B는 실행을
  잃고 보고 절로만 남는다.

  설계를 검증하다 별개의 결함 둘이 같이 잡혔다.

  첫째, 후보 탐색이 우선순위를 지킨 적이 없다. `ls 후보1 후보2 … | head -1`은 `ls`가
  피연산자를 정렬하기 때문에 "실재하는 첫 후보"가 아니라 "이름이 사전순으로 앞서는
  후보"를 골랐다. 다섯 후보가 내용이 같아 지금까지 드러나지 않았을 뿐이다. `for` +
  `break`로 바꿔 순서를 실제로 지킨다.

  둘째, 성공 판정이 캐리어 마커 하나에 걸려 있었다. 정본 스크립트는 개별 항목이
  실패해도 마커를 붙이므로, `tokens=FAIL`로 끝난 프로젝트가 `있음`으로 닫혔다. 판정을
  마커 + 산출물 실재로 올렸고, 그래서 부분 실패가 이제 폴백으로 떨어져 온전한 자산
  사본으로 복구된다.

  Step 5의 `.gitignore` fence는 재판정을 버리고 순수 재인쇄가 된다. 그 자리의 마커
  재대조는 폴백이 fence 밖(5-B)에 있던 시절의 장치였는데, 폴백이 안으로 들어와 "밖에서
  회복" 경로가 사라졌다. 남겨 두면 이 fence는 `--tds` 여부를 몰라 블록과 같은 판정을
  재현하지 못하고, 마커만 보는 약한 대조가 블록이 정직하게 남긴 흔적을 지워 거짓 성공을
  만든다. 흔적 파일명은 `.gitignore`에 함께 넣어 실패한 프로젝트에 상태 파일이 커밋되지
  않게 했다.

  판정을 올린 김에 범위도 맞췄다. 종전 판정은 마커·가이드·CSS·아이콘만 봤는데, 아이콘은
  `icons.tsx` **또는** svg라 React 프로젝트에 낡은 svg 하나만 있어도 통과했고, entry 배선과
  `CLAUDE.md` 마커는 아무도 안 봤다. 그래서 스크립트가 `entry=FAIL`로 끝낸 프로젝트가
  `있음`으로 닫혀 토큰 CSS가 앱에 한 번도 로드되지 않은 채 남았다. 판정에 프로젝트 계열에
  맞는 아이콘·entry 배선·`CLAUDE.md` 마커를 더했고, 이제 그런 형상은 폴백이 그 자리에서
  채워 복구한다. entry 배선의 tsconfig 탐색 범위도 스크립트와 같게 맞췄다 — 블록만
  `tsconfig.json`·`tsconfig.app.json` 두 개를 보고 있어서 `tsconfig.web.json`을 쓰는
  프로젝트에서 배선이 조용히 빠졌다. `--no-tossface`의 sed가 아무것도 못 지웠는데
  `tossface=off`로 보고하던 것과, 0바이트 자산 디렉터리가 온전한 후보로 통과하던 것도
  함께 고쳤다.

  블록은 `{ … }` 그룹 한 겹으로 감쌌고 마지막 `fi`와 닫는 중괄호를 한 줄에 뒀다. 앞을
  자르든 뒤를 자르든, 첫 줄과 끝 줄을 함께 잘라도 문법 오류로 죽는다 — 85줄 전수 스윕에서
  파싱되는 진접두·진접미가 bash·zsh·dash 모두 0개다(종전 블록은 조용히 부분 실행되는
  접두가 있었다). 자산이 없는 세계에서는 흔적 파일 하나만 남기고 디렉터리조차 만들지
  않으며, 열한 가지 세계(스크립트·자산 유무, 부분 배포, 부분 성공, 옵트아웃, 경로 오치환,
  이미 주입됨)와 다섯 셸에서 판정이 일치한다.

- new-miniapp Step 3의 형상 가드 fence와 디자인 가이드 주입 블록을 하나로 합쳤다. 트립와이어 열 run에서 셋이 형상 fence·wf major·`ait` bin 세 서브체크를 정상 수행하고 네 번째인 주입 블록만 건너뛴 채 다음 Step으로 갔다 — 직전 판에서 자산 폴백을 블록 안으로 들여 "판정 → 폴백" 이동을 없앴는데, 실제로 남아 있던 이동은 그게 아니라 "Step 3 안에서 fence 하나를 더 실행하는 것"이었다. 고친 이동과 남아 있던 이동이 달랐다.

  실패한 세 run 전부 형상 fence는 바이트 동일하게 실행했다. 그래서 이번에는 이동을 없애는 대신 fence 수를 줄였다 — 형상 확인과 디자인 가이드 주입이 한 fence 안에서 두 줄을 찍는다. 첫 줄이 형상 판정, 둘째 줄이 디자인 가이드 판정이다. Step 3에 남는 필수 셸 호출은 이 fence 하나뿐이고, 건너뛸 수 있는 자리가 없어졌다.

  형상 fence 끝에 붙어 있던 `디자인 가이드 마커:` 참고 신호도 함께 지웠다. 판정이 아니라 신호일 뿐이라는 해명을 세 문장이나 달고 있었는데, 실측에서 실패한 run들은 그 줄이 `없음`을 찍은 것을 보고도 주입 블록으로 가지 않았다 — 신호가 "확인했다"는 감각만 주고 행동은 안 만든 셈이다. 판정을 내는 fence가 같은 호출 안에 있으니 신호 자체가 불필요해졌다.

  Step 5의 `.gitignore` fence는 3분기가 됐다. 종전에는 흔적 파일(`.ait-design-guide-failed`)의 **부재**가 성공과 미실행 둘 다를 뜻해 미실행이 조용히 통과했다(실측: 한 run은 `✅ 디자인 가이드 상태 정상`을 지어냈고, 다른 run은 `./_timer/`처럼 경로를 잘못 짚은 자기 식 검사를 만들어 아무 출력도 안 나온 것을 정상으로 읽었다 — 둘 다 완료 보고에 디자인 가이드 줄이 아예 없었다). 이제 흔적 있음이면 실패 문장을, 흔적도 캐리어 마커도 없으면 "fence 미실행 — 지금 실행하라"를 찍는다. 흔적 검사가 1순위라 마커 검사가 실패를 성공으로 덮을 수 없다. `.gitignore` 부재 시 rc=1로 중단 신호를 내는 성질은 그대로다.

  검증: 병합 fence 86줄과 Step 5 fence 4줄 모두 bash·sh·dash·zsh·ksh 문법 통과, 진접두·진접미 절단 0/0, 첫 줄과 끝 줄 동시 절단·한 줄 평탄화 모두 문법 오류. 병합 fence는 6개 세계(스크립트 있음/없음 × 형상 정상/불일치, 경로 오치환, 옵트아웃)에서 기대 판정을 내고 재실행 2회가 `있음(이미 있음)`으로 멱등이며 마커·`@import` 중복이 0이다. 스크립트도 자산도 없는 세계에서는 산출물과 디렉터리를 하나도 만들지 않고 흔적 파일만 남긴다. Step 5 fence는 5개 상태(실패·미실행·성공·옵트아웃·`.gitignore` 부재)에서 기대 출력과 exit code를 낸다.

- new-miniapp Step 2의 scaffold fence를 표기에서 실행 가능한 명령으로 바꾼다. 종전
  fence는 `(--template <template> | --tds) [--sample iap,iaa]`라는 문법 표기였고, 그
  자리를 채우는 일은 모델 몫이었다. 입력 절에 기본값이 `react-ts`라고 적혀 있어도
  프롬프트에 템플릿 얘기가 없으면 모델은 그 인자를 통째로 지웠다 — `--inline`에서는
  `--template`이나 `--tds` 중 하나가 필수라 CLI가 `비대화형 실행에 필요한 값이
빠졌어요`로 즉시 죽고, 모델은 에러를 읽고 나서야 다시 넣었다. 다섯 셀 25 run 중
  19가 첫 호출에서 이 왕복을 했고, 그 재시도 뒤에 npm install을 백그라운드로 넘겼다가
  타임아웃으로 탈선한 run이 셋이다. 정상 경로 5 run 중에서도 셋이 같은 왕복을 했다.

  fence에 `--template react-ts`를 박아 템플릿 요청이 없으면 그대로 실행되게 했다.
  바꿔 넣는 자리는 셋으로 좁혀 적었다 — 다른 템플릿이면 이름 교체, `--tds`면
  `--template react-ts`를 통째로 교체, 샘플 요청이면 뒤에 덧붙임. 호출 규칙의 첫
  항목도 "`--template react-ts`가 이미 들어 있다"로 맞췄다. `--tds` 단독 규칙과 주입
  스크립트 인자 규칙은 그대로다.

  같은 측정에서 확인된 것을 함께 적어 둔다. 스크립트가 제자리에 있는 정상 경로에서는
  Step 2 체인이 5 run 전부 정본 바이트 그대로 디자인 가이드를 주입했고, Step 3 fence를
  한 번도 돌리지 않은 run까지 온전했다. 지난 두 판에서 고친 자산 폴백과 fence 병합은
  플러그인 설치가 깨져 스크립트가 없는 복구 경로에만 해당한다.

- new-miniapp SKILL.md가 `@apps-in-toss/web-framework` 버전이 정해지는 방식을 낡게
  서술하던 곳을 고친다. 종전 문장은 create-ait-app이 `package.json`에 `"latest"`
  리터럴을 써서 install 시점의 registry dist-tag가 버전을 정한다고 했고, 그 전제 위에
  "`@apps-in-toss/*`는 항상 최신을 쓴다"는 정책 서술과 major 확인 절의 복구 절차가
  얹혀 있었다. 현재 create-ait-app(0.2.5·0.2.6 dist 실측)은 자기 저장소의
  `.github/version-pins/package.json`에 고정한 정확 버전(`3.1.1`)을 빌드에 박아
  scaffold에 그대로 쓴다. 공개 `latest`가 `3.2.0`이어도 새 프로젝트는 `3.1.1`을 받고,
  핀은 create-ait-app이 새로 발행될 때만 움직인다.

  네 자리를 같은 사실로 맞췄다. 의존 절의 인터넷 항목, Step 2의 핀 정책 인용문, 호출
  규칙의 `package.json` 항목, Step 3의 wf major 확인 절. major 확인 게이트와 2.x 복구
  절차는 그대로 두되, 2.x가 들어오는 경로를 "종전 CLI가 내려온 경우와
  `create-ait-app@latest`가 구버전으로 해석되는 환경"으로 다시 적었고, 복구 절차의
  편집 대상도 `"latest"` 리터럴 한 형태에서 값 전체로 넓혔다. 사용자 보고 문안의
  원인 서술도 같이 바꿨다.

## 0.1.31

### Patch Changes

- Cursor 지원 후속 정리. setup-debugger의 frontmatter description이 `.mcp.json` 전용 서술로 남아 본문의 호스트 분기와 어긋나던 것을 고치고, Cursor 완료 안내가 환경 3 attach를 "아직 확인되지 않았다"로 흐리게 적어 debug skill의 adapter-note(Claude Code 전용)와 강도가 달랐던 것을 맞췄다. welcome의 station map은 콘솔 인가 줄이 Claude Code 전용 `/mcp`만 담고 있어 Cursor 경로를 함께 적었다. `A11/marketplace-entry-drift`는 규칙 자체는 변이 테스트로 발화가 확인됐지만 네거티브 테스트가 없어, 파싱 실패·이름 불일치 두 분기를 각각 강제하는 테스트를 더했다.
- `/ait:new` 5-B의 자산 폴백이 원본을 한 번도 읽지 않고 디자인 가이드를 지어내던
  문제를 고친다. 스크립트를 못 찾았을 때 쓰라고 둔 폴백은 "`design` skill의
  `assets/project/`를 열어 그대로 옮겨라"는 산문 지시였다. 측정에서 그 경로를 탄
  두 run이 둘 다 원본을 안 열고 창작했다 — 한 run은 확장자를 `tokens.ts`로 잘못
  짚은 `find`가 빈손이 되자 그대로 지어내 파일명·Tossface CDN URL·팔레트가 전부
  달랐는데 완료 보고에는 그 팔레트를 "토스 공식 색상"이라고 적었고, 다른 run은
  검색 시도 없이 바로 파일을 만들어 간격 토큰이 통째로 빠졌다. 둘 다 완료 보고에는
  디자인 가이드를 정상 포함으로 올렸다. 파일은 있지만 프로젝트가 따를 기준은 없는
  상태이고, 사용자는 그게 가짜라는 걸 알 방법이 없다.

  "지어내지 마라"는 문장은 이미 그 자리에 있었고 두 번 다 안 지켜졌다. 그래서
  문장을 더 쓰는 대신 지어낼 자리를 없앴다. 자산 위치 탐색·복사·entry 배선·캐리어
  append·최종 판정을 한 셸 블록에 담고, 옮기는 것은 `cp`가 넘긴 원본 바이트다.
  스크립트 경로를 fence로 접었던 것과 같은 처리를 자산 경로에도 한 것이다.

  자산이 없는 세계에서 정직하게 닫히는 것이 이 수정의 본체다. 다섯 후보 어디에도
  자산이 없으면 블록은 파일을 하나도 만들지 않고 실패 흔적만 남긴 채 닫힘 ③으로
  간다 — 그 분기 안에 파일을 쓰는 코드 자체가 없다. 자산은 찾았는데 일부만 옮겨진
  경우도 성공으로 새지 않게, 캐리어 마커를 전 항목 성공일 때만 붙인다. 마커가
  성공의 유일한 증인이라 흔적이 남고, 완료 블록 직전 재확인이 그 사실을 실어
  나른다. TDS 다이제스트 치환이 실패하면 원문을 그대로 붙이지 않고 실패로 닫는다.

  폴백 산출물은 스크립트를 직접 돌린 결과와 바이트가 같다 — 트리 전체를 대조해
  확인했다. entry 배선을 포함시켜, 폴백을 탄 프로젝트에서도 기본 CSS와 이모지
  서체가 엔트리에 실제로 걸린다. 아이콘 복사는 glob 대신 파일명 나열이라 zsh에서
  매치 0건일 때 죽지 않는다.

- 디자인 가이드 실패 흔적(`.ait-design-guide-failed`)이 낡은 채로 남아 거짓 실패를
  알리던 문제를 고친다. 흔적은 보완 fence가 남기고 같은 fence가 지우는데, 회복이
  fence 밖에서 일어나면(자산 폴백으로 직접 채우기 등) 아무도 지우지 않는다. 측정에서
  한 run이 폴백으로 가이드를 채우고도 흔적을 끝까지 남겨, 완료 블록 직전의 재확인이
  있지도 않은 실패를 찍었다. 모델은 그 신호를 무시하고 성공으로 보고했다 — 기계 신호와
  보고가 정면으로 어긋난 상태였다.

  원인은 흔적을 최종 상태로 취급한 것이다. 흔적이 뜻하는 건 "한 번은 실패했다"까지고,
  지금 가이드가 있는지는 `AGENTS.md`의 마커가 답한다.

  그래서 Step 5의 재확인이 흔적만 보지 않고 마커 실재를 대조한다. 실재하면 그 사이
  어떤 경로로든 회복된 것이므로 흔적을 지우고 아무것도 찍지 않고, 실재하지 않을 때만
  완료 블록에 넣을 문장을 찍는다. 흔적이 애초에 없는 성공·`--no-design-guide` 경로는
  전과 같이 무반응이고, `.gitignore` 부재 시 중단시키는 exit 1 신호도 그대로다.

- 디자인 가이드 주입에 실패했을 때 그 사실이 완료 보고에서 통째로 사라지는 경로를
  막는다. 측정에서 한 run이 fence의 `주입 실패(스크립트=못찾음)` 판정을 정확히 찍고도
  이후 13턴 동안 폴백을 시도하지 않았고, 최종 완료 보고 전문에 "디자인 가이드"라는
  말이 한 번도 나오지 않았다. 실패도 성공도 말하지 않고 항목만 빠진 것이라, 사용자는
  주입이 안 됐다는 사실 자체를 알 수 없다.

  원인은 판정과 인쇄 사이의 거리다. 실패는 Step 3에서 확정되는데 그것을 알리는 문장은
  열몇 턴 뒤 Step 6에서 나온다. "반드시 포함해야 한다"는 지시는 이미 있었고 지켜지지
  않았으므로, 문장을 강하게 고쳐 쓰는 방향은 이미 반증된 접근이다.

  그래서 기억에 맡기던 구간을 셸로 옮겼다. 보완 fence는 실패하면 프로젝트에
  `.ait-design-guide-failed` 흔적을 남기고 완료 블록에 넣을 문장을 같은 호출에서 함께
  인쇄하며, 성공하면 그 흔적을 지운다. 완료 블록 직전의 마지막 필수 셸 호출인 Step 5
  `.gitignore` fence가 그 흔적을 다시 읽어 같은 문장을 한 번 더 찍는다. Step 6은 몇 턴
  전 판정을 되짚는 대신 방금 나온 출력을 옮긴다.

  새 실행 단계는 늘지 않았다. 기존 fence에 세그먼트를 덧붙이는 방식이라 `--no-design-guide`
  (흔적 없음 → 줄 생략)와 성공(흔적 없음 → 정상 나열)의 기존 분기도 그대로다.
  `.gitignore` 부재 시 중단시키는 exit 1 신호도 보존된다.

- 디자인 가이드 보완 fence가 주입 스크립트 경로를 스스로 찾게 한다. 직전 라운드의
  fault-injection 측정에서 루프 누락은 닫혔지만, 그 자리에 **fence에 도달하기 전
  단계**의 결함 둘이 드러났다(각 2/5·1/5).

  첫째, 모델이 skill base directory를 기억으로 재구성하다 틀린 경로를 써서 스크립트를
  아예 못 찾는 사례가 나왔다 — 한 run은 `$HOME/.claude/skills/…`라는 그럴듯한 추측을,
  다른 run은 skill 이름 세그먼트가 빠진 경로를 썼다. "경로를 재계산하지 말고 표시된
  base directory를 그대로 옮겨라"는 규칙은 이미 있었지만 산문 규칙만으로는 지켜지지
  않았다. 그래서 보완 fence 앞에 `ls` 한 번으로 네 갈래(표시된 base directory ·
  `$CLAUDE_PLUGIN_ROOT` 2형태 · 프로젝트 scope · 사용자 scope)를 훑어 실재하는 경로를
  고르는 탐색을 넣었다. 찾지 못하면 `bash "${G:-/dev/null}"`로 무해하게 지나가 `&&`
  체인의 exit code 의미도 그대로다. 판정 줄은 원인을 함께 인쇄한다 —
  `주입 실패(스크립트=<경로>)`는 스크립트를 찾았으나 실패, `주입 실패(스크립트=못찾음)`은
  탐색 자체가 빈 경우로 자산 폴백 대상이다.

  둘째, 경로가 깨진 run이 "같은 경로를 쓰는 fence는 무의미하다"고 판단해 fence를
  건너뛰고, 원본 자산을 한 번도 읽지 않은 채 임의 팔레트로 파일 5종을 지어낸 뒤 완료
  보고에 "디자인 가이드: 포함"으로 적었다. Step 2에서 경로가 틀렸어도 fence는 반드시
  실행한다는 것(fence가 스스로 복구한다)을 명시하고, 자산 폴백은 원본을 실제로 `Read`한
  내용만 쓰며 원본을 못 읽으면 창작 대신 실패로 정직하게 닫으라는 금지를 넣었다.

- `--no-*` 플래그를 추측으로 붙이지 못하게 막는다. 측정에서 한 run이 "권한이나 외부
  SDK 호출 없이 순수 UI로 카운트다운만 동작하면 된다"는 과제를 받고, 아무도 요청하지
  않은 `--no-design-guide`를 첫 호출에 스스로 붙여 디자인 가이드 주입을 통째로
  건너뛰었다. 완료 보고에는 사실대로 적었으니 은폐는 아니지만, 사용자는 뺄 생각이
  없던 산출물을 잃었다.

  원인은 **앱의 런타임 동작 범위**를 말하는 표현("간단한", "순수 UI로", "최소한으로",
  "권한 없이")을 **스캐폴드 산출물 범위**를 줄이라는 지시로 확대 해석한 것이다.
  `new-miniapp` 플래그 절에 규칙을 명시했다 — 요청에 플래그의 대상(디자인 가이드 ·
  devtools · Tossface · 로컬 템플릿)이 이름으로 등장하지 않으면 붙이지 않고, 애매하면
  붙이지 않는 쪽이 기본값이다. 넣은 것은 나중에 뺄 수 있지만, 안 넣은 것은 사용자가
  알아채지 못하면 되돌릴 기회조차 없다.

## 0.1.30

### Patch Changes

- 디자인 가이드 보완 호출의 검증 루프를 닫는다. fault-injection 측정(주입
  스크립트의 첫 1회·첫 2회 호출을 무음 실패시키는 실험 2라운드)으로 안전망을
  실제 발화시켜 본 결과, "없음" 검출과 즉시 보완 호출은 설계대로 작동했지만 —
  보완 실패 후의 재확인·재시도를 산문 지시로 모델이 여러 턴에 걸쳐 조율하게
  하면 **재시도 단계가 확률적으로 누락되고**(라운드별 1/4·1/5), 그 run은 완료
  보고에서 실패 항목만 조용히 빼는 누락형 성공 위장으로 이어졌다.

  보강은 2겹이다: ① `new-miniapp` Step 3·5-B의 보완 fence를
  호출→재확인→실패 시 1회 재시도→최종 판정(`있음(보완됨)`/`주입 실패`)까지 한
  줄 셸 로직으로 접었다 — 루프가 셸 안에 있으므로 모델이 누락할 단계 자체가
  없다. ② 판정 닫힘을 세 가지(`있음` / 의도된 `없음` / 재시도 소진 후 실패
  명시)로 정의하고, 실패 닫힘은 완료 보고에 "디자인 가이드: 주입 실패" 줄을
  포함해야 성립한다 — 실패 항목을 완료 표에서 빼고 성공처럼 보고하는 것을
  명시적으로 금지했다(Step 6 인쇄 규칙에도 동일 반영).

## 0.1.29

### Patch Changes

- Cursor 어댑터를 추가했다. `.cursor-plugin/plugin.json`은 Claude Code manifest와
  같은 `shared/skills/`를 그대로 지목하되 `commands`는 담지 않는다 — Cursor에는
  `$ARGUMENTS` 치환이 없고 Commands 표면 자체가 Skills로 deprecated되는 중이며,
  스텁을 얹으면 플랫 `/new`가 다른 플러그인과 충돌할 위험이 있어서다. `mcpServers`도
  Cursor 형식(`{url, auth: {CLIENT_ID}}`)으로 담았다 — Claude Code manifest의
  `{type: "http", url, oauth: {clientId}}`와는 필드 모양이 다르다. 루트에는
  `.cursor-plugin/marketplace.json`을 새로 만들었다(source `packages/agent-plugin`).
  이걸로 종전 "Cursor는 번들 포맷이 없어 `install/cursor.sh`로 파일을 꽂는다"는
  계획은 폐기됐다 — Cursor 2.5가 1급 plugin 포맷을 갖췄기 때문이다.

  `scripts/sync-plugin-version.mjs`와 검증기 A5는 이제 두 manifest를 함께 다루고,
  새로 추가한 A11이 name·skills 경로·서버 집합·url·auth 값의 정합성과 `commands`
  미탑재를 강제한다. `setup-debugger`·`welcome` skill은 호스트별로 분기해
  Cursor에서는 `.cursor/mcp.json`을 쓰고 읽는다.

- `.ait` 산출물 확인이 현재 위치 추측에 기대지 않게 바꾼다. 반복 측정에서 빌드 후
  첫 추측이 자주 빗나가 `find`·`pwd` 방황이나 불필요한 재빌드로 번졌는데, 근본
  원인은 위치 서술이 아니라 **도구 셸의 cwd 지속성 차이**였다 — 호출 사이에 cwd가
  리셋되는 환경과 유지되는 환경이 둘 다 실측됐고, 어느 한쪽을 가정한 상대 경로가
  반대 환경에서 어긋난다.

  확인 명령을 밖/안 이분 추측 없이 두 후보를 함께 조회하는 한
  호출(`ls ./<package_name>/*.ait ./*.ait 2>/dev/null`)로 바꾸고(`test-on-device`
  §3·`new-miniapp` Step 6 안내), `new-miniapp` 호출 규칙의 "셸은 호출마다
  돌아온다" 단정을 "어느 쪽도 가정하지 마라 — `cd`를 안 붙이면 차이가 문제되지
  않고, 경로가 어긋나면 추측 대신 `pwd`부터"로 교정했다. "Shell cwd was reset"
  알림도 확정 신호가 아님을 명시했다.

- 형상 가드 fence 통합(0.1.28) 후 최종 검증 측정에서 남은 저빈도 이탈 2결을 막는다.

  첫째, fence 자체 조립 시 `grep` 세그먼트 누락(1/10 실측) — Step 3 형상 가드
  fence를 Step 2와 같은 이유로 **한 줄**(`;` 연결)로 바꾸고, 그대로 복사해 한 번의
  Bash 호출로 실행하라는 규칙을 명시했다. 검사 항목을 추려 자기 식으로 재조립하는
  경로 자체를 막는다.

  둘째, 탐지-후-미보완(1/10 실측 — fence가 `디자인 가이드 없음`을 정확히 찍고도
  보완 없이 후처리를 이어가 "완료"를 선언) — 보완 호출 fence를 "디자인 가이드
  실재" 판정 절에 인라인으로 박고, `없음` 확인 후 보완 없이 진행하는 것을 금지로
  명시했으며, 판정이 닫히기 전 Step 6 완료 블록 인쇄를 막는 게이트를 추가했다.
  근본 원인이던 분리형 재시도(스캐폴더 부분만 재실행해 주입이 조용히 빠지는
  경로)도 호출 규칙·재시도 선택지 문구에서 전체 한 줄 재실행으로 못박았다.

## 0.1.28

### Patch Changes

- `new-miniapp`의 디자인 가이드 주입이 일부 run에서 여전히 건너뛰어지는 문제를
  세 방향으로 보강했다. epoch 4 측정(6셀×5)에서 체인 직결 후에도 haiku가 10run 중
  5회 주입을 이탈하는 것이 관측됐는데, 이탈 경로가 셋으로 갈렸다 — 체인 조립 시
  `&&` 세그먼트 자체를 누락, 체인을 쪼갠 뒤 스크립트 경로를 `$PWD`/`dirname`으로
  재계산하다 실패, 스캐폴드가 백그라운드로 넘어간 뒤 주입 확인 누락.

  각각에 대응한다: Step 2 fence를 줄바꿈 연속(`\`) 없는 단일 행으로 바꾸고 세그먼트
  생략 금지·경로 재계산(`$PWD`·`dirname`·`find`) 금지를 호출 규칙에 명시했으며,
  Step 3(형상 가드) 말미에 `AGENTS.md` 마커 실재 확인을 추가해 부재 시 보완 호출을
  그 자리에서 실행한다 — 주입을 건너뛴 run들도 형상 가드는 전 run 실행했다는
  실측에 안전망을 앵커한 것이다. 주입 항목·멱등·플래그 효과는 동일하다.

- haiku 체인 가드 검증 측정에서 새로 관측된 실패 2결을 막는다.

  첫째, scaffold 위치 이탈 — 한 run이 Step 2 명령 앞에 `cd /tmp`를 스스로 붙여
  프로젝트를 작업 디렉터리 밖에 만들었고, 이후 후처리도 전부 그 밖 경로에서
  돌려 가드가 통과한 채 "완료"를 자칭했다(사용자 눈에는 결과물이 없는 실패).
  `new-miniapp` Step 2 호출 규칙에 현재 작업 디렉터리 실행 원칙을 명시했다 —
  명령 앞 `cd` 금지, 후처리 fence도 적힌 그대로(상대 경로) 실행, "Shell cwd was
  reset" 알림을 경고 신호로 해석하는 규칙까지.

  둘째, 번들 산출물 위치 방황 — 한 run이 빌드가 백그라운드로 전환된 사이 완료
  전에 `.ait`를 조기 탐색하다 못 찾자 재빌드 후 `pwd`/`ls` 11회를 반복했다(실제
  산출물은 처음부터 프로젝트 루트에 있었다). `ait build` 산출물이 프로젝트 루트의
  `<appName>.ait`라는 실측 사실을 `test-on-device` §3과 `new-miniapp` Step 6
  안내에 명시하고, 완료(exit code) 확인 전 조기 탐색·재빌드 금지를 함께 적었다.

- 앞선 결함 수정(scaffold 위치 이탈·번들 산출물 방황)의 검증 측정이 드러낸 잔여
  결을 마저 막는다.

  첫째, 디자인 가이드 실재 확인을 형상 가드의 **같은 fence 안으로** 통합했다 —
  별도 fence로 두면 한 run이 형상 가드 자체는 실행하면서 그 확인만 통째로 빼먹고
  "형상 검증 완료"로 통과하는 사례가 실측됐다(침묵 스킵 1/10). fence를 복사해
  실행하면 확인이 함께 따라오는 구조로 바꾸고, fail-soft 판정 규칙(중단 대상 아님,
  `--no-design-guide`면 `없음`이 정상)은 산문에 남겼다.

  둘째, `.ait` 산출물 위치 서술의 기준 디렉터리 모호성 제거 — "프로젝트 루트"를
  상위 작업 디렉터리로 오해해 첫 추측이 빗나가고 `find`로 자가수정하는 경미한
  탐색이 다수 run에 잔존했다(재빌드는 이미 소멸). "프로젝트 디렉터리 바로 아래,
  `package.json` 옆"으로 바꾸고 밖/안 각각의 확인 명령을 명시했다
  (`new-miniapp` Step 6 안내·`test-on-device` §3).

  셋째, 스캐폴더 명칭 혼동 방지 — 존재하지 않는 `npm create @apps-in-toss/app`
  변형을 지어내 404를 맞은 사례(1/10)에 대해 `create-ait-app` 단일 명칭 규칙을
  호출 규칙에 명시했다.

## 0.1.27

### Patch Changes

- `new-miniapp`의 디자인 가이드 주입 호출을 별도 후처리(5-B)에서 Step 2 스캐폴드
  명령 체인(`npx create-ait-app … && bash inject-project-guide.sh …`)으로 옮겼다.
  별도 단계로 두면 일부 run(특히 haiku)이 주입을 통째로 건너뛰는 것이 세 라운드
  측정에서 반복 관측됐는데(1~2/5), scaffold가 성공한 run은 반드시 주입까지
  실행하도록 명령 레벨에서 결합한 것이다. 주입 스크립트는 항상 exit 0(fail-soft)
  이라 성공 판정(exit code) 의미는 그대로다.

  5-B 절은 `5-B:` 요약 해석·보고 전용으로 줄었고, Step 2 출력에 요약 줄이 없을
  때만 같은 스크립트를 1회 보완 호출하는 안전망을 남겼다. 주입 항목·멱등·플래그
  효과(`--tds`/`--no-tossface`/`--no-design-guide`)는 동일하다.

- `setup-debugger`의 노출 발화("말로:" 예시·README 표)를 교체했다. 종전 문장("온디바이스
  디버깅용 ait-devtools MCP 서버를 이 프로젝트 .mcp.json에 등록해줘")은 기계적 JSON 편집
  요청으로 해석돼 모델이 Skill 라우팅을 통째로 건너뛰는 것이 라우팅 프로브에서 결정적으로
  재현됐고(0/5 — 자가 실행 시 틀린 `.mcp.json`을 임의 생성할 위험), 새 문장("나중에 폰
  디버깅할 수 있게 디버거 연결을 미리 세팅해줘")은 5/5로 `setup-debugger`에 닿는다. README
  ko/en·debug·test-on-device·welcome 5표면을 같은 커밋에서 갱신했다.

  description에도 반증 문구를 넣었다 — `.mcp.json` 등록처럼 들리는 기계적 요청도 손으로
  JSON을 쓰지 말고 이 skill로 오라는 것과, `debug-console` 패키지 설치는 `inject`라는 경계.
  인접 경계 케이스(inject 3 facet·debug·test-on-device) 15/15 무회귀 실측.

## 0.1.26

### Patch Changes

- 동작 변경: `design` skill이 판정만 하던 skill에서 **화면을 직접 만들고 고치는**
  skill이 됐다. `/ait:design`은 이제 화면이 없는 프로젝트에서 처음부터 화면 파일을
  쓰고, 기존 화면은 진단 목록으로 넘기지 않고 1층 하드 규칙 위반을 코드로 해소한다
  (기존 파일 편집은 `전체 적용`/`골라서`/`취소` 3택 승인, 새 파일 생성은 승인 불요).
  SKILL.md 본문을 모드 4종(새로 만든다·고친다·본다·등록 자산) + 실행 순서 0~7단계로
  재작성했고, 프로젝트 디자인 가이드 주입 단계(1-B)와 차단 항목 수정 루프(4단계, 같은
  항목 최대 2회)를 넣었다.

  `references/quality-bar.md`는 항목별 `등급`(차단·권장) 열을 갖는 4열 표로 재편했다 —
  1층 하드 규칙을 판정 항목으로 승격·신설해 G0-6·G1-6·G3-7·G3-8·G4-7·G7-7~G7-10·
  G8-6~G8-8을 더했고(G 번호 재부여·삭제 0건), 완료 판정 규칙을 "차단 등급이 남으면
  완료가 아니다"를 축으로 6개로 다시 썼다. 판정에서 멈춘다는 서술은 반대로 뒤집혔다.
  `references/screen-craft.md`는 `render-rules.md`·`build-mode.md`로 흡수되어 제거됐다.

  validator에 `A2/quality-bar-blocking-groups-mismatch` 가드를 추가했다 — 차단 항목을
  가진 그룹 집합을 검사기 상수·완료 판정 규칙 2의 부기 줄·표 등급 열 실측 셋으로
  3자 대조해, 등급을 한쪽만 고치는 조용한 드리프트를 막는다.

  `ux-writing`과의 경계는 "판정 vs 재작성"에서 "카피 문자열은 ux-writing, 그 외 화면
  코드는 design"으로 옮겨 갔다(G6 항목 번호·인용은 무변). README ko/en, `welcome`
  station map, 패키지 CLAUDE.md의 design 서술도 함께 갱신했다.

- design skill 재건 1단계 — 렌더 규칙·주입 자산 기반 구축. `references/render-rules.md`(3층
  구조: 1층 하드 규칙 1-1~1-10·2층 권장·3층 자유 + 기본 토큰 포인터)와
  `references/build-mode.md`(요청 무게 분류·리스크 점검·화면 명세),
  `references/project-guide.md`(프로젝트 디자인 가이드 주입 절차)를 신설하고, 프로젝트로
  복사되는 자산 세트 `assets/project/`(tokens.css·base.css·design-guide.md·
  memory-digest.md·아이콘 6종 SVG/TSX — 전부 자체 제작, stroke currentColor)를 동봉했다.
  validator에 가드 2종을 추가: `A2/render-rules-tier1-incomplete`(1층 10항 완전성),
  `A2/design-icon-asset-invalid`(아이콘 currentColor·SVG↔TSX 파리티). 이 단계는 자산과
  가드만 싣는다 — design skill 본문·품질 기준 재편은 후속 변경에서 이어진다.
- `new-miniapp` skill의 5-B(디자인 가이드 주입)를 SKILL.md에 박혀 있던 61줄 bash
  블록에서 동봉 스크립트(`design/scripts/inject-project-guide.sh`) 1회 호출로
  바꿨다. 실측에서 모델이 그 블록을 2~5회의 Bash 호출로 쪼개 실행해 스캐폴드
  세션 토큰의 15%가량을 여기서만 썼는데, 스크립트 호출은 결정적으로 1턴이다.

  주입 항목(토큰·기본 CSS·아이콘·`docs/design-guide.md`·`AGENTS.md`/`CLAUDE.md`
  캐리어)과 멱등 가드, fail-soft 동작(개별 실패가 나머지를 죽이지 않고 항상 완주),
  `5-B:` 요약 형식, `--tds`/`--no-tossface` 플래그 효과는 그대로다 — 옮긴 것은
  실행 위치뿐이다. SKILL.md 5-B 절도 함께 줄였다(800줄 → 732줄): 인라인 블록
  자리에 스크립트 호출 지시문과 플래그 매핑만 남기고, fail-soft 계약·완주 우선·
  마커 규칙 서술은 유지했다.

- `new-miniapp`의 디자인 가이드 주입(`5-B`)을 통합 명령 하나로 경량화했다. 종전에는
  하위 단계 8개(`5-B-0`~`5-B-7`)가 각각 "가드 → 실행"으로 서술돼 실행 에이전트가 매
  run 도구 호출을 14턴 썼고, 그게 스캐폴드 세션 토큰의 절반가량을 차지했다. 이제
  5-B는 verbatim bash 블록 하나다 — 첫 줄의 값 4개(`PROJ`·`SRC`·`TDS`·`NO_TOSSFACE`)만
  채워 한 번 실행하면 자산 경로 해석, `docs/design-guide.md`·`src/styles/` CSS 2종·
  아이콘(React/vanilla 분기) 복사, `AGENTS.md`/`CLAUDE.md` 캐리어, entry 배선까지
  끝나고 마지막 줄이 항목별 수행/스킵을 한 줄로 요약한다.

  동작 의미는 그대로다: 마커(`ait:design-guide v1`) 4상태(파일 없음·마커 없음
  append·v1 skip·타 버전 skip), 플래그 3종(`--no-design-guide`·`--no-tossface`·
  `--tds`)의 효과, 아이콘 계열 분기, entry 배선 우선순위(`src/index.css` 최상단
  `@import` → JS entry 첫 import → `index.html` `<link>`)와 `vite/client` 앰비언트
  타입 2자리 확인, 항목별 멱등 가드, 실패해도 scaffold를 중단하지 않는 완주 우선
  원칙이 모두 유지된다. 자산을 못 찾으면 요약이 `assets=UNRESOLVED`로 끝나고 그때만
  `Read`→`Write` 폴백을 쓴다.

  같은 이유로 SKILL.md 본문도 압축했다 — 스킬이 커지면 로드 이후 모든 턴의 토큰이
  함께 불어난다. 목적·입력·Step 0~4·Step 6·참고에서 중복 서술을 걷어내 978줄에서
  800줄로 줄였다(frontmatter·Step 번호 체계·seam 블록 형식은 무변경).
  `references/local-template.md`의 `L-3b`도 새 형태에 맞춰 갱신했다: 프리베이크
  검증은 같은 블록을 한 번 돌려 요약이 전 항목 `skip`으로 끝나는지 보는 것으로
  바뀌었고, `--no-tossface`는 블록의 `NO_TOSSFACE=1`이 프리베이크된 `base.css`에도
  그대로 적용된다.

- 동작 변경: `/ait:new`가 만든 프로젝트에 디자인 가이드가 기본으로 들어간다.
  `new-miniapp` skill에 후처리 단계 `5-B`를 신설해 `design` skill이 소유한
  `assets/project/`의 자산을 스캐폴드 직후 프로젝트로 복사한다 — 규칙 요약을 담은
  캐리어 문서(`AGENTS.md` 본문 + `CLAUDE.md`의 `@AGENTS.md` 한 줄, HTML 주석 마커
  `ait:design-guide v1`로 감싼다), `docs/design-guide.md`, `src/styles/tokens.css`·
  `base.css`, 아이콘 6종(React면 `icons.tsx`, vanilla면 `.svg`), 그리고 진입 CSS/JS
  entry 배선까지다. 이모지 서체 Tossface도 이 CSS로 함께 배선된다. 하위 단계마다
  `test -f` 선행 멱등 가드를 두고, 어떤 실패도 scaffold를 중단시키지 않는다(실패한
  항목만 산문 한 줄로 보고하고 계속 진행 — 나중에 `/ait:design`으로 채울 수 있다).

  옵트아웃 플래그 2개를 더했다: `--no-design-guide`(주입 전체 skip),
  `--no-tossface`(서체 배선만 제외). `--tds`는 CSS·아이콘을 넣지 않고 캐리어 문서만
  받는다 — 색·크기·아이콘은 TDS 컴포넌트의 것을 쓴다.

  `--local` 폴백 템플릿(`templates/react-vite`)은 같은 자산을 **프리베이크**로 담는다
  (정본에서 복사한 사본 — 재저작하지 않는다). `src/main.tsx`에 `styles/base.css`
  import를 넣고, `src/App.tsx`를 토큰 기반 화면으로 다시 썼다. 그 과정에서 이제
  존재하지 않는 명령 4개(`/ait:setup-bundle`·`/ait:register`·`/ait:deploy-key`·
  `/ait:deploy`)를 안내하던 문단을 `npm run build` → `/ait:test-on-device`로 바로잡았다.

  `inject`의 tossface facet에는 스캐폴드 기본 배선을 만났을 때의 분기를 더했다 —
  감지·보고만 하고 중복 배선하지 않으며, 오프라인 결정성이 필요하면 번들 포함 모드로
  전환한다. `new-miniapp` Step 6의 완료 안내도 함께 고쳤다: Tossface를 "기본 주입하지
  않는다"고 하던 서술이 사실과 반대가 되어 정정했고, `/ait:design` 줄이 등록 이미지
  자산만 가리키던 것을 화면 생성·개선까지 포함하도록 바꿨다. README ko/en의 여정 3과
  `/ait:new` 행도 같은 내용으로 갱신했다.

- 플러그인 표시 이름 `displayName: "Apps in Toss"`를 plugin.json과 루트
  marketplace.json 엔트리에 추가했다. 짧은 식별자 `ait`(명령 네임스페이스
  `/ait:<verb>`·설치 참조 `ait@apps-in-toss`)는 그대로 유지되므로 기존 설치본에
  영향이 없고, 플러그인 목록·브라우저 표시만 사람이 알아보는 이름으로 바뀐다 —
  공식 marketplace의 displayName 관행(Convex·Hostinger 등)과 동일 패턴.
- `welcome` skill이 진입 지도 인쇄에 더해 환경·연동 상태를 점검하도록 확장됐다
  (maintainer 지시) — git·Node/npm/npx 존재, cwd 형상(빈 디렉토리/기존
  프로젝트/git 저장소 여부), docs·콘솔 MCP 도구 노출, 프로젝트 `.mcp.json`의
  `ait-devtools` 배선 여부를 한 번의 읽기 전용 점검으로 확인하고, 결과에 따라
  `/ait:new`·`/ait:inject-devtools`·`/ait:setup-debugger`·`/mcp` 인가 등을
  권유·제안한다. 사용자가 동의하면 해당 전담 skill로 이어가되, `welcome` 자체는
  여전히 어떤 파일도 쓰지 않는다(mutation은 항상 전담 skill의 몫).

  기존 station map 블록과 자연어 예시 5종 블록은 내용 무변 — 루트 README ko/en의
  노출 예시와 결합돼 있어 문구를 바꾸지 않았다.

## 0.1.25

### Patch Changes

- 내부 운영 문서(`docs/`)·eval 런북(`.claude/skills/eval-suite-b`)을 repo 추적에서
  빼면서, skill·README·CLAUDE.md에 남아 있던 그 경로 참조를 "로컬 `docs/...`
  (repo 미포함 — maintainer-local)" 표기로 정리했다. 서술 내용 자체는 바뀌지
  않았다 — 문서가 더 이상 이 repo에 없다는 것만 명확히 했다.

  `docs/bug-report-guide.md`(소비자용 버그 리포트 가이드)는 공개 유지가 맞아
  `.github/bug-report-guide.md`로 옮기고, 이슈 템플릿의 링크도 새 경로로
  갱신했다.

- 소비자 대면 표면의 기본 패키지 매니저를 pnpm에서 npm/npx로 전환했다
  (maintainer 결정) — `new-miniapp`·`inject`·`debug`·`test-on-device`·`welcome`·
  `plan` skill과 `--local` 폴백 템플릿(`shared/templates/react-vite/`)의 설치·
  실행·빌드 안내가 전부 `npm install`/`npm run <script>`/`npx -y <pkg>` 형태로
  바뀌었다. 에이전트가 실행하는 npx는 항상 `-y`로 비대화형 호출한다.

  - `new-miniapp`: scaffold 정본 호출이 `npx -y create-ait-app@latest … --pm npm`이
    됐다. pnpm 부트스트랩(corepack enable → npm i -g pnpm) 단계와
    `pnpm-workspace.yaml` allowBuilds 게이트 단계는 삭제했다 — npm은
    postinstall을 기본 실행하므로 그 실패 모드 자체가 없다.
  - `inject`의 devtools/debug-console facet은 lockfile 감지 로직을 유지하되
    npm을 첫 번째(기본)로 재배열하고, 신호가 없을 때의 기본을 npm으로 명시했다.
  - `shared/templates/react-vite/package.json`의 `packageManager: "pnpm@11.17.0"`
    필드를 제거했다 — scaffold 산출물에 복사돼 corepack이 pnpm을 강제하는
    원인이었다. 같은 이유로 `shared/templates/react-vite/pnpm-workspace.yaml`
    (구 allowBuilds 게이트, `--local` 경로에서 scaffold 산출물로 그대로
    복사되던 파일)도 삭제했다.
  - monorepo 내부 개발 축(루트/패키지 scripts, `.githooks`, CI, README
    Contributing 절, CLAUDE.md의 monorepo 개발 지침)은 pnpm을 그대로 유지한다.

- 측정 인프라(`eval/`)를 repo 추적에서 빼고 `.gitignore`에 등록했다 —
  maintainer-local 산출물이라 공개 clone에는 없는 게 정상이다. 그에 맞춰:

  - `scripts/validate-plugin.mjs`의 A3(템플릿 + eval 동기화) 검사 중
    `promptfooconfig.yaml` 동기화 블록을 파일이 있을 때만 발화하도록 완화했다
    (부재 시 조용히 skip — hard-fail이던 `A3/promptfoo-missing`은 더 이상
    발생하지 않는다). 파일이 있으면 기존 skill 목록 동기화 검사는 그대로
    발화한다.
  - `package.json`의 `eval:promptfoo`·`eval:e2e` 스크립트와 vitest
    `eval/**/*.test.ts` include, `tsconfig.json`의 `eval/e2e/**/*.ts` include를
    제거했다.
  - `scripts/skill-load-probe.mjs`·`shared/skills/setup-debugger/SKILL.md`·
    루트 `CLAUDE.md`·이 패키지 `CLAUDE.md`·루트 `README.md`/`README.en.md`에
    남아 있던 `eval/` 경로 참조를 "로컬 `eval/...`(repo 미포함 —
    maintainer-local)" 표기로 정리했다(내부 운영 문서 비공개화 때와 같은
    관행). 서술 내용 자체는 바뀌지 않았다.

## 0.1.24

### Patch Changes

- fix: `ait build` 전제조건·`brand.icon` 실패 모드 서술을 CLI 소스에 맞게 정정 (#138)

  skill 문서가 CLI 동작을 두 군데서 잘못 서술하고 있었다. `@apps-in-toss/cli`
  `2.10.8`(2.x)·`3.0.5`(3.x) 소스를 직접 읽어 확인했다.

  **1. `ait build` 단독 실행** — "두 형상 모두 실패한다"는 서술은 3.x에만 맞다.

  - 3.x `buildArtifact()`는 이미 만들어진 `webBundleDir`(기본 `dist/`)를 포장만
    한다. 없으면 `웹 빌드 디렉토리(dist)가 존재하지 않습니다`로 `exit(1)`.
  - 2.x `WebBuildStrategy.ensurePrepared()`는 `<outdir>/web/index.html`이 없으면
    `<outdir>`를 지우고 `web.commands.build`를 **스스로 실행**한다. 즉 단독 실행이
    성립하고, 앞서 돌린 `vite build` 산출물은 오히려 버려진다.

  **2. `RELEASE_CHANNEL=dogfood ait build`** — 3.x에서는 형태 자체가 위험하다.
  어느 CLI도 `RELEASE_CHANNEL`을 읽지 않으므로 이 값은 웹 빌드가 소비한다. 그런데
  3.x `ait build`는 웹 빌드를 돌리지 않으므로 환경 변수가 번들에 닿을 경로가 없다.
  `RELEASE_CHANNEL=dogfood pnpm build`(3.x `build` = `vite build && ait build`),
  2.x 폴백은 `pnpm bundle:ait`로 바꿨다. `docs/design/three-environments-fidelity.md`가
  이미 쓰던 형태와 일치한다.

  **3. `brand.icon` 누락이 `ait build`를 실패시킨다** — 사실이 아니다. 3.x 스키마엔
  필드 자체가 없고(마이그레이션이 `brand`에서 `primaryColor` 외를 지운다), 2.x는
  스캐폴드 기본값이 `icon: ''`이라 빈 값으로 빌드가 통과한다. 같은 repo의
  `local-template.md`가 이미 올바른(런타임 실패, harness#90 미재현) 서술을 갖고
  있었는데 같은 파일 안 다른 줄이 반대로 적혀 있었다.

  수정: `debug`·`test-on-device`·`inject`(+`references/debug-console.md`)·
  `new-miniapp/references/local-template.md`.

- 카피 재작성 조력 skill 신설 + design skill 사전 제작 조력 reference + Tossface
  이모지 서체 번들 배선 3건을 함께 반영한다.

  **1. `ux-writing` skill (신설, 8→9 skill).** `design` skill의 quality bar
  G6(카피) 판정이 "조정 필요"로 남긴 문구를 실제 재작성으로 이어받는 조력
  skill이다. 판정 기준은 새로 정의하지 않고 `design`의
  `references/quality-bar.md`를 그대로 참조하며, 화면 문구 전수 수집 → 축별
  점검 → before/after 제안 → 사용자 확인 후 적용 → `design` G6 재판정 hand-off
  순서를 따른다. 확인 없이 문자열을 일괄 치환하지 않는다. command stub은
  만들지 않는다 — skill 디렉터리 이름과 겹치는 stub은 harness#134가 잡는
  문제라, `/ait:ux-writing`은 skill 자체로 슬래시 목록에 오른다.

  **2. `design` skill — 사전 제작 조력 reference 신설.** 화면이 아직 없는
  처음부터-설계 단계를 위해 `references/screen-craft.md`를 추가했다 — quality
  bar(G0~G8)를 사후 채점이 아니라 사전 체크리스트로 뒤집어 제작 순서로 정리한
  문서다. 이미 화면 코드가 있는 기존 프로젝트는 이 절을 건너뛴다. G6(카피)
  축 설명에는 재작성이 `/ait:ux-writing`으로 이어진다는 포인터를 달았다.

  **3. Tossface 번들 배선 (`inject` skill 3번째 facet, 3→4 command stub).**
  `/ait:inject-tossface`가 신설되며 `inject` skill에 devtools·debug-console에
  이은 3번째 facet이 생겼다. 이모지를 토스페이스 글리프로 렌더하는 두 가지
  모드 — CDN 링크(번들 증가 0, 네트워크·CDN 도달성 의존 — 토스 앱 webview
  안에서의 도달성은 미실측) 또는 subset 번들 포함(결정적, 담는 subset당 약
  520KB~1.9MB 증가) — 의 대가를 먼저 계산해 사용자에게 보여주고 고르게 한다.
  공식 배포(`toss/tossface`)의 `dist/tossface.css`는 `unicode-range`로 나뉜
  12개 subset(`TossFaceFontMac-00`~`-11`)의 모음이라는 사실이 번들 모드의
  용량 절감 열쇠다 — 앱이 실제로 쓰는 이모지가 속한 subset만 골라 담으면
  원본을 수정하지 않고도 전량(12개, 약 13.2MB)보다 적게 담을 수 있다.
  재-subsetting·포맷 변환은 라이선스의 '수정본' 정의(포맷 변경 포함)와 허가
  조건(수정본 제한·이름 사용 제한)에 걸려 하지 않는다. 번들 모드는 라이선스가 요구하는 저작권
  고지 + 라이선스 전문 동봉을 절차에 명시했다. `design` skill의 서체 대안
  절(이모지 서체는 본문 서체 금지의 예외)도 12-subset·용량·번들 시 라이선스
  요건과 `/ait:inject-tossface` 포인터로 보강했고, `new-miniapp` scaffold
  완료 안내에도 같은 포인터를 한 줄 추가했다(scaffold가 폰트를 기본
  주입하지는 않는다 — 용량 대가가 앱마다 달라서다).

  라우팅 게이트(`eval/promptfoo/promptfooconfig.yaml`, `eval/routing/cases.tsv`)에
  `ux-writing`·`inject`(tossface facet) positive 케이스를 각각 추가했다
  (13→14 라우팅 케이스). `EXPECTED_CMD_TO_SKILL`·`MERGED_SECONDARY_FACET_CMDS`에
  `inject-tossface.md` 항목을 추가했다.

- feat(new-miniapp): create-ait-app 버전 정책을 `@latest`로 전환 + Step 2/4 재설계

  maintainer 결정(2026-08-10)으로 `create-ait-app`·`@apps-in-toss/*`는 명시 핀 없이
  항상 최신을 쓴다. 핀(`@0.2.1`)이 지탱하던 "산출물 형상이 결정적"이라는 전제는
  매 run 도는 형상 가드로 대체했다.

  - **Step 2 재설계** — scaffold/install 2명령 분리를 폐기하고 단일 명령으로
    되돌렸다. `--skip-install`이 0.2.3에서 제거돼(지정 시 `알 수 없는 옵션이에요`로
    즉사, 산출물 0 — 실측 2026-08-10) 분리 설계 자체가 성립하지 않는다. CLI가
    scaffold → 내부 install → `ait init`(devtools·번들 설정 배선)까지 수행한다.
  - **§2-1 재정의** — 트리거를 "CLI 내부 install 실패 잔여 상태"로 바꿨다.
    `ait init` 단계의 실패는 CLI가 삼키고 exit 0으로 끝내므로(0.2.3 dist 실측),
    scaffold 직후 **항상** `pnpm --dir ./<name> install`로 설치 상태를 수렴시키고
    필요하면 `ait init`을 재실행한다. allowBuilds 절차 자체는 유지.
  - **형상 가드 교체** — 0.2.3은 `package.json`의 `createAitApp` 메타데이터를 더
    이상 쓰지 않는다(`add-sample`이 발견하면 오히려 제거하고, 프로젝트 판정을
    `@apps-in-toss/web-framework` 의존성 또는 `apps-in-toss.config.ts` 존재로 한다).
    그 필드를 보던 가드는 0.2.3 산출물에서 통과할 수 없으므로, 판정을
    `apps-in-toss.config.ts` + wf 의존성 + `ait build`를 포함한 `build` 스크립트로
    바꿨다. wf major 확인·`ait` bin 확인은 그대로 유지.
  - **Step 4 축소** — devtools 배선은 CLI가 하므로 skill은 devDependency와 번들러
    설정의 unplugin을 **확인**하고, 안 돼 있을 때만 기존 수동 배선을 폴백으로
    실행한다. `--no-devtools`는 "설치 제외"가 아니라 **배선 해제**(devDependency
    제거 + 설정에서 plugin 제거)로 재정의했다 — CLI에 배선을 끄는 플래그가 없다.
  - **`--tds` 우회 소실을 정직하게 반영** — scaffold 단계 install이 실패하면 CLI가
    생성 디렉터리를 롤백하고, 이를 피하던 `--skip-install`이 없어져 in-place 복구가
    불가능하다. 재시도·`--local` 폴백만 남는다.

  eval 슈트 B: `driver.test.ts` fixture의 scaffold 명령을 새 정본 형태로 갱신했다.
  버전 정책 변경은 `fixedInputs` 변경이라 `baseline.json`은 건드리지 않는다(새
  epoch, 재측정은 별도 PR — 재측정 시 해석된 create-ait-app 버전을 함께 기록한다).

- feat(new-miniapp): create-ait-app 핀을 `0.1.3` → `0.2.1`로 이관 (#68)

  공개 registry 기준 `create-ait-app` latest가 0.2.1(0.1.3 대비 대규모 재작성 —
  `granite.config.ts`→`apps-in-toss.config.ts`, base가 순정 create-vite로 전환,
  `granite` bin 폐지·`ait` bin만 제공)로 확인되어 핀을 올렸다. 후처리 0(형상 가드)은
  유지하되 판정을 반전(`apps-in-toss.config.ts` + `package.json`의 `createAitApp`
  메타데이터 존재 확인)했고, 0.1.x 전제였던 후처리 3종을 정리했다:

  - 후처리 A(`granite` bin 검증 → web-framework 2.x 강등) **삭제** — 0.2.x 산출물엔
    애초에 `granite` bin이 없어 그대로 두면 정본 3.x 산출물을 오탐으로 강등하는
    활성 버그였다. `node_modules/.bin/ait` 존재 확인 한 줄로 대체.
  - 후처리 C-1(`brand.icon` 안내 주석) **삭제** — 0.2.x 설정 스키마에 해당 필드 없음.
  - 후처리 C-2(`.gitignore` 생성) **축소** — 0.2.x는 `.gitignore`가 이미 존재하므로
    `*.ait` 한 줄만 없을 때 append(파일 자체가 없으면 만들지 않고 스킵 — 실측으로
    드러난 `test -f` 가드 누락 버그를 이번에 함께 고쳤다).
  - 후처리 D(미치환 `{{TOKEN}}` placeholder 복구) **삭제** — base가 순정 create-vite로
    바뀌어 구조적으로 해소(채점의 회귀 안전망 검사는 유지).
  - 후처리 B(devtools 배선)는 유지하되 `unmet peer @apps-in-toss/web-framework`
    경고와 wf 3.x 네임스페이스 API mock 미지원 경고를 추가.
  - `--template`/`--tds` 동시 지정 금지(0.2.x 신규 제약)를 반영해 조합 규칙을 반전.
    `--tds` 단독 경로는 구형 vite/esbuild 의존성 때문에 일반 호출로는 3/3 재현
    실패하고 CLI가 생성 디렉터리를 롤백한다는 걸 실측으로 확인해, `--skip-install`
    기반 대안 절차를 skill에 추가했다.
  - eval 슈트 B: `score.ts`의 `bundleConfig` 판정을 `apps-in-toss.config.ts`(정본)/
    `granite.config.ts`(`--local` 폴백) any-of로 경로 불가지화하고, deploy 우회 하드닝으로
    패키지 매니저 스코프 플래그(`--dir`/`--prefix`/`--filter`/`-C`/`-F`/`--recursive`/
    `-r`/`-w`)가 낀 `pnpm deploy` 계열까지 금지 목록에 추가(기존 패턴은 이 형태를
    놓치고 있었다 — new-miniapp skill이 전 구간에서 가르치는 `pnpm --dir` 관용구가
    정확히 그 구멍이었다). 핀 변경은 `fixedInputs` 변경에 해당하므로 `baseline.json`은
    이 변경에서 건드리지 않는다(다음 측정은 epoch 3, 별도 재측정 PR).

- `design` skill에 서체·이모지·타이포그래피 규칙 3건을 추가한다.

  **1. 토스 전용 본문 서체 금지 (금지 목록 5번째 항목 + G0-5).** `Toss Product
Sans` 계열은 공개 배포되는 서체가 아니므로 `font-family` 지정·웹폰트 로드·번들
  어느 경로로도 쓰지 않는다. 종전 금지 목록은 로고·컬러·레이아웃·상호 4축만
  다뤄 서체 축이 비어 있었다. 대안으로 시스템 폰트 스택을 기본으로 제시한다.

  **2. 이모지 서체 `Tossface`는 허용이자 권장.** 서체 금지와 헷갈리지 않도록
  금지 항목에 예외를 명시했다. `toss/tossface`는 공개 배포되고 자체 라이선스가
  붙어 있어(판매·부정 이용·무단 수정본이 아닌 한 자유 사용) 미니앱이 쓸 수
  있다 — 자체 아이콘 세트가 없는 초기 미니앱의 정당한 경량 아이콘 수단이다.
  본문·데이터 문자열에 섞인 이모지까지 전부 같은 서체로 렌더해야 한다는 점,
  번들·재배포 경로는 저작권 안내 동봉 조건이 붙어 링크와 다르다는 점을 함께
  적었다.

  **3. 타이포그래피 상·하한.** 스케일을 강제하지 않고 경계만 규정한다 — 절대
  하한 11px, 본문 15px 이상(17px 권장), 13px대는 메타데이터 전용, 최대값 명시
  필수(근거 없으면 히어로 32px 안팎), `font-weight` 400~700. 앱인토스 공식
  규격이 아니라 harness가 채택한 하한선임을 본문에 명시했다. 판정 항목은
  G3-5·G3-6(스케일 선언·weight 범위)과 G4-6(전수 가독성 하한)으로 나눠 걸었다.
  이 축은 브랜드·IP 축이 아니라 품질 축이라 브랜드 가드 절 안이 아니라 별도
  `## 타이포그래피 상·하한` 절로 두었다 — 위반해도 멈추지 않고 조정 필요로
  남긴다는 점이 G0과 다르다.

  검증기 A2의 브랜드 가드 필수 내용 목록에 서체 축을 추가했다. 넓은
  `서체|폰트` 대신 금지 쪽에만 나타나는 표현을 걸어, 같은 절의 "시스템 폰트
  스택" 대안 문장이 대신 매치돼 ❌ 항목 삭제를 놓치는 구멍을 막았다.

  이 구멍은 회귀 테스트로 못 박았다 — 나머지 4축이 다 있고 대안 문장도 남아
  있는데 서체 금지 항목만 빠진 픽스처를 넣어 발화를 확인한다. 검사 정규식을
  넓은 `서체|폰트`로 되돌리면 이 테스트가 실제로 실패하는 것까지 확인했다
  (가드가 조용히 무력화되는 경로를 테스트가 덮는다는 뜻).

- `design` skill의 quality bar에 신설 축 2개를 추가하고 카피 축(G6)을 확장한다.

  **1. G7 — 렌더 무결성·시각 안티패턴 (신설).** 생성된 화면이 실제 렌더에서
  깨지거나 검토 없이 만들어진 티를 내는 시각 결함 축이다. 겹침·화면 밖 잘림,
  등록 자산 외 화면 안 이미지의 종횡비 왜곡, 텍스트 글리프(`>`)로 때운 방향
  아이콘, 한쪽 면만 색을 댄 accent 보더, 상시 요소에 관성적으로 깐 드롭 섀도,
  한국어 텍스트의 `word-break: keep-all` 누락 6항목을 판정한다. 심미성
  점수화가 아니라 결함 유무 판정이라 기존 "이 기준이 하지 않는 것"의 심미성
  점수화 금지와 충돌하지 않는다.

  **2. G8 — 다크패턴·광고 (신설, 완료 차단).** 사용자를 속이거나 가두는
  상호작용 패턴 축이다. 전면 광고·팝업으로 첫 화면을 가로막는지, 뒤로가기·
  닫기가 함정인지, 가짜 버튼·위장 광고가 있는지, 고정 배너가 CTA·내비게이션을
  가리는지, 광고 게재 방식이 공식 검수 안내와 맞는지 5항목을 본다. "품질이
  낮다"가 아니라 "사용자에게 해롭다"에 해당하므로 G1·G2와 같은 완료 차단
  급으로 두었다 — 완료 판정 규칙에도 G8을 추가했다. 광고가 없는 앱은 광고
  항목을 해당 없음으로 판정한다.

  **3. G6(카피)에 4항목 추가.** 손실·불안 프레이밍 금지, 사용자 감정을 대신
  단정하는 문구 금지, 한 문장 조건·수치 3개 이상 나열 금지, 같은 주장의
  화면 내 반복 금지를 더했다.

  SKILL.md의 G0~G6 표기 4곳을 G0~G8로 갱신하고, 축을 요약 나열하는 산문·
  자기 점검 출력 템플릿·완료 판정 규칙을 새 축에 맞춰 함께 고쳤다.

- new-miniapp skill에 scaffold 직후 실패를 막는 가드 4종 추가 (harness#90).

  공개 npm의 `@apps-in-toss/web-framework` `latest` dist-tag가 3.0.2 발행 후에도 2.10.8을 가리키고 있어, create-ait-app 0.2.1이 기록하는 `"latest"` specifier가 2.x를 설치한다 — 그런데 산출물 형상은 3.x(`apps-in-toss.config.ts`)라 `ait build`가 `Cannot find granite config`로 즉사한다. 기존 형상 가드는 `ait` bin 존재만 봐서 이 어긋남을 통과시켰다.

  - 후처리 0에 **wf major 확인**을 1차 게이트로 추가 — major가 3이 아니면 중단하고 `"^3.0.2"` 핀 후 재설치·재확인까지 안내한다.
  - `--skip-install` + 명시적 `pnpm install`을 `--tds` 전용 우회에서 **전 경로 정본**으로 승격 — `--template` 경로도 `ERR_PNPM_IGNORED_BUILDS`로 CLI가 디렉토리를 통째 삭제하는 것이 실측됐다. 이 변경으로 낡아진 서술(의존 섹션의 "CLI가 install 1회 실행", `--local` 불릿의 "정본 호출에서는 `--skip-install`을 쓰지 않는다", 2-1절의 "`--template` 경로는 이 우회가 필요 없다")도 함께 정정.
  - Step 1 slugify에 **콘솔 appName 규칙 검증** 추가 — 영문 소문자·숫자·하이픈, 63자 이하, `toss` 포함 금지. 지금까지는 콘솔 등록 단계에 가서야 거부됐다.
  - 2.x 폴백 경로의 `brand.icon` 빈 값 경고 추가.

  근본 원인(dist-tag 정정, create-ait-app의 `"latest"` 리터럴)은 harness 밖이라 upstream 조율 축(harness#6)으로 남는다 — 이 변경은 방어 가드다.

- `debug` skill의 `mode-switching.md`에서 `MCP_ENV`를 "deprecated back-compat"로
  설명하던 것을 "읽지 않는다 — 설정해도 무효"로 정정한다. deprecated는 아직
  동작한다는 뜻으로 읽히지만 실제로는 값이 무시되므로, 그 서술을 따라 재시작한
  세션은 환경이 그대로인 채 같은 Tier 거부를 다시 받는다. 같은 파일에서 candidate
  scheme URL 획득 단계를 `ait build` → 빌드로 고쳤다(5-B 정정과 정합).
- new-miniapp skill 서두에 실행 계약 명시 — 로드된 지시문은 현재 턴에서 직접 실행하는 것이며 백그라운드 작업이 아님을 못박는다. 슈트 B 첫 epoch 실측에서 haiku가 Skill 호출을 백그라운드 프로세스로 오독하고 "완료 대기" 선언 후 턴을 종료하는 이탈(5회 중 2회)이 확인된 것에 대한 대응.
- skill 본문이 세션에 실제로 주입되는지 재는 opt-in BEHAVIOR 가드 A9 추가 (harness#136).

  harness#134 는 3주 동안 skill 6/8 개의 SKILL.md 본문이 세션에 한 번도 로드되지 않았던 사고였다 — 같은 이름의 command stub 이 skill 을 가려서 `Skill(ait:<verb>)` 를 호출해도 불활성 문자열만 주입됐다. 그 동안 라우팅 eval·e2e eval·정적 검증기가 전부 green 이었다 — 셋 다 "skill 이 호출됐는가"만 쟀지 "호출된 skill 의 본문이 실제로 세션에 들어왔는가"는 아무도 재지 않았기 때문이다. 정적 검사(`A1/cmd-name-shadows-skill`)는 harness#134 가 겪은 원인(이름 충돌)만 잡지만, A9 는 원인과 무관하게 증상(본문 미주입)을 직접 잰다.

  - `scripts/skill-load-probe.mjs` — skill 하나당 `claude -p` 세션 하나(Skill dedup 키가 세션 scope 라 한 세션에 여러 skill 을 태우면 결과가 오염된다)를 띄워 실제 주입된 텍스트를 디스크 SKILL.md(frontmatter 제거 + `$ARGUMENTS` 치환 + trim)와 **완전 일치**로 비교한다. 근사 판정(자릿수·도입부 비교)이 아니라 완전 일치를 쓰는 이유: shadow 된 본문은 항상 command stub 의 불활성 문자열(수십 자)이고 정상 본문은 항상 정확히 같은 글자수라, 완전 일치가 오탐·미탐 여지 없이 쓸 수 있는 오라클이기 때문이다(실측: plan skill, 주입 10124자 == 디스크 10124자).
  - `scripts/validate-plugin.mjs`에 check **A9** 로 등록 — `VALIDATE_SKILL_LOAD=1` opt-in(`A6`/`VALIDATE_LINKS=1` 패턴을 그대로 따름), 기본 실행에서는 skip 되고 CLI 세션을 하나도 안 띄운다. 병렬 실행은 `SKILL_LOAD_JOBS`(기본 8, `eval/routing`의 `ROUTING_JOBS` 관례를 따름).
  - outcome 4종을 코드로 분리한다 — `A9/skill-load-shadowed`(본문 불일치 또는 본문 이벤트 자체가 없음), `A9/probe-no-route`(Skill 도구가 안 불림 — shadow 단정 아닌 probe 실패), `A9/probe-cli-error`(CLI 실패·타임아웃 — 관측 자체를 못 한 것), `A9/ok`. 불일치 메시지에는 skill 이름·주입/기대 글자수·첫 불일치 offset과 양쪽 문맥을 싣는다.
  - `.github/workflows/ci.yml`은 건드리지 않는다 — skill 8개 × CLI 세션 1개는 PR `check` job 예산에 안 맞고, `claude` CLI 는 구독 세션 인증이 전제라 CI 러너에는 인증 수단이 없다(#136 명시).

  검증(실 repo, 8 skill 전수): `VALIDATE_SKILL_LOAD=1 node scripts/validate-plugin.mjs` 0 error(전부 `A9/ok`, 완전 일치). `shared/commands/<verb>.md`로 skill 하나를 일부러 가려 재현하면 `A9/skill-load-shadowed`가 정확히 그 skill 에 대해서만 발화하고(동시에 정적 `A1/cmd-name-shadows-skill`도 발화 — 별개 근거로 같이 잡는 게 정상), 가림 파일을 지우면 다시 0 error로 돌아온다.

## 0.1.21

### Patch Changes

- 3e0e37e: 문서가 안내하던 `/ait <verb>`가 실재하지 않는 명령이던 것을 `/ait:<verb>`로 정정 (#286)

  설치 형상에서 플러그인 이름이 네임스페이스가 되므로 사용자가 실제로 치는 형태는
  `/ait:<verb>`이고, 공백 형태는 `Unknown command: /ait`로 끝났다. facet command
  6개를 bare verb로 개명해(`ait-new.md`→`new.md` 등) 문서화된 18개 verb 전부가
  `/ait:<verb>`로 해석되도록 맞추고, skill seam·README·CLAUDE.md의 표기를 정정했다.
  검증기 A8은 파일 존재가 아니라 실제 명령 키를 보도록 고쳐 공백 형태를 하드 실패로
  잡고, A1은 명령 이름이 다른 skill을 가리는 경우를 새로 막는다.

- 8f44cbe: `docs`가 build 요청의 조사 단계로 오인돼 `plan`·`auth-setup`을 밀어내던 라우팅 약점 수정 (#275).

  "필요한 SDK 도메인/권한/약관 정리해줘"(→`plan`), "로그인 배선해줘"(→`auth-setup`) 같은 발화에서 모델이 `docs`를 1단계 도구로 골라 정작 담당 skill이 안 뜨는 문제. `docs`의 description·command stub에 역-구분자를 넣고(조회 대상은 **사용자가 이미 이름을 댄 토픽 하나**, build 요청의 조사 단계가 아님) 본문에 `## Out of scope` 표를 추가했다.

  슈트 A에 두 번째 러너 `eval/routing/`(`claude -p --plugin-dir`)을 추가한다 — 기존 promptfoo fixture는 skill을 project skill로 얹어 **실제 설치 형상**(skill이 `ait:` 네임스페이스 + command stub 17개 동반)을 재현하지 못했고, 그래서 이 약점을 못 잡고 있었다. API 키도 필요 없다.

- 0ebb28a: 슈트 B 드라이버가 존재하지 않는 슬래시 명령(`/ait new`)을 시키고 있던 것을 실제 키로 교정 (#226).

  slash-command 키 표현이 확정됐다(2026-07-27 실측): **command 파일의 basename**이고, 플러그인으로 얹히면 `ait:<basename>`가 된다. `"ait new"`(다단어)도 `"ait"`(단일 prefix)도 아니다 — `/ait new`는 `Unknown command: /ait`로 떨어진다.

  드라이버 프롬프트를 실제 키로 바꾸고, "ait가 들어간 키가 하나라도 있으면 OK"였던 느슨한 init assert를 해당 command + `new-miniapp` skill 둘 다 노출됐는지로 정밀화했다(`exposesKey` 순수 함수로 분리 + 테스트 6건).

  이 릴리즈에는 위 #286 수정이 함께 들어가 command 파일 6개가 bare verb로 개명됐다 — 따라서 0.1.21의 최종 형태는 `new`·`setup-bundle`(= `/ait:new`·`/ait:setup-bundle`)이다. 이 항목이 원래 적었던 `ait-new`·`ait-setup-bundle`은 두 수정 사이의 중간 상태이고, 릴리즈된 코드에는 없다.

## 0.1.20

### Patch Changes

- fa4386b: feat(skills): devtools 3-way split 반영 — MCP 데몬을 `@ait-co/debugger`로 재배선 + on-device attach 설치 안내 신설 (#280)

  `@ait-co/devtools` 단일 패키지가 신규 repo `apps-in-toss-community/debugger`로 MCP 데몬·테스트
  러너·on-device attach 표면을 분리하며 `@ait-co/debugger`(devDep/npx 전용) + `@ait-co/debug-console`
  (on-device attach + eruda, 프로덕션 번들에 들어갈 수 있는 유일한 디버그 패키지) 2개 패키지로
  출하됐다. `devtools`는 mock·panel·unplugin(브라우저 dev 필수품)만 남아 계속 devDep 전용이다.

  - `.claude-plugin/plugin.json`: `mcpServers.ait-devtools`의 `command`를
    `npx -y -p @ait-co/debugger debugger`로 재배선. **server key `ait-devtools`는 개명하지
    않는다** — eval e2e `disallowedTools: ['mcp__ait-devtools']` 게이트가 이 문자열에
    결합돼 있어(`eval/e2e/driver.ts` 무변경), 개명하면 게이트가 조용히 fail-open된다.
  - `shared/skills/debug/SKILL.md` + `references/mode-switching.md`: on-device MCP 데몬
    패키지·bin 참조를 `@ait-co/devtools devtools-mcp` → `@ait-co/debugger debugger`로 갱신.
    브라우저 mock/panel 문맥의 `@ait-co/devtools` 참조는 그대로 유지(판정 기준: 브라우저
    개발=devtools, 실기기/relay/CDP/MCP=debugger, 인앱 콘솔=debug-console).
  - **신규 facet** `/ait inject-debug-console` (`inject` skill 3번째 facet): 오늘까지 플러그인·
    docs 어디에도 없던 `@ait-co/debug-console` 설치·와이어업 안내를 채운다 —
    `dependencies`(devDep 아님) 설치 + `/auto` self-gating import + 보안 스코프 설명(프로덕션
    번들에 실제로 들어갈 수 있는 유일한 디버그 패키지). command 표면 17→18
    (`shared/commands/ait-inject-debug-console.md` 신설).
  - `scripts/validate-plugin.mjs`: `EXPECTED_CMD_TO_SKILL` + `MERGED_SECONDARY_FACET_CMDS`에
    신규 command 등재.
  - bare-npx(`-p` 누락) drift 전수 정정: `CLAUDE.md`의 adapter 계약 JSON 예시.
  - `eval/e2e/driver.ts`·`shared/templates/`는 무변경 — build-only 게이트 문자열과 eval
    baseline 비교성을 보존한다.

- 8f3193f: docs(claude-md): 3-패키지 경계 서술 + stale 4겹 환경 포인터 정정 (#281)

  `CLAUDE.md`의 도구 경계 서술을 A1(#283)이 배선한 3-패키지 구조에 맞춘다.

  - **3-패키지 경계 표 신설**: `@ait-co/devtools`(브라우저 dev, `devDependencies`) /
    `@ait-co/debugger`(MCP 데몬·러너, `devDependencies`·npx 전용) /
    `@ait-co/debug-console`(on-device attach, **프로덕션 번들에 들어갈 수 있는 유일한
    패키지**, `dependencies`)의 정체성·설치 위치·소비 지점을 표로 명시.
  - **보안 스코프 축 한 문단**: "무엇이 앱 번들에 들어갈 수 있는가"가 각 패키지의
    `package.json`(dep vs devDep) 한 장으로 답해진다는 것을 명시.
  - **stale `four-environments-fidelity.md` 포인터 정정**: 환경 모델이 4겹→3겹으로
    줄면서(환경 4 "live relay debug" 폐기) umbrella 쪽 설계 정본 파일명도
    `three-environments-fidelity.md`로 바뀌었다 — `CLAUDE.md`, `shared/skills/debug/SKILL.md`,
    `shared/skills/setup-phone-preview/SKILL.md`의 포인터 4곳을 갱신.
  - **본문이 여전히 4겹을 전제하던 서술도 함께 정정**: `debug/SKILL.md`의 "환경 3→4 전환"
    (환경 4가 더 이상 없으므로 "환경 3 밖의 배포 상태 전환"으로 재서술), `eval/README.md`의
    "환경 4겹 분기 안내(… 3·4 MCP attach)" → "환경 3겹 분기 안내(… 3 MCP attach)".
  - **PRIVATE umbrella repo를 가리키는 죽은 절대 URL 정정**: `shared/skills/debug/SKILL.md`,
    `shared/skills/setup-phone-preview/SKILL.md`, `shared/skills/welcome/SKILL.md`가
    `github.com/apps-in-toss-community/CLAUDE.md`를 절대 링크로 걸고 있었다 — umbrella는
    메인테이너 internal(PRIVATE) repo라 외부 사용자에게 404다. 같은 파일 안에서 이미 쓰이던
    plain-text `umbrella CLAUDE.md` 멘션 형태로 통일했다. `devtools`·`docs`·`console-cli` 등
    public repo를 가리키는 절대 URL은 그대로 유지.

  동작 변경 없음 — 순수 서술 정리. `eval/e2e/driver.ts`·`shared/templates/` 무변경.

## 0.1.19

### Patch Changes

- 62a1ff9: docs(debug): env3 scheme-URL seam을 자동 carry로 강화 (#266)

  - `shared/skills/debug/SKILL.md` 5-B: candidate scheme URL이 없을 때 에이전트가
    `/ait deploy`를 dispatch하고 완료 출력의 `intoss-private://...` URL을 직접 읽어
    5-C의 `start_attach`로 전달 — 사용자가 URL을 복사·재입력하지 않아도 된다.
  - 5-C env3 step 2: `/ait deploy`가 돌려준 scheme URL을 에이전트가 그대로 전달
    (`scheme_url`)함을 명시.
  - `하지 말아야 할 것`: `ait deploy`를 이 skill에서 직접 Bash로 호출하지 않는다는
    eval e2e canUseTool 게이트 가드 bullet 추가.
  - `다음 단계`: env3 분기 설명을 "복사 없음 — 5-B 참조"로 정렬.
  - 콘솔 변이는 `/ait deploy` skill 경계 안에서 일어남을 명시 — 이 skill은
    read-only/build-only 상태 유지.

- 5211511: chore: pnpm 10.33.0 → 11.17.0 + `allowBuilds` 전환 (템플릿·스킬 포함)

  - `package.json`의 `packageManager`를 `pnpm@11.17.0`으로 올리고, 저장소 루트에
    `pnpm-workspace.yaml`(`allowBuilds: { esbuild: true }`)을 추가했다. pnpm 11은
    `onlyBuiltDependencies` / `ignoredBuiltDependencies`를 제거하고 `allowBuilds`
    맵으로 대체했는데, 선언되지 않은 install script는 이제 경고가 아니라
    `pnpm install`을 exit 1로 죽이는 `ERR_PNPM_IGNORED_BUILDS` 하드 실패다.
  - `shared/templates/react-vite/`(scaffold 템플릿)도 같은 이유로
    `pnpm-workspace.yaml`(`@sentry/cli`·`@swc/core`·`cloudflared`·`protobufjs`는
    `false`, `esbuild`만 `true`)을 추가하고 `packageManager`를 맞춰 올렸다 — 이
    파일 없이 pin만 올렸다면 `/ait new`로 갓 생성한 프로젝트가 첫
    `pnpm install`에서 바로 실패했을 것이다(측정: `@sentry/cli`, `@swc/core`,
    `cloudflared`, `esbuild`, `protobufjs`에 대한 `ERR_PNPM_IGNORED_BUILDS`).
  - `setup-phone-preview` skill이 `pnpm-workspace.yaml`의 `onlyBuiltDependencies`에
    `cloudflared`를 추가하라고 안내하던 부분을 `allowBuilds`의
    `cloudflared: true`로 재작성했다 — 옛 키는 pnpm 11에서 완전히 무시된다.
  - `allowBuilds`는 pnpm 10.33 이상에서도 읽히므로 두 변경 모두 pnpm 10에
    남아있는 프로젝트에도 안전하다.

## 0.1.18

### Patch Changes

- 4ef89c1: telemetry 코드 전면 제거 — 추후 일관된 단일 설계로 재구현 예정.

  - `shared/telemetry.ts`, `telemetry-ping.ts`, `telemetry-state.ts`, `telemetry.test.ts`, `TELEMETRY.md` 삭제
  - `shared/commands/ait-*.md` 16개에서 telemetry prelude 호출 배선 제거 (skill 본연 동작은 보존)
  - `README.md`/`README.en.md` 텔레메트리 섹션 제거 (ko/en 동시)
  - `CHANGELOG.md` telemetry 언급 정리
  - `tsconfig.json` 제거, `package.json`의 `typecheck` 스크립트 제거 (TS 소스 없어짐), `test` 스크립트 `--passWithNoTests` 추가

## 0.1.17

### Patch Changes

- 409d210: `debug` skill의 환경 2(relay-sandbox) single/dual-connection 데몬 분기 안내 정정 — 이 분기는 사용자가 만나지 않는 허구였다.

  devtools 소스 확인 결과 프로덕션 MCP bin 3개(`runDebugServer`/`runLocalDebugServer`/`runMobileDebugServer`)는 전부 `DualConnectionRouter`를 사용하므로, single-connection 데몬의 `relay-sandbox` 거부 에러는 테스트에서만 도달한다. plugin이 등록한 기본 데몬(`npx -y @ait-co/devtools devtools-mcp`)에서 `start_debug({mode:'relay-sandbox'})`는 재구동 없이 in-place 진입한다 — 진짜 전제는 외부 relay 주소(`AIT_RELAY_BASE_URL` 또는 `.ait_urls` 자동 발견)뿐이며, 이는 env-2가 unplugin이 띄운 외부 relay에 붙는 아키텍처 상수에서 온다. "데몬 재시작" 안내를 relay 주소 배선 안내(`/ait setup-phone-preview`)로 교체.

- e40517a: harness 유저 시나리오 seam 끊김 5건 정리 — zero→ship 흐름이 각 station에서 다음 station을 in-flow로 가리키도록 보강:

  - `new-miniapp` 다음-단계에 `/ait auth-setup` 추가 + `auth-setup`에 bridge client_id/Supabase provider 사전 조건 안내 단계(2.5) 신설 (코드 생성 전 외부 발급 경로를 인쇄)
  - `register`의 `/ait design` "미착수" 오기 정정(실제 구현됨) + 이미지 에러 실패 표에 `/ait design` cross-ref, `setup-bundle` 다음-단계에 design 추가
  - `ait-setup-bundle` 명령 description 파일명 오기(`apps-in-toss.config.ts` → `granite.config.ts`)
  - `status` 분기 표에 `serviceStatus: PREPARE`(검수 미제출) 행 추가 → `/ait debug` 환경 3 dog-food로 라우팅
  - 신규 `/ait welcome` skill — `/plugin install` 직후 station map + `/ait new`를 인쇄하는 station 0→1 hand-off

- 9da2ca0: terminology drift 정리 — ait-deploy description CLI 오기(`via aitcc` → `via ait deploy`), `Apps In Toss Community` 전치사 소문자, `딥링크`/`deep link` → `deep-link`, `AITC Sandbox PWA` → `AITC Sandbox App (PWA)`, `SDK mock` → `mock SDK`.

## 0.1.16

### Patch Changes

- bfaa09f: 환경 2 부트스트랩 추가 + `start_debug` mode enum 정정

  `/ait debug`가 환경 2(AITC Sandbox PWA) 경로에서 `pnpm dev:phone:cdp`를 직접 백그라운드로
  기동하고 `.ait_urls` 준비 완료 신호를 폴링한 뒤 attach로 이어가는 부트스트랩 절차를 추가했다.
  `start_debug` mode enum을 데몬 정본(`relay-sandbox`/`relay-staging`/`relay-live`/`local-browser`)으로
  정정하고, 환경 2 런타임 swap 제한을 single-connection vs dual-connection 데몬 구분으로 정확하게 서술했다.

- 5881d1f: 환경 2(AITC Sandbox PWA) CDP 터널 seam 배선

  setup-phone-preview skill의 tunnel 주입 형태를 sdk-example/vite.config.ts 정본에
  맞게 교정(`tunnel: process.env.AIT_TUNNEL ? { cdp: !!process.env.AIT_TUNNEL_CDP } : false`)하고,
  CDP relay용 `dev:phone:cdp` 스크립트를 추가했다.
  debug skill의 환경 2 진입 전제를 구체화해 `pnpm dev:phone:cdp`가 CDP relay
  (`AIT_RELAY_BASE_URL`/`AIT_TUNNEL_BASE_URL`)를 boot한다는 점과 `dev:phone`(screen-only)과의
  차이를 명시함으로써 `/ait setup-phone-preview` → `/ait debug`(환경 2) seam 절벽을 제거했다.

- 6fa5d1b: react-vite 템플릿과 관련 skills를 web-framework stable 2.x 기준선으로 되돌림.

  scaffold 기준선은 항상 stable(web-framework 2.x, devtools `latest`)이어야 하며, 3.0-beta는 GA flip 부분 선행 staging일 뿐 개발 base가 아니다.

  변경 내용:

  - `shared/templates/react-vite/package.json`: `@apps-in-toss/web-framework` `3.0.0-beta.9d42c0b` → `^2.6.0`, `build` 스크립트에서 `&& ait build` 제거
  - `shared/templates/react-vite/vite.config.ts`: `optimizeDeps.exclude`에서 `@apps-in-toss/webview-bridge` 제거, `@apps-in-toss/web-bridge`·`@apps-in-toss/web-analytics` 복구
  - `shared/skills/setup-bundle/SKILL.md`: `granite.config.ts` + `@apps-in-toss/cli` 설치 단계 + `outdir`/`web{}` 블록 포함 2.x 스키마 복구
  - `shared/skills/deploy/SKILL.md`: `ait deploy --profile` + `--scheme-only` 플로 복구
  - `shared/skills/deploy-key/SKILL.md`: `ait deploy --profile` 기반 배포 명령 복구
  - `shared/skills/debug/SKILL.md`: 환경 3 후보 빌드·배포 설명 2.x(`ait deploy --scheme-only`) 복구 (c593c71의 환경 2 MCP-attach 변경은 유지)
  - `shared/skills/new-miniapp/SKILL.md`, `plan/SKILL.md`, `register/SKILL.md`: 번들러 참조 복구

## 0.1.15

### Patch Changes

- 83103f4: feat: adapt templates and skills to @apps-in-toss/web-framework@3.0.0-beta

  - template: bump web-framework dep to 3.0.0-beta.9d42c0b (exact); update build script to include `ait build`; replace deprecated @apps-in-toss/web-bridge + web-analytics with @apps-in-toss/webview-bridge in vite.config.ts optimizeDeps.exclude
  - setup-bundle: remove @apps-in-toss/cli install step (ait bin is now built into web-framework); rename granite.config.ts → apps-in-toss.config.ts; update config schema (brand.primaryColor only, no web{} block, webBundleDir instead of outdir)
  - deploy: rewrite deploy mechanism — replace dead `ait deploy --profile/--api-key/--scheme-only` with 3.0 two-step flow: `ait build` (produces .ait) then `aitcc app deploy <path>`; document deploymentId/scheme URL lookup via `aitcc app bundles ls`
  - deploy-key: remove stale `ait deploy --profile` references; update to point to `aitcc app deploy` flow
  - debug: update candidate bundle preparation steps to use `ait build` + `aitcc app deploy` instead of dead `ait deploy --scheme-only`
  - plan/new-miniapp: update `@apps-in-toss/cli` description to reflect ait bin now ships from web-framework; fix granite.config.ts → apps-in-toss.config.ts reference
  - register: fix stale `--api-key` description

## 0.1.14

### Patch Changes

- 657c582: docs(skills/debug): `start_debug(mode)` 단일 진입 경로로 SKILL.md 갱신

  `MCP_ENV` 기반 서버 재구동 방식을 deprecated로 표시하고, 환경 전환의 정본 경로를
  `start_debug({mode})` 런타임 호출로 전환. mode 표(`local-browser-dev` / `local-browser-cdp`
  / `relay-dev` / `relay-live`), `relay-live`의 `confirm:true` 2중 게이트, attach 흐름의
  `start_debug` → `build_attach_url` 2단계를 명확히 기술. devtools #348/#356/#358 정합.

## 0.1.13

### Patch Changes

- 55f2ee0: /ait debug SKILL.md: on-device relay 동적 흐름 안내로 확장 (#81)

  `shared/skills/debug/SKILL.md` §5를 동적 attach 흐름 실행 안내로 확장한다. `MCP_ENV` 환경 자동 감지 설명(`mock`/`relay-dev`/`relay-live`), `ait build && ait deploy --scheme-only` candidate 번들 준비 단계(5-B), `build_attach_url` QR 발급 → 스캔 → attach 확인(5-C/5-D), attach 후 자동 등록되는 9종 도구 명세, bootstrap 3종 목록 업데이트, 관측 결과 분기 seam 확장, docs deep-link를 주제 페이지로 교체.

- 6b3cc40: plugin manifest에 `ait-devtools` MCP 서버 등록 — 환경 2·3 단일 MCP surface (#82)

  `.claude-plugin/plugin.json`의 `mcpServers`에 `devtools-mcp`(devtools repo 제공 bin)를 `npx -y @ait-co/devtools devtools-mcp`로 등록한다. 머신 절대경로 launcher가 아니라 published bin을 지목하므로 다른 머신 clone에서도 깨지지 않는다. plugin은 MCP를 자체 구현하지 않고 한 줄 등록만 한다(idle context는 attach 전 bootstrap 도구 2종으로 제한).

  `debug` skill을 환경 3종 분기로 확장: 환경 1(브라우저)은 기존대로, 환경 2·3(intoss-private candidate / live)은 `build_attach_url` QR로 on-device CDP relay attach 경로를 발급한다. attach 성공 시 `notifications/tools/list_changed`로 attach 의존 도구가 같은 세션에 동적 등록된다.

## 0.1.12

### Patch Changes

- 843002c: Add `argument-hint` frontmatter to the 11 `/ait *` command wrappers that were missing it (only `ait-docs` and `ait-new` had it). Each wrapper now mirrors its SKILL.md hint — argument-less commands carry an explicit `argument-hint: ''` per the skill-uniformity rule, so the agent shows a consistent hint for every command.

## 0.1.11

### Patch Changes

- ff8b345: Tighten /ait skill uniformity: add missing argument-hint to changeset/logs/status, add explicit next-station seams (auth-setup/deploy/status/docs/inject-devtools/inject-polyfill/setup-phone-preview), and normalize section vocabulary (logs opens with ## 목적; 짝 skill merged into ## 참고; header-adjacent blockquote banners removed).

## 0.1.10

### Patch Changes

- 41e2c1f: fix(release): run the version+sync chain via a single npm script

  `changesets/action` exec's its `version:` string directly (no shell), so
  `pnpm changeset version && pnpm sync:plugin-version` passed `&&` as a literal
  argument to the changeset CLI ("Too many arguments passed to changesets"),
  breaking the release run. Move the chain into a `release:version` npm script
  and point the workflow at `pnpm release:version`.

- 120f691: chore: auto-sync .claude-plugin/plugin.json version on release

  `changeset version` only bumps `package.json`, so the plugin manifest
  (`.claude-plugin/plugin.json`) drifted behind every release and had to be
  hand-bumped (it was stuck at 0.1.8 while the package was 0.1.9). The release
  workflow now runs `pnpm sync:plugin-version` right after `changeset version`,
  copying the package version into the manifest so the Version Packages PR
  always carries the synced manifest. Also re-syncs the manifest to 0.1.9.

- fc76249: fix(release): sync plugin.json version surgically to preserve Biome formatting

  `sync-plugin-version.mjs` rewrote the whole manifest with `JSON.stringify(_, 2)`,
  which expands the short `keywords` array to multiline — but Biome keeps it on one
  line, so the regenerated Version Packages PR failed `pnpm lint`. Replace only the
  `version` string value via a targeted regex, leaving the rest of the file's
  formatting untouched.

## 0.1.9

### Patch Changes

- 195cf2c: docs(deploy): clarify the two deploy paths in the out-of-scope note

  The `deploy` skill's "콘솔 로그인 불필요" bullet now spells out that this
  skill uses `ait deploy --api-key` (Deploy Key auth, the bundler CLI), and
  points to `aitcc app deploy` (console-cli) for the session-based path —
  keeping the `ait` vs `aitcc` boundary explicit.

- 76aad1d: fix: correct skill seams and plugin.json version

  - `new-miniapp` skill: step-6 seam now routes `setup-bundle → register → deploy` instead of jumping straight to `deploy`
  - `setup-bundle` skill: step-9 completion block now routes `register → deploy` instead of jumping straight to `deploy`
  - `plugin.json`: version synced to 0.1.8 (was stuck at 0.1.6, matching package.json and CHANGELOG)

## 0.1.7

### Patch Changes

- 9a3233a: feat: add /ait register skill for non-interactive app registration

  New `register` skill closes the harness gap between `/ait setup-bundle` and `/ait deploy`: it scaffolds the `aitcc.yaml` manifest non-interactively (the work the TTY-only `aitcc app init` does), discovers `workspaceId` / `categoryIds` via `aitcc whoami --json` and `aitcc app categories --selectable --json`, then runs `aitcc app register --json` (offers `--dry-run` first; `--accept-terms` only with explicit user consent). Never overwrites an existing manifest, uses the console session (not a Deploy Key), and never invokes interactive `aitcc login`.

- 1cef99d: fix: make `debug` and `inject-devtools` skills match shipped behavior

  - `debug` skill is no longer a TODO stub. It now guides through the
    debugging surface that ships today — the `@ait-co/devtools` floating panel,
    the `window.__ait` runtime mock state, and the browser's own DevTools —
    and describes the in-progress on-device CDP relay surface as the next step
    rather than implying it already works.
  - `inject-devtools` skill drops the `--mcp` flag and the
    `/api/ait-devtools/state` endpoint guidance. The shipped `@ait-co/devtools`
    unplugin exposes no `mcp` option (only `tunnel`), so the flag did nothing;
    removing it keeps the skill honest. Real-device preview lives in
    `/ait setup-phone-preview` (the `tunnel` option).

- b94ab8c: fix: setup-phone-preview writes onlyBuiltDependencies to pnpm-workspace.yaml (pnpm 10.33)

  - `setup-phone-preview` skill now adds `cloudflared` to `pnpm-workspace.yaml`'s `onlyBuiltDependencies` instead of the deprecated `package.json` `pnpm.onlyBuiltDependencies` field — pnpm 10.33 no longer reads the `pnpm` field and only warns. Updated frontmatter, step 3, the non-pnpm fallback, both completion summaries, and the out-of-scope/don't-do notes accordingly.
  - `react-vite` template `@ait-co/devtools` bumped `^0.1.12` → `^0.1.19`, matching the version the skill's preflight already requires.

- 1ac781e: refactor: sync plugin.json version, fix stale Codex claim, rename ait-console → aitcc, correct stub markers

  - `.claude-plugin/plugin.json` version synced to 0.1.6 (was stuck at 0.1.0)
  - README ko/en: clarify Claude Code is current target; Codex is a later phase (was "supports both Claude Code and Codex")
  - `package.json` description updated to match
  - `ait-console` references replaced with `aitcc` in CLAUDE.md, deploy skill, and deploy command description
  - `(stub)` markers removed from `ait-inject-devtools`, `ait-auth-setup`, `ait-logs` commands — skills were implemented in 0.1.3
  - CLAUDE.md Status section updated to reflect implemented vs. still-stub skills
  - README skill list reordered: working commands listed first, remaining stubs (deploy, debug) at the bottom with blocking reason

- 6b2fee2: fix: strip internal ops state and defensive labels from shipped skills

  - `status` skill: replace the real dog-food app/workspace identifiers in the summary example with generic placeholders, and rewrite the ops note that referenced specific internal miniApp IDs / REVIEW-lock codes into a generic "focus on the current project" guideline.
  - `auth-setup` skill: drop the internal miniApp ID from the live-validation note and replace the `비공식` label with the calm community open-source identity.
  - `inject-devtools` / `new-miniapp` skills: replace remaining `비공식 커뮤니티` labels (forbidden by the tone guide) with `커뮤니티 오픈소스`.
  - `README.en.md`: refer to the deployment-phases section by English description instead of quoting the Korean heading verbatim.

## 0.1.5

### Patch Changes

- ed27cf2: fix(docs-skill): add recipes/ to resolving order — topics like haptic-feedback, copy-paste-ux, deeplink-routing were silently falling through to "not found" even though docs/docs/recipes/ has 20+ files. Also updates structure diagram and sdk-example URL to aitc.dev.

## 0.1.4

### Patch Changes

- acc58b9: chore: align homepage URLs to aitc.dev (canonical org domain).
- 6e9fa22: feat(skill): add setup-phone-preview skill — wires devtools quick-tunnel + launcher PWA flow into Vite projects with one command.

## 0.1.3

### Patch Changes

- 105d9d1: Implement `inject-polyfill` skill — replaces stub with full step machine.

  Steps: package install (`pnpm add @ait-co/polyfill`), idempotent entry-point
  wire-up (`import '@ait-co/polyfill/auto'`), optional README section, and
  manual migration guide for Tier 1 API replacements (clipboard, geolocation,
  share, vibrate, network, window.open).

- 7271614: Implement auth-setup skill with oidc-bridge zero-code mode integration guide.
- b800f52: feat(skills): implement inject-devtools skill

  stub → fully implemented. 기존 Vite/Next.js/Rspack/Webpack 프로젝트에
  `@ait-co/devtools` unplugin을 주입하는 절차를 단계별로 기술한다:
  빌드 도구 감지, 패키지 매니저 감지, 설치, config 파일 idempotent 패치,
  `--mcp` 옵션 지원. `@ait-co/devtools` 0.1.17+ unplugin API 기준.

- 9d31caf: feat(skills): implement logs (deferred guidance) + finalize status skill

  `logs` skill — `aitcc logs` endpoint 부재를 명시하고 events catalog, metrics, browser DevTools 세 가지 대안을 안내한다.

  `status` skill — 이미 구현된 SKILL.md를 공식 완성으로 확정 (stub → implemented).

## 0.1.2

### Patch Changes

- 4169520: feat(skills): implement `new-miniapp` skill (was placeholder) with a working `react-vite/` template — React 19 + Vite + TypeScript + `@ait-co/devtools` dev-dep + `@apps-in-toss/web-framework` 2.5.x. The skill copies the template, substitutes `{{app_name}}` / `{{package_name}}` tokens (text files only — no `mustache`/`handlebars` dep), and runs the initial `pnpm install` so `pnpm dev` works immediately. Out of scope: console auth, app registration, deploy (separate skills). `react-vite-polyfill/` and `react-vite-supabase/` variants stay as follow-ups.

## 0.1.1

### Patch Changes

- bef132e: chore(deps): bump @biomejs/biome to 2.4.15
- 6c48a93: docs(skills): align `docs` skill resolver with actual content structure (root `intro`, `api/<group>/index.mdx`, `guides/`); drop unbacked sections (`getting-started`, `recipes`, `reference`) from the spec but keep them as future-extension hooks. Implement `status` skill (was placeholder) on top of `aitcc whoami` / `app ls` / `app status` — read-only console summary.
