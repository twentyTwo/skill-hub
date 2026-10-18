---
name: write-docs
description: Write or update a README, guide, API reference or code comments that are accurate, scannable and written for the reader's task. Use when asked to document code, write a README, explain a module, or update docs after a change.
---

# Write documentation

## Decide who it's for

Pick one reader and one job before writing: a new user installing the tool, a developer calling an API, a contributor changing internals, or an operator running it in production. A page that tries to serve all of them serves none.

## Get the facts from the code

- Read the code, configuration and tests. Run commands before documenting them, and copy their real output.
- Never document behavior you haven't confirmed. If something is unclear, say so in your reply instead of guessing in the docs.
- When updating docs after a change, search for every place the old behavior is mentioned (README, guides, comments, help text, examples).

## Structure

**README:** what it is and who it's for (one or two sentences) → install → a minimal working example → common tasks → configuration → where to get help or contribute. Put the most common task first.

**API reference:** for each function or endpoint, give its purpose, parameters (type, required, default), return value, errors, and a short example.

**Code comments:** explain *why* (a constraint, a workaround, a non-obvious decision), not what the next line does. Keep them next to the code they describe, and delete comments the change made untrue.

## Style

- Short sentences, active voice, second person ("Run `npm test`"). Define a term the first time you use it.
- Headings that say what the section does ("Configure a proxy"), so readers can scan.
- Code blocks for anything the reader types or copies, with the language tag. Examples must run as written.
- Lists for steps and options, tables for comparisons. No walls of text.
- Link instead of repeating. Keep one source of truth for each fact.
