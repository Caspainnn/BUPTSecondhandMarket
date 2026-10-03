const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
const NOW = 1000000
function fixture({ enabled = false, send, queueFailure = false } = {}) {
  let source = { OPENID: 'buyer-openid', SOURCE: 'wx_client' }, queue = Promise.resolve(), calls = 0
  const state = { users: { buyer: { _id: 'buyer', _openid: 'buyer-openid', status: 'active', profileCompleted: true, nickname: '买家甲' }, seller: { _id: 'seller', _openid: 'seller-openid', status: 'active', profileCompleted: true, nickname: '卖家乙' } }, conversations: { c: { _id: 'c', buyerId: 'buyer', sellerId: 'seller', buyerUnread: 0, sellerUnread: 0 } }, posts: { p: { _id: 'p', status: 'active', totalQuantity: 3, availableQuantity: 3, reservedQuantity: 0, soldQuantity: 0 } }, transactions: { t: { _id: 't', conversationId: 'c', postId: 'p', buyerId: 'buyer', sellerId: 'seller', quantity: 1, status: 'pending_seller', scheduledAt: NOW + 600000, locationText: '图书馆门口', buyerResult: '', sellerResult: '', activeKey: 'active', postSnapshot: {} } }, transaction_events: {}, inventory_movements: {}, messages: {}, subscription_deliveries: {} }
  const evaluate = (row, condition) => typeof condition === 'function' ? condition(row) : Object.entries(condition).every(([key, value]) => typeof value === 'function' ? value(row[key]) : row[key] === value)
  const command = { and: parts => row => parts.every(part => evaluate(row, part)), or: parts => row => parts.some(part => evaluate(row, part)), gte: value => item => typeof item === 'number' && item >= value, gt: value => item => item != null && item > value, lte: value => item => typeof item === 'number' && item <= value, lt: value => item => item < value, eq: value => item => item === value, in: values => item => values.includes(item), exists: value => item => (item !== undefined) === value, remove: () => '__REMOVE__' }
  function collection(name) {
    const rows = () => state[name]
    const select = (condition, orders = [], limit = 100) => ({ orderBy(field, order) { return select(condition, [...orders, [field, order]], limit) }, limit(value) { return select(condition, orders, value) }, async count() { return { total: Object.values(rows()).filter(row => evaluate(row, condition)).length } }, async get() { return { data: structuredClone(Object.values(rows()).filter(row => evaluate(row, condition)).sort((a, b) => { for (const [field, order] of orders) { const delta = a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0; if (delta) return order === 'asc' ? delta : -delta } return 0 }).slice(0, limit)) } } })
    return { where: condition => select(condition), doc: id => ({ async get() { if (!rows()[id]) throw Error('missing'); return { data: structuredClone(rows()[id]) } }, async set({ data }) { if (queueFailure && name === 'subscription_deliveries' && data.kind === 'delivery') throw Error('queue unavailable'); rows()[id] = structuredClone({ ...data, _id: id }) }, async update({ data }) { for (const [key, value] of Object.entries(data)) { if (value === '__REMOVE__') delete rows()[id][key]; else rows()[id][key] = structuredClone(value) } } }), async add({ data }) { if (name === 'transaction_events' && Object.values(rows()).some(row => row.actorId === data.actorId && row.requestId === data.requestId)) throw Error('DUPLICATE_ACTOR_REQUEST'); const id = 'row' + Object.keys(rows()).length; rows()[id] = structuredClone({ ...data, _id: id }); return { _id: id } } }
  }
  const db = { command, collection, runTransaction(work) { const next = queue.then(async () => { const before = structuredClone(state); try { return await work({ collection }) } catch (error) { for (const key of Object.keys(state)) state[key] = before[key]; throw error } }); queue = next.catch(() => {}); return next } }
  const config = { enabled, templateId: enabled ? 'approved-id' : '', miniprogramState: 'trial', fields: { mode: 'thing1', status: 'phrase2', time: 'time3', location: 'thing4', nickname: 'thing5' } }
  const cloud = { init() {}, DYNAMIC_CURRENT_ENV: 'env', database: () => db, getWXContext: () => source, openapi: { subscribeMessage: { async send(payload) { calls++; return send ? send(payload) : { errCode: 0 } } } } }
  const subscription = require('./cloudfunctions/transactionApi/subscription')
  const exports = {}
  class Clock extends Date { static now() { return NOW } }
  vm.runInNewContext(fs.readFileSync('cloudfunctions/transactionApi/index.js', 'utf8'), { Date: Clock, Object, exports, console: { error() {}, log() {} }, require: name => name === 'wx-server-sdk' ? cloud : name === './subscription' ? { ...subscription, getSubscriptionConfig: () => config } : require(path.resolve('cloudfunctions/transactionApi', name)) })
  return { main: exports.main, state, context(value) { source = value }, get calls() { return calls } }
}
test('real subscription API uses trusted actor and correct opposite nickname; external failures preserve confirmed inventory', async () => {
  for (const fail of [false, true]) {
    const repo = fixture({ enabled: true, send: async payload => { assert.equal(payload.touser, 'buyer-openid'); assert.equal(payload.data.thing5.value, '卖家乙'); if (fail) throw Error('timeout'); return { errCode: 0 } } })
    const grant = await repo.main({ action: 'subscribe', transactionId: 't', accepted: true, requestId: 'grant', actor: { _id: 'seller' } })
    assert.equal(grant.ok, true)
    assert.equal(Object.values(repo.state.subscription_deliveries)[0].recipientId, 'buyer')
    repo.context({ OPENID: 'seller-openid', SOURCE: 'wx_client' })
    const confirmed = await repo.main({ action: 'respond', transactionId: 't', decision: 'confirm', requestId: 'confirm' })
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed.error))
    assert.equal(repo.calls, 1)
    assert.equal(repo.state.transactions.t.status, 'awaiting_handover')
    assert.equal(repo.state.posts.p.reservedQuantity, 1)
    assert.ok(Object.values(repo.state.messages).some(row => row.reminderType === 'near' && !row.transactionCard))
    const delivery = Object.values(repo.state.subscription_deliveries).find(row => row.kind === 'delivery' && row.reminderType === 'progress')
    assert.equal(delivery.status, fail ? 'unknown' : 'sent')
  }
})
test('real timer entry refuses fake client timer and completes via trusted source with no duplicate reminders', async () => {
  const repo = fixture()
  repo.state.transactions.t = { ...repo.state.transactions.t, status: 'awaiting_handover', scheduledAt: NOW - 3600000 }
  repo.state.posts.p.availableQuantity = 2; repo.state.posts.p.reservedQuantity = 1
  const event = { Type: 'Timer', TriggerName: 'appointment-timeout', now: 9999999999 }
  assert.equal((await repo.main(event)).error.code, 'FORBIDDEN')
  repo.context({ OPENID: 'buyer-openid', SOURCE: 'wx_client' })
  const result = await repo.main({ action: 'refresh' })
  assert.equal(result.ok, true, JSON.stringify(result.error))
  assert.equal(result.data.completed, 1)
  assert.equal(result.data.reminded, 0)
  assert.equal(repo.state.posts.p.soldQuantity, 1)
  assert.equal((await repo.main({ action: 'refresh' })).data.completed, 0)
})
test('real reminder scan excludes null nextReminderAt and preserves legacy appointments without extra near replay', async () => {
  const repo = fixture()
  repo.state.transactions.t = { ...repo.state.transactions.t, status: 'awaiting_handover', scheduledAt: NOW - 1000 }
  repo.context({ OPENID: 'buyer-openid', SOURCE: 'wx_client' })
  const event = { Type: 'Timer', TriggerName: 'appointment-timeout' }
  assert.equal((await repo.main({ action: 'refresh' })).data.reminded, 1)
  assert.equal(repo.state.transactions.t.nextReminderAt, null)
  assert.equal((await repo.main({ action: 'refresh' })).data.reminded, 0)
  assert.deepEqual(Object.values(repo.state.messages).map(row => row.reminderType), ['result'])
})

