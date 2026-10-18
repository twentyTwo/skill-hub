---
name: commit-message
description: Write a clear git commit message for the staged changes, following the repository's existing convention (Conventional Commits if it uses them). Use when asked to commit, write a commit message, or describe staged changes.
---

# Commit message

## Steps

1. Run `git diff --staged` to see what will be committed. If nothing is staged, say so and ask whether to stage everything (`git add -A`) or specific files. Never commit unstaged work without asking.
2. Run `git log --oneline -15` and match the style you see: Conventional Commits (`feat(api): …`), a ticket prefix (`ABC-123 …`), or plain sentences. If there's no clear convention, use plain imperative sentences.
3. If the staged changes do several unrelated things, suggest splitting them into separate commits before writing one message for all of it.

## Format

```
<summary line, imperative mood, max ~72 characters, no trailing period>

<body: why the change was made and anything a reviewer can't see in the diff.
Wrap at 72 characters. Skip the body for trivial changes.>

<trailers: Fixes #123, Co-authored-by: …, BREAKING CHANGE: …>
```

- Imperative mood: "Add retry to upload", not "Added" or "Adds".
- The summary says what changed for the user or the codebase, not which files were touched.
- The body explains *why*: the bug, the constraint, the alternative you rejected. The diff already shows *what*.
- With Conventional Commits, pick the type honestly: `feat` (new behavior), `fix` (bug), `refactor` (no behavior change), `perf`, `docs`, `test`, `build`, `ci`, `chore`. Mark breaking changes with `!` and a `BREAKING CHANGE:` trailer.

## Examples

```
fix(auth): refresh the token before it expires, not after

Requests made in the last 30 seconds of a token's life failed with 401
because the refresh only ran on the first failure. Refresh when less than
60 seconds remain instead.

Fixes #482
```

```
Remove unused CSV export endpoint
```
