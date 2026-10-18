# Skill Hub — UI spec (Option A "Workbench")

Reference for revamping the VS Code extension and building the desktop app.

| File | What it is |
|---|---|
| `mockups/01-vscode-workspace.html` / `.png` | VS Code: sidebar "This repo" tab + skill detail page |
| `mockups/02-vscode-add-skills.html` / `.png` | VS Code: sidebar "Library" tab + Add skills page |
| `mockups/03-desktop-library.html` / `.png` | Desktop: Library grid + skill inspector |
| `mockups/04-desktop-projects.html` / `.png` | Desktop: Projects matrix + conflict panel |
| `tokens.css` | Colours, type, spacing, and base component classes (`.sh-*`) |

The HTML mockups are static. Open them in a browser and use DevTools to inspect exact sizes. Skill names other than `tech-debt-audit`, and the `[project-n]` names, are sample data.

---

## 1. Visual language

- **Ground:** dark graphite with layered surfaces: chrome `#0A0C0E` → app `#0D0F12` → sidebar `#121519` → editor `#16191E` → cards `#1A1E24`.
- **One accent:** orange `#FF9A4D`. Use it only for the primary action, the selected or active item, and "on" target chips. There's never more than one orange filled button per view.
- **Status colours** are fixed and always come with a glyph, so color is never the only signal: ✓ ↑ ✎ ! × ○.
- **Type:** IBM Plex Sans for UI. JetBrains Mono for anything that is a file or ID (skill names, paths, hashes, SKILL.md).
- **Section labels:** 11px uppercase, letter-spacing 0.06–0.08em, weight 600, colour `--sh-text-faint`.
- **"Not installed" / "available" states** use **dashed** borders. Installed or real things use solid borders.
- **Radii:** 5 (small buttons) · 6 (rows, buttons) · 8 (inputs) · 10 (cards) · 12 (desktop cards and table).

## 2. Status mapping (single source of truth)

These map to `SkillStatus` in `src/core/workspace.ts`. Replace the `STATUS` table in `src/ui/workspaceView.ts` with this:

| `SkillStatus` | Glyph | Short label (rows) | Token | Primary action |
|---|---|---|---|---|
| `synced` | ✓ | Up to date | `--sh-synced-*` | — |
| `outdated` | ↑ | Update available | `--sh-outdated-*` | **Update** → `skillHub.workspace.update` |
| `modified` | ✎ | Edited in this repo | `--sh-modified-*` | **Save to hub** → `skillHub.workspace.saveToHub` |
| `conflict` | ! | Both changed | `--sh-conflict-*` + 2px accent ring | **Resolve…** (merge / take hub / keep local) |
| `missing` | × | Files missing | `--sh-missing-*` | **Restore** → `skillHub.workspace.update` |
| `unmanaged` | ○ | Not tracked | `--sh-unmanaged-*` | **Add to hub** → `skillHub.workspace.addToHub` |

Rule: every row shows **at most one** inline action, the one in this table. Everything else goes in the context menu or on the detail page.

## 3. VS Code extension

### 3.1 Sidebar (`skillHub` view container)

Replace the two tree views (`skillHub.library`, `skillHub.workspace`) with **one `WebviewView`** (`skillHub.main`) that has three tabs. Keep the tree views registered behind a setting (`skillHub.classicViews`) if you want a fallback.

```
┌ SKILL HUB                      🔍 ＋ ⟳ ┐  header: 11px label + icon buttons (28×28)
│ [ This repo | Library | Discover ]   │  segmented control (.sh-segmented)
│ ┌ 📁 skill-hub              lock ✓ ┐ │  repo card: folder name, lock-file state
│ │ 3 skills applied · 1 update · …  │ │  summary from scanWorkspace()
│ │ (●Claude Code) (●AGENTS.md)      │ │  target chips: on = targets used by any
│ │ (○Copilot) (○Cursor)             │ │  skill in the lock file; off = dashed
│ └──────────────────────────────────┘ │
│ NEEDS ATTENTION                      │  outdated, modified, conflict, missing
│ [↑] pdf             [Update]         │
│ APPLIED                              │  synced
│ [✓] tech-debt-audit                  │  selected row: inset 2px accent bar
│ FOUND, NOT TRACKED                   │  unmanaged
│ [○] webapp-testing  [Add to hub]     │
│ ┌ ─ Drop skills from Library here ─ ┐│  drop zone (keeps existing DnD)
└──────────────────────────────────────┘
```

- **Group order:** Needs attention → Applied → Found, not tracked. Hide empty groups.
- **Row:** status badge 22×22 · mono name 12.5px · meta line 11.5px (targets or reason) · optional small button.
- **Activity-bar badge:** count of `outdated + conflict + missing`. This is already computed in `updateBadge`.
- **Library tab:** filter input, chips (All · Applied here · Has update), and skills grouped by source (`describeSource`). Each row has an orange dot if the skill is applied here and an → button for `skillHub.applySkill`.
- **Discover tab:** the GitHub search (`skillHub.searchSkills`) results inline.
- **Multi-root workspaces:** the repo card becomes a dropdown to pick the folder.

### 3.2 Skill detail (`WebviewPanel`, editor area)

Open this on row click instead of opening SKILL.md directly. Title: skill name, with the hexagon icon.

