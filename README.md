# Ramify

Ramify (to branch out) is a desktop git client for local repositories, written in Rust with egui and libgit2.
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

## Download (macOS, Apple Silicon)

Get `Ramify-<version>-macos-arm64.dmg` from the [Releases](https://github.com/a-ahandani/ramify/releases) page, open it, and drag `Ramify.app` to Applications. The build is signed ad hoc and not notarized yet, so the first launch needs right-click, then Open (or `xattr -d com.apple.quarantine /Applications/Ramify.app`).

## Build from source on macOS

Requires Rust (`curl https://sh.rustup.rs | sh`) and `git` on your PATH.

```sh
git clone https://github.com/a-ahandani/ramify.git && cd ramify
scripts/bundle-mac.sh --install     # builds Ramify.app and the .dmg, and copies the app to /Applications
```

Or install just the binary:

```sh
cargo install --path .
ramify /path/to/repo
```

## Develop

```sh
cargo run -- /path/to/repo
cargo test
```

Windows and Linux are planned; the code has no macOS-specific dependencies, only the bundle script is.
