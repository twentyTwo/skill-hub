---
name: write-tests
description: Add or improve automated tests for a function, module or change, using the project's existing test framework and conventions. Use when asked to write tests, increase coverage, or add a regression test for a bug.
---

# Write tests

## Before writing anything

1. **Find the existing setup.** Look at `package.json` scripts, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml` and similar, plus existing test files. Use the framework, file layout, naming and helpers already there. Never add a second test framework.
2. **Read the code under test** and its callers, so you test what the code is *for*, not just what it currently does.
3. **Run the existing tests once** so you know the baseline and the exact command.

## What to test

- **Behavior through the public interface**, not private helpers or implementation details. A refactor that keeps behavior shouldn't break the tests.
- **The main path first**, then edges: empty input, one item, many items, boundaries (0, -1, max), invalid input, `null`/`undefined`, unicode, large sizes.
- **Error paths**: assert the error type and message the caller relies on.
- **For a bug fix, a regression test first.** Write a test that fails without the fix, confirm it fails, then make it pass.

## How to write them

- One behavior per test. The name says the behavior and the condition: `returns empty list when the source has no skills`.
- Arrange, act, assert, with no logic (loops, conditionals) in the test itself. Use table-driven tests for many similar cases.
- Prefer real objects and temporary directories over mocks. Mock only slow, non-deterministic or external things: network, clock, randomness, third-party APIs.
- Keep tests independent and deterministic: no shared mutable state, no reliance on test order, no real sleeps, fixed seeds and times.
- Clean up anything you create (temp files, servers, env vars).

## Finish

Run the full suite and report the exact command and result. If a new test exposes a real bug, say so instead of weakening the assertion to make it pass.
