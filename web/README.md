# Ramify for the browser

The same client, running entirely in a browser tab: git is reimplemented in JavaScript (isomorphic-git), and the repository folder is read and written through the File System Access API.

- Works in Chrome, Edge and other Chromium browsers. Safari and Firefox can only run the demo repository, because they cannot open folders on disk.
- Fetch, pull and push need a CORS proxy (set in Remote access) and an HTTPS token. SSH remotes do not work in a browser.
- Not available here compared with the desktop app: rebase, cherry-pick, revert, merge conflict resolution, mixed reset, hooks.
- Known limit of the JavaScript git engine: an edit that keeps a file's size and lands in the same second as the last stage can go unnoticed until the next change.

```sh
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # static site in dist/
```
