---
'@apps-in-toss/agent-plugin': patch
---

skill 본문이 세션에 실제로 주입되는지 재는 opt-in BEHAVIOR 가드 A9 추가 (harness#136).

harness#134 는 3주 동안 skill 6/8 개의 SKILL.md 본문이 세션에 한 번도 로드되지 않았던 사고였다 — 같은 이름의 command stub 이 skill 을 가려서 `Skill(ait:<verb>)` 를 호출해도 불활성 문자열만 주입됐다. 그 동안 라우팅 eval·e2e eval·정적 검증기가 전부 green 이었다 — 셋 다 "skill 이 호출됐는가"만 쟀지 "호출된 skill 의 본문이 실제로 세션에 들어왔는가"는 아무도 재지 않았기 때문이다. 정적 검사(`A1/cmd-name-shadows-skill`)는 harness#134 가 겪은 원인(이름 충돌)만 잡지만, A9 는 원인과 무관하게 증상(본문 미주입)을 직접 잰다.

- `scripts/skill-load-probe.mjs` — skill 하나당 `claude -p` 세션 하나(Skill dedup 키가 세션 scope 라 한 세션에 여러 skill 을 태우면 결과가 오염된다)를 띄워 실제 주입된 텍스트를 디스크 SKILL.md(frontmatter 제거 + `$ARGUMENTS` 치환 + trim)와 **완전 일치**로 비교한다. 근사 판정(자릿수·도입부 비교)이 아니라 완전 일치를 쓰는 이유: shadow 된 본문은 항상 command stub 의 불활성 문자열(수십 자)이고 정상 본문은 항상 정확히 같은 글자수라, 완전 일치가 오탐·미탐 여지 없이 쓸 수 있는 오라클이기 때문이다(실측: plan skill, 주입 10124자 == 디스크 10124자).
- `scripts/validate-plugin.mjs`에 check **A9** 로 등록 — `VALIDATE_SKILL_LOAD=1` opt-in(`A6`/`VALIDATE_LINKS=1` 패턴을 그대로 따름), 기본 실행에서는 skip 되고 CLI 세션을 하나도 안 띄운다. 병렬 실행은 `SKILL_LOAD_JOBS`(기본 8, `eval/routing`의 `ROUTING_JOBS` 관례를 따름).
- outcome 4종을 코드로 분리한다 — `A9/skill-load-shadowed`(본문 불일치 또는 본문 이벤트 자체가 없음), `A9/probe-no-route`(Skill 도구가 안 불림 — shadow 단정 아닌 probe 실패), `A9/probe-cli-error`(CLI 실패·타임아웃 — 관측 자체를 못 한 것), `A9/ok`. 불일치 메시지에는 skill 이름·주입/기대 글자수·첫 불일치 offset과 양쪽 문맥을 싣는다.
- `.github/workflows/ci.yml`은 건드리지 않는다 — skill 8개 × CLI 세션 1개는 PR `check` job 예산에 안 맞고, `claude` CLI 는 구독 세션 인증이 전제라 CI 러너에는 인증 수단이 없다(#136 명시).

검증(실 repo, 8 skill 전수): `VALIDATE_SKILL_LOAD=1 node scripts/validate-plugin.mjs` 0 error(전부 `A9/ok`, 완전 일치). `shared/commands/<verb>.md`로 skill 하나를 일부러 가려 재현하면 `A9/skill-load-shadowed`가 정확히 그 skill 에 대해서만 발화하고(동시에 정적 `A1/cmd-name-shadows-skill`도 발화 — 별개 근거로 같이 잡는 게 정상), 가림 파일을 지우면 다시 0 error로 돌아온다.
