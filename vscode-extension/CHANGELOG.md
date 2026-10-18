# Changelog

## 0.3.0

- New sidebar with three tabs. **This repo** groups skills by what needs attention and shows one action per skill. **Library** has filters, source groups and applied-here markers. **Discover** searches GitHub.
- Skill detail page: status, the agents a skill is installed for (with **+ Install here**), a `SKILL.md` preview, and the skill's files.
- **Add skills** page replaces the chain of pickers. It detects what you paste, lists the skills to tick, and can apply them to the repo in the same step.
- **Resolve…** for skills edited in the repo while the hub also changed: compare and merge, take the hub version, or keep local.
- Status bar summary for the open repository.
- Right-click menus in the sidebar, with the same actions as before.
- The old tree views are still available with `skillHub.classicViews`.

## 0.2.0

- Search GitHub for skills: type words into the Add Skill picker, or use the search button in the Library.
- Commands no longer wait for their "done" notification to be dismissed.

## 0.1.0

- Library and Workspace views in the Activity Bar.
- Add skills from GitHub (API, no git needed), any git host, file links and local paths; import markdown, Copilot instructions and Cursor rules as skills.
- Apply skills for Claude Code, GitHub Copilot, Cursor, AGENTS.md and custom folders.
- Lock file with status tracking: update from hub, save local edits back to the hub, restore missing skills.
