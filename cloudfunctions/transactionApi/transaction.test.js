const test = require('node:test')
const assert = require('node:assert/strict')

const { cancelTransaction, createTransaction, getTransactionDetail, listTransactions, respondTransaction, submitTransactionResult, withdrawTransaction } = require('./transaction')

const NOW = Date.parse('2026-10-01T00:00:00Z')
const buyer = { _id: 'buyer', status: 'active', profileCompleted: true }
const buyer2 = { _id: 'buyer2', status: 'active', profileCompleted: true }
const seller = { _id: 'seller', status: 'active', profileCompleted: true }
const post = { _id: 'post', ownerId: 'seller', title: '教材', imageFileIds: ['cloud://cover.jpg'], unitPriceCents: 1000, campusId: 'bupt-shahe', status: 'active', totalQuantity: 3, availableQuantity: 3, reservedQuantity: 0, soldQuantity: 0 }
const conversations = [
  { _id: 'c1', postId: 'post', buyerId: 'buyer', sellerId: 'seller', buyerUnread: 0, sellerUnread: 0 },
  { _id: 'c2', postId: 'post', buyerId: 'buyer2', sellerId: 'seller', buyerUnread: 0, sellerUnread: 0 },
]

function repository(seed = {}) {
  const state = {
    posts: [structuredClone(post)], conversations: structuredClone(conversations), transactions: [], events: [], movements: [], messages: [],
    ...structuredClone(seed),
  }
  const tx = {
    async getConversation(id) { return state.conversations.find((x) => x._id === id) || null },
    async getPost(id) { return state.posts.find((x) => x._id === id) || null },
    async getTransaction(id) { return state.transactions.find((x) => x._id === id) || null },
    async findActive(conversationId) { return state.transactions.find((x) => x.conversationId === conversationId && ['pending_seller', 'awaiting_handover'].includes(x.status)) || null },
    async findRequest(key) { const event = state.events.find((x) => x.requestKey === key); if (event) return this.getTransaction(event.transactionId); return state.transactions.find((x) => x.createRequestKey === key) || null },
    async createTransaction(data) { const row = { _id: `t${state.transactions.length + 1}`, ...data }; state.transactions.push(row); return row },
    async updateTransaction(id, patch) { const row = await this.getTransaction(id); Object.assign(row, patch); return row },
    async updatePost(id, patch) { const row = await this.getPost(id); Object.assign(row, patch); return row },
    async createEvent(data) { state.events.push({ _id: `e${state.events.length + 1}`, ...data }) },
    async createMovement(data) { state.movements.push({ _id: `i${state.movements.length + 1}`, ...data }) },
    async createSystemMessage(data) { state.messages.push({ _id: `m${state.messages.length + 1}`, ...data }) },
    async updateConversation(id, patch) { Object.assign(await this.getConversation(id), patch) },
  }
  let queue = Promise.resolve()
  return {
    state,
    runTransaction(work) {
      const execution = queue.then(async () => {
        const before = structuredClone(state)
        try { return await work(tx) } catch (error) { Object.keys(state).forEach((key) => { state[key] = before[key] }); throw error }
      })
      queue = execution.catch(() => {})
      return execution
    },
    async list({ userId, role, status, limit }) { const rows = state.transactions.filter((x) => (!role || x[`${role}Id`] === userId) && (!status || x.status === status) && (x.buyerId === userId || x.sellerId === userId)); return { rows: rows.slice(0, limit), nextCursor: null } },
    async pendingCounts(userId) { return { buyer: state.transactions.filter((x) => x.buyerId === userId && ['pending_seller', 'awaiting_handover'].includes(x.status)).length, seller: state.transactions.filter((x) => x.sellerId === userId && ['pending_seller', 'awaiting_handover'].includes(x.status)).length } },
    async getTransaction(id) { return tx.getTransaction(id) },
    async getEvents(id) { return state.events.filter((x) => x.transactionId === id) },
  }
}

const validInput = (conversationId = 'c1') => ({ conversationId, quantity: 2, scheduledAt: NOW + 10 * 60 * 1000, campusId: 'bupt-shahe', locationText: '教学楼门口', requestId: 'create-1' })

test('only the buyer can create from their conversation with an authoritative post snapshot', async () => {
  const transactions = repository()
  const { transaction } = await createTransaction({ actor: buyer, ...validInput(), transactions, now: NOW })
  assert.equal(transaction.status, 'pending_seller')
  assert.equal(transaction.buyerId, 'buyer')
  assert.equal(transaction.sellerId, 'seller')
  assert.deepEqual(transaction.postSnapshot, { postId: 'post', title: '教材', coverFileId: 'cloud://cover.jpg', unitPriceCents: 1000 })
  await assert.rejects(createTransaction({ actor: seller, ...validInput(), requestId: 'seller-create', transactions, now: NOW }), (error) => error.code === 'BUYER_ONLY')
})

