const { releaseInventory, reserveInventory, sellInventory } = require('./inventory')

const ACTIVE_STATUSES = ['pending_seller', 'awaiting_handover']
const CAMPUSES = ['bupt-xitucheng', 'bupt-shahe', 'bupt-hainan']

class TransactionError extends Error {
  constructor(code, message) { super(message); this.name = 'TransactionError'; this.code = code }
}

function requireActor(actor) {
  if (!actor || actor.status !== 'active' || !actor.profileCompleted) throw new TransactionError('PROFILE_REQUIRED', '请先完善个人资料')
}
function requestId(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 64) throw new TransactionError('INVALID_REQUEST', '请求标识无效')
  return value.trim()
}
function requestKey(actor, action, value) { return `${actor._id}:${action}:${requestId(value)}` }
function normalizeReason(value, required = false) {
  const reason = typeof value === 'string' ? value.trim() : ''
  if ((required && reason.length < 2) || reason.length > 200) throw new TransactionError('INVALID_REASON', '原因须为 2 至 200 个字符')
  return reason
}
function validateInput({ quantity, scheduledAt, campusId, locationText }, post, now) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99 || quantity > post.availableQuantity) throw new TransactionError('INVALID_QUANTITY', '预约数量无效')
  const time = typeof scheduledAt === 'number' ? scheduledAt : Date.parse(scheduledAt)
  if (!Number.isFinite(time) || time < now + 10 * 60 * 1000 || time > now + 14 * 24 * 60 * 60 * 1000) throw new TransactionError('INVALID_SCHEDULE', '约定时间须晚于当前至少 10 分钟且不超过 14 天')
  if (!CAMPUSES.includes(campusId)) throw new TransactionError('INVALID_CAMPUS', '请选择有效校区')
  const location = typeof locationText === 'string' ? locationText.trim() : ''
  if (location.length < 2 || location.length > 50) throw new TransactionError('INVALID_LOCATION', '交接地点须为 2 至 50 个字符')
  return { quantity, scheduledAt: time, campusId, locationText: location }
}

async function appendSystem(tx, transaction, actor, text, requestKeyValue, now) {
  const recipientId = actor._id === transaction.buyerId ? transaction.sellerId : transaction.buyerId
  await tx.createSystemMessage({ conversationId: transaction.conversationId, transactionId: transaction._id, senderId: 'system', recipientId, type: 'system', text, transactionCard: { postSnapshot: transaction.postSnapshot, quantity: transaction.quantity, scheduledAt: transaction.scheduledAt, campusId: transaction.campusId, locationText: transaction.locationText, status: transaction.status }, requestKey: requestKeyValue, createdAt: now })
  const conversation = await tx.getConversation(transaction.conversationId)
  const patch = { lastMessageText: text, lastMessageType: 'system', lastMessageAt: now, updatedAt: now, buyerUnread: Number(conversation.buyerUnread || 0), sellerUnread: Number(conversation.sellerUnread || 0) }
  if (recipientId === transaction.buyerId) patch.buyerUnread += 1
  else patch.sellerUnread += 1
  await tx.updateConversation(transaction.conversationId, patch)
}

