[한국어](./README.md) · **English**

# apps-in-toss-harness

A harness monorepo that lets you go from an empty directory to a published Apps in Toss mini-app without ever leaving your AI coding agent (Claude Code, etc.). The Claude Code plugin `ait` acts as the orchestrator, weaving scaffolding, development, debugging, bundling, registration, and operations into a single flow. Scaffolding is built on `create-ait-app`; docs lookup and console integration are handled by two MCP servers enabled by default; and dev/debug tooling like devtools and debugger are wired in only when you opt in.

## Status

We hard-copied the tools that used to be scattered across the `apps-in-toss-community` organization, and this monorepo is now canonical for all four packages — agent-plugin, debugger, debug-console, and internal-protocol. There's no ongoing relationship with the community org. (devtools has been replaced by an in-house devtools living in the wf source monorepo, so the harness copy was removed.) This repository is public. Packages are distributed via GitHub Releases (`debugger-v0.2.1`, `debug-console-v0.1.4`) — there is no plan to publish to npmjs. Release downloads don't require authentication. `debugger` and `debug-console` under `packages/` follow this same distribution model.

## Quick start

You'll need Node 24+, pnpm 11.17.0 (pinned via the root `package.json`'s `packageManager`), git (adding the plugin marketplace fetches this repository via git clone), and an Apps in Toss console account.

From Claude Code, copy and paste the block below one line at a time, top to bottom — it takes you from entering the harness all the way to the entry map.

```
# 1) Register the harness plugin marketplace
/plugin marketplace add toss/apps-in-toss-harness

# 2) Install the ait plugin (registers 9 skills + 2 MCP servers)
/plugin install ait@apps-in-toss

# 3) Authorize the console MCP (OAuth, one time) — the docs MCP (apps-in-toss-docs) connects automatically, no auth required
/mcp

# 4) See the harness entry map
/ait:welcome
```

For step 3, pick `apps-in-toss-console` from the `/mcp` list and complete the OAuth authorization. Instead of `/ait:welcome`, you can also jump straight to `/ait:new my-app` to scaffold your first mini-app.

### Using it from Codex

The same plugin **installs in Codex as-is.** Codex reads this repo's plugin manifest directly, so no Codex-specific manifest is needed. Copy and paste the block below one line at a time, top to bottom — it takes you from entering the harness all the way to the entry map.

```
# 1) Register the harness plugin marketplace
codex plugin marketplace add toss/apps-in-toss-harness

# 2) Install the ait plugin (registers 9 skills + 2 MCP servers, no ~/.codex/config.toml edits)
codex plugin add ait@apps-in-toss

# 3) Authorize the console MCP (OAuth, one time)
codex mcp login apps-in-toss-console

# 4) See the harness entry map
/ait:welcome
```

Right after installing, both MCP servers show up in `codex mcp list` (the docs MCP shows `Auth` as `Unsupported` since it needs none; the console MCP shows `Not logged in` until you authorize).

**Two things differ from Claude Code.**

- The `/ait:<verb>` slash-command namespace does not carry over. Codex auto-migrates a plugin's commands into skills, but `new` — whose body relies on `$ARGUMENTS` substitution — is dropped by that migration. The skill behind it (`new-miniapp`) is still installed, so ask in plain language instead (e.g. "scaffold a new mini-app called my-app") and you get the same procedure. The other eight skills install directly as skills, with no command file in between. Use the phrasings in [Just ask for it](#just-ask-for-it--five-kinds-of-plain-language-examples) below — every skill also prints the slash command and its plain-language equivalent side by side when it hands off.
- **The debug wiring depends on Claude Code-only mechanisms.** `setup-debugger` registers the MCP server in a project-scope `.mcp.json`, and the on-device attach section of the `debug` skill assumes background execution and `/mcp` auto-start — both are Claude Code-specific and won't work as written in Codex (each skill's `adapter-note` says so). Scaffolding, development, docs lookup, and console registration/upload all work from Codex.

**Notes for non-interactive (`codex exec`) runs** (verified against codex-cli `0.146.1`):

- The connection-approval prompt that pops up the first time a session touches the console MCP has no UI to render under `codex exec`, so it auto-cancels. Approve it from the interactive TUI instead, or — if you accept the risk — pass `--dangerously-bypass-approvals-and-sandbox` so registration/upload can proceed.
- `codex exec resume` has no `-s`/`-C` flags, so it inherits the cwd of the shell that invoked it as-is. Resuming from a different directory can resume the wrong project, so always `cd` into the project directory before resuming.

