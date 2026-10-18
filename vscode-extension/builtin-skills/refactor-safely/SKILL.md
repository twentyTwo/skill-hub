---
name: refactor-safely
description: Restructure existing code without changing its behavior, in small verified steps with tests as a safety net. Use when asked to refactor, clean up, simplify, extract, rename or reorganize code.
---

# Refactor safely

A refactor changes structure, not behavior. If behavior needs to change too, do it in a separate step.

## Before you start

1. **State the goal** in one sentence: what will be easier after the refactor (adding a feature, reading a module, testing a function)? Don't refactor without one.
2. **Check the safety net.** Run the tests that cover the code. If coverage is thin, first add characterization tests that pin down the current behavior, including the odd parts.
3. **Find every caller** of what you'll change: search the codebase, including dynamic uses (reflection, string-based lookups, templates, config files, other repositories that import it).

## While refactoring

- **Small steps, each one compiling and passing tests**: rename, extract function, inline, move, change signature, replace conditional with polymorphism. Run the tests after each.
- **Don't mix in behavior changes or bug fixes.** If you find a bug, note it, finish the step, and fix it separately with its own test.
- **Keep public interfaces stable**, or change them with a deprecation path when outside code depends on them.
- **Match the surrounding style** instead of introducing a new pattern halfway through a codebase.
- Prefer deleting code to adding abstraction. Don't add layers, interfaces or configuration "for later".

## When you're done

- Run the full test suite, linter and type checker.
- Summarize what moved where, so reviewers can follow the diff. Suggest reviewing commit by commit if the steps are separate.
- List anything you noticed but deliberately left alone.
