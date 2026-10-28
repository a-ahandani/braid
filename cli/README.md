# Ramulus

A local-first Git GUI. Every branch in one graph, editor-grade diffs, and your repositories in tabs. No account, no cloud, no telemetry.

```sh
npx ramulus            # in a repository
npx ramulus ~/code/app # or point it at one
npx ramulus ~/code     # or a folder of repositories, each opens in its own tab
```

![The Ramulus branch graph](https://raw.githubusercontent.com/a-ahandani/ramulus/main/docs/screenshots/overview.png)

Options: `--port N` to pick a port, `--no-open` to only print the URL.

- Needs Node 20 or newer and `git` on your PATH. Works on macOS, Windows and Linux.
- Everything runs through your installed git, so SSH keys, credential helpers, hooks and LFS behave exactly as on the command line.
- The server listens on 127.0.0.1 only and every request carries a per-run token, so other pages and other machines cannot reach your repository.
- Commit graph with lanes, branches, tags, stashes, staging with diffs, commit and amend, merge, rebase, cherry-pick, revert, reset, fetch, pull, push, and a banner with Continue and Abort when a merge or rebase stops on conflicts.
- Open several repositories in a left sidebar that stays docked or auto-hides, pin favourites to the top, search them with ⌘⇧A, and pull or fetch all of them at once.
- Rebase with uncommitted changes and undo it afterwards; a rejected push offers rebase, merge or a safe force push.
- A movable, resizable diff window on Monaco where every opened file is a tab, with side-by-side or inline layout, hidden-region folds, an editable working-tree side saved with ⌘S, and block-level stage, unstage and discard; drag a branch label onto a commit to merge or rebase; solo branches; command palette (⌘⇧P); shortcuts list (?); tree or flat file lists with +/− counts; resizable panels; status bar; light and dark themes.

Source and the native desktop app: https://github.com/a-ahandani/ramulus
