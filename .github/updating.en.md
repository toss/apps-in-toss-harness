[한국어](./updating.md) · **English**

# Updating

A new plugin version only registers when `plugin.json` gets a version bump.

**Claude Code.** If auto-update is on (after [installing](../README.en.md#getting-started), `/ait:welcome` offers to turn it on), Claude Code refreshes the marketplace and updates the plugin in the background within ten minutes of a session start. When something updates you get a notification asking you to run `/reload-plugins`, and if you miss it the new version loads on your next launch. To update right now, run this in your shell:

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

What moves the snapshot is `add`. Run it again even when the marketplace is already registered and it re-clones at the current HEAD of the tracked branch. The commit-hash directory is replaced wholesale, and you don't need `remove` first.

```
agent plugin marketplace add https://github.com/toss/apps-in-toss-harness
```

That refreshes the marketplace snapshot only. The plugin that actually loads lives under `~/.cursor/plugins/cache/<marketplace>/<plugin>/<commit>`, one directory per commit, so it moves to the new commit only when you reinstall. `agent plugin` has no install subcommand (`marketplace` is the only one), which makes this step interactive: in an `agent` session or the desktop editor, run `/plugins`, uninstall ait, and install it again.

Clearing the cache is no substitute. Which commit an installed plugin sits on is account-side state, not a local file (the editor's state DB holds an install id and no commit), so deleting the cache directory makes the next session fetch the same commit again, and it drags the marketplace snapshot back to that commit too. Treat deleting `~/.cursor/plugins/cache/apps-in-toss` as cleanup for a botched reinstall, not as a way to update. Reinstalling keeps your console MCP authorization and `.cursor/mcp.json` entries, which live separately from the plugin install.

This section was verified against Claude Code `2.1.250`, codex-cli `0.149.1`, and Cursor CLI `2026.08.25-3e8eec8`.

## The console MCP was renamed

The console MCP server the plugin registers is now called `ait-console` instead of `apps-in-toss-console`. The URL is the same. If you're upgrading from an older version, sign in to `ait-console` again in `/mcp`. If your permission rules mention `mcp__plugin_ait_apps-in-toss-console__*`, change them to `mcp__plugin_ait_ait-console__*` so they keep applying. The developer center's manual setup example may still use the old name; when you register the server yourself, either name works.
