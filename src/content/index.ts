import { computeInsertion, parseKeyHint, seedTokenAtCursor } from '../core/citation'
import { generateKey, rewriteKey, synthesizeBibtex } from '../core/bibtex'
import { parseBibPapers } from '../core/local'
import type { EffectiveSettings } from '../core/settings'
import type { BibtexResponse, MergedResult, Paper, SourceId } from '../core/types'
import * as bridge from './bridge-client'
import { readBibContent, removeBibEntry, writeBibEntry, type BibWriteResult } from './bib-writer'
import { Overlay, type SelectOptions } from './overlay'
import { SearchController, type SearchUpdate } from './search'
import { bibFilesFrom, fetchEntities, getProjectId, resolveBibFile } from './overleaf'
import {
  loadEffectiveSettings,
  loadProjectSettings,
  saveProjectSettings,
} from './settings-store'

const PREFETCH_TOP_N = 3
const PREFETCH_SETTLE_MS = 600

let overlay: Overlay | null = null
let controller: SearchController | null = null
let settings: EffectiveSettings | null = null
let projectId = ''
let bibFiles: string[] = []
let currentBibFile: string | undefined
let openedEditorFileName: string | undefined
let inserting = false

/** The last insertion, revertible with Cmd/Ctrl+Shift+Z while its toast is visible. */
interface PendingUndo {
  /** Absent when the entry already existed and nothing was written. */
  bib?: { file: string; from: number; text: string }
  cite: { from: number; inserted: string; prev: string; fileName?: string }
  query: string
}
let pendingUndo: PendingUndo | null = null
let undoTimer: ReturnType<typeof setTimeout> | undefined

function armUndo(undo: PendingUndo, ttlMs: number): void {
  if (undoTimer !== undefined) clearTimeout(undoTimer)
  pendingUndo = undo
  undoTimer = setTimeout(() => {
    pendingUndo = null
  }, ttlMs)
}

bridge.injectBridge()

// Prefetch only once typing has settled, and never re-request the same ref:
// hammering DBLP/arXiv on every keystroke makes them throttle the actual searches.
let prefetchTimer: ReturnType<typeof setTimeout> | undefined
const prefetched = new Set<string>()

function prefetchBibtex(results: MergedResult[]): void {
  if (prefetchTimer !== undefined) clearTimeout(prefetchTimer)
  prefetchTimer = setTimeout(() => {
    for (const result of results.slice(0, PREFETCH_TOP_N)) {
      const paper = result.primary
      const id = `${paper.bibtexSource}:${paper.bibtexRef}`
      if (paper.bibtexSource === 'local' || paper.inlineBibtex || prefetched.has(id)) continue
      prefetched.add(id)
      chrome.runtime
        .sendMessage({ kind: 'bibtex', provenance: paper.bibtexSource, ref: paper.bibtexRef })
        .catch(() => {})
    }
  }, PREFETCH_SETTLE_MS)
}

async function fetchBibtex(paper: Paper): Promise<string> {
  if (paper.inlineBibtex) return paper.inlineBibtex
  // Some OpenReview notes carry no _bibtex; build an entry from metadata.
  if (paper.bibtexSource === 'openreview') return synthesizeBibtex(paper)
  const res: BibtexResponse = await chrome.runtime.sendMessage({
    kind: 'bibtex',
    provenance: paper.bibtexSource,
    ref: paper.bibtexRef,
  })
  if (!res.bibtex) throw new Error(res.error ?? 'Failed to fetch BibTeX')
  return res.bibtex
}

function ensureOverlay(): Overlay {
  if (overlay) return overlay
  overlay = new Overlay({
    onQueryChange: (text) => controller?.query(text),
    onSubmit: (text) => controller?.queryNow(text),
    onSelect: (result, opts) => void insertResult(result, opts),
    onOpenPaper: (result) => openPaper(result),
    onClose: () => closeOverlay(),
    onToggleSource: (source) => void toggleSource(source),
    onPickBibFile: (file) => void pickBibFile(file),
  })
  return overlay
}

function closeOverlay(): void {
  overlay?.close()
  bridge.focusEditor().catch(() => {})
}

async function toggleSource(source: SourceId): Promise<void> {
  if (!settings) return
  const enabled = settings.sources.includes(source)
    ? settings.sources.filter((s) => s !== source)
    : [...settings.sources, source]
  if (enabled.length === 0) return
  settings.sources = enabled
  const project = await loadProjectSettings(projectId)
  await saveProjectSettings(projectId, { ...project, sources: enabled })
  controller?.setSources(enabled, settings.preferOfficial)
  overlay?.setSources(enabled)
  overlay?.focusInput()
}

