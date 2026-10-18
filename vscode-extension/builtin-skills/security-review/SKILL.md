---
name: security-review
description: Review code changes for security vulnerabilities such as injection, broken access control, secrets in code and unsafe deserialization, and report only issues with a concrete exploit path. Use when asked for a security review or audit of a change, endpoint or feature.
---

# Security review

Focus on the code in scope (a diff, a branch, or named files). Report real, exploitable problems, not a generic checklist.

## Method

1. **Map the trust boundaries.** Where does untrusted data enter: HTTP params, headers, cookies, file uploads, webhooks, CLI args, environment, files from users, messages from other services, LLM output?
2. **Follow each input to where it's used** (the sink), and check whether it's validated, encoded or parameterized on the way.
3. **For each candidate issue, write the attack**: the exact request or input, and what the attacker gains. If you can't, it's not a finding.

## What to look for

- **Injection**: SQL/NoSQL built with string concatenation; shell commands with user input (`exec`, `system`, `shell=True`); template injection; LDAP/XPath.
- **Path traversal**: user-controlled paths without normalization and a check that they stay inside the allowed directory; archive extraction (zip slip).
- **XSS**: unescaped output in HTML, `innerHTML`, `dangerouslySetInnerHTML`, `v-html`, or markdown rendered without sanitizing.
- **Access control**: endpoints missing authentication or authorization; object IDs taken from the request without an ownership check (IDOR); privilege checks only in the UI.
- **Secrets**: keys, tokens or passwords in code, config, tests or logs; secrets sent to the client.
- **Crypto and auth**: home-made crypto, weak hashing for passwords (anything but bcrypt/scrypt/argon2), predictable tokens, non-constant-time comparisons, missing CSRF protection on cookie-authenticated state changes.
- **Deserialization and SSRF**: `pickle`, Java serialization, YAML `load` on untrusted data; server-side requests to user-supplied URLs.
- **Dependencies**: new packages that are unmaintained, typo-squatted, or pinned to versions with known CVEs.

## Report

For each finding: severity (critical, high, medium, low), `file:line`, the vulnerable flow from source to sink, a concrete exploit scenario, and a specific fix. Order by severity. If you find nothing exploitable, say so plainly and list what you checked.
