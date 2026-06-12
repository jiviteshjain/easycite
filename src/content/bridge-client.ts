// Isolated-world client for the MAIN-world bridge (src/page/bridge.ts).
import bridgeSrc from '../page/bridge?script&module'
import {
  REQ_EVENT,
  RES_EVENT,
  type BridgeResponse,
  type EditorState,
  type ReplaceRangeArgs,
} from '../page/protocol'

let injected = false
let nextId = 1
const pending = new Map<number, { resolve: (r: BridgeResponse) => void }>()

window.addEventListener(RES_EVENT, (event) => {
  const res = (event as CustomEvent).detail as BridgeResponse
  const entry = pending.get(res.id)
  if (entry) {
    pending.delete(res.id)
    entry.resolve(res)
  }
})

export function injectBridge(): void {
  if (injected) return
  injected = true
  const script = document.createElement('script')
  script.src = chrome.runtime.getURL(bridgeSrc)
  script.type = 'module'
  script.onload = () => script.remove()
  ;(document.head ?? document.documentElement).appendChild(script)
}

function request(detail: object, timeoutMs = 2000): Promise<BridgeResponse> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Editor bridge timed out'))
    }, timeoutMs)
    pending.set(id, {
      resolve: (res) => {
        clearTimeout(timer)
        resolve(res)
      },
    })
    window.dispatchEvent(new CustomEvent(REQ_EVENT, { detail: { id, ...detail } }))
  })
}

async function unwrap(res: BridgeResponse): Promise<EditorState | undefined> {
  if (!res.ok) throw new Error(res.error)
  return res.result
}

export async function getEditorState(): Promise<EditorState> {
  const result = await unwrap(await request({ action: 'getEditorState' }))
  if (!result) throw new Error('Bridge returned no editor state')
  return result
}

export async function replaceRange(args: ReplaceRangeArgs): Promise<void> {
  await unwrap(await request({ action: 'replaceRange', args }))
}

export async function focusEditor(): Promise<void> {
  await unwrap(await request({ action: 'focusEditor' }))
}