If you want **only the MCP servers** without the plugin, register them directly.

```
codex mcp add apps-in-toss-docs --url https://developers-apps-in-toss.toss.im/~gitbook/mcp
```

```
codex mcp add apps-in-toss-console --url https://mcp.toss.im/adapters/apps-in-toss-console/mcp --oauth-client-id mcp-gateway
```

On that path, don't drop `--oauth-client-id mcp-gateway` — the auth server doesn't support dynamic client registration (DCR), so a static client id is required. Check the result with `codex mcp list` (the docs MCP shows `Auth` as `Unsupported` since it needs none; the console MCP shows `Not logged in` until you authorize).

The commands in this section were verified against codex-cli `0.146.0`; the non-interactive notes were additionally verified against `0.146.1`.

## Development journey

1. **install** — Enter the harness via `/plugin marketplace add` → `/plugin install`, then authorize `apps-in-toss-console` from `/mcp`.
2. **plan (optional)** — Run `/ait:plan [requirements]` to take a vague idea through ideation and a lightweight PRD (`PRD.md`) to a list of needed SDK domains, runtime permissions, and console terms.
3. **scaffold** — Run `/ait:new <app-name>` to create the mini-app. devtools gets wired in as a post-processing step.
4. **dev** — Run `pnpm dev` to see the mock SDK and devtools panel in your local browser — the first environment where you can develop without a Toss app.
   - At a desktop browser's default width, the mini-app layout looks different from the real thing — check it at mobile width from the AIT panel's Viewport tab (or your browser's responsive mode).
   - The real Toss app's WebView runs on WebKit (Safari's engine) on iOS, so rendering can differ from a Chromium-based local browser — open it in Safari too before shipping, or verify it on a real device with step 5's `/ait:test-on-device`.
5. **on-device check** — Run `/ait:test-on-device` to upload the bundle to the console and check it **in the real Toss app**. This is the standard path for "I want to run it on my phone": build the bundle, upload it, confirm the compile, then open the entry link the tools returned. It is not a React Native-only path — every project that produces an `.ait` bundle follows the same procedure. (`ait build` requires `brand.icon`, so run step 7's `/ait:design` first if you don't have the assets yet.)
6. **debug (optional)** — When a problem only reproduces on the phone, run `/ait:setup-debugger` to wire up the debug MCP, then `/ait:debug` to inspect local and on-device state.
7. **design (optional)** — Run `/ait:design [figma-url]` to produce a logo, thumbnail, and screenshots that meet registration specs. Also needed to fill in the `brand.icon` field required by `ait build`.
8. **ship** — The bundle build and upload already happened in step 5 (on-device check). When you're ready to release, submit it for review from the console (`review_*` / `bundle_submit_review` — an irreversible transition, so the harness skill never calls it automatically), then move on to release and promotion once it passes.
9. **operate** — Check post-deploy status with the console MCP's `miniapp_get_status` and `bundle_list`.

Station 4 (auth) only covers the client-side `appLogin()` mock — the server side of mini-app user login (backend token verification) is deliberately out of scope for the harness. The focus is on getting a working mini-app (client) done first; server-related knowledge and skills will be added in later stages. That's why there's no dedicated login-wiring step in this flow.

## Just ask for it — five kinds of plain-language examples

