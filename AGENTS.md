## Branches

Never commit to `main` directly. For every feature, bug fix or improvement, start a new branch from the latest `main`:

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

- Use lowercase kebab-case names that say what the change is, not who made it or a ticket number alone.
- One branch per change. Don't pile unrelated work onto an existing branch.
- If the working tree has uncommitted changes when starting, ask before carrying them onto the new branch.
- When the work is done, push the branch and open a pull request into `main`. Merging to `main` runs the release workflow, which publishes only when the version in `vscode-extension/package.json` is new.

<!-- skill-hub:begin -->
## Skills

Skills for this repository live in `.agents/skills/`. When a task matches a skill below, read its `SKILL.md` first and follow it.

- **tech-debt-audit**: Thorough, user-invoked tech debt and architecture audit of the current codebase. Produces TECH_DEBT_AUDIT.md with file-cited findings, severity, effort estimates, and a required "looks bad but is actually fine" section. Use when the user asks for a debt audit, codebase health check, architecture review, or code quality assessment of an entire repo. Does not auto-invoke. See `.agents/skills/tech-debt-audit/SKILL.md`.
<!-- skill-hub:end -->
