# Ramulus

Every branch of your repository, in one graph. Ramulus starts a small local server on top of the `git` you already have and opens the UI in your browser.

```sh
npx ramulus            # in a repository
npx ramulus ~/code/app # or point it at one
```

Options: `--port N` to pick a port, `--no-open` to only print the URL.

- Needs Node 20 or newer and `git` on your PATH. Works on macOS, Windows and Linux.
- Everything runs through your installed git, so SSH keys, credential helpers, hooks and LFS behave exactly as on the command line.
- The server listens on 127.0.0.1 only and every request carries a per-run token, so other pages and other machines cannot reach your repository.
- Commit graph with lanes, branches, tags, stashes, staging with diffs, commit and amend, merge, rebase, cherry-pick, revert, reset, fetch, pull, push, and a banner with Continue and Abort when a merge or rebase stops on conflicts.

Source and the native desktop app: https://github.com/a-ahandani/ramulus
