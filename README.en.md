[한국어](./README.md) · **English**

# apps-in-toss-harness

This repo holds `ait`, a plugin for building Apps in Toss mini-apps by talking to an AI coding agent. Say "I want to build a daily check-in mini-app" and the agent writes up a plan, creates the project, builds the screens and opens the result in the Toss app on your phone. Review submission happens inside the agent too. It works in Claude Code, Codex and Cursor.

## Getting started

If you're new to coding or haven't installed an AI tool yet, start with [Creating a Mini App](https://developers-apps-in-toss.toss.im/ai-vibe-coding/en) on the developer center. It covers everything from installing the tool to launch, with screenshots and videos.

If you already use Claude Code, have Node 24+ and git ready, then enter these lines one at a time. They go in the Claude Code chat input, not your terminal.

```
/plugin marketplace add toss/apps-in-toss-harness
/plugin install ait@apps-in-toss
/mcp
/ait:welcome
```

In `/mcp`, pick `ait-console` and sign in once with your Apps in Toss console account. The last line, `/ait:welcome`, checks your setup and tells you what to do next. Marketplaces you add yourself start with auto-update off; welcome notices this and offers to turn it on. Say yes and new versions arrive on their own. If a command doesn't show up, open a new session and enter it again.

The desktop app's plugin search won't find `ait`. If slash commands don't work where you are, paste this sentence as is and the agent will install from its shell:

```
Install the Apps in Toss mini-app plugin. In the shell, run `claude plugin marketplace add toss/apps-in-toss-harness` and then `claude plugin install ait@apps-in-toss`. Don't edit `~/.claude/settings.json` directly. When you're done, tell me the remaining manual step (authorize ait-console in `/mcp`), and tell me to open a new session and type /ait:welcome.
```

To install in Codex or Cursor, see [Using it from Codex and Cursor](./.github/other-hosts.en.md).

## How to use it

You don't need to remember commands. Say what you want and the agent picks the right step.

- "Make me a new Apps in Toss mini-app called my-shop"
- "The screen looks rough, make it look nicer"
- "I want to try the mini-app in the real Toss app"
- "Look it over before I submit for review"

When you want to pick the step yourself, use these. You usually go top to bottom.

| Command | What it does |
|---|---|
| `/ait:plan` | Turns your idea into a plan (`PRD.md`) and points out the SDK features, permissions and console terms you'll need. |
| `/ait:new <app-name>` | Creates a new project with `create-ait-app` and wires in devtools so it runs in a browser without the Toss app. |
| `/ait:design` | Builds or fixes screens. Fixes text and touch targets that are too small right in the code, and makes the logo and screenshots for console registration. |
| `/ait:feature` | Adds SDK features such as ads, in-app purchases, sharing, leaderboards, haptics and storage to your project. Writes them to fit your stack and SDK version, and tells you what to set up in the console first. |
| `/ait:test-on-device` | Builds the bundle, uploads it to the console and gives you a link to open in your Toss app. If the app has in-app purchases, it tells you first that payments are real. |
| `/ait:debug` | Looks at the app's state in the browser or on your phone, finds the cause and fixes it. |
| `/ait:launch` | Runs the launch checklist and submits for review once you approve. If you were rejected, run it with the reason. |
| `/ait:server` | Writes server code that stores user data or adds Toss login. Keeps whatever you already chose, such as Cloudflare Workers, Supabase or Firebase. |
| `/ait:ux-writing` | Shows before/after rewrites of your screen copy and changes only the ones you pick. |
| `/ait:inject-devtools`<br>`/ait:inject-debug-console`<br>`/ait:inject-tossface` | Adds devtools, the `debug-console` for phone debugging, or the Tossface font to an existing project. |
| `/ait:setup-debugger` | Registers the MCP server for phone debugging in your project settings. Run it once before using `/ait:debug` on a phone. |
| `/ait:welcome` | Checks your setup and tells you the next step. |

Codex and Cursor name the slash commands a little differently, so asking in plain words is easier there.

## MCP servers that come with it

| Server | URL | Sign-in |
|---|---|---|
| `apps-in-toss-docs` | `https://developers-apps-in-toss.toss.im/~gitbook/mcp` | Not needed |
| `ait-console` | `https://mcp.toss.im/adapters/apps-in-toss-console/mcp` | Once, with your console account (OAuth) |

The agent reads developer center docs through `apps-in-toss-docs`, and registers apps and uploads bundles through `ait-console`. If you're moving over from the old name `apps-in-toss-console`, see [Updating](./.github/updating.en.md#the-console-mcp-was-renamed).

## What the agent won't do

Only `/ait:launch` submits for review, and it shows you the request first and sends it only if you approve. It doesn't release, roll back or run promotions; do those in the console. It deploys servers only when you ask. It reaches the console through OAuth sign-in only and never uses a Deploy Key.

## More

- [Using it from Codex and Cursor](./.github/other-hosts.en.md)
- [Updating](./.github/updating.en.md)
- [Install troubleshooting](./.github/install-troubleshooting.en.md)
- [Bug report guide](./.github/bug-report-guide.md): read it, then [open an issue](https://github.com/toss/apps-in-toss-harness/issues/new/choose). Don't paste secrets or internal identifiers.

## Contributing

This is a pnpm workspace. pnpm is pinned to 12.10.1 through `packageManager`.

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm typecheck
```

Behind a proxy that rewrites npm registry responses, pnpm 11.x can fail to switch to 12.10.1 and leave tarball URLs in `pnpm-lock.yaml`. If that happens, install it directly with `npm install -g pnpm@12.10.1` and check that `git diff pnpm-lock.yaml` is empty afterwards.

| Package | What it does | Distribution |
|---|---|---|
| `packages/agent-plugin` | The plugin itself: commands, skills, MCP config | Plugin marketplace |
| `packages/debugger` | Debug MCP server, phone relay, test runner. Development only. | GitHub Releases (`debugger-v0.2.7`) |
| `packages/debug-console` | Runtime inside the phone that connects to the debugger. The only package that can ship in a production bundle. | GitHub Releases (`debug-console-v0.2.0`) |

`debugger` and `debug-console` aren't published to npm. They ship only through GitHub Releases and download without authentication. The wire-protocol source they share lives outside the workspace in `shared/internal-protocol`.

## License

[BSD-3-Clause](./LICENSE)
