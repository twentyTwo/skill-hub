# Skill Hub

Keep one library of AI agent skills, collected from anywhere, and apply any of them to the repository you have open, for Claude Code, GitHub Copilot, Cursor, AGENTS.md-based agents, or any folder you configure.

A **skill** is a folder with a `SKILL.md` (YAML frontmatter with `name` and `description`, then instructions) plus any scripts or reference files it needs. This is the [Agent Skills](https://agentskills.io) format. Skill Hub can also import plain markdown, Copilot `*.instructions.md` files and Cursor `.mdc` rules, converting each into a `SKILL.md`.

## How it works

```
 anywhere ──add──▶  your hub (~/.skill-hub)  ──apply──▶  this repo
 GitHub, git,       one copy of each skill      .claude/skills/<skill>/
 URLs, folders      + where it came from        .github/skills/<skill>/
                                                .cursor/rules/<skill>.mdc
                                                .agents/skills/<skill>/ + AGENTS.md
```

Open the **Skill Hub** icon in the Activity Bar. The sidebar has three tabs:

- **This repo**: the open repository, the agents it has skills for, and every skill in it, grouped into *Needs attention*, *Applied* and *Found, not tracked*. Each row shows its status and at most one action (Update, Save to hub, Resolve…, Restore or Add to hub). Drag skills from the Library onto the drop zone to apply them. In a multi-root workspace, pick the folder from the repo card.
- **Library**: every skill in your hub, grouped by source. Filter by text, *Applied here* or *Has update*. An orange dot means the skill is applied here, and `→` applies it.
- **Discover**: search GitHub for skills and add them in one click.

Click any skill to open its **detail page**. It shows the skill's status, which agents it's installed for (with **+ Install here** for the others), a preview of its `SKILL.md`, and its files. Right-click a skill in the sidebar for everything else.

The Activity Bar badge counts skills with an update, a conflict or missing files. The status bar shows the same for the open repository.

## Adding skills

Click **+** in the sidebar to open the **Add skills** page, then paste almost anything. As you type, it tells you what it detected (GitHub repository, git URL, file link, local path or search words). Press Enter to list the skills, tick the ones you want, and optionally apply them to this repository in the same step.

| You paste | What happens |
|---|---|
| `anthropics/skills` or `https://github.com/anthropics/skills` | Lists every skill in the repo; pick the ones you want |
| `https://github.com/o/r/tree/main/skills/pdf` | Adds that one skill (branches with `/` in the name work) |
| `owner/repo/path/to/skill@v2` | A path and a branch or tag |
| `https://gitlab.com/group/proj/-/tree/main/skills`, a Bitbucket `/src/` link, any `.git` or SSH URL (`#ref` picks a branch) | Shallow `git clone`, then lists skills |
| `https://example.com/rules/react.mdc`, a raw `SKILL.md` link, a gist | Imports the file, converting it to `SKILL.md` |
| A local folder or file path (`./`, `~/`, `C:\…`) | Copies it; a folder of many skills lists them all |

Don't know where a skill lives? **Search GitHub**: type plain words (`pdf`, `react testing`) into the Add skills page, or use the **Discover** tab. Skill Hub searches `SKILL.md` files across public repositories and lets you add any of the results. GitHub requires sign-in for code search, so you'll be asked once.

You can also:

- Use the **Local folder** and **Create new skill** shortcuts on the Add skills page.
- Right-click a folder or `.md`/`.mdc` file in the Explorer and choose **Add to Skill Hub**.
- Drag folders from the Explorer onto the Library tab (hold Shift to drop into the sidebar).

GitHub is read through its API, so git isn't needed for GitHub sources. Private repositories and the anonymous rate limit trigger a GitHub sign-in prompt, using VS Code's built-in GitHub account. Other hosts need `git` on your PATH.

Skill Hub keeps each skill's source, so **Update from Source** (one skill) or the sync button (all skills) pulls the latest version.

## Applying skills to a repository

Click `→` on a skill in the Library, drag it onto the **This repo** tab, use **Apply** on its detail page, or run **Apply Skill to Workspace…**. Then choose where to install it:

| Target | Writes | Read by |
|---|---|---|
| `claude` | `.claude/skills/<skill>/` | Claude Code (and VS Code Copilot, which also reads it) |
| `copilot` | `.github/skills/<skill>/` | GitHub Copilot agent skills |
| `cursor` | `.cursor/rules/<skill>.mdc` (an "agent requested" rule), with supporting files in `.cursor/rules/<skill>/` | Cursor |
| `agents` | `.agents/skills/<skill>/` and a managed **Skills** section in `AGENTS.md` | Codex, Jules, Zed and other AGENTS.md readers |
| custom | `<your folder>/<skill>/` | Anything else (see `skillHub.customTargets`) |

The `AGENTS.md` section sits between `<!-- skill-hub:begin -->` and `<!-- skill-hub:end -->`. Nothing outside those markers is touched.

### Status and syncing

Skill Hub records what it applied in `skill-hub.lock.json` at the repository root. Each skill on the **This repo** tab shows one of these statuses:

| Status | Meaning | Action |
|---|---|---|
| ✓ Up to date | Matches your hub | |
| ↑ Update available | Your hub has a newer version | **Update** |
| ✎ Edited in this repo | Someone changed the installed files | **Save to hub** shares the edit with every other repo |
| ! Both changed | Edited here, and the hub is newer too | **Resolve…**: compare and merge, take the hub version, or keep local and push it to the hub |
| × Files missing | In the lock file but not installed | **Restore**, or **Restore Skills from Lock File** for all of them |
| ○ Not tracked | Found in a skills folder but not applied by Skill Hub | **Add to hub** |

Commit `skill-hub.lock.json` together with the installed skill folders. A teammate who opens the repository sees the skills, can **Add to Hub** to get them in their own library, and **Restore Skills from Lock File** re-fetches anything missing from its recorded source. The lock file records sources, not commit SHAs, so a restore fetches the current version from the source.

## Settings

| Setting | Default | |
|---|---|---|
| `skillHub.libraryPath` | `~/.skill-hub` | Where your hub lives. Point it at a synced or git-tracked folder to share it across machines. |
| `skillHub.defaultTargets` | `["claude"]` | Targets pre-checked when applying |
| `skillHub.promptForTargets` | `true` | Set to `false` to always use the default targets without asking |
| `skillHub.customTargets` | `[]` | Extra folders, e.g. `[{ "id": "codex", "label": "Codex", "folder": ".codex/skills" }]` |
| `skillHub.agentsSkillsFolder` | `.agents/skills` | Folder used by the `agents` target |
| `skillHub.classicViews` | `false` | Show the older Library and Workspace tree views instead of the sidebar |

## Hub layout

```
~/.skill-hub/
  hub.json            where each skill came from, and when it was added and updated
  skills/
    pdf/SKILL.md ...  one folder per skill; edit freely, or drop folders in by hand
```

**Open Hub Folder in New Window** (sidebar `…` menu) opens the hub for editing. Changes show up as updates in every workspace that uses the skill.

## Development

```sh
npm install
npm test                  # unit tests for everything under src/core (no VS Code needed)
npm run test:integration  # runs the extension inside VS Code; set VSCODE_PATH=<path to Code.exe> to skip downloading one
npm run typecheck         # type-checks the extension and the webview scripts
npm run bundle            # build dist/ (npm run watch rebuilds on change)
```

Press **F5** in VS Code to launch an Extension Development Host. `npm run package` builds a `.vsix` you can install with **Extensions: Install from VSIX…**.

The code is split into layers:

- `src/core/`: plain Node code with no VS Code imports. It covers sources (GitHub, git, URL, local), the library, targets, the lock file and workspace status. The desktop app (`../desktop`) imports it too, so run its tests after changing core.
- `src/shared/`: the status table and the message types passed between the extension and its webviews. No VS Code or Node imports. The desktop app reuses the status table.
- `src/ui/`: commands (`actions.ts` is the only place that changes anything), the sidebar and panel hosts that turn hub state into view models, and the classic tree views.
- `src/webview/`: the browser side of the sidebar, skill detail and Add skills pages. `webview.css` imports `../design/tokens.css`, so the design tokens have one source. The desktop app reuses the HTML helpers in `common.ts`.

The UI follows `../design/DESIGN.md`.
