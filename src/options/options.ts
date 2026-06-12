import type { SourceId } from '../core/types'
import type { GlobalSettings } from '../core/settings'
import { ARXIV_GROUP_IDS } from '../core/sources/arxiv'
import {
  clearAllProjectSettings,
  loadGlobalSettings,
  saveGlobalSettings,
} from '../content/settings-store'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const SOURCES: SourceId[] = ['dblp', 'openreview', 'arxiv', 'crossref', 'europepmc']

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
  }
  await saveGlobalSettings(settings)
  const saved = $('saved')
  saved.classList.add('show')
  setTimeout(() => saved.classList.remove('show'), 1200)
}

void init()
