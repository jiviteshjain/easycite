import { extractBibResources } from '../core/citation'

export interface ProjectEntity {
  path: string
  type: 'doc' | 'file'
}

export function getProjectId(): string {
  const meta = document.querySelector('meta[name="ol-project_id"]') as HTMLMetaElement | null
  if (meta?.content) return meta.content
  const m = window.location.pathname.match(/\/project\/([0-9a-f]{24})/)
  if (m) return m[1]!
  throw new Error('Could not determine Overleaf project id')
}

export function getCsrfToken(): string | undefined {
  const meta = document.querySelector('meta[name="ol-csrfToken"]') as HTMLMetaElement | null
  return meta?.content
}

export async function fetchEntities(projectId: string): Promise<ProjectEntity[]> {
  const res = await fetch(`/project/${projectId}/entities`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Failed to list project files (HTTP ${res.status})`)
  const data = await res.json()
  return (data.entities ?? []) as ProjectEntity[]
}

export function bibFilesFrom(entities: ProjectEntity[]): string[] {
  return entities
    .filter((e) => e.type === 'doc' && e.path.toLowerCase().endsWith('.bib'))
    .map((e) => e.path.replace(/^\//, ''))
}

/**
 * Pick the target .bib file. Priority: per-project setting -> declared in the
 * current doc (\bibliography / \addbibresource) -> the only .bib in the project
 * -> conventional names. Returns undefined if no candidate exists.
 */
export function resolveBibFile(
  bibFiles: string[],
  configured: string | undefined,
  currentDocText: string
): string | undefined {
  const lower = (s: string) => s.toLowerCase()
  if (configured) {
    const hit = bibFiles.find((f) => lower(f) === lower(configured))
    if (hit) return hit
  }
  for (const declared of extractBibResources(currentDocText)) {
    const hit = bibFiles.find((f) => lower(f) === lower(declared) || f.toLowerCase().endsWith(`/${lower(declared)}`))
    if (hit) return hit
  }
  if (bibFiles.length === 1) return bibFiles[0]
  for (const conventional of ['references.bib', 'refs.bib', 'bibliography.bib', 'main.bib']) {
    const hit = bibFiles.find((f) => lower(f) === conventional || lower(f).endsWith(`/${conventional}`))
    if (hit) return hit
  }
  return undefined
}