async function createTransaction({ actor, conversationId, quantity, scheduledAt, campusId, locationText, requestId: request, transactions, now }) {
  requireActor(actor)
  const key = requestKey(actor, 'create', request)
  return transactions.runTransaction(async (tx) => {
    const repeated = await tx.findRequest(key)
    if (repeated) return { transaction: repeated, created: false }
    const conversation = await tx.getConversation(conversationId)
    if (!conversation) throw new TransactionError('CONVERSATION_NOT_FOUND', '会话不存在')
    if (conversation.buyerId !== actor._id) throw new TransactionError('BUYER_ONLY', '只能由买家发起交易清单')
    if (await tx.findActive(conversationId)) throw new TransactionError('ACTIVE_TRANSACTION_EXISTS', '该会话已有进行中的交易')
    const post = await tx.getPost(conversation.postId)
    if (!post || post.ownerId !== conversation.sellerId) throw new TransactionError('POST_NOT_FOUND', '商品不存在')
    if (post.status !== 'active' || post.availableQuantity <= 0) throw new TransactionError('POST_UNAVAILABLE', '商品当前不可预约')
    const input = validateInput({ quantity, scheduledAt, campusId, locationText }, post, now)
    const transaction = await tx.createTransaction({
      conversationId, postId: post._id, buyerId: conversation.buyerId, sellerId: conversation.sellerId,
      postSnapshot: { postId: post._id, title: post.title, coverFileId: post.imageFileIds[0], unitPriceCents: post.unitPriceCents },
      ...input, status: 'pending_seller', activeKey: 'active', buyerResult: '', sellerResult: '', createRequestKey: key, createdAt: now, updatedAt: now,
    })
    await tx.createEvent({ transactionId: transaction._id, actorId: actor._id, type: 'created', requestId: requestId(request), requestKey: key, createdAt: now })
    await appendSystem(tx, transaction, actor, '买家发起预约购买，等待卖家确认', key, now)
    return { transaction, created: true }
  })
}

async function respondTransaction({ actor, transactionId, decision, reason, requestId: request, transactions, now }) {
  requireActor(actor)
  if (!['confirm', 'reject'].includes(decision)) throw new TransactionError('INVALID_DECISION', '卖家处理结果无效')
  const key = requestKey(actor, `respond:${decision}`, request)
  return transactions.runTransaction(async (tx) => {
    const repeated = await tx.findRequest(key)
    if (repeated) return { transaction: repeated, post: await tx.getPost(repeated.postId) }
    const transaction = await tx.getTransaction(transactionId)
    if (!transaction) throw new TransactionError('TRANSACTION_NOT_FOUND', '交易不存在')
    if (transaction.sellerId !== actor._id) throw new TransactionError('SELLER_ONLY', '只能由卖家处理交易清单')
    if (transaction.status !== 'pending_seller') throw new TransactionError('STALE_STATUS', '交易状态已变化，请刷新')
    const post = await tx.getPost(transaction.postId)
    if (decision === 'confirm') {
      const inventory = reserveInventory(post, transaction.quantity, { transactionId, requestKey: key, now })
      const updatedPost = await tx.updatePost(post._id, { ...inventory.patch, updatedAt: now })
      await tx.createMovement(inventory.movement)
      const updated = await tx.updateTransaction(transactionId, { status: 'awaiting_handover', confirmedAt: now, updatedAt: now })
      await tx.createEvent({ transactionId, actorId: actor._id, type: 'confirmed', requestId: requestId(request), requestKey: key, createdAt: now })
      await appendSystem(tx, updated, actor, `卖家已确认交易，已预留 ${transaction.quantity} 件商品`, key, now)
      return { transaction: updated, post: updatedPost }
    }
    const normalizedReason = normalizeReason(reason)
    const updated = await tx.updateTransaction(transactionId, { status: 'cancelled', activeKey: `terminal:${transactionId}`, cancelledBy: actor._id, cancelType: 'seller_rejected', cancelReason: normalizedReason, cancelledAt: now, updatedAt: now })
    await tx.createEvent({ transactionId, actorId: actor._id, type: 'seller_rejected', reason: normalizedReason, requestId: requestId(request), requestKey: key, createdAt: now })
    await appendSystem(tx, updated, actor, normalizedReason ? `卖家已拒绝交易：${normalizedReason}` : '卖家已拒绝交易', key, now)
    return { transaction: updated, post }
  })
}