1. **Header:** mono name 24px, status pill, then a meta line: source link · "Applied {date}" · short hash (8 chars of `lock.hash`). On the right: `Open SKILL.md` · `Check source` (secondary) · `Apply to more targets` (primary).
2. **Description:** 14px, max 72ch.
3. **INSTALLED FOR:** one card per target in `targets.ts`, in a grid of `minmax(220px,1fr)`.
   - *Installed:* solid card, name + "✓ In sync" (or that target's status), with the mono path.
   - *Not installed:* dashed card, "Not installed", and a ghost button "+ Install here".
4. **SKILL.md** preview: frontmatter keys in accent colour, first lines of the body. Then **FILES**: the skill folder listing, and at the bottom a danger button "Remove from this repo".

### 3.3 Add skills (`WebviewPanel`)

This replaces the quick-pick chain behind `skillHub.addSkill`.

- **Single input** (52px tall, accent border on focus). As you type, show a detection chip on the right: GitHub repository / Git URL / File link / Local folder / Search words. Use the same parser as `src/core/sources/index.ts`.
- **Shortcut chips** under the input: GitHub repo · Git URL · File link · Local folder · Create new skill.
- **Results card:** "Found N skills in {source}", Select all, then one checkbox row per skill (mono name, description, path on the right). Skills already in the hub are disabled with an "Already in hub" tag.
- **Footer bar:** checkbox "Also apply to this repo for" + target chips (prefilled from `skillHub.defaultTargets`), then the primary button **Add {n} skills**.

### 3.4 Implementation notes

- Webview HTML: link `tokens.css` via `webview.asWebviewUri`, add `class="sh-vscode"` to `<body>`, and set a strict CSP (`default-src 'none'; style-src ${cspSource}; script-src 'nonce-…'; font-src ${cspSource}`).
- Fonts: inside VS Code, inherit `--vscode-font-family` (already handled in `tokens.css`). Don't bundle Plex or JetBrains Mono for the extension.
- Icons: use `@vscode/codicons` in webviews (`pass`, `arrow-circle-up`, `edit`, `warning`, `error`, `circle-large-outline`, `add`, `sync`, `search`, `folder`, `file`). They map onto the glyphs above.
- Messaging: the webview posts `{ type: 'command', id: 'skillHub.workspace.update', args: [skillId, folderUri] }`, and the extension replies with `{ type: 'state', skills: WorkspaceSkill[], library: LibrarySkill[] }` on `hub.onDidChange`.
- Keep `src/ui/actions.ts` as the only place that runs commands. Webviews only post messages.

## 4. Desktop app

Reuse `src/core/` unchanged (it has no `vscode` imports). Use Tauri or Electron with the same web UI. A shared `ui/` package can render both the VS Code webviews and the desktop screens.

### 4.1 Shell

- **Top bar (56px):** logo + "Skill Hub" · global search (`Ctrl K`; also accepts a pasted link, which opens the Add flow) · `Sync all` (secondary) · `+ Add skill` (primary).
- **Left nav (220–240px):** Library · Discover · Projects · Sources · Activity · Settings, with counts on the right. Below that, a **PROJECTS** list with a status dot per repo (blue = updates, amber = local edits or conflict, green = clean) and a dashed "+ Add project folder" button.
- **Layout:** `flex-wrap` row with content `flex: 999 1 520px`. Below about 900px wide, the nav and inspector stack.

### 4.2 Library (`03-desktop-library`)

- Title + "N skills from M sources · stored in {libraryPath}". Grid/list toggle.
- **Filter pills:** All sources · GitHub · Local · Has update · Unused.
- **Skill card** (grid `minmax(240px,1fr)`, min-height 150): mono name · "↑ Update" pill when the source is newer · 2-line description · footer with source + "Used in N projects". Selected card: accent border + 3px soft ring.
- **Inspector (320–360px):** name, source link. A blue notice when the source is newer ("N files changed. Updating flags all X projects that use it", with `Review changes` / `Update`). **USED IN**: one row per project with its targets and status. Bottom: `Apply to projects…` (primary), `Edit`, `Open in VS Code`.

### 4.3 Projects matrix (`04-desktop-projects`)

- **Data:** for each added project folder, run `scanWorkspace(root, hubSkills, targets)`. Rows are projects (name + targets used), columns are hub skills.
- **Banner:** "↑ N updates across M projects · K conflicts need a decision" with `Update all safe`. "Safe" means `outdated` and `missing` only, never `modified` or `conflict`.
- **Cell:** a 44×32 button with the status glyph. An empty cell is a dashed "+" that applies the skill to that project. Every cell has an `aria-label` with the full status text.
- **Conflict panel (380–440px):** "! BOTH CHANGED", "{skill} in {project}", a short diff of SKILL.md (red = removed, green = hub added, amber = local edit). Then a radio choice:
  - **Merge both** (default): opens a 3-way merge, then saves to the hub and the repo.
  - **Take hub version**
  - **Keep local, push to hub**

  Buttons at the bottom: `Skip` and the primary `Merge in editor`.

## 5. Accessibility checklist

- All controls are real `<button>`, `<a>`, `<input>` elements. Icon-only buttons have `aria-label`.
- Tabs use `role="tablist"`/`tab` and `aria-selected`.
- Text contrast is ≥ 4.5:1 on its surface. `--sh-text-faint` is only used at 11px+ on sidebar or editor grounds.
- Status always shows glyph + label (tooltip or `aria-label`), never colour alone.
- Visible focus: `--sh-focus` ring on every interactive element.
