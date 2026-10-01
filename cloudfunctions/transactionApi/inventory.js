class InventoryError extends Error {
  constructor(code, message) { super(message); this.name = 'InventoryError'; this.code = code }
}

function quantity(value) {
  if (!Number.isInteger(value) || value <= 0) throw new InventoryError('INVALID_QUANTITY', '数量必须为正整数')
  return value
}

function counts(post) {
  const result = {
    total: Number(post.totalQuantity),
    available: Number(post.availableQuantity),
    reserved: Number(post.reservedQuantity),
    sold: Number(post.soldQuantity),
  }
  if (Object.values(result).some((value) => !Number.isInteger(value) || value < 0) || result.available + result.reserved + result.sold !== result.total) {
    throw new InventoryError('INVENTORY_INVARIANT', '商品库存数据异常')
  }
  return result
}

function movement(post, value, type, context) {
  return { postId: post._id, transactionId: context.transactionId, type, quantity: value, createdAt: context.now, requestKey: context.requestKey || '' }
}

function reserveInventory(post, value, context = {}) {
  const amount = quantity(value)
  const current = counts(post)
  if (current.available < amount) throw new InventoryError('INSUFFICIENT_STOCK', '商品可预约库存不足')
  return { patch: { availableQuantity: current.available - amount, reservedQuantity: current.reserved + amount }, movement: movement(post, amount, 'reserve', context) }
}

function releaseInventory(post, value, context = {}) {
  const amount = quantity(value)
  const current = counts(post)
  if (current.reserved < amount) throw new InventoryError('INVENTORY_INVARIANT', '预留库存不足，无法释放')
  return { patch: { availableQuantity: current.available + amount, reservedQuantity: current.reserved - amount }, movement: movement(post, amount, 'release', context) }
}

module.exports = { InventoryError, releaseInventory, reserveInventory }