A `/ait:<verb>` slash command and a plain-language request **reach the same skill.** You never have to memorize the commands, and in agents where the slash namespace does not carry over (see [Using it from Codex](#using-it-from-codex) above) plain language is the standard path. Every skill's hand-off block prints **both surfaces** — the slash command and its plain-language equivalent.

| What you want | Say this | Command it reaches |
|---|---|---|
| 1. Setup | "Add the Apps in Toss devtools panel to my existing Vite project" | `/ait:inject-devtools` |
| | "Register the ait-devtools MCP server for on-device debugging in this project's .mcp.json" | `/ait:setup-debugger` |
| | "I want emoji to render as the Tossface font — wire it in as a CDN link" | `/ait:inject-tossface` |
| 2. Planning (PRD) | "I'm building a location-based coupon mini-app — first sort out the SDK domains, permissions, and terms I'll need" | `/ait:plan` |
| 3. Build and ship | "Create a new Apps in Toss mini-app called my-shop" | `/ait:new` |
| | "Scaffold an Apps in Toss mini-app project from scratch in an empty directory" | `/ait:new` |
| 4. Testing | "I want to run the mini-app I built in the real Toss app — upload the bundle so I can check it on my phone" | `/ait:test-on-device` |
| | "The mini-app behaves oddly on my phone and I want to debug its live state" | `/ait:debug` |
| 5. By feature | "I want to identify users with Toss login" (`auth`) | `/ait:plan` → development |
| | "I want to sort nearby stores by current location" (`location`) | `/ait:plan` → development |
| | "I want to sell in-app digital goods" (`iap`) | `/ait:plan` → development |
| | "I want to show in-app ads" (`ads`) | `/ait:plan` → development |
| | "I want to store favorites locally" (`storage`) | `/ait:plan` → development |

Rows 1–4 are English renderings of the exact utterances the routing gate measures (`packages/agent-plugin/eval/routing/cases.tsv`, written in Korean) — that is, "say this and that skill triggers" has been measured for those cases.

The names in parentheses in row 5 are domains from the SDK domain catalog the `plan` skill carries (18 in total). Which runtime permissions and console terms each domain drags in is what `/ait:plan` maps out, and the exact APIs and permission constants are confirmed through the docs MCP (`searchDocumentation` / `getPage`) — do not invent feature names that are not in the catalog. These five rows are examples drawn from the catalog, not routing-gate cases (a feature request on its own does not pin one skill; while you are still planning it leads to `plan`).

## Commands

| Command | What it does | Station |
|---|---|---|
| `/ait:welcome` | Prints the harness entry map right after install and points to `/ait:new` as the first step | 0 → 1 hand-off |
| `/ait:plan [requirements]` | Takes a vague idea through ideation and a lightweight PRD (`PRD.md`) to a list of needed SDK domains, runtime permissions, and console terms (planning only — hands off to `/ait:new`) | 7. plan |
| `/ait:new <app-name> [--template <name>] [--tds] [--sample <ids>] [--local] [--no-devtools]` | Drives `create-ait-app` non-interactively to scaffold a mini-app, then wires up devtools (mock SDK + panel) as a post-step (greenfield only) | 1. scaffold |
| `/ait:inject-devtools` | Adds the devtools unplugin to an existing project's build config (brownfield) | 2. dev |
| `/ait:inject-debug-console` | Installs `debug-console` (on-device attach + eruda) as a dependency and wires up a self-gating import — the only debug package allowed in a production bundle | 2. dev / 3. debug |
| `/ait:inject-tossface` | Wires the Tossface emoji web font in via a CDN link (zero bundle cost) or by bundling only the subsets the project needs (deterministic, roughly 520KB–1.9MB per subset) | 2. dev |
| `/ait:setup-debugger` | Wires the debug MCP server (`debugger`) into the project's `.mcp.json` as an opt-in | 3. debug |
| `/ait:debug` | Debugs by branching across two environments — local browser and on-device candidate — based on what it observes | 3. debug |
| `/ait:test-on-device` | Builds the bundle, uploads it via console MCP, confirms the compile, and hands over the entry link the tools returned so you can check it in the real Toss app (never submits for review, releases, or promotes) | 5. register+ship |
| `/ait:design [figma-url]` | Checks a Figma design against mini-app UX constraints (safe-area, swipe-back, PageHeader) and produces the image assets needed for registration (does not register or upload) | 8. design |
| `/ait:ux-writing [screen or files]` | Checks screen copy against UX writing principles and proposes before/after rewrites — the rewrite counterpart to design's G6 (copy) grading (never applies without user confirmation) | 8. design counterpart |
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
| `@apps-in-toss/debugger` | `packages/debugger` | MCP debugging daemon, on-device CDP relay, test runner, dev bridge — devDependency/npx only, never shipped in a production bundle | GitHub Releases (`debugger-v0.2.1`) |
| `@apps-in-toss/debug-console` | `packages/debug-console` | On-device attach + eruda console — the only one of these allowed in a production bundle | GitHub Releases (`debug-console-v0.1.4`) |

`shared/internal-protocol` is the device↔host wire-protocol source shared by `debugger` and `debug-console`, but it is not a pnpm workspace member (by design) — it lives under `shared/`, not `packages/`, and both packages reach it directly via tsconfig `paths` and bundler `alias`. Not published.

## If you run into a problem

If you run into a problem, check the [bug report guide](./.github/bug-report-guide.md) first, then [file an issue](https://github.com/toss/apps-in-toss-harness/issues/new/choose). Regardless of the repo's visibility, never paste secrets like Deploy Keys or TOTP values, or internal identifiers, into the issue body or logs.

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
