const test = require('node:test')
const assert = require('node:assert/strict')

const { listMessages, markConversationRead, sendMessage } = require('./message')

const buyer = { _id: 'buyer', status: 'active', profileCompleted: true }
const seller = { _id: 'seller', status: 'active', profileCompleted: true }

function repository() {
  const state = {
    conversations: [{ _id: 'c1', buyerId: 'buyer', sellerId: 'seller', buyerUnread: 0, sellerUnread: 0 }],
    messages: [],
    updates: 0,
  }
  const txApi = {
    async getConversation(id) { return state.conversations.find((item) => item._id === id) || null },
    async findByRequest(conversationId, senderId, requestId) { return state.messages.find((item) => item.conversationId === conversationId && item.senderId === senderId && item.requestId === requestId) || null },
    async createMessage(data) { const row = { _id: `m${state.messages.length + 1}`, ...data }; state.messages.push(row); return row },
    async updateConversation(id, patch) { state.updates += 1; const row = state.conversations.find((item) => item._id === id); Object.assign(row, patch); return { ...row } },
  }
  return {
    state,
    async runTransaction(work) { return work(txApi) },
    async getConversation(id) { return txApi.getConversation(id) },
    async listMessages({ conversationId, before, limit }) {
      const rows = state.messages.filter((item) => item.conversationId === conversationId && (!before || item.createdAt < before.createdAt)).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
      const last = rows[rows.length - 1]
      return { rows, nextBefore: rows.length === limit && last ? { createdAt: last.createdAt, id: last._id } : null }
    },
    async getTotalUnread(userId) { return state.conversations.reduce((sum, item) => sum + (item.buyerId === userId ? item.buyerUnread : item.sellerId === userId ? item.sellerUnread : 0), 0) },
  }
}

test('trims text, preserves plain URLs, updates summary, and increments only recipient unread', async () => {
  const messages = repository()
  const { message, conversation } = await sendMessage({ actor: buyer, conversationId: 'c1', text: '  看这里 https://example.com/a?b=1  ', requestId: 'r1', messages, now: 100 })
  assert.equal(message.text, '看这里 https://example.com/a?b=1')
  assert.equal(message.type, 'text')
  assert.equal(conversation.buyerUnread, 0)
  assert.equal(conversation.sellerUnread, 1)
  assert.equal(conversation.lastMessageText, message.text)
  assert.equal(messages.state.updates, 1)
})

test('rejects blank and over-500-character text', async () => {
  for (const text of ['', '   ', 'a'.repeat(501)]) {
    await assert.rejects(sendMessage({ actor: buyer, conversationId: 'c1', text, requestId: 'r', messages: repository(), now: 1 }), (error) => error.code === 'INVALID_TEXT')
  }
})

test('requires a complete participant profile for send, list, and read', async () => {
  const messages = repository()
  await assert.rejects(sendMessage({ actor: { ...buyer, _id: 'other' }, conversationId: 'c1', text: 'hello', requestId: 'r', messages, now: 1 }), (error) => error.code === 'FORBIDDEN')
  await assert.rejects(listMessages({ actor: { ...buyer, profileCompleted: false }, conversationId: 'c1', messages }), (error) => error.code === 'PROFILE_REQUIRED')
  await assert.rejects(markConversationRead({ actor: { ...buyer, _id: 'other' }, conversationId: 'c1', messages, now: 1 }), (error) => error.code === 'FORBIDDEN')
})

test('reconstructs chronological pages while using an older-than cursor', async () => {
  const messages = repository()
  messages.state.messages.push(
    { _id: 'm1', conversationId: 'c1', type: 'text', text: 'old', createdAt: 1 },
    { _id: 'm2', conversationId: 'c1', type: 'system', text: 'reserved', createdAt: 2 },
    { _id: 'm3', conversationId: 'c1', type: 'text', text: 'new', createdAt: 3 },
  )
  const page = await listMessages({ actor: buyer, conversationId: 'c1', limit: 2, messages })
  assert.deepEqual(page.messages.map((item) => item._id), ['m2', 'm3'])
  assert.deepEqual(page.nextBefore, { createdAt: 2, id: 'm2' })
})

test('reuses an idempotent send without another message, unread increment, or summary update', async () => {
  const messages = repository()
  const first = await sendMessage({ actor: buyer, conversationId: 'c1', text: 'hello', requestId: 'same', messages, now: 1 })
  const second = await sendMessage({ actor: buyer, conversationId: 'c1', text: 'changed', requestId: 'same', messages, now: 2 })
  assert.equal(second.message._id, first.message._id)
  assert.equal(messages.state.messages.length, 1)
  assert.equal(messages.state.conversations[0].sellerUnread, 1)
  assert.equal(messages.state.updates, 1)
})

test('message API always creates user text and cannot forge a system message', async () => {
  const messages = repository()
  const result = await sendMessage({ actor: buyer, conversationId: 'c1', text: 'system', type: 'system', requestId: 'r', messages, now: 1 })
  assert.equal(result.message.type, 'text')
})

test('mark read clears only the actor counter and returns global unread', async () => {
  const messages = repository()
  messages.state.conversations[0].buyerUnread = 4
  messages.state.conversations[0].sellerUnread = 7
  messages.state.conversations.push({ _id: 'c2', buyerId: 'buyer', sellerId: 'other', buyerUnread: 3, sellerUnread: 0 })
  const result = await markConversationRead({ actor: buyer, conversationId: 'c1', messages, now: 9 })
  assert.equal(result.unreadCount, 0)
  assert.equal(result.totalUnread, 3)
  assert.equal(messages.state.conversations[0].sellerUnread, 7)
})

test('sender-side sends do not erase the sender existing unread messages', async () => {
  const messages = repository()
  messages.state.conversations[0].buyerUnread = 2
  const { conversation } = await sendMessage({ actor: buyer, conversationId: 'c1', text: 'reply', requestId: 'r', messages, now: 1 })
  assert.equal(conversation.buyerUnread, 2)
  assert.equal(conversation.sellerUnread, 1)
})

test('transaction messages include fresh authorized state rather than old snapshot actions',async()=>{
 const messages=repository()
 messages.state.messages.push({_id:'m1',conversationId:'c1',transactionId:'t1',type:'system',createdAt:1,transactionCard:{status:'pending_seller'}})
 messages.getTransactions=async()=>[{_id:'t1',conversationId:'c1',buyerId:'buyer',sellerId:'seller',status:'cancelled'}]
 const result=await listMessages({actor:buyer,conversationId:'c1',messages})
 assert.equal(result.messages[0].currentTransaction.status,'cancelled')
 messages.getTransactions=async()=>[{_id:'t1',conversationId:'other',buyerId:'other',status:'pending_seller'}]
 assert.equal((await listMessages({actor:buyer,conversationId:'c1',messages})).messages[0].currentTransaction,null)
})
