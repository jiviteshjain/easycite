// Runs in the page's MAIN world. The only context with access to Overleaf's
// CodeMirror 6 instance; serves editor reads/writes to the content script.
import {
  REQ_EVENT,
  RES_EVENT,
  type BridgeRequest,
  type BridgeResponse,
  type EditorState,
  type ReplaceRangeArgs,
} from './protocol'

interface CM6Module {
  EditorView: {
    findFromDOM(el: HTMLElement): CM6View | null
  }
}

interface CM6View {
  state: {
    doc: { toString(): string; length: number }
    selection: { main: { from: number; to: number } }
  }
  dispatch(spec: object): void
  focus(): void
}

let cmModule: CM6Module | null = null

window.addEventListener('UNSTABLE_editor:extensions', (event) => {
  const detail = (event as CustomEvent).detail
  if (detail?.CodeMirror) cmModule = detail.CodeMirror
})
// If we loaded after the editor, ask Overleaf to re-fire the event above.
window.dispatchEvent(new CustomEvent('editor:extension-loaded'))

function findView(): CM6View | null {
  const candidates: Element[] = []
  const focused = document.activeElement?.closest('.cm-editor')
  if (focused) candidates.push(focused)
  candidates.push(...document.querySelectorAll('.cm-editor.cm-focused'))
  candidates.push(...document.querySelectorAll('.cm-editor'))
  for (const el of candidates) {
    if (cmModule) {
      const view = cmModule.EditorView.findFromDOM(el as HTMLElement)
      if (view) return view
    }
    const cmView = (el as HTMLElement & { cmView?: { rootView?: { view?: CM6View }; view?: CM6View } }).cmView
    const view = cmView?.rootView?.view ?? cmView?.view
    if (view) return view
  }
  return null
}

function activeFileName(): string | undefined {
  const selectors = [
    '.ol-cm-breadcrumbs > *:last-child',
    '[data-testid="file-tree"] [aria-selected="true"]',
    '.file-tree [aria-selected="true"]',
  ]
  for (const sel of selectors) {
    const text = document.querySelector(sel)?.textContent?.trim()
    if (text) return text
  }
  return undefined
}

function getEditorState(): EditorState {
  const view = findView()
  if (!view) throw new Error('No CodeMirror editor found on the page')
  const { from, to } = view.state.selection.main
  return {
    doc: view.state.doc.toString(),
    selectionFrom: from,
    selectionTo: to,
    fileName: activeFileName(),
  }
}

function replaceRange(args: ReplaceRangeArgs): void {
  const view = findView()
  if (!view) throw new Error('No CodeMirror editor found on the page')
  if (view.state.doc.length !== args.expectedDocLength) {
    throw new Error('Document changed since the edit was computed; aborting')
  }
  view.dispatch({
    changes: { from: args.from, to: args.to, insert: args.insert },
    selection: { anchor: args.cursor },
    scrollIntoView: true,
  })
  view.focus()
}

window.addEventListener(REQ_EVENT, (event) => {
  const req = (event as CustomEvent).detail as BridgeRequest
  let res: BridgeResponse
  try {
    if (req.action === 'getEditorState') {
      res = { id: req.id, ok: true, result: getEditorState() }
    } else if (req.action === 'replaceRange') {
      replaceRange(req.args)
      res = { id: req.id, ok: true }
    } else if (req.action === 'focusEditor') {
      findView()?.focus()
      res = { id: req.id, ok: true }
    } else {
      throw new Error(`Unknown action: ${(req as { action: string }).action}`)
    }
  } catch (err) {
    res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  window.dispatchEvent(new CustomEvent(RES_EVENT, { detail: res }))
})
