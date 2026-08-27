---
'@apps-in-toss/agent-plugin': patch
---

측정 인프라(`eval/`)를 repo 추적에서 빼고 `.gitignore`에 등록했다 —
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
