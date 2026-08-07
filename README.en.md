[한국어](./README.md) · **English**

# apps-in-toss-harness

A harness monorepo that lets you go from an empty directory to a published Apps in Toss mini-app without ever leaving your AI coding agent (Claude Code, etc.). The Claude Code plugin `ait` acts as the orchestrator, weaving scaffolding, development, debugging, bundling, registration, and operations into a single flow. Scaffolding is built on `create-ait-app`; docs lookup and console integration are handled by two MCP servers enabled by default; and dev/debug tooling like devtools and debugger are wired in only when you opt in.

## Status

We hard-copied the tools that used to be scattered across the `apps-in-toss-community` organization, and this monorepo is now canonical for all four packages — agent-plugin, debugger, debug-console, and internal-protocol. There's no ongoing relationship with the community org. (devtools has been replaced by an in-house devtools living in the wf source monorepo, so the harness copy was removed.) The repo has completed its public switch-over. Packages are distributed via GitHub Releases — the first releases shipped on 2026-08-06 (`debugger-v0.2.0`, `debug-console-v0.1.4`) — there is no plan to publish to npmjs. `debugger` and `debug-console` under `packages/` follow this same distribution model.

## Quick start

You'll need Node 24+, pnpm 11.17.0 (pinned via the root `package.json`'s `packageManager`), and an Apps in Toss console account.

From Claude Code, run these two commands in order to enter the harness. Copy and paste them one line at a time.

```
/plugin marketplace add toss/apps-in-toss-harness
```

```
/plugin install ait@apps-in-toss
```

Right after installing, authorize `apps-in-toss-console` once via OAuth from `/mcp`. The docs MCP (`apps-in-toss-docs`) connects automatically, no auth required. From there, run `/ait:welcome` to see the entry map, or jump straight to `/ait:new my-app` to scaffold your first mini-app.

### Using it from Codex

The same plugin **installs in Codex as-is.** Codex reads this repo's plugin manifest directly, so no Codex-specific manifest is needed. Run these two commands in order.

```
codex plugin marketplace add toss/apps-in-toss-harness
```

```
codex plugin add ait@apps-in-toss
```

Installing brings all 8 skills plus both MCP servers — the MCP servers are registered at plugin scope, so you never touch `~/.codex/config.toml`, and they show up in `codex mcp list` right away. The console MCP needs a one-time OAuth authorization.

```
codex mcp login apps-in-toss-console
```

**Two things differ from Claude Code.**

- The `/ait:<verb>` slash-command namespace does not carry over. Codex auto-migrates a plugin's commands into skills, but `new` and `plan` — the two whose bodies rely on `$ARGUMENTS` substitution — are dropped by that migration. The skills behind them (`new-miniapp`, `plan`) are still installed, so ask in plain language instead (e.g. "scaffold a new mini-app called my-app") and you get the same procedure.
- **The debug wiring depends on Claude Code-only mechanisms.** `setup-debugger` registers the MCP server in a project-scope `.mcp.json`, and the on-device attach section of the `debug` skill assumes background execution and `/mcp` auto-start — both are Claude Code-specific and won't work as written in Codex (each skill's `adapter-note` says so). Scaffolding, development, docs lookup, and console registration/upload all work from Codex.

If you want **only the MCP servers** without the plugin, register them directly.

```
codex mcp add apps-in-toss-docs --url https://developers-apps-in-toss.toss.im/~gitbook/mcp
```

```
codex mcp add apps-in-toss-console --url https://mcp.toss.im/adapters/apps-in-toss-console/mcp --oauth-client-id mcp-gateway
```

On that path, don't drop `--oauth-client-id mcp-gateway` — the auth server doesn't support dynamic client registration (DCR), so a static client id is required. Check the result with `codex mcp list` (the docs MCP shows `Auth` as `Unsupported` since it needs none; the console MCP shows `Not logged in` until you authorize).

The commands in this section were verified against codex-cli `0.146.0`.

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

Station 4 (auth) only covers the client-side `appLogin()` mock — the server side of mini-app user login (backend token verification) is deliberately out of scope for the harness. The focus is on getting a working mini-app (client) done first; server-related knowledge and skills will be added in later stages. That's why there's no dedicated login-wiring step in this flow.

## Commands

