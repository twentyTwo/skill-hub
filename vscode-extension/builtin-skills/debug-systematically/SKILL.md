---
name: debug-systematically
description: Find the root cause of a bug, failing test, crash or unexpected behavior with a reproduce, isolate, hypothesize, verify loop, then fix it with a regression test. Use when something is broken and the cause isn't obvious.
---

# Debug systematically

Don't guess-and-patch. Each step should narrow down where the bug can be.

## 1. Reproduce

- Get the exact error, stack trace, logs, inputs and environment (versions, OS, config).
- Make the failure happen on demand, ideally with one command or one test. If it's intermittent, find what makes it more likely (load, timing, ordering, a specific input).
- If you can't reproduce it, say so and gather more information before changing code.

## 2. Isolate

- Shrink the reproduction: remove inputs, steps and code until removing anything else makes the bug disappear.
- If it used to work, find the change that broke it: `git log` on the affected files, or `git bisect run <test command>`.
- Read the stack trace from the top of *your* code, not the framework's.

## 3. Hypothesize and test

- Write down one specific hypothesis: "the cache returns stale entries because the key ignores the locale".
- Design a check that proves or disproves it: a log line, an assertion, a debugger breakpoint, a unit test. Predict the outcome before running it.
- If the result surprises you, your model of the code is wrong. Update it before trying the next idea.
- Change one thing at a time. Revert experiments that didn't help.

## 4. Fix the cause

- Fix where the wrong value is *produced*, not where it's noticed. Check whether the same mistake exists elsewhere.
- Add a regression test that fails before the fix and passes after.
- Remove temporary logging and debug code.

## 5. Report

Explain the root cause in one or two sentences, the fix, how you verified it, and anything still unexplained.
