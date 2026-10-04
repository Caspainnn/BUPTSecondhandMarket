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
    async getUser(id) { return (state.users || []).find(user => user._id === id) || null },
    async getConversation(id) { return tx.getConversation(id) },
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
  assert.deepEqual(transaction.postSnapshot, { direction: 'provide', contentType: 'item', postId: 'post', title: '教材', coverFileId: 'cloud://cover.jpg', unitPriceCents: 1000 })
  await assert.rejects(createTransaction({ actor: seller, ...validInput(), requestId: 'seller-create', transactions, now: NOW }), (error) => error.code === 'BUYER_ONLY')
})

test('accepts exact appointment boundaries and rejects outside them', async () => {
  await createTransaction({ actor: buyer, ...validInput(), scheduledAt: Math.floor(NOW / 60000) * 60000, transactions: repository(), now: NOW })
  await createTransaction({ actor: buyer, ...validInput(), scheduledAt: NOW + 14 * 24 * 60 * 60 * 1000, transactions: repository(), now: NOW })
  for (const scheduledAt of [Math.floor(NOW / 60000) * 60000 - 1, NOW + 14 * 24 * 60 * 60 * 1000 + 1]) {
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
  assert.deepEqual([transactions.state.events.length, transactions.state.movements.length, transactions.state.messages.length], [3, 1, 3])
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
  for (const patch of [{ quantity: 4 }, { scheduledAt: Math.floor(NOW / 60000) * 60000 - 1 }, { campusId: 'invalid' }, { locationText: '' }]) {
    await assert.rejects(reviseTransaction({ actor: buyer, ...validInput(), transactionId: created.transaction._id, requestId: 'bad-revise', ...patch, transactions, now: NOW }))
  }
  assert.equal(transactions.state.transactions[0].quantity, 2)
  assert.equal(transactions.state.movements.length, 0)
  assert.equal(transactions.state.messages.length, 1)
})

test('failure before the appointment releases inventory once and remains idempotent', async () => {
  const transactions = repository(awaitingSeed())
  const input = { actor: buyer, transactionId: 't1', result: 'failure', requestId: 'early-failure', transactions, now: NOW }
  const result = await submitTransactionResult(input)
  assert.equal(result.transaction.status, 'failed')
  await submitTransactionResult(input)
  assert.equal(transactions.state.movements.length, 1)
  assert.equal(transactions.state.posts[0].reservedQuantity, 0)
  assert.equal(transactions.state.posts[0].availableQuantity, 3)
})

test('appointment changes carry their actor and notify only the other participant once',async()=>{
 const {reviseTransaction}=require('./transaction')
 const transactions=repository()
 const created=await createTransaction({actor:buyer,...validInput(),transactions,now:NOW})
 const id=created.transaction._id
 await reviseTransaction({actor:buyer,...validInput(),transactionId:id,quantity:1,requestId:'notify-revise',transactions,now:NOW})
 await respondTransaction({actor:seller,transactionId:id,decision:'confirm',requestId:'notify-confirm',transactions,now:NOW})
 const failure={actor:buyer,transactionId:id,result:'failure',requestId:'notify-failure',transactions,now:NOW}
 await submitTransactionResult(failure);await submitTransactionResult(failure)
 assert.deepEqual(transactions.state.messages.filter(row=>!row.reminderType).map(row=>row.senderId),['buyer','buyer','seller','buyer'])
 assert.deepEqual(transactions.state.messages.filter(row=>!row.reminderType).map(row=>row.recipientId),['seller','seller','buyer','seller'])
 assert.equal(transactions.state.conversations[0].sellerUnread,4)
 assert.equal(transactions.state.conversations[0].buyerUnread,2)
 assert.ok(transactions.state.messages.filter(row=>!row.reminderType).every(row=>row.actorId===row.senderId && row.transactionCard))
})

async function confirmedTimeoutFixture(seed) {
  const transactions = repository(seed)
  const { transaction } = await createTransaction({ actor: buyer, ...validInput(), transactions, now: NOW })
  transaction.autoCompleteAfterMs = 3600000; transaction.autoCompleteAt = transaction.scheduledAt + 3600000
  await respondTransaction({ actor: seller, transactionId: transaction._id, decision: 'confirm', requestId: 'confirm-timeout', transactions, now: NOW })
  return { transactions, id: transaction._id, deadline: transaction.scheduledAt + 3600000 }
}
test('timeout completion respects exact hour and does not invent participant results', async () => {
  const { autoCompleteTransaction } = require('./transaction')
  const { transactions, id, deadline } = await confirmedTimeoutFixture()
  assert.equal((await autoCompleteTransaction({ transactionId: id, transactions, now: deadline - 1 })).completed, false)
  const result = await autoCompleteTransaction({ transactionId: id, transactions, now: deadline })
  assert.equal(result.completed, true)
  assert.equal(result.transaction.completionSource, 'timeout')
  assert.equal(result.transaction.buyerResult, '')
  assert.equal(result.transaction.sellerResult, '')
  assert.equal(transactions.state.posts[0].soldQuantity, 2)
  assert.equal(transactions.state.posts[0].reservedQuantity, 0)
  const before = structuredClone(transactions.state)
  assert.equal((await autoCompleteTransaction({ transactionId: id, transactions, now: deadline + 1 })).completed, false)
  assert.deepEqual(transactions.state, before)
  const message = transactions.state.messages.at(-1)
  assert.equal(message.actorId, 'system')
  assert.equal(message.transactionCard.completionSource, 'timeout')
  assert.equal(transactions.state.conversations[0].buyerUnread, before.conversations[0].buyerUnread)
  assert.equal(transactions.state.conversations[0].sellerUnread, 3)
})
test('timeout handles single success and concurrent failure with one inventory outcome', async () => {
  const { autoCompleteTransaction } = require('./transaction')
  for (const result of ['success', 'failure']) {
    const { transactions, id, deadline } = await confirmedTimeoutFixture()
    await submitTransactionResult({ actor: buyer, transactionId: id, result, requestId: 'feedback', transactions, now: deadline - 1 })
    const completed = await autoCompleteTransaction({ transactionId: id, transactions, now: deadline })
    assert.equal(completed.completed, result === 'success')
    assert.equal(transactions.state.transactions[0].status, result === 'success' ? 'completed' : 'failed')
  }
  for (const failureFirst of [true, false]) {
    const { transactions, id, deadline } = await confirmedTimeoutFixture()
    const failure = () => submitTransactionResult({ actor: buyer, transactionId: id, result: 'failure', requestId: 'racing-failure', transactions, now: deadline })
    const timeout = () => autoCompleteTransaction({ transactionId: id, transactions, now: deadline })
    await Promise.allSettled(failureFirst ? [failure(), timeout()] : [timeout(), failure()])
    assert.equal(transactions.state.movements.filter(row => ['sell', 'release'].includes(row.type)).length, 1)
    assert.equal(transactions.state.transactions[0].status, failureFirst ? 'failed' : 'completed')
  }
})
test('timeout ignores pending invalid and failed appointments and rolls back on broken inventory', async () => {
  const { autoCompleteTransaction } = require('./transaction')
  const transactions = repository()
  const { transaction } = await createTransaction({ actor: buyer, ...validInput(), transactions, now: NOW })
  assert.equal((await autoCompleteTransaction({ transactionId: transaction._id, transactions, now: NOW + 9999999 })).completed, false)
  for (const patch of [{ scheduledAt: null }, { scheduledAt: 'bad' }, { buyerResult: 'failure' }]) {
    const fixture = await confirmedTimeoutFixture()
    Object.assign(fixture.transactions.state.transactions[0], patch)
    assert.equal((await autoCompleteTransaction({ transactionId: fixture.id, transactions: fixture.transactions, now: fixture.deadline })).completed, false)
  }
  const fixture = await confirmedTimeoutFixture()
  fixture.transactions.state.posts[0].reservedQuantity = 0
  const before = structuredClone(fixture.transactions.state)
  await assert.rejects(autoCompleteTransaction({ transactionId: fixture.id, transactions: fixture.transactions, now: fixture.deadline }))
  assert.deepEqual(fixture.transactions.state, before)
})
test('timeout closes need without inventory and preserves ongoing services', async () => {
  const { autoCompleteTransaction } = require('./transaction')
  for (const direction of ['need', 'provide']) {
    const servicePost = { ...post, direction, contentType: 'service', ownerId: direction === 'need' ? 'buyer' : 'seller' }
    const fixture = await confirmedTimeoutFixture({ posts: [servicePost] })
    await autoCompleteTransaction({ transactionId: fixture.id, transactions: fixture.transactions, now: fixture.deadline })
    assert.equal(fixture.transactions.state.movements.length, 0)
    assert.equal(fixture.transactions.state.posts[0].status, direction === 'need' ? 'completed' : 'active')
    if (direction === 'need') assert.equal(fixture.transactions.state.posts[0].activeTransactionId, '')
  }
})

test('timeout linked stock closes original need and sells out only exhausted goods', async () => {
  const { autoCompleteTransaction } = require('./transaction')
  const need = { _id: 'need', ownerId: 'buyer', direction: 'need', contentType: 'item', title: '求教材', status: 'active', imageFileIds: [] }
  const goods = { ...post, totalQuantity: 2, availableQuantity: 2 }
  const transactions = repository({ posts: [goods, need], conversations: [{ ...conversations[0], postId: 'need' }] })
  const { transaction } = await createTransaction({ actor: buyer, ...validInput(), linkedPostId: 'post', transactions, now: NOW })
  await respondTransaction({ actor: seller, transactionId: transaction._id, decision: 'confirm', requestId: 'confirm-linked-timeout', transactions, now: NOW })
  await autoCompleteTransaction({ transactionId: transaction._id, transactions, now: transaction.scheduledAt + 3600000 })
  assert.equal(transactions.state.posts[0].status, 'sold')
  assert.equal(transactions.state.posts[0].soldQuantity, 2)
  assert.equal(transactions.state.posts[1].status, 'completed')
  assert.equal(transactions.state.posts[1].activeTransactionId, '')
  assert.equal(transactions.state.movements.filter(row => row.type === 'sell').length, 1)
})

test('confirmed appointments within fifteen minutes receive one plain reminder immediately', async () => {
  const { processAppointmentReminders } = require('./reminders')
  for (const minutes of [0, 10, 15]) {
    const transactions = repository()
    const { transaction } = await createTransaction({ actor: buyer, ...validInput(), scheduledAt: NOW + minutes * 60000, transactions, now: NOW })
    await respondTransaction({ actor: seller, transactionId: transaction._id, decision: 'confirm', requestId: 'confirm-short', transactions, now: NOW })
    const near = transactions.state.messages.filter(row => row.reminderType === 'near')
    assert.equal(near.length, 1)
    assert.equal(near[0].transactionCard, undefined)
    assert.equal(near[0].senderId, 'system')
    await processAppointmentReminders({ transactionId: transaction._id, transactions, now: NOW })
    assert.equal(transactions.state.messages.filter(row => row.reminderType === 'near').length, 1)
    assert.equal(transactions.state.messages.filter(row => row.reminderType === 'result').length, minutes === 0 ? 1 : 0)
  }
})
test('future appointments remind at fifteen minutes and at scheduled time without stealing the order card', async () => {
  const { processAppointmentReminders } = require('./reminders')
  const transactions = repository()
  const scheduledAt = NOW + 30 * 60000
  const { transaction } = await createTransaction({ actor: buyer, ...validInput(), scheduledAt, transactions, now: NOW })
  await respondTransaction({ actor: seller, transactionId: transaction._id, decision: 'confirm', requestId: 'confirm-future', transactions, now: NOW })
  for (const now of [scheduledAt - 900001, scheduledAt - 900000, scheduledAt - 900000, scheduledAt, scheduledAt]) await processAppointmentReminders({ transactionId: transaction._id, transactions, now })
  assert.deepEqual(transactions.state.messages.filter(row => row.reminderType).map(row => row.reminderType), ['near', 'result'])
  assert.equal(transactions.state.transactions[0].nextReminderAt, null)
  assert.ok(transactions.state.messages.filter(row => row.reminderType).every(row => !row.transactionCard))
  assert.equal(transactions.state.transactions[0].status, 'awaiting_handover')
})
test('late reminder scan only sends current result reminder and skips cancelled expired or failed orders', async () => {
  const { processAppointmentReminders } = require('./reminders')
  const seed = awaitingSeed({ scheduledAt: NOW })
  const transactions = repository(seed)
  await processAppointmentReminders({ transactionId: 't1', transactions, now: NOW + 60000 })
  assert.deepEqual(transactions.state.messages.map(row => row.reminderType), ['result'])
  for (const patch of [{ status: 'cancelled' }, { status: 'failed' }, { scheduledAt: NOW - 3600000 }, { buyerResult: 'failure' }]) {
    const repo = repository(awaitingSeed({ scheduledAt: NOW, ...patch }))
    await processAppointmentReminders({ transactionId: 't1', transactions: repo, now: NOW })
    assert.equal(repo.state.messages.length, 0)
  }
})

test('detail exposes only participant nicknames with conversation fallback after access check', async () => {
  const transactions = repository({ users: [{ _id: 'buyer', nickname: '买家甲', _openid: 'private-openid', contactInfo: 'private-contact' }] })
  transactions.state.conversations[0].sellerSnapshot = { nickname: '卖家乙' }
  const created = await createTransaction({ actor: buyer, ...validInput(), transactions, now: NOW })
  const detail = await getTransactionDetail({ actor: buyer, transactionId: created.transaction._id, transactions })
  assert.equal(detail.buyerNickname, '买家甲')
  assert.equal(detail.sellerNickname, '卖家乙')
  assert.ok(!JSON.stringify(detail).includes('private-'))
  transactions.getUser = async () => { throw Error('Must not read profiles before authorization') }
  await assert.rejects(getTransactionDetail({ actor: { ...buyer, _id: 'outsider' }, transactionId: created.transaction._id, transactions }), { code: 'FORBIDDEN' })
})

test('per-appointment timeout supports one day and seven days', async () => {
  const { autoCompleteTransaction, reviseTransaction } = require('./transaction')
  for (const hours of [24, 168]) {
    const { transactions, id } = await confirmedTimeoutFixture()
    const row = transactions.state.transactions.find(item => item._id === id)
    row.autoCompleteAfterMs = hours * 3600000
    const cutoff = row.scheduledAt + row.autoCompleteAfterMs
    assert.equal((await autoCompleteTransaction({ transactionId: id, transactions, now: cutoff - 1 })).completed, false)
    assert.equal((await autoCompleteTransaction({ transactionId: id, transactions, now: cutoff })).completed, true)
  }
})

test('timeout config accepts one day and seven days and rejects invalid values', () => {
  const { configuredTimeoutMs } = require('./timeout')
  for (const hours of [1, 24, 168]) assert.equal(configuredTimeoutMs({ autoCompleteAfterHours: hours }), hours * 3600000)
  for (const hours of [0, -1, '24', null, Infinity, 9000]) assert.throws(() => configuredTimeoutMs({ autoCompleteAfterHours: hours }))
})
test('new appointment snapshots timeout and revision moves deadline without changing duration', async () => {
  const { reviseTransaction } = require('./transaction')
  const transactions = repository()
  const { transaction } = await createTransaction({ actor: buyer, ...validInput(), transactions, now: NOW })
  assert.equal(transaction.autoCompleteAfterMs, require('./timeout').configuredTimeoutMs())
  transaction.autoCompleteAfterMs = 168 * 3600000
  const updated = await reviseTransaction({ actor: buyer, ...validInput(), transactionId: transaction._id, scheduledAt: NOW + 3600000, requestId: 'move', transactions, now: NOW })
  assert.equal(updated.transaction.autoCompleteAfterMs, 168 * 3600000)
  assert.equal(updated.transaction.autoCompleteAt, NOW + 169 * 3600000)
  const { getAutoCompleteAt } = require('../../miniprogram/services/transaction-state')
  assert.equal(getAutoCompleteAt(updated.transaction), updated.transaction.autoCompleteAt)
})

test('failure details return only opposite contact to the authorized participant', async () => {
  const transactions = repository({ users: [{ _id: 'buyer', nickname: '甲', contactInfo: 'buyer-contact', _openid: 'secret-buyer' }, { _id: 'seller', nickname: '乙', contactInfo: 'seller-contact', _openid: 'secret-seller' }], transactions: [{ _id: 't', buyerId: 'buyer', sellerId: 'seller', conversationId: 'c1', status: 'abnormal' }] })
  const result = await getTransactionDetail({ actor: buyer, transactionId: 't', transactions })
  assert.equal(result.peerContact.contactInfo, 'seller-contact')
  assert.equal(result.peerContact.nickname, '乙'); assert.equal(result.peerContact.role, 'seller')
  assert.ok(!JSON.stringify(result).includes('secret-'))
  const reverse = await getTransactionDetail({ actor: seller, transactionId: 't', transactions })
  assert.equal(reverse.peerContact.contactInfo, 'buyer-contact')
  transactions.state.transactions[0].status = 'completed'
  assert.equal((await getTransactionDetail({ actor: buyer, transactionId: 't', transactions })).peerContact, null)
})
