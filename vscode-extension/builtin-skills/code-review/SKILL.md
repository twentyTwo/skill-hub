---
name: code-review
description: Review a diff, branch or pull request for bugs, risky changes and readability problems, and report findings ranked by severity. Use when asked to review code, check a PR, or look over changes before merging.
---

# Code review

Review the change the user points at (a diff, a branch, a PR, or the uncommitted working tree). If they don't say, review uncommitted changes, then the current branch against its base.

## How to review

1. **Understand the intent first.** Read the PR description, commit messages and linked issue. A change can only be wrong relative to what it's trying to do.
2. **Read the whole diff, then the surrounding code.** Open the functions that changed and their callers. Most real bugs live at the boundary between new and existing code.
3. **Check, in this order:**
   - **Correctness**: logic errors, off-by-one, wrong conditions, unhandled `null`/empty/error cases, race conditions, resource leaks, broken error propagation.
   - **Behavior changes**: public APIs, file formats, defaults, or database schemas that change without a migration or a note.
   - **Security**: untrusted input reaching queries, shells, file paths, HTML or deserializers; secrets in code or logs; missing authorization checks.
   - **Tests**: does a test fail if the change is reverted? Are edge cases covered?
   - **Readability**: names that mislead, functions doing two things, comments that contradict the code, dead code.
4. **Verify before reporting.** For each suspected bug, trace a concrete input that triggers it. Drop anything you can't make concrete, or label it as a question.

## How to report

- Lead with a one-line verdict: ready to merge, merge after fixes, or needs rework.
- List findings most severe first. For each: `file:line`, what is wrong, a concrete failing scenario, and a suggested fix.
- Separate **must fix** from **suggestions** and **questions**.
- Don't pad the review with style nits a formatter or linter would catch, and don't restate what the diff does.
- Say what's good when it's notable (a clear test, a careful migration). Keep it to a line.
