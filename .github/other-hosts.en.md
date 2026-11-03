[한국어](./other-hosts.md) · **English**

# Using it from Codex and Cursor

The `ait` plugin also installs in Codex and Cursor, not just Claude Code. The basic setup is in the [README](../README.en.md#getting-started); this page collects the install commands for those two agents and what works differently from Claude Code.

## Using it from Codex

The same plugin installs in Codex as-is. Codex reads this repo's plugin manifest directly, so no Codex-specific manifest is needed. Paste the block below one line at a time, top to bottom. It goes from registering the marketplace to the getting-started overview.

```
# 1) Register the harness plugin marketplace
codex plugin marketplace add toss/apps-in-toss-harness

# 2) Install the ait plugin (registers 12 skills + 2 MCP servers, no ~/.codex/config.toml edits)
codex plugin add ait@apps-in-toss

# 3) Authorize the console MCP (OAuth, one time)
codex mcp login ait-console

# 4) See the harness entry map
/ait:welcome
```

Right after installing, both MCP servers show up in `codex mcp list` (the docs MCP shows `Auth` as `Unsupported` since it needs none; the console MCP shows `Not logged in` until you authorize).

Two things differ from Claude Code.

- The slash-command namespace (`/ait:<verb>`) does not carry over. Codex auto-migrates a plugin's commands into skills, but `new` is dropped by that migration, since its body relies on `$ARGUMENTS` substitution.
  - The skill behind it (`new-miniapp`) is still installed, so ask in plain language instead (e.g. "scaffold a new mini-app called my-app") and you get the same procedure.
  - The other eleven skills install directly as skills, with no command file in between. Use the example phrasings in the [README](../README.en.md#how-to-use-it); every skill also prints the slash command and its plain-language equivalent side by side when it hands off.
- The debug wiring depends on Claude Code-only mechanisms. `setup-debugger` registers the MCP server in a project-scope `.mcp.json`, and the on-device attach section of the `debug` skill assumes background execution and `/mcp` auto-start. Both are Claude Code-specific and won't work as written in Codex (each skill's `adapter-note` says so). Scaffolding, development, docs lookup, and console registration/upload all work from Codex.

Notes for non-interactive (`codex exec`) runs (verified against codex-cli `0.146.1`):

- The connection-approval prompt that pops up the first time a session touches the console MCP has no UI to render under `codex exec`, so it auto-cancels. Approve it from the interactive TUI instead, or, if you accept the risk, pass `--dangerously-bypass-approvals-and-sandbox` so registration/upload can proceed.
- `codex exec resume` has no `-s`/`-C` flags, so it inherits the cwd of the shell that invoked it as-is. Resuming from a different directory can resume the wrong project, so always `cd` into the project directory before resuming.

If you want only the MCP servers without the plugin, register them directly.

```
codex mcp add apps-in-toss-docs --url https://developers-apps-in-toss.toss.im/~gitbook/mcp
```

```
codex mcp add ait-console --url https://mcp.toss.im/adapters/apps-in-toss-console/mcp --oauth-client-id mcp-gateway
```

On that path, don't drop `--oauth-client-id mcp-gateway`: the auth server doesn't support dynamic client registration (DCR), so a static client id is required. Check the result with `codex mcp list` (the docs MCP shows `Auth` as `Unsupported` since it needs none; the console MCP shows `Not logged in` until you authorize).

The commands in this section were verified against codex-cli `0.146.0`; the non-interactive notes were additionally verified against `0.146.1`.

## Using it from Cursor

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

The install is activated per project. Installing from `/plugins` records it in the current project's `.cursor/settings.json`, and other projects need their own activation. Sessions in an activated project expose all twelve skills and the four docs-MCP tools right away. Plugin-provided MCP servers do not appear in `agent mcp list`; that command only covers servers registered in `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global).

Authorize the console MCP from the desktop editor. While unauthorized, the plugin's console MCP exposes a single `mcp_auth` tool, and calling it from the CLI returns "Interactive MCP authentication is only available in the Cursor desktop IDE". Authorizing from the editor opens the full console toolset to that project's editor sessions. The authorization does not carry over to CLI sessions, so to use the console MCP from a CLI session, register the servers directly in `.cursor/mcp.json` (the plugin-less path below) and authorize there.

Four things differ from Claude Code.

- The slash-command namespace (`/ait:<verb>`) does not carry over. You invoke skills by their flat names: `/welcome` shows up as a first-class slash command, and typing `/ait:welcome` still reaches the same skill through model interpretation.
- The four command stubs (`/ait:new` and friends) are not installed. Use the example phrasings in the [README](../README.en.md#how-to-use-it). For scaffolding, asking "scaffold a new mini-app called my-app" runs the `new-miniapp` skill through the same procedure.
- `setup-debugger` wires the debug MCP into `.cursor/mcp.json`, not `.mcp.json` (a `"type": "stdio"` entry; the skill detects the host and handles this on its own).
- On-device debugging (the attach section of the `debug` skill) depends on Claude Code-only mechanisms, the same limitation as in Codex. Scaffolding, development, docs lookup, and console registration/upload are all available from Cursor (verified up to skill injection, MCP connectivity, and console authorization).

Notes for non-interactive (`agent -p`) runs:

- `agent plugin marketplace add` is scriptable, but the install itself is interactive-only (`/plugins`), and console authorization needs a browser (the editor, or `agent mcp login`).
- In some proxy environments `agent -p` hangs forever with no output (proxies that break HTTP/2 streaming). Adding `"network": { "useHttp1ForAgent": true }` to `~/.cursor/cli-config.json` fixes it.

If you want only the MCP servers without the plugin, create `.cursor/mcp.json` in your project and register them directly.

```json
{
  "mcpServers": {
    "apps-in-toss-docs": {
      "url": "https://developers-apps-in-toss.toss.im/~gitbook/mcp"
    },
    "ait-console": {
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
agent mcp enable ait-console
agent mcp login ait-console
```

Once authorized, `agent mcp list` shows both servers as `ready` (the docs MCP needs no auth, so it turns `ready` right after enable; the console MCP shows `requires_authentication` until then).

The commands in this section were verified against Cursor CLI `2026.08.25-3e8eec8`.
