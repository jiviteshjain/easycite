# EasyCite

Fast citation insertion for Overleaf. Press **Ctrl/Cmd+Shift+E**, type a few words of a paper you already know (title, authors, year), hit Enter — the BibTeX entry lands in your `.bib` file (invisibly, no tab switching) and the citation key is inserted at the cursor, merged into an existing `\cite`/`\citep`/`\citet` if you're inside one.

Searches DBLP, OpenReview, and arXiv in parallel; prefers official published versions (ACL Anthology, NeurIPS/ICML/ICLR via OpenReview/DBLP, CVPR, COLM, TMLR, …) over arXiv preprints, with `⌥⏎` to grab the preprint instead.

<p align="center">
  <img src="docs/easycite-overlay.png" alt="EasyCite search overlay docked on the right of an Overleaf project" width="420">
</p>
<p align="center">
  <img src="docs/inserted-bibtex-entry.png" alt="Toast showing the BibTeX entry that was just inserted" width="560">
</p>

## Install

Download `easycite-vX.Y.Z.zip` from the [latest release](../../releases/latest), unzip it somewhere permanent (Chrome loads the extension from that folder), then load the folder as an unpacked extension at `chrome://extensions` (enable Developer mode → "Load unpacked"). To update, replace the folder contents with a newer release and click the reload arrow on `chrome://extensions`.

Or build from source:

```sh
npm install
npm run build
```

and load `dist/` the same way.

## Usage

- `Ctrl/Cmd+Shift+E` — open the search overlay (rebind at `chrome://extensions/shortcuts`)
- `↑↓` pick · `⏎` insert · `⌥⏎` insert the alternate (preprint/official) version · `⌘⏎` insert and keep the overlay open for multi-key cites · `⇧⏎` open the paper in a new tab · `esc` close
- Footer: per-project bibliography file picker and source toggles (saved per Overleaf project)
- Global defaults (citation key format, alphabetical vs append, default cite command) in the popup behind the toolbar icon

## Develop

```sh
npm run dev    # vite + CRXJS hot reload
npm test       # vitest unit tests for the core logic
```

## Release

Bump `version` in `manifest.config.ts` and `package.json`, then:

```sh
git tag v0.1.1 && git push --tags
```

GitHub Actions builds, tests, zips `dist/`, and publishes the release automatically.
