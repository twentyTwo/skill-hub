---
name: pr-description
description: Write a pull request title and description from the current branch's changes, aimed at reviewers. Use when asked to open a PR, write a PR description, or summarize a branch for review.
---

# Pull request description

## Gather context

1. Find the base branch (`main`, `master`, or `develop`; check `git remote show origin` if unsure).
2. Read `git log <base>..HEAD` and `git diff <base>...HEAD`. Read commit messages in full, since they often hold the reasoning.
3. Look for a PR template: `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE/`, or `docs/`. If one exists, fill in its sections instead of using the layout below.
4. Note any linked issue numbers from branch names or commits.

## Title

- One line, under ~70 characters, describing the outcome: "Retry failed uploads with backoff", not "Update upload.ts".
- Follow the repository's convention (Conventional Commits prefix, ticket key) if recent PR titles use one.

## Body

```markdown
## Summary
What changes and why, in 2–4 sentences. Lead with the problem it solves.

## Changes
- The notable changes, grouped by area. Skip trivial ones (renames, formatting).

## How to test
Steps a reviewer can follow, or the tests that cover it.

## Notes for reviewers
Risky parts, decisions you'd like a second opinion on, follow-up work, screenshots for UI changes.

Closes #123
```

## Rules

- Write for a reviewer who hasn't seen the code. Explain anything they'd otherwise have to ask about.
- State breaking changes, migrations and new configuration prominently.
- Never claim tests pass or that something was verified unless you ran it.
- Leave out sections that would be empty instead of writing "N/A".
