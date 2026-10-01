const test = require('node:test')
const assert = require('node:assert/strict')

const { createTransactionState, derivePendingCounts, getPostManagementActions, getTransactionActions, getTransactionStatusLabel, reduceTransactionState } = require('./transaction-state')

const future = Date.now() + 60_000
const past = Date.now() - 60_000
const base = { _id: 't', buyerId: 'buyer', sellerId: 'seller', status: 'pending_seller', scheduledAt: future, buyerResult: '', sellerResult: '' }

test('shows role-based pending actions', () => {
  assert.deepEqual(getTransactionActions(base, 'buyer', Date.now()), ['withdraw'])
  assert.deepEqual(getTransactionActions(base, 'seller', Date.now()), ['confirm', 'reject'])
  assert.deepEqual(getTransactionActions(base, 'other', Date.now()), [])
})

test('allows cancellation before appointment and locks results until appointment', () => {
  const waiting = { ...base, status: 'awaiting_handover' }
  assert.deepEqual(getTransactionActions(waiting, 'buyer', Date.now()), ['cancel'])
  assert.deepEqual(getTransactionActions({ ...waiting, scheduledAt: past }, 'buyer', Date.now()), ['success', 'failure'])
})

test('hides result controls after the actor submitted and lets the other participant finish a failed record', () => {
  const failed = { ...base, status: 'failed', scheduledAt: past, buyerResult: 'failure', sellerResult: '' }
  assert.deepEqual(getTransactionActions(failed, 'buyer', Date.now()), [])
  assert.deepEqual(getTransactionActions(failed, 'seller', Date.now()), ['success', 'failure'])
})

test('preserves the full form on failure and prevents duplicate submit', () => {
  let state = createTransactionState({ conversationId: 'c', campusId: 'bupt-shahe' })
  state = reduceTransactionState(state, { type: 'PATCH_FORM', patch: { quantity: 2, locationText: '图书馆门口', scheduledAt: '2026-10-02 12:00' } })
  state = reduceTransactionState(state, { type: 'SUBMIT_START', requestId: 'r1' })
  state = reduceTransactionState(state, { type: 'SUBMIT_START', requestId: 'r2' })
  assert.equal(state.requestId, 'r1')
  state = reduceTransactionState(state, { type: 'FAILURE', message: '失败' })
  assert.deepEqual(state.form, { quantity: 2, campusId: 'bupt-shahe', locationText: '图书馆门口', scheduledAt: '2026-10-02 12:00' })
  assert.equal(state.requestId, 'r1')
})

test('uses the approved 待交接 label and renders failed/abnormal distinctly', () => {
  assert.equal(getTransactionStatusLabel('awaiting_handover'), '待交接')
  assert.equal(getTransactionStatusLabel('failed'), '交接失败')
  assert.equal(getTransactionStatusLabel('abnormal'), '结果异常')
})

test('post management reflects unavailable and lifecycle states', () => {
  assert.deepEqual(getPostManagementActions({ status: 'active', availableQuantity: 2 }), ['edit', 'downlist'])
  assert.deepEqual(getPostManagementActions({ status: 'offline', availableQuantity: 2 }), ['edit', 'relist'])
  assert.deepEqual(getPostManagementActions({ status: 'active', availableQuantity: 0 }), ['edit'])
})

test('derives buyer and seller pending counts from transaction rows', () => {
  const rows = [{ buyerId: 'u', sellerId: 'x', status: 'pending_seller' }, { buyerId: 'x', sellerId: 'u', status: 'awaiting_handover' }, { buyerId: 'u', sellerId: 'x', status: 'completed' }]
  assert.deepEqual(derivePendingCounts(rows, 'u'), { buyer: 1, seller: 1 })
})
