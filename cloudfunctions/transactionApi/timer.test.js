const test = require('node:test')
const assert = require('node:assert/strict')
const { isTrustedTimer, runTimeoutBatch } = require('./timer')

test('timer requires configured trigger and rejects client source including chained calls', () => {
  const event = { Type: 'Timer', TriggerName: 'appointment-timeout', now: Number.MAX_SAFE_INTEGER }
  assert.equal(isTrustedTimer(event, {}), true)
  for (const context of [{ OPENID: 'user' }, { SOURCE: 'wx_client' }, { SOURCE: 'wx_client,scf' }]) assert.equal(isTrustedTimer(event, context), false)
  assert.equal(isTrustedTimer({ ...event, TriggerName: 'other' }, {}), false)
  assert.equal(isTrustedTimer({ action: 'autoComplete' }, {}), false)
})
test('timeout scanner uses stable cursor and continues past a broken record', async () => {
  const queries = [], handled = []
  const transactions = {
    async listDue(query) { queries.push(query); return query.cursor ? { rows: [{ _id: 'last' }], nextCursor: null } : { rows: [{ _id: 'broken' }, { _id: 'cancelled' }], nextCursor: { scheduledAt: 100, id: 'cancelled' } } },
    async runTransaction(work) { return work({ async getTransaction(id) { handled.push(id); if (id === 'broken') throw Object.assign(new Error('broken'), { code: 'INVENTORY_INVARIANT' }); return { status: 'cancelled' } } }) },
  }
  const result = await runTimeoutBatch({ transactions, now: 3601000 })
  assert.deepEqual(result, { scanned: 3, completed: 0, failed: 1, hasMore: false })
  assert.equal(queries[0].before, 1000)
  assert.deepEqual(queries[1].cursor, { scheduledAt: 100, id: 'cancelled' })
  assert.deepEqual(handled, ['broken', 'cancelled', 'last'])
})
test('timeout scanner bounds each invocation and reports remaining work', async () => {
  const transactions = { async listDue() { return { rows: [], nextCursor: { scheduledAt: 1, id: 'next' } } } }
  const result = await runTimeoutBatch({ transactions, now: 4000000, maxPages: 2 })
  assert.equal(result.hasMore, true)
})

test('reminder scanner final hasMore reflects remaining work rather than intermediate pages', async () => {
  const { runAppointmentBatch } = require('./timer'); let pages = 0
  const transactions = {
    async listDue(query) { if (query.reminderBefore == null) return { rows: [], nextCursor: null }; pages++; return { rows: [], nextCursor: pages === 1 ? { scheduledAt: 1, id: 'next' } : null } },
  }
  const result = await runAppointmentBatch({ transactions, now: 4000000 })
  assert.equal(pages, 2); assert.equal(result.hasMore, false)
})
test('scanner stops starting tasks once invocation budget expires', async () => {
  let now = 4000000, reads = 0
  const transactions = {
    async listDue() { return { rows: [{ _id: 'a' }, { _id: 'b' }], nextCursor: null } },
    async runTransaction(work) { return work({ async getTransaction() { reads++; now += 100; return { status: 'cancelled' } } }) },
  }
  const result = await runTimeoutBatch({ transactions, now, clock: () => now, deadline: now + 50 })
  assert.equal(reads, 1); assert.equal(result.hasMore, true)
})