async function withdrawTransaction({ actor, transactionId, reason, requestId: request, transactions, now }) {
  requireActor(actor)
  const key = requestKey(actor, 'withdraw', request)
  return transactions.runTransaction(async (tx) => {
    const repeated = await tx.findRequest(key)
    if (repeated) return { transaction: repeated }
    const transaction = await tx.getTransaction(transactionId)
    if (!transaction) throw new TransactionError('TRANSACTION_NOT_FOUND', '交易不存在')
    if (transaction.buyerId !== actor._id) throw new TransactionError('BUYER_ONLY', '只能由买家撤回交易清单')
    if (transaction.status !== 'pending_seller') throw new TransactionError('STALE_STATUS', '交易状态已变化，请刷新')
    const normalizedReason = normalizeReason(reason)
    const updated = await tx.updateTransaction(transactionId, { status: 'cancelled', activeKey: `terminal:${transactionId}`, cancelledBy: actor._id, cancelType: 'buyer_withdrew', cancelReason: normalizedReason, cancelledAt: now, updatedAt: now })
    await tx.createEvent({ transactionId, actorId: actor._id, type: 'buyer_withdrew', reason: normalizedReason, requestId: requestId(request), requestKey: key, createdAt: now })
    await appendSystem(tx, updated, actor, normalizedReason ? `买家已撤回交易：${normalizedReason}` : '买家已撤回交易', key, now)
    return { transaction: updated }
  })
}

async function cancelTransaction({ actor, transactionId, reason, requestId: request, transactions, now }) {
  requireActor(actor)
  const key = requestKey(actor, 'cancel', request)
  return transactions.runTransaction(async (tx) => {
    const repeated = await tx.findRequest(key)
    if (repeated) return { transaction: repeated, post: await tx.getPost(repeated.postId) }
    const transaction = await tx.getTransaction(transactionId)
    if (!transaction) throw new TransactionError('TRANSACTION_NOT_FOUND', '交易不存在')
    if (transaction.buyerId !== actor._id && transaction.sellerId !== actor._id) throw new TransactionError('FORBIDDEN', '你无权取消该交易')
    if (transaction.status !== 'awaiting_handover') throw new TransactionError('STALE_STATUS', '当前交易不可取消')
    if (now >= Number(transaction.scheduledAt)) throw new TransactionError('CANCEL_WINDOW_CLOSED', '已到约定时间，请提交交接结果')
    const normalizedReason = normalizeReason(reason, true)
    const post = await tx.getPost(transaction.postId)
    const inventory = releaseInventory(post, transaction.quantity, { transactionId, requestKey: key, now })
    const updatedPost = await tx.updatePost(post._id, { ...inventory.patch, updatedAt: now })
    await tx.createMovement(inventory.movement)
    const updated = await tx.updateTransaction(transactionId, { status: 'cancelled', activeKey: `terminal:${transactionId}`, cancelledBy: actor._id, cancelType: 'participant_cancelled', cancelReason: normalizedReason, cancelledAt: now, updatedAt: now })
    await tx.createEvent({ transactionId, actorId: actor._id, type: 'participant_cancelled', reason: normalizedReason, requestId: requestId(request), requestKey: key, createdAt: now })
    await appendSystem(tx, updated, actor, `交易已取消：${normalizedReason}`, key, now)
    return { transaction: updated, post: updatedPost }
  })
}

