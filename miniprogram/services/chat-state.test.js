const test = require('node:test')
const assert = require('node:assert/strict')

const { createChatState, reduceChatState, startPolling } = require('./chat-state')

test('prevents duplicate optimistic sends and reuses request id after failure', () => {
  let state = reduceChatState(createChatState('c1'), { type: 'DRAFT_CHANGE', value: '你好' })
  state = reduceChatState(state, { type: 'SEND_START', requestId: 'r1' })
  const duplicate = reduceChatState(state, { type: 'SEND_START', requestId: 'r2' })
  assert.equal(duplicate.requestId, 'r1')
  state = reduceChatState(state, { type: 'FAILURE', operation: 'send', message: '失败' })
  assert.equal(state.draft, '你好')
  assert.equal(state.requestId, 'r1')
  state = reduceChatState(state, { type: 'SEND_START', requestId: 'r2' })
  assert.equal(state.requestId, 'r1')
})

test('successful send de-duplicates messages and clears draft/request id', () => {
  let state = { ...createChatState('c1'), draft: 'hello', sending: true, requestId: 'r1', messages: [{ _id: 'm1' }] }
  state = reduceChatState(state, { type: 'SEND_SUCCESS', conversationId: 'c1', message: { _id: 'm1' } })
  assert.equal(state.messages.length, 1)
  assert.equal(state.draft, '')
  assert.equal(state.requestId, '')
  assert.equal(state.sending, false)
})

test('merges fetched pages without duplicates and ignores another conversation', () => {
  let state = { ...createChatState('c1'), messages: [{ _id: 'm2' }] }
  state = reduceChatState(state, { type: 'MESSAGES_SUCCESS', conversationId: 'c1', messages: [{ _id: 'm1' }, { _id: 'm2' }], nextBefore: null })
  assert.deepEqual(state.messages.map((item) => item._id), ['m1', 'm2'])
  const unchanged = reduceChatState(state, { type: 'MESSAGES_SUCCESS', conversationId: 'c2', messages: [{ _id: 'wrong' }] })
  assert.deepEqual(unchanged.messages.map((item) => item._id), ['m1', 'm2'])
})

test('mark read clears conversation and total unread values', () => {
  const state = reduceChatState({ ...createChatState('c1'), unreadCount: 4, totalUnread: 9 }, { type: 'MARK_READ_SUCCESS', conversationId: 'c1', totalUnread: 5 })
  assert.equal(state.unreadCount, 0)
  assert.equal(state.totalUnread, 5)
})

test('poller runs immediately and stops its timer exactly once', async () => {
  let calls = 0
  let scheduled
  let cleared = 0
  const scheduler = {
    setInterval(callback, interval) { scheduled = { callback, interval }; return 7 },
    clearInterval(id) { assert.equal(id, 7); cleared += 1 },
  }
  const stop = startPolling(async () => { calls += 1 }, 3000, scheduler)
  await Promise.resolve()
  assert.equal(calls, 1)
  assert.equal(scheduled.interval, 3000)
  scheduled.callback()
  assert.equal(calls, 2)
  stop(); stop()
  assert.equal(cleared, 1)
})

test('a stopped poller suppresses an in-flight result callback', async () => {
  let finish
  const pending = new Promise((resolve) => { finish = resolve })
  const received = []
  const scheduler = { setInterval() { return 1 }, clearInterval() {} }
  const stop = startPolling(() => pending, 3000, scheduler, (value) => received.push(value))
  stop()
  finish('late')
  await pending
  await Promise.resolve()
  assert.deepEqual(received, [])
})

test('send failure does not mutate already received messages', () => {
  const initial = { ...createChatState('c1'), draft: 'x', sending: true, requestId: 'r', messages: [{ _id: 'm1' }] }
  const state = reduceChatState(initial, { type: 'FAILURE', operation: 'send', message: 'network' })
  assert.deepEqual(state.messages, initial.messages)
})
