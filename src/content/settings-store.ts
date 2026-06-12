import {
  DEFAULT_GLOBAL_SETTINGS,
  resolveSettings,
  type EffectiveSettings,
  type GlobalSettings,
  type ProjectSettings,
} from '../core/settings'

const GLOBAL_KEY = 'globalSettings'
const projectKey = (projectId: string) => `project:${projectId}`

export async function loadGlobalSettings(): Promise<GlobalSettings> {
  const data = await chrome.storage.sync.get(GLOBAL_KEY)
  return { ...DEFAULT_GLOBAL_SETTINGS, ...(data[GLOBAL_KEY] as Partial<GlobalSettings> | undefined) }
}

export async function saveGlobalSettings(settings: GlobalSettings): Promise<void> {
  await chrome.storage.sync.set({ [GLOBAL_KEY]: settings })
}

export async function loadProjectSettings(projectId: string): Promise<ProjectSettings> {
  const key = projectKey(projectId)
  const data = await chrome.storage.sync.get(key)
  return (data[key] as ProjectSettings | undefined) ?? {}
}

export async function saveProjectSettings(
  projectId: string,
  settings: ProjectSettings
): Promise<void> {
  await chrome.storage.sync.set({ [projectKey(projectId)]: settings })
}

/** Remove all per-project settings (bib file, source toggles); returns count. */
export async function clearAllProjectSettings(): Promise<number> {
  const all = await chrome.storage.sync.get(null)
  const keys = Object.keys(all).filter((k) => k.startsWith('project:'))
  if (keys.length > 0) await chrome.storage.sync.remove(keys)
  return keys.length
}

export async function loadEffectiveSettings(projectId: string): Promise<EffectiveSettings> {
  const [global, project] = await Promise.all([
    loadGlobalSettings(),
    loadProjectSettings(projectId),
  ])
  return resolveSettings(global, project)
}
