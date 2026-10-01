const test = require('node:test')
const assert = require('node:assert/strict')

const { releaseInventory, reserveInventory } = require('./inventory')

test('reserves available inventory without changing total or sold counts', () => {
  const result = reserveInventory({ _id: 'p', totalQuantity: 5, availableQuantity: 3, reservedQuantity: 1, soldQuantity: 1 }, 2, { transactionId: 't', now: 10 })
  assert.deepEqual(result.patch, { availableQuantity: 1, reservedQuantity: 3 })
  assert.equal(result.movement.type, 'reserve')
  assert.equal(result.movement.quantity, 2)
})

test('rejects stale reservations that would oversell', () => {
  assert.throws(() => reserveInventory({ _id: 'p', totalQuantity: 1, availableQuantity: 1, reservedQuantity: 0, soldQuantity: 0 }, 2, {}), (error) => error.code === 'INSUFFICIENT_STOCK')
})

test('release restores available inventory and preserves the invariant', () => {
  const result = releaseInventory({ _id: 'p', totalQuantity: 4, availableQuantity: 1, reservedQuantity: 2, soldQuantity: 1 }, 2, { transactionId: 't', now: 10 })
  assert.deepEqual(result.patch, { availableQuantity: 3, reservedQuantity: 0 })
})

test('rejects invalid quantities and impossible inventory records', () => {
  assert.throws(() => reserveInventory({ availableQuantity: 2, reservedQuantity: 0 }, 0, {}))
  assert.throws(() => releaseInventory({ totalQuantity: 1, availableQuantity: 0, reservedQuantity: 0, soldQuantity: 1 }, 1, {}), (error) => error.code === 'INVENTORY_INVARIANT')
})
