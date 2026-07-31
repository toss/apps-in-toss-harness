# agent-plugin

[한국어](./README.md) · **English**

Plugin for building [Apps in Toss](https://toss.im/) mini-apps from inside coding agents — currently supports [Claude Code](https://claude.com/claude-code). Codex and other agents are planned for later phases.

## Goal

Ties together `@ait-co/devtools`, `sdk-example`, the docs MCP, and the console MCP into a single integrated experience. Slash commands available today:

- `/ait:welcome` — confirm installation + point to the first station (`/ait:new`)
- `/ait:new` — scaffold a new mini-app
- `/ait:plan` — plan SDK domains/permissions/terms before scaffolding
- `/ait:design` — turn Figma designs into registration image assets
- `/ait:inject-devtools` / `/ait:inject-debug-console` — inject config into an existing project
- `/ait:setup-phone-preview` — real-device preview tunnel (Cloudflare quick-tunnel + launcher PWA)
- `/ait:setup-debugger` — wire the on-device debug MCP server into the project's `.mcp.json`
- `/ait:debug` — live-state debugging guidance (browser devtools panel · `window.__ait` · on-device CDP relay)

Docs lookups go through the docs MCP (`searchDocumentation`/`getPage`); console registration, bundle
upload, and status queries go through the console MCP (`miniapp_create`/`bundle_upload`/
`bundle_upload_complete`/`miniapp_get_status`) — both need a one-time authorization via `/mcp`. See
the "Skills" table in [`CLAUDE.md`](./CLAUDE.md) for the full skill list and dependency repos.

## Distribution

A **dual-distribution** model from a single repo to multiple AI coding agent marketplaces (following the [Figma `mcp-server-guide`](https://github.com/figma/mcp-server-guide) pattern).

```
agent-plugin/
├── shared/                  # source of truth (skills, commands, templates)
│   ├── skills/              # SKILL.md bundles
│   ├── commands/            # slash command entry points (thin wrappers)
│   └── templates/           # scaffolding templates
├── .claude-plugin/          # Claude Code plugin manifest (Phase 1, current) — marketplace manifest lives at the repo root
└── .codex-plugin/           # Codex (Phase 3, after spec is finalised)
```

`shared/` is the source of truth. Real logic lives in skills; slash commands are thin wrappers. See [`CLAUDE.md`](./CLAUDE.md) for architecture and decision background.

### Install

In Claude Code, add the marketplace and install the plugin:

```bash
/plugin marketplace add toss/apps-in-toss-harness
/plugin install ait@apps-in-toss
```

After installation the `/ait:` commands (`/ait:new`, `/ait:debug`, etc.) become available. The plugin name is the namespace, so the colon form is the real command — a space form (`/ait new`) does not exist.

Codex / Gemini CLI / Cursor / Windsurf are planned for Phase 2+. See the deployment-phases section in [`CLAUDE.md`](./CLAUDE.md).

## Development

### Pre-commit hook

Optional but recommended. After cloning, activate the standard pre-commit hook (runs `biome check` on staged files):

```sh
git config core.hooksPath .githooks
```

This is a developer convenience for fast feedback before push. CI runs the same checks as the enforcement layer, so contributors who don't activate the hook will still see lint failures in their PR.

## Status

See [`docs/roadmap.md`](../../docs/roadmap.md) for the full roadmap.