async function pickBibFile(file: string): Promise<void> {
  currentBibFile = file
  overlay?.setBibFiles(bibFiles, file)
  controller?.setLocalPapers([])
  loadLocalPapers(file)
  const project = await loadProjectSettings(projectId)
  await saveProjectSettings(projectId, { ...project, bibFile: file })
  overlay?.focusInput()
}

/** Read the bib file and surface its entries as instant local results. */
function loadLocalPapers(file: string): void {
  readBibContent(projectId, file)
    .then((content) => {
      const papers = parseBibPapers(content)
      // Append mode puts new entries at the end — reverse so the most recently
      // added come first; alphabetical bibs keep file order.
      if (settings?.bibInsertMode === 'append') papers.reverse()
      controller?.setLocalPapers(papers)
    })
    .catch(() => {})
}

function openPaper(result: MergedResult): void {
  const url = result.primary.url ?? result.alternate?.url
  if (!url) {
    overlay?.setStatus('No link available for this paper', true)
    return
  }
  // Opening from the page inherits the physically-held shift key and becomes
  // a popup window; the background worker always opens a real tab.
  chrome.runtime.sendMessage({ kind: 'open-tab', url }).catch(() => {})
}

async function insertResult(result: MergedResult, opts: SelectOptions): Promise<void> {
  if (!settings || inserting) return
  const paper = (opts.alternate && result.alternate) || result.primary
  const ui = ensureOverlay()
  const isLocal = paper.bibtexSource === 'local'
  if (!isLocal && !currentBibFile) {
    ui.setStatus('Pick a bibliography file first (button bottom-left)', true)
    return
  }
  inserting = true
  ui.setStatus('Inserting…')
  const query = ui.getQuery()
  try {
    let key: string
    let entry = ''
    let write: BibWriteResult | undefined
    if (isLocal) {
      // Already in the .bib — only the citation key goes in.
      key = paper.bibtexRef
    } else {
      entry = (await fetchBibtex(paper)).trim()
      const customKey = generateKey(entry, settings.citeKeyFormat)
      if (customKey) entry = rewriteKey(entry, customKey)
      write = await writeBibEntry(
        projectId,
        currentBibFile!,
        entry,
        settings.bibInsertMode,
        openedEditorFileName
      )
      key = write.key
    }

    const state = await bridge.getEditorState()
    const ins = computeInsertion(state.doc, state.selectionFrom, key, settings.defaultCiteCommand)
    await bridge.replaceRange({ ...ins, expectedDocLength: state.doc.length })

    ui.setStatus(null)
    let ttl: number
    if (isLocal) {
      ttl = ui.showToast({ text: `Reused from ${currentBibFile ?? 'your .bib'}`, key }, 'ok', true)
    } else if (write!.existed) {
      ttl = ui.showToast({ text: `Already in ${currentBibFile} — reused`, key }, 'warn', true)
    } else {
      ttl = ui.showBibToast(key, currentBibFile!, rewriteKey(entry, key))
      if (write!.renamedFrom) {
        ui.showToast({ text: `Key @${write!.renamedFrom} was taken — used`, key }, 'warn')
      }
    }
    armUndo(
      {
        bib: write?.inserted && { file: currentBibFile!, ...write.inserted },
        cite: {
          from: ins.from,
          inserted: ins.insert,
          prev: state.doc.slice(ins.from, ins.to),
          fileName: state.fileName,
        },
        query,
      },
      ttl
    )
    if (!opts.keepOpen) {
      ui.close()
    } else {
      ui.focusInput()
    }
  } catch (err) {
    // The overlay stays open on failure, so the status banner is enough.
    ui.setStatus(err instanceof Error ? err.message : String(err), true)
  } finally {
    inserting = false
  }
}

/**
 * Revert the last insertion: the cite key (only if the doc still holds exactly
 * what we inserted) and the bib entry (only if one was actually written), then
 * bring the overlay back with the same search.
 */
