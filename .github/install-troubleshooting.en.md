[한국어](./install-troubleshooting.md) · **English**

# Install troubleshooting

## When to read this

- The plugin doesn't show up in the list. `claude plugin list` has no `ait@apps-in-toss`, or it's there but no skills show up.
- Updates don't take effect. You shipped a new version but a session never picks it up.
- It's installed but skills don't show up. `plugin list` shows it, but calling `/ait:*` gets no response.

Searching for `ait` in the desktop app's plugin browser and finding nothing is a different problem; the diagnosis table below covers that symptom.

## First — take a state snapshot

Paste the block below into your shell as-is. Everything here is read-only; nothing gets changed.

```bash
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

claude --version
claude plugin list
claude plugin marketplace list

ls -la "$CFG/plugins"
cat "$CFG/plugins/known_marketplaces.json"
python3 -m json.tool "$CFG/plugins/installed_plugins.json"

ls "$CFG/plugins/marketplaces"
git -C "$CFG/plugins/marketplaces/apps-in-toss" log -1 --format=%cd
git -C "$CFG/plugins/marketplaces/apps-in-toss" rev-parse --short HEAD

find "$CFG/plugins/cache/apps-in-toss" -maxdepth 3
```

Don't paste `plugin-catalog-cache.json` in full. It's hundreds of KB and holds metadata for every other plugin too. What C1 needs is only the distribution of key suffixes, called out separately in the C1 row below.

For an issue report, `claude plugin list --json` and `claude plugin marketplace list --json` work better, since the fields come out structured and are easier to review.

### Scrub before pasting

`installPath`, `projectPath`, `installLocation`, and the Directory source in `claude plugin marketplace list` all print an absolute path under your home directory, so your username is in there. Before pasting, run it through `sed "s|$HOME|~|g"` or swap it by hand. Check once more with your own eyes that the substitution actually happened.

## What's broken — diagnosis table

| ID | Symptom | Evidence (read-only) | Fix |
|---|---|---|---|
| C1 | Searching for `ait` in the desktop app's plugin screen returns nothing | Every key under `catalog.plugins` in `plugin-catalog-cache.json` ends in `@claude-plugins-official`, and there are zero `apps-in-toss` entries | None. Install by pasting into the chat input instead. Upstream: anthropics/claude-code#38008, #52147 |
| C2 | No new version shows up in `/plugin`. On desktop, the Update button is greyed out | `known_marketplaces.json`'s `apps-in-toss.lastUpdated` is more than a few days old, and the clone's `git log -1 --format=%cd` is behind upstream's latest | R2, then R3 if that doesn't help. Upstream: anthropics/claude-code#72089 |
| C3 | The version stays the same for days, with none of the stuck-clone signs above | The `apps-in-toss` entry in `known_marketplaces.json` has no `autoUpdate: true` | `/plugin` → Marketplaces → apps-in-toss → Enable auto-update. For an immediate update, run R2 |
| C4 | `/ait:*` never shows up in a session at all. `plugin list` still shows it | The `installPath` that `installed_plugins.json`'s `plugins["ait@apps-in-toss"]` entry points to doesn't exist on disk | R4. Upstream: anthropics/claude-code#48985 |
| C5 | The plugin is enabled but the skill list looks empty | The `installPath` directory exists, but `.claude-plugin/` is missing or `shared/skills/` is empty | R4, then R5 if that doesn't help. Upstream: anthropics/claude-code#64763 (Windows desktop) |
| C6 | The version on disk is new, but the session's skills are still old — especially on desktop | The latest version directory in the cache and the Version column in `plugin list` agree, but the session behaves differently anyway | R1. Upstream: anthropics/claude-code#52967 |
| C7 | Not a bug. Just eating disk space | Multiple version directories sit under `cache/apps-in-toss/ait/`, and the unused ones carry an `.orphaned_at` file | R5 (that version only). Fine to leave alone if it's not urgent |

The very first row can't be fixed. Don't climb the ladder; install by pasting into the chat input instead. A shallow marketplace clone is normal (they all are), so a stuck clone is never diagnosed by shallowness alone. When more than one row applies, work from the lowest ID first (stop there if that row is the unfixable one).

## The recovery ladder

Try these top to bottom and stop at whichever step fixes it. Each step down erases a wider blast radius, so don't skip ahead.

### R0 — Back up the state files

Copy the three files below with a timestamp suffix. Always do this before going to R3 or further.

```bash
cp "$CFG/plugins/installed_plugins.json" "$CFG/plugins/installed_plugins.json.bak.$(date +%s)"
cp "$CFG/plugins/known_marketplaces.json" "$CFG/plugins/known_marketplaces.json.bak.$(date +%s)"
cp "$CFG/settings.json" "$CFG/settings.json.bak.$(date +%s)"
```

`enabledPlugins` and `extraKnownMarketplaces` live in `settings.json`. `plugin-catalog-cache.json` is not part of this backup: it's a derived cache the CLI re-fetches on its own. Backing up means copying, nothing more. Don't pour a backup back in by hand when you want to restore. A backup is for reading what used to be there; restoring is `claude plugin`'s job.

### R1 — Reload / new session / full app restart

On the CLI, reach for `/reload-plugins` first. If it warns that reloading invalidates the prompt cache, run `/reload-plugins --force`. When only skills changed on disk, `/reload-skills` is enough. Both commands are in the `/help` list on claude 2.1.278. If nothing changes, open a new session. The desktop app has no such reload path and needs a full quit and relaunch, not a closed window. It's the fix for stale skills on an already-current disk version, and the finishing step after every other rung.

