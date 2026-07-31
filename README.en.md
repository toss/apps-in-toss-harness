[한국어](./README.md) · **English**

# apps-in-toss-harness

A harness monorepo that lets you go from an empty directory to a published Apps in Toss mini-app without ever leaving your AI coding agent (Claude Code, etc.). The Claude Code plugin `ait` acts as the orchestrator, weaving scaffolding, development, debugging, bundling, registration, and operations into a single flow. Scaffolding is built on `create-ait-app`; docs lookup and console integration are handled by two MCP servers enabled by default; and dev/debug tooling like devtools and debugger are wired in only when you opt in.

## Status

We're in the process of migrating tools scattered across the `apps-in-toss-community` organization into this monorepo, and we're currently in private staging. Until the public switch-over and the first `@apps-in-toss/*` npm publish, the community org repos remain canonical. `devtools`, `polyfill`, `debugger`, and `debug-console` under `packages/` have public publishing configured via `publishConfig`, but none have been published to the npm registry yet.

## Quick start

You'll need Node 24+, pnpm 11.17.0 (pinned via the root `package.json`'s `packageManager`), and an Apps in Toss console account.

> This repo is still in private staging. The two commands below only work if you have access to this repo — if you don't, the community org repos are currently canonical, as noted in "Status" above.

From Claude Code, enter the harness with these two commands:

```
/plugin marketplace add toss/apps-in-toss-harness
/plugin install ait@apps-in-toss
```

Right after installing, authorize `apps-in-toss-console` once via OAuth from `/mcp`. The docs MCP (`apps-in-toss-docs`) connects automatically, no auth required. From there, run `/ait:welcome` to see the entry map, or jump straight to `/ait:new my-app` to scaffold your first mini-app.

Claude Code is the first-class target for now. Support for other agents such as Codex is planned but not started — this repo doesn't yet ship a Codex-specific manifest.

## Development journey

1. **install** — Enter the harness via `/plugin marketplace add` → `/plugin install`, then authorize `apps-in-toss-console` from `/mcp`.
2. **plan (optional)** — Run `/ait:plan [requirements]` to work out which SDK domains, runtime permissions, and console terms you'll need before scaffolding.
3. **scaffold** — Run `/ait:new <app-name>` to create the mini-app. devtools gets wired in as a post-processing step.
4. **dev** — Run `pnpm dev` to see the mock SDK and devtools panel in your local browser — the first environment where you can develop without a Toss app.
5. **dev, real device (optional)** — Run `/ait:setup-phone-preview` to wire up a quick-tunnel + launcher PWA so you can preview on a real device's WebKit engine (no review needed).
6. **debug (optional)** — Run `/ait:setup-debugger` to wire up the debug MCP, then `/ait:debug` to inspect local and on-device state.
7. **design (optional)** — Run `/ait:design [figma-url]` to produce a logo, thumbnail, and screenshots that meet registration specs. Also needed to fill in the `brand.icon` field required by `ait build`.
8. **ship** — Run `ait build` to produce a native `.ait` bundle, then register and upload it through the console MCP's `miniapp_create` → `bundle_upload` → `bundle_upload_complete`.
9. **operate** — Check post-deploy status with the console MCP's `miniapp_get_status` and `bundle_list`.

Login wiring (station 4) is due for a redesign and isn't part of this flow yet.

## Commands

