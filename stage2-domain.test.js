const test = require('node:test')
const assert = require('node:assert/strict')
const { validatePostInput } = require('./cloudfunctions/postApi/post')
const base = { title: '自行车维修', description: '', imageFileIds: [], categoryId: 'other', price: '10', totalQuantity: 1, conditionId: 'new', campusId: 'bupt-shahe' }
const buyer = { _id: 'buyer', status: 'active', profileCompleted: true, nickname: '买家' }
const seller = { ...buyer, _id: 'seller', nickname: '卖家' }
const trades = require('./cloudfunctions/transactionApi/transaction')
const { openConversation } = require('./cloudfunctions/conversationApi/conversation')
function market(post) {
  const state = { posts: { p: { _id: 'p', ownerId: 'seller', status: 'active', imageFileIds: [], title: '维修预约', ...post } }, conversations: {}, transactions: {}, events: [], movements: [], messages: [] }
  const tx = {
    getConversation: async id => state.conversations[id], getPost: async id => state.posts[id], getTransaction: async id => state.transactions[id],
    findActive: async id => Object.values(state.transactions).find(t => t.conversationId === id && t.activeKey === 'active'),
    findRequest: async key => { const e = state.events.find(e => e.requestKey === key); return e ? state.transactions[e.transactionId] : Object.values(state.transactions).find(t => t.createRequestKey === key) },
    createTransaction: async data => { const id = 't' + Object.keys(state.transactions).length; return state.transactions[id] = { _id: id, ...data } },
    updateTransaction: async (id, patch) => state.transactions[id] = { ...state.transactions[id], ...patch },
    updatePost: async (id, patch) => state.posts[id] = { ...state.posts[id], ...patch },
    createEvent: async data => state.events.push(data), createMovement: async data => state.movements.push(data), createSystemMessage: async data => state.messages.push(data),
    updateConversation: async (id, patch) => state.conversations[id] = { ...state.conversations[id], ...patch },
  }
  let queue = Promise.resolve()
  const transactions = { runTransaction(work) { const run = queue.then(async () => { const before = structuredClone(state); try { return await work(tx) } catch (error) { Object.assign(state, before); throw error } }); queue = run.catch(() => {}); return run } }
  state.conversations.c = { _id: 'c', postId: 'p', buyerId: 'buyer', sellerId: 'seller' }
  return { state, transactions }
}
const appointment = { conversationId: 'c', quantity: 1, itemDescription: '一辆自行车', scheduledAt: 60000, campusId: 'bupt-shahe', locationText: '南门见面', requestId: 'new', now: 60000 }

test('linked seller goods reserve on submission and complete both stock and original need', async () => {
  const { state, transactions } = market({ direction: 'need', contentType: 'item', ownerId: 'buyer' })
  state.posts.goods = { _id: 'goods', ownerId: 'seller', direction: 'provide', contentType: 'item', status: 'active', title: '橡皮', imageFileIds: [], totalQuantity: 1, availableQuantity: 1, reservedQuantity: 0, soldQuantity: 0 }
  const { transaction } = await trades.createTransaction({ actor: buyer, ...appointment, linkedPostId: 'goods', transactions })
  assert.equal(transaction.postId, 'goods'); assert.equal(transaction.needPostId, 'p')
  assert.equal(state.posts.goods.availableQuantity, 0); assert.equal(state.posts.p.activeTransactionId, transaction._id)
  await trades.reviseTransaction({ actor: buyer, transactionId: transaction._id, ...appointment, requestId: 'revise', transactions })
  await trades.respondTransaction({ actor: seller, transactionId: transaction._id, decision: 'confirm', requestId: 'confirm', transactions, now: 60000 })
  assert.equal(state.posts.goods.reservedQuantity, 1)
  await trades.submitTransactionResult({ actor: buyer, transactionId: transaction._id, result: 'success', requestId: 'b', transactions, now: 60000 })
  await trades.submitTransactionResult({ actor: seller, transactionId: transaction._id, result: 'success', requestId: 's', transactions, now: 60000 })
  assert.equal(state.posts.goods.status, 'sold'); assert.equal(state.posts.goods.soldQuantity, 1)
  assert.equal(state.posts.p.status, 'completed'); assert.equal(state.posts.p.activeTransactionId, '')
})

