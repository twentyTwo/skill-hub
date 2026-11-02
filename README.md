# Skill Hub

[![Release](https://github.com/twentyTwo/skill-hub/actions/workflows/release.yml/badge.svg)](https://github.com/twentyTwo/skill-hub/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**One library of AI agent skills, applied to any repository, for every agent you use.**

Skills (`SKILL.md` folders) are spread across GitHub repos, gists and old projects, and each agent wants them in a different place: `.claude/skills`, `.github/skills`, `.cursor/rules`, `AGENTS.md`. Copying them by hand means every repo ends up with a slightly different, slightly stale version.

Skill Hub keeps one copy of each skill in your hub, applies it to any repository for Claude Code, GitHub Copilot, Cursor or AGENTS.md-based agents, and tells you when a copy is out of date, edited locally, or missing.

![The Skill Hub sidebar in VS Code: the Library with built-in skills, and a skill's detail page](docs/screenshots/vscode-library.png)

## Why Skill Hub

- **Collect from anywhere.** Paste `anthropics/skills`, a GitHub, GitLab or Bitbucket link, any git URL, a raw file link or a local folder. Search GitHub for `SKILL.md` files when you don't know where a skill lives.
- **Apply to every agent at once.** One skill, installed for Claude Code, Copilot, Cursor and AGENTS.md in one step, or into any folder you configure.
- **Know what's out of date.** Each repo gets a `skill-hub.lock.json`. Skill Hub shows which skills have an update, were edited in the repo, or are missing, with one action to fix each.
- **Share local edits.** Improved a skill inside one repo? **Save to hub** and every other repo sees the update. When both sides changed, compare and merge.
- **Teammates get the same skills.** Commit the lock file and anyone with Skill Hub can restore the skills from their recorded sources.
- **Eight built-in skills** to start with: `code-review`, `commit-message`, `pr-description`, `write-tests`, `debug-systematically`, `security-review`, `refactor-safely` and `write-docs`.
- **Imports other formats.** Plain markdown, Copilot `*.instructions.md` files and Cursor `.mdc` rules are converted into `SKILL.md`.

## Install

**VS Code extension.** Search for **Skill Hub** in the Extensions view, or install it from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=noorashuvo.skill-hub) or [Open VSX](https://open-vsx.org/extension/noorashuvo/skill-hub) (for VSCodium, Cursor and other editors). Each GitHub release also has a `.vsix` file you can install with **Extensions: Install from VSIX…**.

**Desktop app** (Windows, macOS, Linux). There are no installers yet. Build it from source with `cd desktop && npm install && npm run package`. See [desktop/README.md](desktop/README.md).

## Quick start

1. Open the **Skill Hub** icon in the VS Code Activity Bar.
2. Click **+**, paste `anthropics/skills`, press Enter and tick the skills you want.
3. Click `→` on a skill in the Library and pick the agents to install it for.

Commit `skill-hub.lock.json` with the installed skill folders, so teammates get the same skills.

## Where skills go

| Agent | Skill Hub writes |
|---|---|
| Claude Code | `.claude/skills/<skill>/` |
| GitHub Copilot | `.github/skills/<skill>/` |
| Cursor | `.cursor/rules/<skill>.mdc` |
| Codex, Jules, Zed and other AGENTS.md readers | `.agents/skills/<skill>/` and a managed section in `AGENTS.md` |
| Anything else | A folder you configure |

## Two apps, one hub

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/vscode-repo.png" alt="This repo tab: skills grouped by what needs attention, and the detail page of a skill with an update"></td>
    <td width="50%"><img src="docs/screenshots/vscode-add.png" alt="Add skills page listing the skills found in anthropics/skills"></td>
  </tr>
  <tr>
    <td>VS Code: what this repository has, and what needs attention</td>
    <td>VS Code: paste a repo, tick the skills you want</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/desktop-library.png" alt="Desktop app Library grid with the inspector"></td>
    <td width="50%"><img src="docs/screenshots/desktop-projects.png" alt="Desktop app Projects matrix showing each skill's status in each project"></td>
  </tr>
  <tr>
    <td>Desktop: the whole library</td>
    <td>Desktop: every project's skills in one matrix</td>
  </tr>
</table>

- The **VS Code extension** works on the repository you have open. Read [vscode-extension/README.md](vscode-extension/README.md) for every feature, status and setting.
- The **desktop app** works across all your projects at once, with a matrix of every skill in every project and conflict resolution. Read [desktop/README.md](desktop/README.md).

Both use the same hub (`~/.skill-hub`) and the same lock file, so a skill added in one shows up in the other.

## Contributing

Bug reports, ideas and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the setup, the code layout, branches, tests and releases. To report a security issue, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
