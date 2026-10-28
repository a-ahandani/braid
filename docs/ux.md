# UX notes

Ramulus borrows the interaction model that visual git clients have converged on: a three-pane layout with refs on the left, a lane graph in the middle and a detail or staging pane on the right, with every git operation reachable from a right-click on the thing it applies to. The notes below record where Ramulus deliberately departs from the common pattern and why.

## Decisions

- **It looks like a code editor, not a dashboard.** The palette, fonts, 22px rows, uppercase section headers, flat inputs, badge counters and the Codicons icon set follow the dark and light "modern" themes most developers already stare at all day, so nothing has to be learned about where the eye should go. Status letters and their colours (M, A, D, U) match the editor's source-control view for the same reason.
- **One tab per repository.** The + in the tab strip, the welcome screen and the palette all open the same picker: recent repositories, the system folder picker, or a typed path. Each tab keeps its own selection, filters and draft message. Only the visible tab watches its folder, so open tabs cost nothing while hidden and refresh when you return. The helper only touches repositories the user opened in this run, and remembers them in `~/.config/ramulus/recent.json`.
- **The message box sits above the file lists, Staged above Changes**, because that is where a source-control view puts them.
- **The graph breathes.** Rows are 30px with 18px avatars on the lane nodes and 24px avatars in the author column, so faces are recognisable at a glance; lists elsewhere stay at the denser 22px.
- **Refs are grouped into one label per branch.** A local branch and its upstream on the same commit are one pill with two icons, plus an up/down count against the upstream. Two pills for the same branch is visual noise; the count is what people actually look for.
- **Relative dates in the graph, exact dates on hover and in the details.** "3 weeks ago" answers the question the column is for; the exact timestamp is one hover away.
- **Solo instead of hide.** Hiding refs one by one is tedious; soloing one or two branches answers "what is on this branch" directly. Esc or the chip in the header brings everything back.
- **The diff is the editor's own diff view.** It runs on Monaco, the open-source core of that editor, so side by side, the +/− gutter, hidden-region folds, the overview ruler and the diagonal fill behave exactly as people expect. A small floating toolbar on each change block stages, unstages or discards that block.
- **Diffs open in a floating window with tabs.** Clicking a file in any list opens it as a tab in one window that can be moved by its title bar, resized from any edge or corner, or maximized; position and size are remembered. The window has no backdrop, so the graph and the file lists stay usable and every file you click becomes another tab. Each tab keeps its own unsaved edits; closing a tab or the window asks first when edits are unsaved. A working-tree tab closes on its own once the file has nothing left to show there, for example after staging the whole file.
- **The working-tree side is editable.** Edits save with ⌘S or the save icon, and the tab shows a dot while there are unsaved edits. Staging writes the chosen block into the index as whole content, not as a patch, so line endings and files without a trailing newline round-trip exactly.
- **Drag a branch label onto a commit** to merge or rebase. The drop menu only lists operations that are possible from the current state, and says why when none are, instead of failing after the fact.
- **One command palette, one shortcut list.** Every action in a menu is also in the palette (⌘⇧P) so a keyboard user never has to find a pixel. The shortcut list (?) is generated from the same table that binds the keys, so it cannot drift.
- **Keys typed in the diff stay in the diff.** App shortcuts ignore keystrokes that start inside the diff window, and ⌘S is bound per editor, so a save always writes the file you are looking at. Single-letter staging shortcuts were removed after one staged a file by accident; staging happens from the block toolbar or the file list.
- **Status bar carries the three numbers that change what you do next:** ahead/behind against the upstream, uncommitted changes, stashes. Nothing else.
- **Destructive actions confirm with the consequence, not the verb.** "Unstaged edits to README.md will be lost. Continue?" rather than "Are you sure?".
- **In-progress operations get a banner, not a modal.** A merge, rebase, cherry-pick or revert that stopped on conflicts shows a banner with Continue and Abort, and the conflicted files are marked in the list. The user can keep using the graph while deciding.
- **Trees collapse single-child folders** (`src/ui/components` as one row) so deep paths do not need six clicks.
- **Per-file numbers (+12 −3) sit at the right edge** and give way to the action buttons on hover, so the row never grows.
- **Light theme follows the OS** and can be overridden from the status bar; both palettes keep the same ten lane colours so a branch keeps its colour when the theme changes.

## Left out on purpose

- Undo/redo of git operations: the reflog already provides it and a faithful implementation needs state tracking that is easy to get wrong.
- Interactive rebase by dragging commits: valuable, but it needs its own mode and conflict flow; planned as a separate round.
- Integrations with hosting services, cloud patches, AI features: outside the scope of a local client.