test('linked goods rejection and withdrawal release reservation and forbid another seller goods', async () => {
  for (const action of ['reject', 'withdraw']) {
    const { state, transactions } = market({ direction: 'need', contentType: 'item', ownerId: 'buyer' })
    state.posts.goods = { _id: 'goods', ownerId: 'outsider', status: 'active', totalQuantity: 1, availableQuantity: 1, reservedQuantity: 0, soldQuantity: 0 }
    await assert.rejects(trades.createTransaction({ actor: buyer, ...appointment, linkedPostId: 'goods', transactions }), error => error.code === 'INVALID_LINKED_POST')
    state.posts.goods.ownerId = 'seller'
    const { transaction } = await trades.createTransaction({ actor: buyer, ...appointment, linkedPostId: 'goods', transactions })
    if (action === 'reject') await trades.respondTransaction({ actor: seller, transactionId: transaction._id, decision: 'reject', requestId: 'reject', transactions, now: 60000 })
    else await trades.withdrawTransaction({ actor: buyer, transactionId: transaction._id, requestId: 'withdraw', transactions, now: 60000 })
    assert.equal(state.posts.goods.availableQuantity, 1); assert.equal(state.posts.goods.reservedQuantity, 0)
    assert.equal(state.posts.p.activeTransactionId, '')
  }
})
test('stage2 accepts optional images and marks legacy goods as inventory managed', () => {
  const post = validatePostInput(base)
  assert.equal(post.direction, 'provide')
  assert.equal(post.contentType, 'item')
})
test('stage2 need conversations assign the post owner as buyer', async () => {
  const post = { _id: 'p', ownerId: 'buyer', status: 'active', direction: 'need', contentType: 'item', imageFileIds: [] }
  const conversations = { findPost: async () => post, findByKey: async () => null, create: async data => data }
  const result = await openConversation({ actor: seller, postId: 'p', requestId: 'open', conversations, now: 1 })
  assert.equal(result.conversation.buyerId, 'buyer')
  assert.equal(result.conversation.sellerId, 'seller')
})
test('stage2 continuous service completes without stock and remains open', async () => {
  const { state, transactions } = market({ direction: 'provide', contentType: 'service' })
  const { transaction } = await trades.createTransaction({ actor: buyer, ...appointment, transactions })
  await trades.respondTransaction({ actor: seller, transactionId: transaction._id, decision: 'confirm', requestId: 'confirm', transactions, now: 60000 })
  await trades.submitTransactionResult({ actor: buyer, transactionId: transaction._id, result: 'success', requestId: 'b', transactions, now: 60000 })
  await trades.submitTransactionResult({ actor: seller, transactionId: transaction._id, result: 'success', requestId: 's', transactions, now: 60000 })
  assert.equal(state.transactions[transaction._id].status, 'completed')
  assert.equal(state.posts.p.status, 'active')
  assert.equal(state.movements.length, 0)
})
test('stage2 need reservation is unique across sellers and releases only its own lock', async () => {
  const { state, transactions } = market({ direction: 'need', contentType: 'item', ownerId: 'buyer' })
  state.conversations.d = { ...state.conversations.c, _id: 'd', sellerId: 'seller2' }
  const results = await Promise.allSettled(['c', 'd'].map(conversationId => trades.createTransaction({ actor: buyer, ...appointment, conversationId, requestId: conversationId, transactions })))
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  const first = results.find(r => r.status === 'fulfilled').value.transaction
  await trades.withdrawTransaction({ actor: buyer, transactionId: first._id, requestId: 'withdraw', transactions, now: 60000 })
  const second = await trades.createTransaction({ actor: buyer, ...appointment, conversationId: 'd', requestId: 'retry-d', transactions })
  await trades.withdrawTransaction({ actor: buyer, transactionId: first._id, requestId: 'withdraw', transactions, now: 60000 })
  assert.equal(state.posts.p.activeTransactionId, second.transaction._id)
})
test('stage2 services and needs do not require goods condition or stock', () => {
  const service = validatePostInput({ ...base, contentType: 'service', conditionId: '', totalQuantity: undefined, campusId: '' })
  assert.equal(service.contentType, 'service')
  assert.equal(service.campusId, '')
  const need = validatePostInput({ ...base, direction: 'need', price: '', conditionId: '', totalQuantity: undefined })
  assert.equal(need.unitPriceCents, null)
})
test('stage2 service publishes without a goods category and normalizes its type category', () => {
  const post = validatePostInput({ ...base, contentType: 'service', categoryId: '', conditionId: '', totalQuantity: undefined })
  assert.equal(post.categoryId, 'service')
})
test('stage2 card message checks ownership and increments recipient unread only once', async () => {
  const { sendPostCard } = require('./cloudfunctions/messageApi/message')
  const rows = []; let conversation = { _id: 'c', buyerId: 'buyer', sellerId: 'seller', buyerUnread: 0, sellerUnread: 0 }
  const tx = { getConversation: async () => conversation, getPost: async id => ({ _id: id, ownerId: id === 'own' ? 'buyer' : 'seller', title: '我的需求', status: 'active', imageFileIds: [], direction: 'need', contentType: 'item', unitPriceCents: null }), findByRequest: async (id, sender, req) => rows.find(row => row.requestId === req), createMessage: async data => { const row = { _id: 'm', ...data }; rows.push(row); return row }, updateConversation: async (id, patch) => conversation = { ...conversation, ...patch } }
  const messages = { runTransaction: async fn => fn(tx) }
  const input = { actor: buyer, conversationId: 'c', postId: 'own', requestId: 'card', messages, now: 1 }
  await sendPostCard(input); await sendPostCard(input)
  assert.equal(rows.length, 1); assert.equal(rows[0].type, 'post_card'); assert.equal(rows[0].postCard.coverFileId, '')
  assert.equal(conversation.sellerUnread, 1)
  await assert.rejects(sendPostCard({ ...input, postId: 'other', requestId: 'bad' }), e => e.code === 'FORBIDDEN')
})
test('stage2 completed need cannot be reopened through an offline transition', async () => {
  const { setPostStatus } = require('./cloudfunctions/postApi/post-service')
  let post = { _id: 'p', ownerId: 'buyer', direction: 'need', contentType: 'item', status: 'completed' }
  const posts = { findById: async () => post, update: async (id, patch) => post = { ...post, ...patch } }
  await assert.rejects(setPostStatus({ actor: buyer, postId: 'p', status: 'offline', posts, now: 1 }), e => e.code === 'NEED_COMPLETED')
  assert.equal(post.status, 'completed')
})
test('stage2 service closing blocks new orders but preserves pending order processing', async () => {
  const { state, transactions } = market({ contentType: 'service', direction: 'provide' })
  const { transaction } = await trades.createTransaction({ actor: buyer, ...appointment, transactions })
  state.posts.p.status = 'offline'
  await trades.reviseTransaction({ actor: buyer, transactionId: transaction._id, ...appointment, requestId: 'revise', transactions })
  await trades.respondTransaction({ actor: seller, transactionId: transaction._id, decision: 'confirm', requestId: 'confirm', transactions, now: 60000 })
  assert.equal(state.transactions[transaction._id].status, 'awaiting_handover')
  state.conversations.d = { ...state.conversations.c, _id: 'd' }
  await assert.rejects(trades.createTransaction({ actor: buyer, ...appointment, conversationId: 'd', requestId: 'new2', transactions }), e => e.code === 'POST_UNAVAILABLE')
})
test('stage2 demand succeeds and closes only after both handover results', async () => {
  const { state, transactions } = market({ direction: 'need', contentType: 'item', ownerId: 'buyer' })
  const { transaction } = await trades.createTransaction({ actor: buyer, ...appointment, transactions })
  await trades.respondTransaction({ actor: seller, transactionId: transaction._id, decision: 'confirm', requestId: 'confirm', transactions, now: 60000 })
  await trades.submitTransactionResult({ actor: buyer, transactionId: transaction._id, result: 'success', requestId: 'b', transactions, now: 60000 })
  assert.equal(state.posts.p.status, 'active')
  await trades.submitTransactionResult({ actor: seller, transactionId: transaction._id, result: 'success', requestId: 's', transactions, now: 60000 })
  assert.equal(state.posts.p.status, 'completed'); assert.equal(state.posts.p.activeTransactionId, '')
  assert.equal(state.movements.length, 0)
})
test('stage2 online service requires delivery instructions and stores online mode', async () => {
  const { transactions } = market({ direction: 'provide', contentType: 'service' })
  await assert.rejects(trades.createTransaction({ actor: buyer, ...appointment, campusId: '', fulfillmentMode: 'online', locationText: '', transactions }), e => e.code === 'INVALID_LOCATION')
  const result = await trades.createTransaction({ actor: buyer, ...appointment, campusId: '', fulfillmentMode: 'online', locationText: '在站内沟通交付', transactions })
  assert.equal(result.transaction.fulfillmentMode, 'online'); assert.equal(result.transaction.campusId, '')
})
