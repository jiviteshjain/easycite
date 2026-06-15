import { ARXIV_GROUP_IDS } from './sources/arxiv'
import type { SourceId } from './types'

export type CiteKeyFormat = 'authorYearWord' | 'AuthorYear' | 'source'
export type BibInsertMode = 'alphabetical' | 'append'

export interface GlobalSettings {
  citeKeyFormat: CiteKeyFormat
  bibInsertMode: BibInsertMode
  /** Command used when cursor is not inside an existing cite, without backslash. */
  defaultCiteCommand: string
  debounceMs: number
  defaultSources: SourceId[]
  preferOfficial: boolean
  /** Top-level arXiv archive groups to search; all groups = no filter. */
  arxivCategories: string[]
  /** Optional contact for polite-pool requests; never leaves the browser unless set. */
  politeEmail?: string
}

export interface ProjectSettings {
  bibFile?: string
  sources?: SourceId[]
  preferOfficial?: boolean
  arxivCategories?: string[]
}

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  citeKeyFormat: 'authorYearWord',
  bibInsertMode: 'append',
  defaultCiteCommand: 'citep',
  debounceMs: 250,
  defaultSources: ['dblp', 'openreview', 'arxiv'],
  preferOfficial: true,
  arxivCategories: [...ARXIV_GROUP_IDS],
}

export interface EffectiveSettings extends GlobalSettings {
  bibFile?: string
  sources: SourceId[]
}

export function resolveSettings(
  global: Partial<GlobalSettings> | undefined,
  project: ProjectSettings | undefined
): EffectiveSettings {
  const g = { ...DEFAULT_GLOBAL_SETTINGS, ...global }
  return {
    ...g,
    bibFile: project?.bibFile,
    sources: project?.sources ?? g.defaultSources,
    preferOfficial: project?.preferOfficial ?? g.preferOfficial,
    arxivCategories: project?.arxivCategories ?? g.arxivCategories,
  }
}
