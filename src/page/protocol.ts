export const REQ_EVENT = 'EASYCITE_REQ'
export const RES_EVENT = 'EASYCITE_RES'

export interface EditorState {
  doc: string
  selectionFrom: number
  selectionTo: number
  /** File name shown in the editor breadcrumbs/tab, if determinable. */
  fileName?: string
}

export interface ReplaceRangeArgs {
  from: number
  to: number
  insert: string
  cursor: number
  /** Sanity guard: doc length the change was computed against. */
  expectedDocLength: number
}

export type BridgeRequest =
  | { id: number; action: 'getEditorState' }
  | { id: number; action: 'replaceRange'; args: ReplaceRangeArgs }
  | { id: number; action: 'focusEditor' }

export type BridgeResponse =
  | { id: number; ok: true; result?: EditorState }
  | { id: number; ok: false; error: string }
