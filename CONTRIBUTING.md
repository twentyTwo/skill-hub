# Contributing to Skill Hub

Thanks for helping. This page covers how the repository is laid out, how to run and test both apps, and how changes get released.

## Before you start

- For a bug, open an issue with the steps to reproduce it, unless the fix is small and obvious.
- For a new feature or a larger change, open an issue first so we can agree on the approach before you write code.

## Repository layout

| Folder | What it is |
|---|---|
| [`vscode-extension/`](vscode-extension) | The VS Code extension. Works on the repository you have open: sidebar, skill detail and Add skills pages. |
| [`desktop/`](desktop) | The desktop app (Electron). Works across all your projects: Library, a Projects matrix, source checks, and conflict resolution. |
| [`design/`](design) | The UI spec (`DESIGN.md`), mockups, and `tokens.css`, which both apps import. |

The skill logic (sources, library, targets, lock file, status) lives in `vscode-extension/src/core` and has no VS Code imports. The desktop app imports it from there instead of keeping a copy, so **a change to core needs both test suites**:

```sh
cd vscode-extension && npm install && npm test
cd desktop && npm install && npm test
```

Each app's README has a Development section with all of its scripts and a description of its code layers. In VS Code, the launch configurations **Run Extension** and **Run Desktop App** start each one.

## Branches

Never commit to `main` directly. Start each change on a new branch from the latest `main`:

```sh
git fetch origin
git switch -c <type>/<short-name> origin/main
```

| Type | Use for | Example |
|---|---|---|
| `feature/` | New functionality | `feature/builtin-skills` |
| `fix/` | Bug fixes | `fix/lock-file-eperm` |
| `improve/` | Improvements to existing behavior, performance or UX | `improve/library-search` |
| `refactor/` | Code changes that don't change behavior | `refactor/split-actions` |
| `docs/` | Documentation only | `docs/readme-screenshots` |
| `chore/` | Build, CI, dependencies, tooling | `chore/bump-esbuild` |

Use lowercase kebab-case names that say what the change is. Keep one change per branch.

## Pull requests

- Run the typecheck and tests for every app you touched (`npm run typecheck && npm test` in each folder).
- If the change is visible to users, add a line to the next version's section in `vscode-extension/CHANGELOG.md`, and update the README and screenshots if they no longer match.
- UI changes follow `design/DESIGN.md`. Include a screenshot in the pull request.

## CI and releases

GitHub Actions in [`.github/workflows`](.github/workflows):

| Workflow | Runs on | What it does |
|---|---|---|
| `ci.yml` | Pull requests (and as the first step of the two below) | Extension: typecheck and unit tests on Linux and Windows, integration tests in VS Code and a `.vsix` artifact on Linux. Desktop: typecheck and tests. |
| `release.yml` | Push to `main`, or run by hand | Runs CI, then publishes the extension if `vscode-extension/package.json` has a version with no `v<version>` tag yet: VS Code Marketplace and Open VSX in parallel, then a GitHub release with the `.vsix` and that version's CHANGELOG section. A manual run can pick the marketplaces or republish an existing version. |
| `beta.yml` | Push to `develop` | Runs CI, then attaches `<version>-beta.<run>` as a `.vsix` to a GitHub pre-release. Betas don't go to the marketplaces. |

To release: bump `version` in `vscode-extension/package.json`, add a `## <version>` section to `vscode-extension/CHANGELOG.md`, and merge to `main`.

Publishing needs two secrets, each in a repository environment of the same name: `VSC_PAT` in **VS Code Marketplace** (an Azure DevOps token with the *Marketplace → Manage* scope) and `OPENVSX_PAT` in **Open VSX**.
