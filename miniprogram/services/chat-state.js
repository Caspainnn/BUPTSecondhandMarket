function createChatState(conversationId) {
  return { conversationId, draft: '', messages: [], nextBefore: null, exhausted: false, loading: false, sending: false, requestId: '', error: '', unreadCount: 0, totalUnread: 0 }
}

function mergeMessages(first, second) {
  const seen = new Set()
  const rows = [...first, ...second].filter((message) => message && message._id && !seen.has(message._id) && seen.add(message._id))
  if (rows.every((message) => message.createdAt !== undefined)) rows.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  return rows
}

function reduceChatState(state, event) {
  switch (event.type) {
    case 'DRAFT_CHANGE': return { ...state, draft: event.value, error: '' }
    case 'LOAD_START': return { ...state, loading: true, error: '' }
    case 'MESSAGES_SUCCESS':
      if (event.conversationId !== state.conversationId) return state
      return { ...state, loading: false, messages: mergeMessages(event.messages || [], state.messages), nextBefore: event.nextBefore || null, exhausted: !event.nextBefore }
    case 'SEND_START':
      if (state.sending) return state
      return { ...state, sending: true, error: '', requestId: state.requestId || event.requestId }
    case 'SEND_SUCCESS':
      if (event.conversationId !== state.conversationId) return state
      return { ...state, sending: false, draft: '', requestId: '', error: '', messages: mergeMessages(state.messages, [event.message]) }
    case 'MARK_READ_SUCCESS':
      if (event.conversationId !== state.conversationId) return state
      return { ...state, unreadCount: 0, totalUnread: event.totalUnread || 0 }
    case 'FAILURE': return { ...state, loading: false, sending: event.operation === 'send' ? false : state.sending, error: event.message || '操作失败，请重试' }
    default: return state
  }
}

function startPolling(fetcher, intervalMs, scheduler = globalThis, onResult = () => {}) {
  let active = true
  let stopped = false
  const run = () => {
    let result
    try { result = fetcher() } catch (error) { return Promise.resolve() }
    return Promise.resolve(result).then((value) => { if (active) onResult(value) }).catch(() => {})
  }
  run()
  const timer = scheduler.setInterval(run, intervalMs)
  return () => {
    if (stopped) return
    stopped = true
    active = false
    scheduler.clearInterval(timer)
  }
}

module.exports = { createChatState, reduceChatState, startPolling }
