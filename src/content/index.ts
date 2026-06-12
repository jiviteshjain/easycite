import { computeInsertion, parseKeyHint, seedTokenAtCursor } from '../core/citation'
import { generateKey, rewriteKey } from '../core/bibtex'
import type { EffectiveSettings } from '../core/settings'
import type { BibtexResponse, MergedResult, Paper, SourceId } from '../core/types'
import * as bridge from './bridge-client'
import { writeBibEntry } from './bib-writer'
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
      if (paper.inlineBibtex || prefetched.has(id)) continue
      prefetched.add(id)
      chrome.runtime
        .sendMessage({ kind: 'bibtex', provenance: paper.bibtexSource, ref: paper.bibtexRef })
        .catch(() => {})
    }
  }, PREFETCH_SETTLE_MS)
}

async function fetchBibtex(paper: Paper): Promise<string> {
  if (paper.inlineBibtex) return paper.inlineBibtex
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
  const project = await loadProjectSettings(projectId)
  await saveProjectSettings(projectId, { ...project, bibFile: file })
  overlay?.focusInput()
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
  if (!currentBibFile) {
    ui.setStatus('Pick a bibliography file first (button bottom-left)', true)
    return
  }
  inserting = true
  ui.setStatus('Inserting…')
  try {
    let entry = (await fetchBibtex(paper)).trim()
    const customKey = generateKey(entry, settings.citeKeyFormat)
    if (customKey) entry = rewriteKey(entry, customKey)

    const write = await writeBibEntry(
      projectId,
      currentBibFile,
      entry,
      settings.bibInsertMode,
      openedEditorFileName
    )

    const state = await bridge.getEditorState()
    const ins = computeInsertion(
      state.doc,
      state.selectionFrom,
      write.key,
      settings.defaultCiteCommand
    )
    await bridge.replaceRange({ ...ins, expectedDocLength: state.doc.length })

    ui.setStatus(null)
    if (write.existed) {
      ui.showToast({ text: `Already in ${currentBibFile} — reused`, key: write.key }, 'warn')
    } else {
      ui.showBibToast(write.key, currentBibFile, rewriteKey(entry, write.key))
      if (write.renamedFrom) {
        ui.showToast({ text: `Key @${write.renamedFrom} was taken — used`, key: write.key }, 'warn')
      }
    }
    if (!opts.keepOpen) {
      ui.close()
    } else {
      ui.focusInput()
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ui.setStatus(message, true)
    ui.showToast({ text: `EasyCite: ${message}` }, 'error')
  } finally {
    inserting = false
  }
}

async function openOverlay(): Promise<void> {
  const ui = ensureOverlay()
  if (ui.isOpen) {
    ui.focusInput()
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

  let seed = ''
  try {
    const state = await bridge.getEditorState()
    openedEditorFileName = state.fileName
    if (state.selectionFrom !== state.selectionTo) {
      seed = state.doc.slice(state.selectionFrom, state.selectionTo).slice(0, 120)
    } else {
      const token = seedTokenAtCursor(state.doc, state.selectionFrom)
      if (token) seed = parseKeyHint(token.text)
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
      if (!currentBibFile && bibFiles.length > 0) {
        ui.setStatus('Multiple .bib files — pick one below', true)
      } else if (bibFiles.length === 0) {
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
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key.toLowerCase() === 'e' && e.shiftKey && (e.metaKey || e.ctrlKey) && !e.altKey) {
      e.preventDefault()
      e.stopPropagation()
      openOverlay().catch((err) => console.error('[EasyCite] openOverlay failed:', err))
    }
  },
  true
)
