# Skill Hub desktop

A desktop app for the same hub the [VS Code extension](../vscode-extension) uses. The extension works on the repository you have open. The desktop app shows every project at once: which skills each one has, which are out of date, and which were edited, all in one matrix.

It follows `design/DESIGN.md` §4 and the `03-desktop-library` and `04-desktop-projects` mockups.

## What it does

- **Library**: every skill in your hub, as a grid or a list. You can filter by source, by *Has update* or by *Unused*. The inspector shows where a skill came from, whether its source has a newer version (with **Review changes** and **Update**), and every project that uses it. **Apply to projects…** copies it into any of them.
- **Projects**: one row per project folder you've added and one column per hub skill. Each cell shows that skill's status in that project (✓ ↑ ✎ ! ×), or a dashed **+** that applies it. **Update all safe** updates everything that's *outdated* or *missing*. It never touches *edited* or *both changed* skills, because those need a decision.
- **Both changed**: when a skill was edited in a project and the hub moved on too, its cell opens a diff and three choices:
  - **Merge both** writes both versions into the project's copy, marking each difference with `<<<<<<<` / `>>>>>>>`, and opens it in your editor. When you've settled them, choose **Keep local, push to hub**.
  - **Take hub version** discards the local edit.
  - **Keep local, push to hub** replaces the hub copy. Every other project then shows an update.
- **Project pages**: click a project in the sidebar to see its skills grouped as *Needs attention*, *Applied* and *Found, not tracked*, each with its one action (Update, Save to hub, Resolve…, Restore or Add to hub).
- **Add skill** accepts the same inputs as the extension: `owner/repo`, GitHub, GitLab and Bitbucket links, any git URL, a link to a markdown file, or a local folder. Pick the skills you want, and optionally apply them to projects in the same step. **Create new skill** starts a `SKILL.md` and opens it.
- **Discover** searches GitHub for `SKILL.md` files.
- **Sources** groups skills by where they came from. **Sync all** (top bar) checks every source. A check downloads the source's current version to compare with the hub copy, and nothing changes until you click **Update**. The update installs exactly the version you reviewed.
- **Activity** logs what the app changed. **Settings** holds the hub folder, default agents, custom agents, the editor command and a GitHub token.
- **Global search** (`Ctrl K` / `⌘ K`) finds skills, projects and sources. Pasting a link into it opens the Add flow.

## Shared with the extension

- **The hub.** Both default to `~/.skill-hub`, so a skill added in one shows up in the other.
- **Each project's `skill-hub.lock.json`.** Status means the same in both, so you can apply a skill from the desktop app and the extension shows it as applied.
- **The code.** The desktop app has no copy of the skill logic. It imports `../vscode-extension/src/core` (sources, library, targets, lock file, workspace status) and `../vscode-extension/src/shared/status.ts` (the status table), and reuses the extension's webview HTML helpers. A change to core affects both apps, so run both test suites.

The desktop app keeps its own settings, source-check results and activity log in the OS app-data folder (`%APPDATA%\Skill Hub` on Windows, `~/Library/Application Support/Skill Hub` on macOS, `~/.config/Skill Hub` on Linux).

**GitHub access.** The app uses, in order: a token saved in Settings (encrypted with the OS keychain through Electron `safeStorage`), then `GITHUB_TOKEN`/`GH_TOKEN`, then the GitHub CLI's sign-in (`gh auth token`). Without a token, public repositories still work at GitHub's anonymous rate limit, but Discover needs one.

**Editor.** *Edit*, *Open in VS Code* and *Merge both* run the editor command from Settings (`code` by default) as `<command> "<path>"`. If that fails, the file opens in its default app.

## Development

```sh
cd desktop
npm install
npm run demo        # build, then launch against a sandbox hub and projects in every state (your real hub isn't touched)
npm start           # build, then launch against your real settings and hub
npm test            # backend and diff tests with plain Node (no Electron)
npm run typecheck   # main process, renderer and tests
npm run package     # installer for this OS in release/ (NSIS on Windows, dmg on macOS, AppImage on Linux)
```

`npm run demo -- --keep` reuses the sandbox from the last run. You can also press F5 in VS Code with the **Run Desktop App** launch configuration.

Layout:

- `src/main/`: the Electron main process. `backend.ts` does everything the UI asks for, on top of core. It has no Electron imports, so `test/` exercises it directly. `main.ts` creates the window, wires IPC and supplies dialogs and the shell. `store.ts` holds settings, checks and activity. `views.ts` builds the view models. `files.ts` compares and merges skill folders.
- `src/preload/`: exposes `window.skillHub` with one `call(method, ...args)` and one event stream. The main process only accepts methods on an allowlist.
- `src/shared/`: the API contract (`api.ts`) and the line diff (`diff.ts`). No Node or Electron imports.
- `src/renderer/`: plain TypeScript and DOM, rendered with the same `html` template helper as the extension's webviews. `styles.css` imports `design/tokens.css`. The fonts (IBM Plex Sans, JetBrains Mono) are bundled, and a strict CSP blocks remote content.
- `test/fixture.ts`: builds the sandbox used by the tests and `npm run demo`.
- `build/icon.png`: the app icon, generated by `npm run icon`.
