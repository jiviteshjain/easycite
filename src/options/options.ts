import type { SourceId } from '../core/types'
import type { GlobalSettings } from '../core/settings'
import * as arxiv from '../core/sources/arxiv'
import * as crossref from '../core/sources/crossref'
import * as dblp from '../core/sources/dblp'
import * as europepmc from '../core/sources/europepmc'
import * as openreview from '../core/sources/openreview'
import {
  clearAllProjectSettings,
  loadGlobalSettings,
  saveGlobalSettings,
} from '../content/settings-store'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const ARXIV_GROUP_IDS = arxiv.ARXIV_GROUP_IDS

interface SourceInfo {
  id: SourceId
  label: string
  politePool: boolean
}

// Each source declares POLITE_POOL itself; this list is the registration site.
const SOURCE_INFO: SourceInfo[] = [
  { id: 'dblp', label: 'DBLP', politePool: dblp.POLITE_POOL },
  { id: 'openreview', label: 'OpenReview', politePool: openreview.POLITE_POOL },
  { id: 'arxiv', label: 'arXiv', politePool: arxiv.POLITE_POOL },
  { id: 'crossref', label: 'Crossref', politePool: crossref.POLITE_POOL },
  { id: 'europepmc', label: 'Europe PMC', politePool: europepmc.POLITE_POOL },
]

const SOURCES: SourceId[] = SOURCE_INFO.map((s) => s.id)

async function init(): Promise<void> {
  const settings = await loadGlobalSettings()

  $<HTMLSelectElement>('citeKeyFormat').value = settings.citeKeyFormat
  $<HTMLSelectElement>('bibInsertMode').value = settings.bibInsertMode
  $<HTMLSelectElement>('defaultCiteCommand').value = settings.defaultCiteCommand
  $<HTMLInputElement>('preferOfficial').checked = settings.preferOfficial
  $<HTMLInputElement>('debounceMs').value = String(settings.debounceMs)
  for (const s of SOURCES) {
    $<HTMLInputElement>(`src-${s}`).checked = settings.defaultSources.includes(s)
  }
  for (const g of ARXIV_GROUP_IDS) {
    $<HTMLInputElement>(`cat-${g}`).checked = settings.arxivCategories.includes(g)
  }
  $<HTMLInputElement>('politeEmail').value = settings.politeEmail ?? ''
  // Source-declarative: settings UI never hard-codes which sources use the email.
  $('politeSources').textContent = SOURCE_INFO.filter((s) => s.politePool)
    .map((s) => s.label)
    .join(', ')

  document.body.addEventListener('change', () => void save())

  $<HTMLButtonElement>('clearProjects').addEventListener('click', () => {
    void (async () => {
      const count = await clearAllProjectSettings()
      $('cleared').textContent =
        count === 0 ? 'Nothing stored' : `Cleared ${count} project${count === 1 ? '' : 's'}`
      setTimeout(() => ($('cleared').textContent = ''), 2500)
    })()
  })
}

async function save(): Promise<void> {
  const defaultSources = SOURCES.filter((s) => $<HTMLInputElement>(`src-${s}`).checked)
  // Empty = arXiv disabled (the search controller skips the source entirely).
  const arxivCategories = ARXIV_GROUP_IDS.filter((g) => $<HTMLInputElement>(`cat-${g}`).checked)
  const settings: GlobalSettings = {
    citeKeyFormat: $<HTMLSelectElement>('citeKeyFormat').value as GlobalSettings['citeKeyFormat'],
    bibInsertMode: $<HTMLSelectElement>('bibInsertMode').value as GlobalSettings['bibInsertMode'],
    defaultCiteCommand: $<HTMLSelectElement>('defaultCiteCommand').value,
    preferOfficial: $<HTMLInputElement>('preferOfficial').checked,
    debounceMs: Math.max(0, Number($<HTMLInputElement>('debounceMs').value) || 250),
    defaultSources: defaultSources.length > 0 ? defaultSources : ['dblp'],
    arxivCategories,
    politeEmail: $<HTMLInputElement>('politeEmail').value.trim() || undefined,
  }
  const saved = $('saved')
  const err = $('saveError')
  saved.classList.remove('show')
  err.classList.remove('show')
  try {
    await saveGlobalSettings(settings)
    saved.classList.add('show')
    setTimeout(() => saved.classList.remove('show'), 1200)
  } catch (e) {
    err.textContent = `Save failed: ${e instanceof Error ? e.message : String(e)}`
    err.classList.add('show')
  }
}

void init()
