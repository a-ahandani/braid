# Ramulus

Ramulus (Latin for a small branch) is a desktop git client for local repositories, written in Rust with egui and libgit2.
No account, no cloud services, no telemetry. MIT licensed; see THIRD-PARTY-NOTICES.md for bundled components.

## What it does

- Commit graph with colored lanes, merge and stash nodes, a work-in-progress row, and branch/tag labels
- Left panel: local branches, remote branches, tags, stashes (click to jump, double-click to checkout, right-click for actions)
- Right panel: commit details with changed files and diffs, or the staging area with unstaged/staged lists, per-file stage/unstage/discard, commit and amend
- Branch create/rename/delete, tag create/delete, checkout (branch, remote branch, or commit)
- Merge, rebase, reset (soft/mixed/hard), cherry pick, revert, stash save/apply/pop/drop
- Fetch, pull (merge, fast-forward only, rebase) and push through your installed `git`, so your existing SSH keys and credential helpers just work
- Live refresh when the working tree or `.git` changes
- Author avatars from Gravatar (an MD5 of each author email is sent to gravatar.com; initials are shown when there is no photo)
- Keyboard: `⌘O` open, `⌘L` fetch, `⌘B` branch, `⌘F` find commit, `⌘⏎` commit, `⌘⇧S` stage all, `⌘⇧U` unstage all, `⌘J`/`⌘K` toggle panels, `↑`/`↓` move selection

The browser UI (used by `npx ramulus` and the hosted page) adds hunk-level staging, diff line numbers with whitespace and wrap toggles, drag a branch label onto a commit to merge or rebase, solo branches, a command palette (`⌘⇧P`), a shortcuts list (`?`), tree or flat file lists with per-file counts, resizable panels, a status bar and a light theme. Design notes live in `docs/ux.md`.

## Run it from npm, on any OS

```sh
npx ramulus            # inside a repository
```

This starts a small local server on top of your installed `git` and opens the same UI in your browser. Native speed, your SSH keys and credential helpers, rebase, cherry-pick and revert included. Needs Node 20+ and `git`. Nothing is downloaded through a browser, so there is no Gatekeeper step. Details in `cli/README.md`.

## Use it in the browser with nothing installed

https://a-ahandani.github.io/ramulus/ runs the same UI with git reimplemented in JavaScript over the File System Access API (Chrome and Edge). It is slower on large repositories and cannot use SSH; see `web/README.md`.

## Download (macOS, Apple Silicon)

Get `Ramulus-<version>-macos-arm64.dmg` from the [Releases](https://github.com/a-ahandani/ramulus/releases) page, open it, and drag `Ramulus.app` to Applications. Until the build is notarized, macOS reports a downloaded copy as damaged. After copying it to Applications, clear the download flag once:

```sh
xattr -d com.apple.quarantine /Applications/Ramulus.app
```

To produce a signed and notarized build yourself, run the bundle script with `RAMULUS_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"` and `RAMULUS_NOTARY_PROFILE=<notarytool keychain profile>` set.

## Build from source on macOS

Requires Rust (`curl https://sh.rustup.rs | sh`) and `git` on your PATH.

```sh
git clone https://github.com/a-ahandani/ramulus.git && cd ramulus
scripts/bundle-mac.sh --install     # builds Ramulus.app and the .dmg, and copies the app to /Applications
```

Or install just the binary:

```sh
cargo install --path .
ramulus /path/to/repo
```

## Develop

```sh
cargo run -- /path/to/repo
cargo test
```

Windows and Linux are planned; the code has no macOS-specific dependencies, only the bundle script is.
