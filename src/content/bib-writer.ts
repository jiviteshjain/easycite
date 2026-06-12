import { planBibInsertion, type BibInsertion } from '../core/bibtex'
import type { BibInsertMode } from '../core/settings'
import { OverleafSocket, findDocIdByPath } from './socket'
import * as bridge from './bridge-client'

export interface BibWriteResult {
  key: string
  /** True when the entry was already present and only the key is reused. */
  existed: boolean
  /** Set when the preferred key was taken by a different paper and we renamed. */
  renamedFrom?: string
  method: 'socket' | 'dom'
}

/** Write via Overleaf's OT websocket — invisible, no tab switching. */
async function writeViaSocket(
  projectId: string,
  bibPath: string,
  entry: string,
  mode: BibInsertMode
): Promise<BibWriteResult> {
  const { socket, project } = await OverleafSocket.connect(projectId)
  try {
    const docId = findDocIdByPath(project, bibPath)
    if (!docId) throw new Error(`${bibPath} not found in project tree`)
    const { content, version } = await socket.joinDoc(docId)
    const plan = planBibInsertion(content, entry, mode)
    if (plan.kind === 'exists') {
      return { key: plan.key, existed: true, method: 'socket' }
    }
    await socket.applyInsert(docId, plan.from, plan.insert, version)
    await socket.leaveDoc(docId)
    return { key: plan.key, existed: false, renamedFrom: plan.renamedFrom, method: 'socket' }
  } finally {
    socket.close()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function fileTreeItem(fileName: string): HTMLElement | undefined {
  const base = fileName.split('/').pop()!
  const items = document.querySelectorAll<HTMLElement>(
    '[role="treeitem"], [data-testid*="file-tree"] li, .file-tree-item'
  )
  for (const item of items) {
    if (item.textContent?.trim() === base) return item
  }
  return undefined
}

async function openFileInEditor(fileName: string): Promise<void> {
  const base = fileName.split('/').pop()!
  const item = fileTreeItem(fileName)
  if (!item) throw new Error(`Could not find "${base}" in the file tree`)
  item.click()
  for (let i = 0; i < 16; i++) {
    await sleep(200)
    try {
      const state = await bridge.getEditorState()
      if (state.fileName === base || state.fileName?.endsWith(base)) return
    } catch {
      // editor mid-switch; retry
    }
  }
  throw new Error(`Timed out opening "${base}" in the editor`)
}

function looksLikeBib(content: string): boolean {
  const trimmed = content.trim()
  return trimmed === '' || trimmed.startsWith('@') || trimmed.startsWith('%')
}

/** Fallback: click the .bib file open, edit through CodeMirror, switch back. */
async function writeViaDom(
  bibPath: string,
  entry: string,
  mode: BibInsertMode,
  returnToFile: string | undefined
): Promise<BibWriteResult> {
  await openFileInEditor(bibPath)
  const state = await bridge.getEditorState()
  if (!looksLikeBib(state.doc)) {
    throw new Error(`"${bibPath}" does not look like a BibTeX file; refusing to edit`)
  }
  const plan: BibInsertion = planBibInsertion(state.doc, entry, mode)
  if (plan.kind === 'insert') {
    await bridge.replaceRange({
      from: plan.from,
      to: plan.from,
      insert: plan.insert,
      cursor: plan.from + plan.insert.length,
      expectedDocLength: state.doc.length,
    })
  }
  if (returnToFile) {
    await openFileInEditor(returnToFile).catch(() => {})
  }
  return {
    key: plan.key,
    existed: plan.kind === 'exists',
    renamedFrom: plan.kind === 'insert' ? plan.renamedFrom : undefined,
    method: 'dom',
  }
}

export async function writeBibEntry(
  projectId: string,
  bibPath: string,
  entry: string,
  mode: BibInsertMode,
  currentFileName: string | undefined
): Promise<BibWriteResult> {
  try {
    return await writeViaSocket(projectId, bibPath, entry, mode)
  } catch (err) {
    console.warn('[EasyCite] socket bib write failed, falling back to DOM:', err)
    return writeViaDom(bibPath, entry, mode, currentFileName)
  }
}