test('accepts exact appointment boundaries and rejects outside them', async () => {
  await createTransaction({ actor: buyer, ...validInput(), scheduledAt: NOW + 10 * 60 * 1000, transactions: repository(), now: NOW })
  await createTransaction({ actor: buyer, ...validInput(), scheduledAt: NOW + 14 * 24 * 60 * 60 * 1000, transactions: repository(), now: NOW })
  for (const scheduledAt of [NOW + 10 * 60 * 1000 - 1, NOW + 14 * 24 * 60 * 60 * 1000 + 1]) {
    await assert.rejects(createTransaction({ actor: buyer, ...validInput(), scheduledAt, transactions: repository(), now: NOW }), (error) => error.code === 'INVALID_SCHEDULE')
  }
})

test('validates quantity, campus, location, availability, and one active transaction per conversation', async () => {
  for (const patch of [{ quantity: 0 }, { quantity: 4 }, { campusId: 'unknown' }, { locationText: 'a' }]) {
    await assert.rejects(createTransaction({ actor: buyer, ...validInput(), ...patch, transactions: repository(), now: NOW }))
  }
  const transactions = repository()
  await createTransaction({ actor: buyer, ...validInput(), transactions, now: NOW })
  await assert.rejects(createTransaction({ actor: buyer, ...validInput(), requestId: 'other', transactions, now: NOW }), (error) => error.code === 'ACTIVE_TRANSACTION_EXISTS')
})

test('create and seller response retries are deterministic without duplicate records', async () => {
  const transactions = repository()
  const first = await createTransaction({ actor: buyer, ...validInput(), transactions, now: NOW })
  const repeated = await createTransaction({ actor: buyer, ...validInput(), transactions, now: NOW + 1 })
  assert.equal(repeated.transaction._id, first.transaction._id)
  await respondTransaction({ actor: seller, transactionId: first.transaction._id, decision: 'confirm', requestId: 'confirm-1', transactions, now: NOW + 2 })
  await respondTransaction({ actor: seller, transactionId: first.transaction._id, decision: 'confirm', requestId: 'confirm-1', transactions, now: NOW + 3 })
  assert.deepEqual([transactions.state.events.length, transactions.state.movements.length, transactions.state.messages.length], [2, 1, 2])
})

test('concurrent seller confirmations atomically reserve inventory and cannot oversell', async () => {
  const seed = { transactions: [
    { _id: 't1', conversationId: 'c1', postId: 'post', buyerId: 'buyer', sellerId: 'seller', quantity: 2, status: 'pending_seller' },
    { _id: 't2', conversationId: 'c2', postId: 'post', buyerId: 'buyer2', sellerId: 'seller', quantity: 2, status: 'pending_seller' },
  ] }
  const transactions = repository(seed)
  const results = await Promise.allSettled([
    respondTransaction({ actor: seller, transactionId: 't1', decision: 'confirm', requestId: 'r1', transactions, now: NOW }),
    respondTransaction({ actor: seller, transactionId: 't2', decision: 'confirm', requestId: 'r2', transactions, now: NOW }),
  ])
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected'])
  assert.equal(results[1].reason.code, 'INSUFFICIENT_STOCK')
  assert.deepEqual({ available: transactions.state.posts[0].availableQuantity, reserved: transactions.state.posts[0].reservedQuantity, total: transactions.state.posts[0].totalQuantity }, { available: 1, reserved: 2, total: 3 })
  assert.equal(transactions.state.transactions.find((x) => x._id === 't2').status, 'pending_seller')
})

test('only seller responds; reject and buyer withdrawal terminate without inventory movement', async () => {
  const transactions = repository()
  const created = await createTransaction({ actor: buyer, ...validInput(), transactions, now: NOW })
  await assert.rejects(respondTransaction({ actor: buyer, transactionId: created.transaction._id, decision: 'confirm', requestId: 'x', transactions, now: NOW }), (error) => error.code === 'SELLER_ONLY')
  await respondTransaction({ actor: seller, transactionId: created.transaction._id, decision: 'reject', reason: '时间不合适', requestId: 'reject', transactions, now: NOW })
  assert.equal(transactions.state.transactions[0].status, 'cancelled')
  assert.equal(transactions.state.movements.length, 0)

  const another = repository()
  const pending = await createTransaction({ actor: buyer, ...validInput(), transactions: another, now: NOW })
  await withdrawTransaction({ actor: buyer, transactionId: pending.transaction._id, reason: '不需要了', requestId: 'withdraw', transactions: another, now: NOW })
  assert.equal(pending.transaction.status, 'cancelled')
})

