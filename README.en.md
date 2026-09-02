[한국어](./README.md) · **English**

# apps-in-toss-harness

A harness monorepo that lets you go from an empty directory to a published Apps in Toss mini-app without ever leaving your AI coding agent (Claude Code, Codex, Cursor). The agent plugin `ait` acts as the orchestrator, weaving scaffolding, development, debugging, bundling, registration, and operations into a single flow. Scaffolding is built on `create-ait-app`; docs lookup and console integration are handled by two MCP servers enabled by default; and dev/debug tooling like devtools and debugger are wired in only when you opt in.

## Quick start

You'll need Node 24+ (npm ships with it), git (adding the plugin marketplace fetches this repository via git clone), and an Apps in Toss console account.

### One command

One line in a terminal sets up every host it finds. Name a host as an argument to narrow it.

```bash
# Every detected host (with no argument it shows what it found and lets you pick)
npx -y -p github:toss/apps-in-toss-harness ait-setup

# Pick a host — claude, codex, cursor, or all
npx -y -p github:toss/apps-in-toss-harness ait-setup cursor
```

The installer registers the marketplace, installs the plugin, turns on auto-update for Claude Code, and checks whether the console MCP is actually connected. Running it again is safe: finished steps are skipped, and a re-run doubles as a refresh. Only the steps a person genuinely has to do are listed, numbered, at the end. Which ones those are depends on the host: the console MCP's browser OAuth applies everywhere, and Cursor adds the first `/plugins` pick plus turning on Enable Auto Refresh. Because Cursor enables plugins per project, a run without `--project` also leaves per-project activation to you.

**You don't need a CLI on your PATH — the desktop apps are enough.** Claude and Codex each ship a CLI inside the app bundle, and the installer finds it and installs with it. That CLI reads and writes the same user state (`~/.claude`, `~/.codex`) as the terminal CLI, so nothing diverges. The Cursor app carries no such CLI, so that is the one case that stays an instruction.

If the plugin is installed but does not show up, or shows up stale, `ait-setup --repair` tells you which of the known causes you hit. It only diagnoses; it deletes nothing.

Common options: `--dry-run` (print the plan only), `--yes` (skip confirmation), `--project` (also wire the current project), `--lang ko|en`, `--help`.

### Installing from inside an agent

Paste the block below into Claude Code's chat input box (in the desktop app, that's the Code tab session — not a terminal), one line at a time, top to bottom. It takes you from entering the harness all the way to the entry map.

```
# 1) Register the harness plugin marketplace
/plugin marketplace add toss/apps-in-toss-harness

# 2) Install the ait plugin (registers 9 skills + 2 MCP servers)
/plugin install ait@apps-in-toss

# 3) Authorize the console MCP (OAuth, one time) — the docs MCP (apps-in-toss-docs) connects automatically, no auth required
/mcp

# 4) Turn on auto-update (Marketplaces > apps-in-toss > Enable auto-update)
/plugin

# 5) See the harness entry map
/ait:welcome
```

For step 3, pick `apps-in-toss-console` from the `/mcp` list and complete the OAuth authorization. For step 4, `/plugin` opens the plugin manager: choose Marketplaces, select `apps-in-toss`, and press Enable auto-update. Third-party marketplaces start with auto-update off, so you have to turn it on once. Instead of `/ait:welcome`, you can also jump straight to `/ait:new my-app` to scaffold your first mini-app.

**Don't search for `ait` in the desktop app's plugin browser.** Search results only surface plugins from the official marketplace, so `ait` won't show up there. Installation goes through pasting the commands above into the chat input, not through search.

If the slash commands above don't work in your environment, paste the whole sentence below into the chat input instead. Claude runs the install from its own shell, so you never have to open a terminal.

```
Install the Apps in Toss mini-app dev plugin. In the shell, run `npx -y -p github:toss/apps-in-toss-harness ait-setup claude --yes`, then tell me any manual steps its output still lists.
```

That sentence calls the same installer as "One command" above. It registers the marketplace, installs the plugin, and turns auto-update on, then reports whatever is left. Don't ask an agent to edit `~/.claude/settings.json` by hand: the `source` under `extraKnownMarketplaces` belongs to the CLI (a sparse registration keeps `sparsePaths` in there), and overwriting it wholesale makes the declaration disagree with the on-disk clone, after which Claude Code stops finding that marketplace at all.