async function submitTransactionResult({ actor, transactionId, result, requestId: request, transactions, now }) {
  requireActor(actor)
  if (!['success', 'failure'].includes(result)) throw new TransactionError('INVALID_RESULT', '交接结果无效')
  const key = requestKey(actor, `result:${result}`, request)
  return transactions.runTransaction(async (tx) => {
    const repeated = await tx.findRequest(key)
    if (repeated) return { transaction: repeated, post: await tx.getPost(repeated.postId) }
    const transaction = await tx.getTransaction(transactionId)
    if (!transaction) throw new TransactionError('TRANSACTION_NOT_FOUND', '交易不存在')
    const role = transaction.buyerId === actor._id ? 'buyer' : transaction.sellerId === actor._id ? 'seller' : ''
    if (!role) throw new TransactionError('FORBIDDEN', '你无权提交该交易结果')
    if (!['awaiting_handover', 'failed'].includes(transaction.status)) throw new TransactionError('STALE_STATUS', '当前交易不可提交结果')
    if (now < Number(transaction.scheduledAt)) throw new TransactionError('RESULT_NOT_OPEN', '到达约定时间后才能提交交接结果')
    const ownField = `${role}Result`
    const otherField = role === 'buyer' ? 'sellerResult' : 'buyerResult'
    if (transaction[ownField]) throw new TransactionError('RESULT_IMMUTABLE', '交接结果提交后不可修改')
    const eventType = `${role}_result_${result}`
    let status = transaction.status
    let post = await tx.getPost(transaction.postId)
    let updatedPost = post
    let inventory = null
    if (result === 'failure' && transaction.status === 'awaiting_handover') {
      inventory = releaseInventory(post, transaction.quantity, { transactionId, requestKey: key, now })
      status = 'failed'
    } else if (result === 'success' && transaction.status === 'failed') {
      status = 'abnormal'
    } else if (result === 'success' && transaction[otherField] === 'success') {
      inventory = sellInventory(post, transaction.quantity, { transactionId, requestKey: key, now })
      status = 'completed'
    }
    if (inventory) {
      const postPatch = { ...inventory.patch, updatedAt: now }
      if (status === 'completed' && inventory.patch.reservedQuantity === 0 && post.availableQuantity === 0) postPatch.status = 'sold'
      updatedPost = await tx.updatePost(post._id, postPatch)
      await tx.createMovement(inventory.movement)
    }
    const terminal = ['completed', 'failed', 'abnormal'].includes(status)
    const updated = await tx.updateTransaction(transactionId, { [ownField]: result, [`${role}ResultAt`]: now, status, ...(terminal ? { activeKey: `terminal:${transactionId}` } : {}), completedAt: status === 'completed' ? now : transaction.completedAt, failedAt: status === 'failed' ? (transaction.failedAt || now) : transaction.failedAt, abnormalAt: status === 'abnormal' ? now : transaction.abnormalAt, updatedAt: now })
    await tx.createEvent({ transactionId, actorId: actor._id, type: eventType, result, requestId: requestId(request), requestKey: key, createdAt: now })
    const statusText = status === 'completed' ? '双方均确认交接成功，交易已完成' : status === 'abnormal' ? '双方交接结果不一致，交易已标记异常' : result === 'failure' ? (transaction.status === 'failed' ? `${role === 'buyer' ? '买家' : '卖家'}也反馈交接失败` : `${role === 'buyer' ? '买家' : '卖家'}反馈交接失败，库存已释放`) : `${role === 'buyer' ? '买家' : '卖家'}已确认交接成功，等待另一方确认`
    await appendSystem(tx, updated, actor, statusText, key, now)
    return { transaction: updated, post: updatedPost }
  })
}

async function listTransactions({ actor, role, status, cursor, limit, transactions }) {
  requireActor(actor)
  if (role && !['buyer', 'seller'].includes(role)) throw new TransactionError('INVALID_ROLE', '交易角色无效')
  const result = await transactions.list({ userId: actor._id, role: role || '', status: status || '', cursor: cursor || null, limit: Math.min(Math.max(Number(limit) || 20, 1), 20) })
  return { transactions: result.rows, nextCursor: result.nextCursor || null, pendingCounts: await transactions.pendingCounts(actor._id) }
}

async function getTransactionDetail({ actor, transactionId, transactions }) {
  requireActor(actor)
  const transaction = await transactions.getTransaction(transactionId)
  if (!transaction) throw new TransactionError('TRANSACTION_NOT_FOUND', '交易不存在')
  if (transaction.buyerId !== actor._id && transaction.sellerId !== actor._id) throw new TransactionError('FORBIDDEN', '你无权查看该交易')
  return { transaction, events: await transactions.getEvents(transactionId) }
}

module.exports = { ACTIVE_STATUSES, TransactionError, cancelTransaction, createTransaction, getTransactionDetail, listTransactions, respondTransaction, submitTransactionResult, withdrawTransaction }