test('multiple appointments do not collide with deployed actor_request unique index', async () => {
  const repo = fixture(); repo.context({ OPENID: 'seller-openid', SOURCE: 'wx_client' })
  repo.state.transactions.t2 = { ...repo.state.transactions.t, _id: 't2' }
  for (const id of ['t', 't2']) assert.equal((await repo.main({ action: 'respond', transactionId: id, decision: 'confirm', requestId: 'confirm-' + id })).ok, true)
  assert.equal(Object.values(repo.state.messages).filter(row => row.reminderType === 'near').length, 2)
  for (const id of ['t', 't2']) { repo.state.transactions[id].scheduledAt = NOW - 1000; repo.state.transactions[id].nextReminderAt = NOW - 1000 }
  repo.context({ OPENID: 'buyer-openid', SOURCE: 'wx_client' })
  assert.equal((await repo.main({ action: 'refresh' })).data.reminded, 2)
  assert.equal(Object.values(repo.state.messages).filter(row => row.reminderType === 'result').length, 2)
})
test('optional subscription queue failure never rolls back confirmation or plain reminder', async () => {
  const repo = fixture({ enabled: true, queueFailure: true }); repo.context({ OPENID: 'seller-openid', SOURCE: 'wx_client' })
  const result = await repo.main({ action: 'respond', transactionId: 't', decision: 'confirm', requestId: 'confirm' })
  assert.equal(result.ok, true)
  assert.equal(repo.state.transactions.t.status, 'awaiting_handover')
  assert.equal(repo.state.posts.p.reservedQuantity, 1)
  assert.equal(Object.values(repo.state.messages).filter(row => row.reminderType === 'near').length, 1)
})