test('participant-only list and detail include pending counts and audit events', async () => {
  const transactions = repository()
  const created = await createTransaction({ actor: buyer, ...validInput(), transactions, now: NOW })
  const list = await listTransactions({ actor: buyer, role: 'buyer', limit: 20, transactions })
  assert.equal(list.transactions.length, 1)
  assert.equal(list.pendingCounts.buyer, 1)
  const detail = await getTransactionDetail({ actor: buyer, transactionId: created.transaction._id, transactions })
  assert.equal(detail.events[0].type, 'created')
  await assert.rejects(getTransactionDetail({ actor: { ...buyer, _id: 'other' }, transactionId: created.transaction._id, transactions }), (error) => error.code === 'FORBIDDEN')
})

function awaitingSeed(overrides = {}) {
  return {
    posts: [{ ...structuredClone(post), availableQuantity: 1, reservedQuantity: 2 }],
    transactions: [{ _id: 't1', conversationId: 'c1', postId: 'post', buyerId: 'buyer', sellerId: 'seller', quantity: 2, scheduledAt: NOW + 60 * 60 * 1000, status: 'awaiting_handover', activeKey: 'active', buyerResult: '', sellerResult: '', ...overrides }],
  }
}

test('either participant can cancel before appointment and inventory is released exactly once', async () => {
  for (const actor of [buyer, seller]) {
    const transactions = repository(awaitingSeed())
    await cancelTransaction({ actor, transactionId: 't1', reason: '临时无法交接', requestId: `cancel-${actor._id}`, transactions, now: NOW })
    await cancelTransaction({ actor, transactionId: 't1', reason: '临时无法交接', requestId: `cancel-${actor._id}`, transactions, now: NOW })
    assert.equal(transactions.state.transactions[0].status, 'cancelled')
    assert.equal(transactions.state.transactions[0].activeKey, 'terminal:t1')
    assert.deepEqual([transactions.state.posts[0].availableQuantity, transactions.state.posts[0].reservedQuantity], [3, 0])
    assert.deepEqual([transactions.state.events.length, transactions.state.movements.length, transactions.state.messages.length], [1, 1, 1])
  }
})

test('terminal active keys remain unique so the same conversation can start a later transaction', async () => {
  const transactions = repository(awaitingSeed())
  await cancelTransaction({ actor: buyer, transactionId: 't1', reason: '本次先取消', requestId: 'cancel-old', transactions, now: NOW })
  const later = await createTransaction({ actor: buyer, ...validInput(), quantity: 1, requestId: 'create-later', transactions, now: NOW })
  assert.equal(later.transaction.activeKey, 'active')
  assert.equal(transactions.state.transactions[0].activeKey, 'terminal:t1')
})

test('cancellation is rejected at appointment and results are rejected before appointment', async () => {
  const atTime = repository(awaitingSeed({ scheduledAt: NOW }))
  await assert.rejects(cancelTransaction({ actor: buyer, transactionId: 't1', reason: '来不及了', requestId: 'c', transactions: atTime, now: NOW }), (error) => error.code === 'CANCEL_WINDOW_CLOSED')
  const beforeTime = repository(awaitingSeed())
  await assert.rejects(submitTransactionResult({ actor: buyer, transactionId: 't1', result: 'success', requestId: 's', transactions: beforeTime, now: NOW }), (error) => error.code === 'RESULT_NOT_OPEN')
})

test('first success waits; both successes complete and move reserved stock to sold', async () => {
  const transactions = repository(awaitingSeed({ scheduledAt: NOW }))
  await submitTransactionResult({ actor: buyer, transactionId: 't1', result: 'success', requestId: 'buyer-success', transactions, now: NOW })
  assert.equal(transactions.state.transactions[0].status, 'awaiting_handover')
  assert.equal(transactions.state.movements.length, 0)
  await submitTransactionResult({ actor: seller, transactionId: 't1', result: 'success', requestId: 'seller-success', transactions, now: NOW + 1 })
  assert.equal(transactions.state.transactions[0].status, 'completed')
  assert.equal(transactions.state.transactions[0].activeKey, 'terminal:t1')
  assert.deepEqual([transactions.state.posts[0].reservedQuantity, transactions.state.posts[0].soldQuantity], [0, 2])
  assert.equal(transactions.state.movements[0].type, 'sell')
})