async function undoLast(): Promise<void> {
  const undo = pendingUndo
  if (!undo || inserting) return
  pendingUndo = null
  if (undoTimer !== undefined) clearTimeout(undoTimer)
  const ui = ensureOverlay()
  ui.clearToasts()

  // All-or-nothing, citation first: if it can't be reverted, leave the bib
  // entry too — a dangling \cite breaks compilation. The reverse leftover
  // (citation reverted, entry removal failed) is just an unused entry.
  let citeProblem: string | undefined
  try {
    const state = await bridge.getEditorState()
    const c = undo.cite
    if (c.fileName && state.fileName && state.fileName !== c.fileName) {
      citeProblem = `${c.fileName} is not open`
    } else if (state.doc.slice(c.from, c.from + c.inserted.length) === c.inserted) {
      await bridge.replaceRange({
        from: c.from,
        to: c.from + c.inserted.length,
        insert: c.prev,
        cursor: c.from + c.prev.length,
        expectedDocLength: state.doc.length,
      })
    } else {
      citeProblem = 'the document changed'
    }
  } catch (err) {
    citeProblem = err instanceof Error ? err.message : String(err)
  }

  let bibProblem: string | undefined
  if (!citeProblem && undo.bib) {
    try {
      await removeBibEntry(projectId, undo.bib.file, undo.bib.from, undo.bib.text, openedEditorFileName)
    } catch (err) {
      bibProblem = err instanceof Error ? err.message : String(err)
    }
  }

  await openOverlay(undo.query)
  // Toast, not status: reopening re-runs the search and its updates clear the
  // status banner, which would wipe the message immediately.
  if (citeProblem) {
    ui.showToast({ text: `Could not undo because ${citeProblem}` }, 'error')
  } else if (bibProblem) {
    ui.showToast(
      { text: `Citation reverted but could not remove the ${undo.bib!.file} entry: ${bibProblem}` },
      'error'
    )
  } else if (undo.bib) {
    ui.showToast({ text: `Citation reverted · entry removed from ${undo.bib.file}` })
  } else {
    ui.showToast({ text: 'Citation reverted' })
  }
}

async function openOverlay(presetQuery?: string): Promise<void> {
  const ui = ensureOverlay()
  if (ui.isOpen) {
    if (presetQuery === undefined) {
      ui.focusInput()
    } else {
      ui.open(presetQuery)
      if (presetQuery) controller?.queryNow(presetQuery)
    }
    return
  }

  projectId = getProjectId()
  settings = await loadEffectiveSettings(projectId)
  controller = new SearchController(
    (update: SearchUpdate) => {
      ui.update(update)
      prefetchBibtex(update.results)
    },
    settings.sources,
    settings.preferOfficial,
    settings.debounceMs
  )

  let seed = presetQuery ?? ''
  try {
    const state = await bridge.getEditorState()
    openedEditorFileName = state.fileName
    if (presetQuery === undefined) {
      if (state.selectionFrom !== state.selectionTo) {
        seed = state.doc.slice(state.selectionFrom, state.selectionTo).slice(0, 120)
      } else {
        const token = seedTokenAtCursor(state.doc, state.selectionFrom)
        if (token) seed = parseKeyHint(token.text)
      }
    }
  } catch {
    // editor not ready; open with empty seed
  }

  ui.setSources(settings.sources)
  ui.setBibFiles([], currentBibFile)
  ui.open(seed)
  if (seed) controller.queryNow(seed)

  // Resolve bib files in the background; doesn't block the overlay opening.
  void (async () => {
    try {
      const entities = await fetchEntities(projectId)
      bibFiles = bibFilesFrom(entities)
      let docText = ''
      try {
        docText = (await bridge.getEditorState()).doc
      } catch {
        // fine, resolution falls back to conventions
      }
      currentBibFile = resolveBibFile(bibFiles, settings?.bibFile, docText)
      ui.setBibFiles(bibFiles, currentBibFile)
      if (currentBibFile) {
        loadLocalPapers(currentBibFile)
      } else if (bibFiles.length > 0) {
        ui.setStatus('Multiple .bib files — pick one below', true)
      } else {
        ui.setStatus('No .bib file found in this project', true)
      }
    } catch (err) {
      ui.setStatus(err instanceof Error ? err.message : String(err), true)
    }
  })()
}

console.log('[EasyCite] content script loaded')

chrome.runtime.onMessage.addListener((msg) => {
  console.log('[EasyCite] message received:', msg)
  if (msg?.kind === 'open-overlay') {
    openOverlay().catch((err) => console.error('[EasyCite] openOverlay failed:', err))
  }
})

// Backup in-page shortcut, in case the manifest command is unassigned.
// Cmd/Ctrl+Shift+Z undoes the last insertion while its toast is visible
// (and only then — otherwise the editor keeps it as redo).
window.addEventListener(
  'keydown',
  (e) => {
    if (!e.shiftKey || !(e.metaKey || e.ctrlKey) || e.altKey) return
    const key = e.key.toLowerCase()
    if (key === 'e') {
      e.preventDefault()
      e.stopPropagation()
      openOverlay().catch((err) => console.error('[EasyCite] openOverlay failed:', err))
    } else if (key === 'z' && pendingUndo) {
      e.preventDefault()
      e.stopPropagation()
      undoLast().catch((err) => console.error('[EasyCite] undo failed:', err))
    }
  },
  true
)