### R2 — Update the marketplace

```bash
claude plugin marketplace update apps-in-toss
```

Nothing needs to run before this step, not even R0. It's safe on its own: it reads, then fast-forwards the clone. Finish with a new session. Use it for C2, and for a marketplace with auto-update off.

To tell whether it worked, take the snapshot again and read `known_marketplaces.json`'s `lastUpdated` and the clone's `git log -1 --format=%cd`. Both moving up to now and to upstream's latest commit means the stuck-clone evidence is gone.

### R3 — Remove and re-add the marketplace

Finish R0 first.

```bash
claude plugin marketplace remove apps-in-toss
claude plugin marketplace add toss/apps-in-toss-harness
claude plugin install ait@apps-in-toss
```

Only that marketplace is affected; other marketplaces and plugins stay untouched. Finish with R1. Use it when a plain update doesn't clear a stuck clone.

To tell whether it worked, check that `claude plugin marketplace list` carries `apps-in-toss` again and that the clone sits on upstream's latest commit. The commit date that refused to move under a plain update has to move here.

### R4 — Reinstall the plugin

Finish R0 first.

```bash
claude plugin uninstall ait@apps-in-toss
claude plugin install ait@apps-in-toss
```

If it's installed at more than one scope, add `--scope` and go one at a time. Only that plugin is affected. Finish with R1. Use it for C4, and for an empty skill list.

To tell whether it worked, run `/ait:welcome` in a new session: no install-state warning line means the missing-path and empty-skill-list evidence is gone. You can also read `installed_plugins.json`'s `installPath` directly and check that the directory exists with `.claude-plugin/` and a populated `shared/skills/`.

### R5 — Purge the cache for one plugin version

Finish R0 through the reinstall step first.

> The command below is `rm -rf`. Before running it, check whether an `.in_use` directory exists inside that version's directory. If it does, close whatever session is using that version first.

```bash
rm -rf "$CFG/plugins/cache/apps-in-toss/ait/<version>"
```

Replace `<version>` with the actual version string, so exactly that one version directory gets erased (never a wildcard). Continue on into a reinstall. Use it for C5, and to clear an orphaned version, or when a plain reinstall alone doesn't clear it.

To tell whether it worked, re-run the `find` line from the snapshot: the version directory you deleted and its `.orphaned_at` should be gone from the listing, which closes out an orphaned version. For an empty skill list, judge it after the reinstall that follows, from `/ait:welcome` in a new session.

### R6 — Purge the entire cache (last resort)

Finish R0 through every rung above first.

> This is the path official troubleshooting points you to, but it's indiscriminate: a single `cache/` directory holds every plugin from every marketplace. Before deleting it, save the output of `claude plugin list`, and after deleting, reinstall each one from that list.

```bash
rm -rf "$CFG/plugins/cache"
```

After deleting, reinstall everything that was installed, then finish with a new session. Reach for this only when R0 through every rung above all failed to help.

## Six traps

**Don't judge freshness by `git status`.** The marketplace clone is shallow and gets updated by a fast-forward-only pull. A clean `git status` doesn't mean you're up to date. Check `known_marketplaces.json`'s `lastUpdated` and the commit date from `git log -1` instead.

**Don't overwrite `extraKnownMarketplaces[…].source` wholesale.** That field belongs to the CLI. A sparse registration keeps `sparsePaths` inside it; a non-sparse one doesn't. Either way, replacing it wholesale makes the declaration disagree with the on-disk clone, and Claude Code stops finding that marketplace at all (`marketplace list` shows "No marketplaces configured", and installed plugins report "Marketplace … not found"). Register and deregister only through `claude plugin marketplace add`/`remove`. If it's already been overwritten, fix it with a remove and re-add.

**Desktop has no reload path.** Even after the CLI updates the shared state, the app's in-memory registry stays as it was. Closing the window doesn't do it. You have to quit the app fully and relaunch.

**Don't search the desktop plugin browser.** That list only surfaces the official catalog, so a third-party marketplace's plugin structurally won't appear there even when the install is perfectly fine (C1). Install by pasting into the chat input instead.

**Don't reach for `rm -rf cache` as your first move.** That's why the ladder is split into six rungs. Wiping the whole cache also takes down every other marketplace's plugins.

**Don't hand-edit the state files.** `installed_plugins.json` and `known_marketplaces.json` are ledgers the CLI writes. Read them for diagnosis, but let `claude plugin` commands make any changes.

## Rehearsing safely — CLAUDE_CONFIG_DIR

You can practice the ladder harmlessly before touching your real home state.

```bash
export CLAUDE_CONFIG_DIR=$(mktemp -d)
claude plugin marketplace add toss/apps-in-toss-harness
claude plugin install ait@apps-in-toss
claude plugin list
```

Setting this variable moves `settings.json`, `.claude.json`, and `plugins/` entirely into that temp directory, leaving your real home state untouched. When you're done, delete the directory and unset the variable. A new shell starts fresh from your real state.

This variable relocates your entire profile, so a rehearsal shell starts with none of your usual settings or auth. An `rm -rf` run in the rehearsal shell only touches the temp directory. The same command typed in a shell where the variable is unset deletes your real state, so change your prompt or use a separate window to avoid mixing the two up.

## Still stuck

Follow the "Install layer" section of the [bug report guide](./bug-report-guide.md) to attach a snapshot, then [file an issue](https://github.com/toss/apps-in-toss-harness/issues/new/choose). The commands in this document were verified against Claude Code 2.1.269, and the two reload commands in R1 against 2.1.278.
