# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

EasyCite: a personal-use Chrome extension (Manifest V3) that searches CS paper databases (DBLP, OpenReview, arXiv, ACL Anthology) and inserts citations into Overleaf — BibTeX entry into the project's `.bib` file, citation key at the cursor. Built for speed: parallel source queries, incremental result rendering, invisible bib writes over Overleaf's OT websocket.

## Commands

- `npm run dev` — Vite dev server with CRXJS hot reload; load `dist/` unpacked at chrome://extensions
- `npm run build` — typecheck (`tsc --noEmit`) + production build to `dist/`
- `npm test` — run vitest once; `npm run test:watch` for watch mode
- Run a single test file: `npx vitest run src/core/citation.test.ts`

## Architecture

The manifest is generated from `manifest.config.ts` by @crxjs/vite-plugin. Three execution contexts, connected by message passing:

1. **MAIN-world page bridge** (`src/page/bridge.ts`) — listed in `web_accessible_resources`, injected as a `<script>` tag by the content script. Only context with access to Overleaf's CodeMirror 6: captures `detail.CodeMirror` from the `UNSTABLE_editor:extensions` window event (re-fireable by dispatching `editor:extension-loaded` on window), resolves the live `EditorView`, and serves read/insert operations. Talks to the content script via paired `CustomEvent`s (`EASYCITE_REQ`/`EASYCITE_RES`) with requestId + timeout; payloads must be JSON-serializable.
2. **Content script, isolated world** (`src/content/`) — overlay UI, keyboard shortcuts, orchestration. Reads `meta[name="ol-project_id"]` / `meta[name="ol-csrfToken"]`, fetches `GET /project/<id>/entities` (session-cookie auth) to find `.bib` files, and runs `socket.ts`, a minimal socket.io 0.9 client speaking Overleaf's OT protocol (`joinProject` → `joinDoc` → `applyOtUpdate` → `leaveDoc`) to edit the .bib without opening it. If the socket path fails, falls back to clicking the file in the project tree and editing via the bridge.
3. **Background service worker** (`src/background.ts`) — all cross-origin fetches (search queries + BibTeX retrieval), reached via `chrome.runtime.sendMessage`. Handles the manifest `commands` shortcut.

`src/core/` is pure logic with no browser APIs — everything in it must stay unit-testable under vitest (tests live next to sources as `*.test.ts`). Citation-command detection/key-merging (`citation.ts`), BibTeX parsing/key rewriting/sorted insertion (`bibtex.ts`), cross-source dedupe and official-version ranking (`merge.ts`), and per-source query builders/response parsers (`sources/`).

## Domain rules worth knowing

- **Prefer official versions**: DBLP records with `venue == "CoRR"` (or type "Informal and Other Publications") are arXiv preprints; same paper often has a second, official record. Ranking: ACL Anthology ≥ official venue (DBLP non-CoRR) > OpenReview-accepted > arXiv. OpenReview acceptance: `content.venue.value` not starting with "Submitted to" and `venueid` lacking `Rejected_Submission`/`Withdrawn`/`Submission`.
- **BibTeX source by provenance**: ACL → `aclanthology.org/<id>.bib`; other venues → `dblp.org/rec/<key>.bib`; OpenReview → `content._bibtex.value`; arXiv-only → `arxiv.org/bibtex/<id>`.
- Search is typeahead: debounced, all enabled sources fired in parallel, stale responses discarded by sequence number. Never serialize source requests or add retry/backoff chains — that's the slowness this project exists to avoid.
- Bib writes are single insert ops (`{p, i}`) at a computed position (alphabetical or append), never whole-document replaces.

## Testing changes against Overleaf

Editor integration and bib writes can only be verified manually: `npm run dev`, load `dist/` unpacked, open a real Overleaf project. Overleaf internals (the `UNSTABLE_editor:extensions` event, socket.io 0.9 protocol, `/project/<id>/entities`) are undocumented and may drift — when integration breaks, check Overleaf's source (github.com/overleaf/overleaf, `services/web`) and the Overleaf-Workshop extension's protocol docs (github.com/iamhyc/Overleaf-Workshop).
