# UX notes

Ramulus borrows the interaction model that visual git clients have converged on: a three-pane layout with refs on the left, a lane graph in the middle and a detail or staging pane on the right, with every git operation reachable from a right-click on the thing it applies to. The notes below record where Ramulus deliberately departs from the common pattern and why.

## Decisions

- **Refs are grouped into one label per branch.** A local branch and its upstream on the same commit are one pill with two icons, plus an up/down count against the upstream. Two pills for the same branch is visual noise; the count is what people actually look for.
- **Relative dates in the graph, exact dates on hover and in the details.** "3 weeks ago" answers the question the column is for; the exact timestamp is one hover away.
- **Solo instead of hide.** Hiding refs one by one is tedious; soloing one or two branches answers "what is on this branch" directly. Esc or the chip in the header brings everything back.
- **Hunk staging lives on the hunk header.** Each hunk carries Stage / Discard (or Unstage) at the point where the user is already reading. Line-level staging is deliberately left out until there is demand; hunks cover most cases and avoid a mode.
- **Drag a branch label onto a commit** to merge or rebase. The drop menu only lists operations that are possible from the current state, and says why when none are, instead of failing after the fact.
- **One command palette, one shortcut list.** Every action in a menu is also in the palette (⌘⇧P) so a keyboard user never has to find a pixel. The shortcut list (?) is generated from the same table that binds the keys, so it cannot drift.
- **Single-key shortcuts only act on a selection** (S stages the selected file, U unstages it) and never fire while an input or overlay has focus.
- **Status bar carries the three numbers that change what you do next:** ahead/behind against the upstream, uncommitted changes, stashes. Nothing else.
- **Destructive actions confirm with the consequence, not the verb.** "Unstaged edits to README.md will be lost. Continue?" rather than "Are you sure?".
- **In-progress operations get a banner, not a modal.** A merge, rebase, cherry-pick or revert that stopped on conflicts shows a banner with Continue and Abort, and the conflicted files are marked in the list. The user can keep using the graph while deciding.
- **Trees collapse single-child folders** (`src/ui/components` as one row) so deep paths do not need six clicks.
- **Per-file numbers (+12 −3) sit at the right edge** and give way to the action buttons on hover, so the row never grows.
- **Light theme follows the OS** and can be overridden from the status bar; both palettes keep the same ten lane colours so a branch keeps its colour when the theme changes.

## Left out on purpose

- Undo/redo of git operations: the reflog already provides it and a faithful implementation needs state tracking that is easy to get wrong.
- Interactive rebase by dragging commits: valuable, but it needs its own mode and conflict flow; planned as a separate round.
- Tabs for several repositories: the npm helper runs per repository; open a second terminal instead.
- Integrations with hosting services, cloud patches, AI features: outside the scope of a local client.
