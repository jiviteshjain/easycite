# EasyCite

Fast citation insertion for Overleaf. Press **Ctrl/Cmd+Shift+E**, type a few words of a paper you already know (title, authors, year), hit Enter — the BibTeX entry lands in your `.bib` file (invisibly, no tab switching) and the citation key is inserted at the cursor, merged into an existing `\cite`/`\citep`/`\citet` if you're inside one.

Searches DBLP, OpenReview, and arXiv in parallel; prefers official published versions (ACL Anthology, NeurIPS/ICML/ICLR via OpenReview/DBLP, CVPR, COLM, TMLR, …) over arXiv preprints, with `⌥⏎` to grab the preprint instead.

## Install

```sh
npm install
npm run build
```

Then load the `dist/` folder as an unpacked extension at `chrome://extensions` (enable Developer mode).

## Develop

```sh
npm run dev    # vite + CRXJS hot reload
npm test       # vitest unit tests for the core logic
```

## Usage

- `Ctrl/Cmd+Shift+E` — open the search overlay (rebind at `chrome://extensions/shortcuts`)
- `↑↓` pick · `⏎` insert · `⌥⏎` insert the alternate (preprint/official) version · `⌘⏎` insert and keep the overlay open for multi-key cites · `esc` close
- Footer: per-project bibliography file picker and source toggles (saved per Overleaf project)
- Global defaults (citation key format, alphabetical vs append, default cite command) in the extension options page