| Command | What it does | Station |
|---|---|---|
| `/ait:welcome` | Prints the harness entry map right after install and points to `/ait:new` as the first step | 0 → 1 hand-off |
| `/ait:plan [requirements]` | Turns natural-language requirements into a list of needed SDK domains, runtime permissions, and console terms (analysis only — hands off to `/ait:new`) | 7. plan |
| `/ait:new <app-name> [--template <name>] [--tds] [--sample <ids>] [--local] [--no-devtools]` | Drives `create-ait-app` non-interactively to scaffold a mini-app, then wires up devtools (mock SDK + panel) as a post-step (greenfield only) | 1. scaffold |
| `/ait:inject-devtools` | Adds the devtools unplugin to an existing project's build config (brownfield) | 2. dev |
| `/ait:inject-polyfill [--entry <path>]` | Migrates an existing project to polyfill mode — routes standard Web API calls to the SDK at runtime | 2. dev |
| `/ait:inject-debug-console` | Installs `debug-console` (on-device attach + eruda) as a dependency and wires up a self-gating import — the only debug package allowed in a production bundle | 2. dev / 3. debug |
| `/ait:setup-phone-preview` | Wires up the quick-tunnel + launcher PWA flow to preview the dev server on a real device (WebKit) | 2. dev |
| `/ait:setup-debugger` | Wires the debug MCP server (`debugger`) into the project's `.mcp.json` as an opt-in | 3. debug |
| `/ait:debug` | Debugs by branching across three environments — local browser, real-device PWA, and on-device candidate — based on what it observes | 3. debug |
| `/ait:design [figma-url]` | Checks a Figma design against mini-app UX constraints (safe-area, swipe-back, PageHeader) and produces the image assets needed for registration (does not register or upload) | 8. design |
| `ait build` (terminal command) | Generates a `.ait` native bundle from `granite.config.ts`. Fails if `brand.icon` is empty | 5. register+ship |

Stations 5 (register/upload) and 6 (status) don't have dedicated slash commands — the agent calls the console MCP tools below directly. Station 4 (auth) is also due for a redesign, so this repo has no auth-related commands yet.

## MCP servers

Installing the plugin registers two MCP servers.

| Server | Auth | Key tools |
|---|---|---|
| `apps-in-toss-docs`<br>`https://developers-apps-in-toss.toss.im/~gitbook/mcp` | None — connected as soon as it's installed | `searchDocumentation`, `getPage`, `askQuestion`, `sendFeedback` |
| `apps-in-toss-console`<br>`https://mcp.toss.im/adapters/apps-in-toss-console/mcp` | OAuth (RFC 9728) — one-time authorization from `/mcp`; needs-auth until then | `miniapp_create`, `bundle_upload`, `bundle_upload_complete`, `miniapp_get_status`, `bundle_list` |

The harness's standard registration and upload flow uses only the console MCP's OAuth session — it doesn't use a Deploy Key (the workspace-scoped credential the console UI calls an "API key") path, since the related skill has already been removed. The Deploy Key term and its auth model are still an open question being tracked, not yet finalized.

## Packages

Six packages managed as a pnpm workspace.

| Package | Directory | Role | Published |
|---|---|---|---|
| `@apps-in-toss/agent-plugin` | `packages/agent-plugin` | Agent plugin for Claude Code — orchestrates `/ait` commands, skills, and MCP manifests | Via the plugin's own distribution mechanism (not published to npm) |
| `@apps-in-toss/devtools` | `packages/devtools` | Mock SDK + floating devtools panel + generic bundler plugin | Not yet published to npm |
| `@apps-in-toss/polyfill` | `packages/polyfill` | Polyfill that routes standard Web API calls to the SDK at runtime | Not yet published to npm |
| `@apps-in-toss/debugger` | `packages/debugger` | MCP debugging daemon, on-device CDP relay, test runner, dev bridge — devDependency/npx only, never shipped in a production bundle | Not yet published to npm |
| `@apps-in-toss/debug-console` | `packages/debug-console` | On-device attach + eruda console — the only one of these allowed in a production bundle | Not yet published to npm |
| `@apps-in-toss/internal-protocol` | `packages/internal-protocol` | Device↔host wire-protocol source shared by `debugger` and `debug-console` | Workspace-internal only, not published |

## Contributing / development

```bash
pnpm install
pnpm lint       # biome check, per package
pnpm test       # vitest, per package
pnpm build      # only packages with a build script
pnpm typecheck  # only packages with a typecheck script
```

## License

[BSD-3-Clause](./LICENSE)