test('real scanner respects persisted seven-day deadline and still handles legacy hour records', async () => {
  const repo = fixture(); repo.context({ OPENID: 'buyer-openid', SOURCE: 'wx_client' })
  const duration = 168 * 3600000
  repo.state.transactions.t = { ...repo.state.transactions.t, status: 'awaiting_handover', scheduledAt: NOW - 7200000, autoCompleteAfterMs: duration, autoCompleteAt: NOW - 7200000 + duration }
  assert.equal((await repo.main({ action: 'refresh' })).data.completed, 0)
  repo.state.transactions.t.scheduledAt = NOW - duration
  repo.state.transactions.t.autoCompleteAt = NOW
  repo.state.posts.p.availableQuantity = 2; repo.state.posts.p.reservedQuantity = 1
  assert.equal((await repo.main({ action: 'refresh' })).data.completed, 1)
})

test('page refresh completes only caller appointments and list returns latest terminal state', async () => {
  const repo = fixture()
  repo.state.transactions.t = { ...repo.state.transactions.t, status: 'awaiting_handover', inventoryManaged: false, scheduledAt: NOW - 360000, autoCompleteAfterMs: 360000, autoCompleteAt: NOW }
  repo.state.transactions.other = { ...repo.state.transactions.t, _id: 'other', buyerId: 'outsider', sellerId: 'another' }
  const result = await repo.main({ action: 'list', status: 'awaiting_handover', now: 999999999 })
  assert.equal(result.ok, true)
  assert.equal(repo.state.transactions.t.status, 'completed')
  assert.equal(repo.state.transactions.other.status, 'awaiting_handover')
  assert.equal(result.data.transactions.length, 0)
  assert.equal(repo.state.transactions.t.buyerResult, '')
  assert.equal(repo.state.transactions.t.completionSource, 'timeout')
})