Installed plugins only load starting from a new session. Follow whatever steps the installer lists at the end, then open a new session and run `/ait:welcome`.

### Using it from Codex

The same plugin **installs in Codex as-is.** Codex reads this repo's plugin manifest directly, so no Codex-specific manifest is needed. Copy and paste the block below one line at a time, top to bottom, and it takes you from entering the harness all the way to the entry map.

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

- The slash-command namespace (`/ait:<verb>`) does not carry over. Codex auto-migrates a plugin's commands into skills, but `new` is dropped by that migration, since its body relies on `$ARGUMENTS` substitution.
  - The skill behind it (`new-miniapp`) is still installed, so ask in plain language instead (e.g. "scaffold a new mini-app called my-app") and you get the same procedure.
  - The other eight skills install directly as skills, with no command file in between. Use the phrasings in [Just ask for it](#just-ask-for-it--five-kinds-of-plain-language-examples) below; every skill also prints the slash command and its plain-language equivalent side by side when it hands off.
- **The debug wiring depends on Claude Code-only mechanisms.** `setup-debugger` registers the MCP server in a project-scope `.mcp.json`, and the on-device attach section of the `debug` skill assumes background execution and `/mcp` auto-start. Both are Claude Code-specific and won't work as written in Codex (each skill's `adapter-note` says so). Scaffolding, development, docs lookup, and console registration/upload all work from Codex.

**Notes for non-interactive (`codex exec`) runs** (verified against codex-cli `0.146.1`):

- The connection-approval prompt that pops up the first time a session touches the console MCP has no UI to render under `codex exec`, so it auto-cancels. Approve it from the interactive TUI instead, or, if you accept the risk, pass `--dangerously-bypass-approvals-and-sandbox` so registration/upload can proceed.
- `codex exec resume` has no `-s`/`-C` flags, so it inherits the cwd of the shell that invoked it as-is. Resuming from a different directory can resume the wrong project, so always `cd` into the project directory before resuming.

If you want **only the MCP servers** without the plugin, register them directly.

```
codex mcp add apps-in-toss-docs --url https://developers-apps-in-toss.toss.im/~gitbook/mcp
```

```
codex mcp add apps-in-toss-console --url https://mcp.toss.im/adapters/apps-in-toss-console/mcp --oauth-client-id mcp-gateway
```

On that path, don't drop `--oauth-client-id mcp-gateway`: the auth server doesn't support dynamic client registration (DCR), so a static client id is required. Check the result with `codex mcp list` (the docs MCP shows `Auth` as `Unsupported` since it needs none; the console MCP shows `Not logged in` until you authorize).

The commands in this section were verified against codex-cli `0.146.0`; the non-interactive notes were additionally verified against `0.146.1`.

### Using it from Cursor

Cursor reads its own plugin format, so this repo ships a Cursor manifest (`.cursor-plugin/`) alongside the Claude Code one. Register the marketplace from the CLI, then install inside an interactive session (there is no non-interactive install command yet).

```
# 1) Register the harness plugin marketplace (the toss/… shorthand fails; use the full URL)
agent plugin marketplace add https://github.com/toss/apps-in-toss-harness

# 2) Install the ait plugin — from an interactive session
agent
/plugins        # pick ait from the marketplace list and install it

# 3) Turn on auto-refresh (/plugins > apps-in-toss > Enable Auto Refresh)
/plugins

# 4) See the harness entry map (skills use flat names, no namespace)
/welcome
```

The install is **activated per project.** Installing from `/plugins` records it in the current project's `.cursor/settings.json`, and other projects need their own activation. Sessions in an activated project expose all nine skills and the four docs-MCP tools right away. Plugin-provided MCP servers do not appear in `agent mcp list`; that command only covers servers registered in `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global).

**Authorize the console MCP from the desktop editor.** While unauthorized, the plugin's console MCP exposes a single `mcp_auth` tool, and calling it from the CLI returns "Interactive MCP authentication is only available in the Cursor desktop IDE". Authorizing from the editor opens the full console toolset (102 tools) to that project's editor sessions. The authorization does not carry over to CLI sessions, so to use the console MCP from a CLI session, register the servers directly in `.cursor/mcp.json` (the plugin-less path below) and authorize there.

**Four things differ from Claude Code.**

