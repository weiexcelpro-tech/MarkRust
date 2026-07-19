const listeners = new Map()

export async function listen(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event).add(handler)
  return () => { listeners.get(event)?.delete(handler) }
}

export async function once(event, handler) {
  const unlisten = await listen(event, (e) => { handler(e); unlisten() })
  return unlisten
}

export async function emit(event, payload) {
  listeners.get(event)?.forEach((cb) => cb({ event, payload, id: 0, windowLabel: 'main' }))
}

window.__E2E_EMIT__ = emit
