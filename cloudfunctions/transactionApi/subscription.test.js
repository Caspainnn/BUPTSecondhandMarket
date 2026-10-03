const test = require('node:test'), assert = require('node:assert/strict')
const subscription = require('./subscription')
const { queueSubscription, recordSubscription, dispatchDelivery, getSubscriptionConfig, buildPayload } = subscription
const config = { enabled: true, templateId: 'approved-template', miniprogramState: 'trial', fields: { mode: 'thing1', status: 'phrase2', time: 'time3', location: 'thing4', nickname: 'thing5' } }
const buyer = { _id: 'buyer', status: 'active', profileCompleted: true }
function fixture() {
  const state = { deliveries: [], transaction: { _id: 't', conversationId: 'c', buyerId: 'buyer', sellerId: 'seller', status: 'awaiting_handover', scheduledAt: 6000000, locationText: '图书馆门口', fulfillmentMode: 'offline' } }
  const tx = {
    async getTransaction() { return state.transaction }, async getDelivery(id) { return state.deliveries.find(row => row._id === id) || null },
    async createDelivery(id, data) { const row = { _id: id, ...data }; state.deliveries.push(row); return row },
    async updateDelivery(id, patch) { Object.assign(await this.getDelivery(id), patch) },
    async findGrant(query) { return state.deliveries.find(row => row.kind === 'grant' && row.status === 'available' && row.recipientId === query.recipientId && row.transactionId === query.transactionId && row.templateId === query.templateId && row.createdAt <= query.before) || null },
    async getUser(id) { return { _id: id, _openid: 'openid-' + id, nickname: id === 'seller' ? '小邮同学' : '甲同学' } },
    async getConversation() { return { buyerSnapshot: { nickname: '旧买家' }, sellerSnapshot: { nickname: '旧卖家' } } },
  }
  let serial = Promise.resolve()
  const transactions = { state, tx, getDelivery: tx.getDelivery.bind(tx), findGrant: tx.findGrant.bind(tx), runTransaction(work) { const next = serial.then(() => work(tx)); serial = next.catch(() => {}); return next } }
  tx.findGrant = async () => { throw Error('Transactional where is unsupported') }
  return transactions
}
async function queued(repo, kind = 'near', createdAt = 100) {
  await queueSubscription({ tx: repo.tx, transaction: repo.state.transaction, eventKey: 'event', kind, actorId: 'system', config, now: createdAt })
  return repo.state.deliveries.find(row => row.kind === 'delivery' && row.recipientId === 'buyer')._id
}
test('subscription stays disabled until approved ID and all unique field keys are configured', () => {
  assert.equal(getSubscriptionConfig({ enabled: false }).enabled, false)
  assert.equal(getSubscriptionConfig({ ...config, templateId: '' }).enabled, false)
  assert.equal(getSubscriptionConfig({ ...config, fields: { ...config.fields, time: '' } }).enabled, false)
  assert.equal(getSubscriptionConfig({ ...config, fields: { ...config.fields, nickname: 'thing1' } }).enabled, false)
  assert.equal(getSubscriptionConfig(config).enabled, true)
})
test('grant recording uses participant identity, requires acceptance and is idempotent', async () => {
  const repo = fixture()
  await recordSubscription({ actor: buyer, transactionId: 't', accepted: false, requestId: 'reject', transactions: repo, config, now: 1 })
  assert.equal(repo.state.deliveries.length, 0)
  const input = { actor: buyer, transactionId: 't', accepted: true, requestId: 'grant', transactions: repo, config, now: 2 }
  await recordSubscription(input); await recordSubscription(input)
  assert.equal(repo.state.deliveries.length, 1)
  await assert.rejects(recordSubscription({ ...input, actor: { ...buyer, _id: 'outsider' }, requestId: 'bad' }), { code: 'FORBIDDEN' })
})
test('no grant means no external send; each recorded grant is consumed for at most one delivery', async () => {
  const repo = fixture(); let sends = 0
  let id = await queued(repo)
  const send = async () => { sends++; return { errCode: 0 } }
  assert.equal((await dispatchDelivery({ id, transactions: repo, config, now: 101, send })).status, 'no_authorization')
  assert.equal(sends, 0)
  await recordSubscription({ actor: buyer, transactionId: 't', accepted: true, requestId: 'grant', transactions: repo, config, now: 200 })
  await queueSubscription({ tx: repo.tx, transaction: repo.state.transaction, eventKey: 'event2', kind: 'near', actorId: 'system', config, now: 201 })
  id = repo.state.deliveries.find(row => row.eventKey === 'event2' && row.recipientId === 'buyer')._id
  const outcomes = await Promise.all([dispatchDelivery({ id, transactions: repo, config, now: 202, send }), dispatchDelivery({ id, transactions: repo, config, now: 202, send })])
  assert.equal(sends, 1)
  assert.ok(outcomes.some(row => row.status === 'sent'))
  assert.equal(repo.state.deliveries.find(row => row.kind === 'grant').status, 'consumed')
})
test('late authorization does not send earlier events and stale reminders never consume grants', async () => {
  const repo = fixture(); const id = await queued(repo)
  await recordSubscription({ actor: buyer, transactionId: 't', accepted: true, requestId: 'late', transactions: repo, config, now: 101 })
  let sends = 0; const send = async () => { sends++; return { errCode: 0 } }
  assert.equal((await dispatchDelivery({ id, transactions: repo, config, now: 102, send })).status, 'no_authorization')
  await queueSubscription({ tx: repo.tx, transaction: repo.state.transaction, eventKey: 'new', kind: 'near', actorId: 'system', config, now: 103 })
  const stale = repo.state.deliveries.find(row => row.eventKey === 'new' && row.recipientId === 'buyer')
  repo.state.transaction.status = 'cancelled'
  assert.equal((await dispatchDelivery({ id: stale._id, transactions: repo, config, now: 104, send })).status, 'stale')
  assert.equal(sends, 0)
  assert.equal(repo.state.deliveries.find(row => row.kind === 'grant').status, 'available')
})
test('payload uses opposite nickname, Shanghai time and configured keys without internal identity leakage', () => {
  const payload = buildPayload({ transaction: { _id: 't', scheduledAt: Date.parse('2026-10-03T10:30:00Z'), fulfillmentMode: 'online', locationText: 'private detail' }, recipientOpenid: 'target', peerNickname: '小邮同学', kind: 'near', config })
  assert.equal(payload.data.thing1.value, '线上交付')
  assert.equal(payload.data.thing4.value, '线上')
  assert.equal(payload.data.thing5.value, '小邮同学')
  assert.equal(payload.data.time3.value, '2026年10月3日 18:30')
  assert.equal(payload.data.phrase2.value, '待交接')
  assert.equal(payload.page, 'pages/transaction-detail/index?transactionId=t')
})
test('unknown send outcome is recorded and never retried automatically, transaction remains unchanged', async () => {
  const repo = fixture()
  await recordSubscription({ actor: buyer, transactionId: 't', accepted: true, requestId: 'grant', transactions: repo, config, now: 1 })
  const id = await queued(repo); const before = structuredClone(repo.state.transaction); let sends = 0
  const send = async () => { sends++; throw new Error('network timeout') }
  assert.equal((await dispatchDelivery({ id, transactions: repo, config, now: 101, send })).status, 'unknown')
  await dispatchDelivery({ id, transactions: repo, config, now: 102, send })
  assert.equal(sends, 1)
  assert.deepEqual(repo.state.transaction, before)
})

test('batch refreshes current time and does not consume grants for expired reminders', async () => {
  const repo = fixture()
  for (const actor of [buyer, { ...buyer, _id: 'seller' }]) await recordSubscription({ actor, transactionId: 't', accepted: true, requestId: actor._id, transactions: repo, config, now: 1 })
  await queued(repo)
  repo.listDeliveries = async () => ({ rows: repo.state.deliveries.filter(row => row.kind === 'delivery'), nextCursor: null })
  let now = 5999999, sends = 0
  await subscription.dispatchPending({ transactions: repo, config, clock: () => now, send: async () => { sends++; now += 100; return { errCode: 0 } } })
  assert.equal(sends, 1)
  assert.equal(repo.state.deliveries.filter(row => row.kind === 'grant' && row.status === 'available').length, 1)
})