- The slash-command namespace (`/ait:<verb>`) does not carry over. You invoke skills by their flat names: `/welcome` shows up as a first-class slash command, and typing `/ait:welcome` still reaches the same skill through model interpretation.
- The four command stubs (`/ait:new` and friends) are not installed. Use the phrasings in [Just ask for it](#just-ask-for-it--five-kinds-of-plain-language-examples) below. For scaffolding, asking "scaffold a new mini-app called my-app" runs the `new-miniapp` skill through the same procedure.
- `setup-debugger` wires the debug MCP into **`.cursor/mcp.json`**, not `.mcp.json` (a `"type": "stdio"` entry; the skill detects the host and handles this on its own).
- On-device debugging (the attach section of the `debug` skill) depends on Claude Code-only mechanisms, the same limitation as in Codex. Scaffolding, development, docs lookup, and console registration/upload are all available from Cursor (verified up to skill injection, MCP connectivity, and console authorization).

**Notes for non-interactive (`agent -p`) runs:**

- `agent plugin marketplace add` is scriptable, but the install itself is interactive-only (`/plugins`), and console authorization needs a browser (the editor, or `agent mcp login`).
- In some proxy environments `agent -p` hangs forever with no output (proxies that break HTTP/2 streaming). Adding `"network": { "useHttp1ForAgent": true }` to `~/.cursor/cli-config.json` fixes it.

If you want **only the MCP servers** without the plugin, create `.cursor/mcp.json` in your project and register them directly.

```json
{
  "mcpServers": {
    "apps-in-toss-docs": {
      "url": "https://developers-apps-in-toss.toss.im/~gitbook/mcp"
    },
    "apps-in-toss-console": {
      "url": "https://mcp.toss.im/adapters/apps-in-toss-console/mcp",
      "auth": {
        "CLIENT_ID": "mcp-gateway"
      }
    }
  }
}
```

On that path, don't drop `auth.CLIENT_ID`: the auth server doesn't support dynamic client registration (DCR), so a static client id is required. After registering, you can finish server approval and console authorization from the CLI.

```
agent mcp enable apps-in-toss-docs
agent mcp enable apps-in-toss-console
agent mcp login apps-in-toss-console
```

Once authorized, `agent mcp list` shows both servers as `ready` (the docs MCP needs no auth, so it turns `ready` right after enable; the console MCP shows `requires_authentication` until then).

The commands in this section were verified against Cursor CLI `2026.08.25-3e8eec8`.

## Updating

A new plugin version only registers when `plugin.json` gets a version bump.

**Claude Code.** With auto-update turned on in step 4 of the quick start, Claude Code refreshes the marketplace and updates the plugin in the background within ten minutes of a session start. When something updates you get a notification asking you to run `/reload-plugins`, and if you miss it the new version loads on your next launch. To update right now, run this in your shell:

```
claude plugin marketplace update apps-in-toss
claude plugin update ait@apps-in-toss
```

`claude plugin update` defaults to the `user` scope. If you installed at a different scope, pass it (for example `--scope project`). Afterwards, run `/reload-plugins` in your session or start a new one.

If you would rather not open a terminal, paste this into the chat input:

```
Update the ait plugin to the latest version. In the shell, run `claude plugin list --json` to find the scope of `ait@apps-in-toss`, then run `claude plugin marketplace update apps-in-toss` and `claude plugin update ait@apps-in-toss --scope <that scope>`, and when done tell me to run /reload-plugins.
```

**Codex.** Codex re-checks every registered git marketplace when a session starts and pulls new commits on its own. There is nothing to turn on. To update right now, run the commands below; the new version loads from the next session.

```
codex plugin marketplace upgrade apps-in-toss
codex plugin list
```

`codex plugin marketplace upgrade` prints no version, so confirm with the VERSION column of `codex plugin list`. Inside the TUI, `/plugins` followed by `Ctrl+U` does the same thing.

**Cursor.** Cursor handles updates per marketplace rather than per plugin. The installed-plugin screen only offers Uninstall, with no update button. The `apps-in-toss` marketplace entry in `/plugins` carries an Enable Auto Refresh toggle, in both the desktop editor and the `agent` CLI, and Cursor's documentation says turning it on keeps plugins in step with the branch the marketplace tracks. In our own measurement, though, the local snapshot (both the marketplace clone and the install cache) sat unchanged 12 hours and 13 commits after the toggle went on, with the editor running and a fresh CLI session opened.

`agent plugin marketplace update` sounds like the refresh, but it fetches nothing. It prints `✓ Updated marketplace apps-in-toss: 1 plugin indexed` while the clone's `.git/FETCH_HEAD` and `.git/HEAD` stay put and HEAD stays on the old commit (checked twice, on two different snapshots). All it does is re-index the snapshot already on disk.

What moves the snapshot is `add`. Run it again even when the marketplace is already registered and it re-clones at the current HEAD of the tracked branch — the commit-hash directory is replaced wholesale, and you don't need `remove` first. Re-running the install script from the quick start does the same thing.

```
agent plugin marketplace add https://github.com/toss/apps-in-toss-harness
```

That refreshes the marketplace snapshot only. The plugin that actually loads lives under `~/.cursor/plugins/cache/<marketplace>/<plugin>/<commit>`, one directory per commit, so it moves to the new commit only when you reinstall. `agent plugin` has no install subcommand (`marketplace` is the only one), which makes this step interactive: in an `agent` session or the desktop editor, run `/plugins`, uninstall ait, and install it again.

Clearing the cache is no substitute. Which commit an installed plugin sits on is account-side state, not a local file — the editor's state DB holds an install id and no commit — so deleting the cache directory makes the next session fetch **the same commit** again, and it drags the marketplace snapshot back to that commit too. Treat deleting `~/.cursor/plugins/cache/apps-in-toss` as cleanup for a botched reinstall, not as a way to update. Reinstalling keeps your console MCP authorization and `.cursor/mcp.json` entries, which live separately from the plugin install.

This section was verified against Claude Code `2.1.250`, codex-cli `0.149.1`, and Cursor CLI `2026.08.25-3e8eec8`.

## Development journey

1. **install** — Enter the harness via `/plugin marketplace add` → `/plugin install`, authorize `apps-in-toss-console` from `/mcp`, then turn on auto-update from `/plugin`.
2. **plan (optional)** — Run `/ait:plan [requirements]` to take a vague idea through ideation and a lightweight PRD (`PRD.md`) to a list of needed SDK domains, runtime permissions, and console terms.
3. **scaffold** — Run `/ait:new <app-name>` to create the mini-app. Post-processing wires in devtools and also seeds a design guide: tokens, hard rules, six icons, `docs/design-guide.md`, and the Tossface emoji font. A summary lands in `AGENTS.md`, which agents read automatically, so any later session that builds a screen works to the same standard (`--no-design-guide` skips all of it, `--no-tossface` skips just the font).
4. **dev** — Run `npm run dev` to see the mock SDK and devtools panel in your local browser, the first environment where you can develop without a Toss app.
   - At a desktop browser's default width, the mini-app layout looks different from the real thing. Check it at mobile width from the AIT panel's Viewport tab (or your browser's responsive mode).
   - The real Toss app's WebView runs on WebKit (Safari's engine) on iOS, so rendering can differ from a Chromium-based local browser. Open it in Safari too before shipping, or verify it on a real device with step 5's `/ait:test-on-device`.
5. **on-device check** — Run `/ait:test-on-device` to upload the bundle to the console and check it **in the real Toss app**. This is the standard path for "I want to run it on my phone": build the bundle, upload it, confirm the compile, then open the entry link the tools returned. It is not a React Native-only path: every project that produces an `.ait` bundle follows the same procedure. (`ait build` requires `brand.icon`, so run step 7's `/ait:design` first if you don't have the assets yet.)
6. **debug (optional)** — When a problem only reproduces on the phone, run `/ait:setup-debugger` to wire up the debug MCP, then `/ait:debug` to inspect local and on-device state.
7. **design** — Run `/ait:design [screen or request]` to create and fix screens: from scratch when the project has none, or by diagnosing existing ones and editing the code to clear hard-rule violations (body text size floor, 44px touch targets, bottom CTA safe area). The same command maps a Figma design and produces the registration assets — logo, thumbnail, screenshots. Also needed to fill in the `brand.icon` field required by `ait build`.
8. **ship** — The bundle build and upload already happened in step 5 (on-device check). When you're ready to release, submit it for review from the console (`review_*` / `bundle_submit_review`, an irreversible transition, so the harness skill never calls it automatically), then move on to release and promotion once it passes.
9. **operate** — Check post-deploy status with the console MCP's `miniapp_get_status` and `bundle_list`.

Station 4 (auth) only covers the client-side `appLogin()` mock. The server side of mini-app user login (backend token verification) is deliberately out of scope for the harness. The focus is on getting a working mini-app (client) done first; server-related knowledge and skills will be added in later stages. That's why there's no dedicated login-wiring step in this flow.

## Just ask for it — five kinds of plain-language examples

A `/ait:<verb>` slash command and a plain-language request **reach the same skill.** You never have to memorize the commands, and in agents where the slash namespace does not carry over (see [Using it from Codex](#using-it-from-codex) and [Using it from Cursor](#using-it-from-cursor) above) plain language is the standard path. Every skill's hand-off block prints both surfaces: the slash command and its plain-language equivalent.

| What you want | Say this | Command it reaches |
|---|---|---|
| 1. Setup | "Add the Apps in Toss devtools panel to my existing Vite project" | `/ait:inject-devtools` |
| | "Set up the debugger connection ahead of time so I can debug on my phone later" | `/ait:setup-debugger` |
| | "I want emoji to render as the Tossface font — wire it in as a CDN link" | `/ait:inject-tossface` |
| 2. Planning (PRD) | "I'm building a location-based coupon mini-app — first sort out the SDK domains, permissions, and terms I'll need" | `/ait:plan` |
| 3. Build and ship | "Create a new Apps in Toss mini-app called my-shop" | `/ait:new` |
| | "Scaffold an Apps in Toss mini-app project from scratch in an empty directory" | `/ait:new` |
| | "This screen looks ugly. Make it look good." | `/ait:design` |
| 4. Testing | "I want to run the mini-app I built in the real Toss app — upload the bundle so I can check it on my phone" | `/ait:test-on-device` |
| | "The mini-app behaves oddly on my phone and I want to debug its live state" | `/ait:debug` |
| 5. By feature | "I want to identify users with Toss login" (`auth`) | `/ait:plan` → development |
| | "I want to sort nearby stores by current location" (`location`) | `/ait:plan` → development |
| | "I want to sell in-app digital goods" (`iap`) | `/ait:plan` → development |
| | "I want to show in-app ads" (`ads`) | `/ait:plan` → development |
| | "I want to store favorites locally" (`storage`) | `/ait:plan` → development |

Rows 1–4 are English renderings of utterances verified by routing regression measurement: "say this and that skill triggers" has been confirmed empirically for those cases.

The names in parentheses in row 5 are domains from the SDK domain catalog the `plan` skill carries (18 in total). Which runtime permissions and console terms each domain drags in is what `/ait:plan` maps out, and the exact APIs and permission constants are confirmed through the docs MCP (`searchDocumentation` / `getPage`); do not invent feature names that are not in the catalog. These five rows are examples drawn from the catalog, not routing-gate cases (a feature request on its own does not pin one skill; while you are still planning it leads to `plan`).

## Commands

| Command | What it does | Station |
|---|---|---|
| `/ait:welcome` | Prints the harness entry map right after install, checks environment/integration state (git, Node/npm/npx, MCP exposure, etc.), and suggests/hands off the next step | 0 → 1 hand-off |
| `/ait:plan [requirements]` | Takes a vague idea through ideation and a lightweight PRD (`PRD.md`) to a list of needed SDK domains, runtime permissions, and console terms (planning only — hands off to `/ait:new`) | 7. plan |
| `/ait:new <app-name> [--template <name>] [--tds] [--sample <ids>] [--local] [--no-devtools] [--no-design-guide] [--no-tossface]` | Drives `create-ait-app` non-interactively to scaffold a mini-app, then wires up devtools (mock SDK + panel) and seeds the design guide (tokens, CSS, icons, `AGENTS.md`) as post-steps (greenfield only) | 1. scaffold |
| `/ait:inject-devtools` | Adds the devtools unplugin to an existing project's build config (brownfield) | 2. dev |
| `/ait:inject-debug-console` | Installs `debug-console` (on-device attach + eruda) as a dependency and wires up a self-gating import — the only debug package allowed in a production bundle | 2. dev / 3. debug |
| `/ait:inject-tossface` | Wires the Tossface emoji web font in via a CDN link (zero bundle cost) or by bundling only the subsets the project needs (deterministic, roughly 520KB–1.9MB per subset) | 2. dev |
| `/ait:setup-debugger` | Wires the debug MCP server (`debugger`) into the project's `.mcp.json`, or `.cursor/mcp.json` on Cursor, as an opt-in | 3. debug |
| `/ait:debug` | Debugs by branching across two environments — local browser and on-device candidate — based on what it observes | 3. debug |
| `/ait:test-on-device` | Builds the bundle, uploads it via console MCP, confirms the compile, and hands over the entry link the tools returned so you can check it in the real Toss app (never submits for review, releases, or promotes) | 5. register+ship |
| `/ait:design [screen or request]` | Creates or fixes screens — from scratch, diagnosing and auto-fixing existing ones, mapping a Figma design, and producing the registration image assets. Hard-rule violations are fixed in the code, not just reported (does not register or upload) | 8. design |
| `/ait:ux-writing [screen or files]` | Checks screen copy against UX writing principles and proposes before/after rewrites — the rewrite counterpart to design's G6 (copy) grading (never applies without user confirmation) | 8. design counterpart |
| `ait build` (terminal command) | Generates a `.ait` native bundle from `granite.config.ts`. Fails if `brand.icon` is empty | 5. register+ship |

Stations 5 (register/upload) and 6 (status) don't have dedicated slash commands; the agent calls the console MCP tools below directly. Station 4 (auth) has no dedicated login-wiring command because the server side is deliberately out of scope for the harness (see above). The client side already works via the `appLogin()` mock.

## MCP servers

Installing the plugin registers two MCP servers, in Claude Code, Codex, and Cursor alike. To register the servers directly without the plugin, see [Using it from Codex](#using-it-from-codex) or [Using it from Cursor](#using-it-from-cursor) above.

| Server | Auth | Key tools |
|---|---|---|
| `apps-in-toss-docs`<br>`https://developers-apps-in-toss.toss.im/~gitbook/mcp` | None — connected as soon as it's installed | `searchDocumentation`, `getPage`, `askQuestion`, `sendFeedback` |
| `apps-in-toss-console`<br>`https://mcp.toss.im/adapters/apps-in-toss-console/mcp` | OAuth (RFC 9728) — one-time authorization from `/mcp`; needs-auth until then | `miniapp_create`, `bundle_upload`, `bundle_upload_complete`, `miniapp_get_status`, `bundle_list` |

The harness's standard registration and upload flow uses only the console MCP's OAuth session. It doesn't use a Deploy Key (the workspace-scoped credential the console UI calls an "API key") path, since the related skill has already been removed. The Deploy Key term and its auth model are still an open question being tracked, not yet finalized.

## Packages

Three packages managed as a pnpm workspace.

| Package | Directory | Role | Published |
|---|---|---|---|
| `@apps-in-toss/agent-plugin` | `packages/agent-plugin` | Agent plugin (Claude Code, Codex, and Cursor) — orchestrates `/ait` commands, skills, and MCP manifests | Via the plugin's own distribution mechanism (not published to npm) |
| `@apps-in-toss/debugger` | `packages/debugger` | MCP debugging daemon, on-device CDP relay, test runner, dev bridge — devDependency/npx only, never shipped in a production bundle | GitHub Releases (`debugger-v0.2.2`) |
| `@apps-in-toss/debug-console` | `packages/debug-console` | On-device attach + eruda console — the only one of these allowed in a production bundle | GitHub Releases (`debug-console-v0.1.5`) |

`shared/internal-protocol` is the device↔host wire-protocol source shared by `debugger` and `debug-console`, but it is not a pnpm workspace member (by design). It lives under `shared/`, not `packages/`, and both packages reach it directly via tsconfig `paths` and bundler `alias`. Not published.

`debugger` and `debug-console` are not published to npm. They're distributed via GitHub Releases (`debugger-v0.2.2`, `debug-console-v0.1.5`), and downloads don't require authentication.

## If you run into a problem

If you run into a problem, check the [bug report guide](./.github/bug-report-guide.md) first, then [file an issue](https://github.com/toss/apps-in-toss-harness/issues/new/choose). Never paste secrets like Deploy Keys or TOTP values, or internal identifiers, into the issue body or logs.

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
