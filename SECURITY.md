# Security policy

## Reporting a vulnerability

Please don't report security issues in public issues or pull requests.

Report them privately through [GitHub's vulnerability reporting](https://github.com/twentyTwo/skill-hub/security/advisories/new) (the **Security** tab, then **Report a vulnerability**). Include what you found, how to reproduce it, and which version or commit you used.

You should get a reply within a week. Once a fix is released, the advisory is published with credit to you, unless you'd rather not be named.

## Supported versions

Only the latest release of the VS Code extension and the current `main` branch get security fixes.

## What counts

Examples of issues we want to hear about:

- Files written outside the target repository or the hub folder, for example through a crafted skill name, path or archive.
- A GitHub token stored or sent somewhere it shouldn't be.
- Remote content running in the extension's webviews or the desktop app's window.
- Desktop IPC calls that get around the main process's method allowlist.

## Skills are code

A skill is instructions and sometimes scripts that an AI agent will follow. Skill Hub copies skills; it doesn't vet them. Read a skill from a source you don't trust before you apply it. A harmful skill from a third-party source is not a vulnerability in Skill Hub, but a way for one to run without being applied is.
