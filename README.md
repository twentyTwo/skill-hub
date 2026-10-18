# Skill Hub

Keep one library of AI agent skills (`SKILL.md` folders), collected from anywhere, and apply them to your repositories for Claude Code, GitHub Copilot, Cursor, AGENTS.md-based agents, or any folder you configure.

There are two apps. They share one hub (`~/.skill-hub`) and the same `skill-hub.lock.json` in each repository:

| Folder | What it is |
|---|---|
| [`vscode-extension/`](vscode-extension) | The VS Code extension. Works on the repository you have open: sidebar, skill detail and Add skills pages. |
| [`desktop/`](desktop) | The desktop app (Electron). Works across all your projects: Library, a Projects matrix, source checks, and conflict resolution. |
| [`design/`](design) | The UI spec (`DESIGN.md`), mockups, and `tokens.css`, which both apps import. |

The skill logic (sources, library, targets, lock file, status) lives in `vscode-extension/src/core` and has no VS Code imports. The desktop app imports it from there instead of keeping a copy, so a change to core needs both test suites:

```sh
cd vscode-extension && npm install && npm test
cd desktop && npm install && npm test
```

See each folder's README for details. In VS Code, the launch configurations **Run Extension** and **Run Desktop App** start each one.