test('first failure immediately releases stock and a second failure changes no inventory', async () => {
  const transactions = repository(awaitingSeed({ scheduledAt: NOW }))
  await submitTransactionResult({ actor: buyer, transactionId: 't1', result: 'failure', requestId: 'buyer-fail', transactions, now: NOW })
  assert.equal(transactions.state.transactions[0].status, 'failed')
  assert.deepEqual([transactions.state.posts[0].availableQuantity, transactions.state.posts[0].reservedQuantity], [3, 0])
  await submitTransactionResult({ actor: seller, transactionId: 't1', result: 'failure', requestId: 'seller-fail', transactions, now: NOW + 1 })
  assert.equal(transactions.state.transactions[0].status, 'failed')
  assert.equal(transactions.state.movements.length, 1)
})

test('opposing success after released failure becomes abnormal without re-reserving', async () => {
  const transactions = repository(awaitingSeed({ scheduledAt: NOW }))
  await submitTransactionResult({ actor: buyer, transactionId: 't1', result: 'failure', requestId: 'buyer-fail', transactions, now: NOW })
  const afterRelease = structuredClone(transactions.state.posts[0])
  await submitTransactionResult({ actor: seller, transactionId: 't1', result: 'success', requestId: 'seller-success', transactions, now: NOW + 1 })
  assert.equal(transactions.state.transactions[0].status, 'abnormal')
  assert.deepEqual(transactions.state.posts[0], afterRelease)
  assert.equal(transactions.state.movements.length, 1)
})

test('submitted results are immutable and result retries append nothing', async () => {
  const transactions = repository(awaitingSeed({ scheduledAt: NOW }))
  await submitTransactionResult({ actor: buyer, transactionId: 't1', result: 'success', requestId: 'same', transactions, now: NOW })
  await submitTransactionResult({ actor: buyer, transactionId: 't1', result: 'success', requestId: 'same', transactions, now: NOW + 1 })
  assert.equal(transactions.state.events.length, 1)
  await assert.rejects(submitTransactionResult({ actor: buyer, transactionId: 't1', result: 'failure', requestId: 'different', transactions, now: NOW + 2 }), (error) => error.code === 'RESULT_IMMUTABLE')
})

test('creating an appointment atomically posts one structured card and increments seller unread once', async () => {
  const transactions = repository()
  const input = { actor: buyer, ...validInput(), transactions, now: NOW }
  const result = await createTransaction(input)
  await createTransaction(input)
  assert.equal(transactions.state.messages.length, 1)
  const message = transactions.state.messages[0]
  assert.equal(message.transactionId, result.transaction._id)
  assert.equal(message.transactionCard.quantity, 2)
  assert.equal(message.transactionCard.locationText, '教学楼门口')
  assert.equal(message.transactionCard.scheduledAt, validInput().scheduledAt)
  assert.equal(message.transactionCard.status, 'pending_seller')
  assert.equal(message.transactionCard.postSnapshot.title, '教材')
  assert.equal(transactions.state.conversations[0].sellerUnread, 1)
})

test('buyer revises pending appointment in place with one event/card and no inventory change', async () => {
  const { reviseTransaction } = require('./transaction')
  const transactions = repository()
  const created = await createTransaction({ actor: buyer, ...validInput(), transactions, now: NOW })
  const input = { actor: buyer, transactionId: created.transaction._id, quantity: 1, scheduledAt: NOW + 3600000, campusId: 'bupt-shahe', locationText: '图书馆门口', requestId: 'revise-1', transactions, now: NOW }
  await reviseTransaction(input)
  await reviseTransaction(input)
  assert.equal(transactions.state.transactions.length, 1)
  assert.equal(transactions.state.transactions[0].quantity, 1)
  assert.equal(transactions.state.messages.length, 2)
  assert.equal(transactions.state.movements.length, 0)
  assert.equal(transactions.state.events.filter(event => event.type === 'modified').length, 1)
  await assert.rejects(reviseTransaction({ ...input, actor: seller, requestId: 'seller-revise' }), error => error.code === 'BUYER_ONLY')
  await respondTransaction({ actor: seller, transactionId: created.transaction._id, decision: 'confirm', requestId: 'confirm', transactions, now: NOW })
  await assert.rejects(reviseTransaction({ ...input, requestId: 'too-late' }), error => error.code === 'STALE_STATUS')
})

test('revisions retain appointment boundaries and never reserve inventory', async () => {
  const { reviseTransaction } = require('./transaction')
  const transactions = repository()
  const created = await createTransaction({ actor: buyer, ...validInput(), transactions, now: NOW })
  for (const patch of [{ quantity: 4 }, { scheduledAt: NOW }, { campusId: 'invalid' }, { locationText: '' }]) {
    await assert.rejects(reviseTransaction({ actor: buyer, ...validInput(), transactionId: created.transaction._id, requestId: 'bad-revise', ...patch, transactions, now: NOW }))
  }
  assert.equal(transactions.state.transactions[0].quantity, 2)
  assert.equal(transactions.state.movements.length, 0)
  assert.equal(transactions.state.messages.length, 1)
})