| Command | What it does | Station |
|---|---|---|
| `/ait:welcome` | Prints the harness entry map right after install and points to `/ait:new` as the first step | 0 → 1 hand-off |
| `/ait:plan [requirements]` | Turns natural-language requirements into a list of needed SDK domains, runtime permissions, and console terms (analysis only — hands off to `/ait:new`) | 7. plan |
| `/ait:new <app-name> [--template <name>] [--tds] [--sample <ids>] [--local] [--no-devtools]` | Drives `create-ait-app` non-interactively to scaffold a mini-app, then wires up devtools (mock SDK + panel) as a post-step (greenfield only) | 1. scaffold |
| `/ait:inject-devtools` | Adds the devtools unplugin to an existing project's build config (brownfield) | 2. dev |
| `/ait:inject-debug-console` | Installs `debug-console` (on-device attach + eruda) as a dependency and wires up a self-gating import — the only debug package allowed in a production bundle | 2. dev / 3. debug |
| `/ait:setup-phone-preview` | Wires up the quick-tunnel + launcher PWA flow to preview the dev server on a real device (WebKit) | 2. dev |
| `/ait:setup-debugger` | Wires the debug MCP server (`debugger`) into the project's `.mcp.json` as an opt-in | 3. debug |
| `/ait:debug` | Debugs by branching across three environments — local browser, real-device PWA, and on-device candidate — based on what it observes | 3. debug |
| `/ait:design [figma-url]` | Checks a Figma design against mini-app UX constraints (safe-area, swipe-back, PageHeader) and produces the image assets needed for registration (does not register or upload) | 8. design |
| `ait build` (terminal command) | Generates a `.ait` native bundle from `granite.config.ts`. Fails if `brand.icon` is empty | 5. register+ship |

Stations 5 (register/upload) and 6 (status) don't have dedicated slash commands — the agent calls the console MCP tools below directly. Station 4 (auth) has no dedicated login-wiring command because the server side is deliberately out of scope for the harness (see above) — the client side already works via the `appLogin()` mock.

## MCP servers

Installing the plugin registers two MCP servers — in Claude Code and in Codex alike. To register the servers directly without the plugin, see [Using it from Codex](#using-it-from-codex) above.

| Server | Auth | Key tools |
|---|---|---|
| `apps-in-toss-docs`<br>`https://developers-apps-in-toss.toss.im/~gitbook/mcp` | None — connected as soon as it's installed | `searchDocumentation`, `getPage`, `askQuestion`, `sendFeedback` |
| `apps-in-toss-console`<br>`https://mcp.toss.im/adapters/apps-in-toss-console/mcp` | OAuth (RFC 9728) — one-time authorization from `/mcp`; needs-auth until then | `miniapp_create`, `bundle_upload`, `bundle_upload_complete`, `miniapp_get_status`, `bundle_list` |

The harness's standard registration and upload flow uses only the console MCP's OAuth session — it doesn't use a Deploy Key (the workspace-scoped credential the console UI calls an "API key") path, since the related skill has already been removed. The Deploy Key term and its auth model are still an open question being tracked, not yet finalized.

## Packages

Three packages managed as a pnpm workspace (devtools has been replaced by an in-house devtools living in the wf source monorepo, so the harness copy was removed).

| Package | Directory | Role | Published |
|---|---|---|---|
| `@apps-in-toss/agent-plugin` | `packages/agent-plugin` | Agent plugin (Claude Code and Codex) — orchestrates `/ait` commands, skills, and MCP manifests | Via the plugin's own distribution mechanism (not published to npm) |
| `@apps-in-toss/debugger` | `packages/debugger` | MCP debugging daemon, on-device CDP relay, test runner, dev bridge — devDependency/npx only, never shipped in a production bundle | GitHub Releases (`debugger-v0.2.0`) |
| `@apps-in-toss/debug-console` | `packages/debug-console` | On-device attach + eruda console — the only one of these allowed in a production bundle | GitHub Releases (`debug-console-v0.1.4`) |

`shared/internal-protocol` is the device↔host wire-protocol source shared by `debugger` and `debug-console`, but it is not a pnpm workspace member (#18 option 4) — it lives under `shared/`, not `packages/`, and both packages reach it directly via tsconfig `paths` and bundler `alias`. Not published.

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
