const { deadline } = require('./timeout')
﻿const { createHash } = require('node:crypto')
const rawConfig = require('./subscription-config.json')
const FIELD_NAMES = ['mode', 'status', 'time', 'location', 'nickname']
const idFor = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex')
function getSubscriptionConfig(raw = rawConfig) {
  const keys = FIELD_NAMES.map(name => raw.fields && raw.fields[name])
  const enabled = raw.enabled === true && typeof raw.templateId === 'string' && raw.templateId.trim().length > 0 && keys.every(key => typeof key === 'string' && /^[a-z_]+\d+$/.test(key)) && new Set(keys).size === FIELD_NAMES.length
  return { ...raw, enabled, miniprogramState: ['developer', 'trial', 'formal'].includes(raw.miniprogramState) ? raw.miniprogramState : 'trial' }
}
function publicSubscriptionConfig(config = getSubscriptionConfig()) { return { enabled: config.enabled, templateId: config.enabled ? config.templateId : '' } }
function participant(transaction, actorId) { return transaction.buyerId === actorId ? 'buyer' : transaction.sellerId === actorId ? 'seller' : '' }
function error(code, message) { return Object.assign(new Error(message), { code }) }
async function recordSubscription({ actor, transactionId, accepted, requestId, transactions, config = getSubscriptionConfig(), now }) {
  if (!actor || actor.status !== 'active' || !actor.profileCompleted) throw error('PROFILE_REQUIRED', '请先完善个人资料')
  if (!config.enabled) return { accepted: false, disabled: true }
  if (typeof accepted !== 'boolean' || typeof requestId !== 'string' || !requestId.trim() || requestId.length > 64) throw error('INVALID_REQUEST', '订阅请求无效')
  return transactions.runTransaction(async tx => {
    const transaction = await tx.getTransaction(transactionId)
    if (!transaction || !participant(transaction, actor._id)) throw error('FORBIDDEN', '你无权订阅该预约')
    if (!accepted) return { accepted: false }
    if (!['pending_seller', 'awaiting_handover'].includes(transaction.status)) throw error('STALE_STATUS', '预约已结束，无需订阅提醒')
    const id = idFor('grant', actor._id, requestId.trim())
    const existing = await tx.getDelivery(id)
    if (existing) {
      if (existing.transactionId !== transactionId || existing.templateId !== config.templateId) throw error('INVALID_REQUEST', '订阅请求标识已使用')
      return { accepted: true, repeated: true }
    }
    await tx.createDelivery(id, { kind: 'grant', recipientId: actor._id, transactionId, templateId: config.templateId, status: 'available', createdAt: now })
    return { accepted: true }
  })
}
async function queueSubscription({ tx, transaction, eventKey, kind = 'progress', actorId = 'system', config = getSubscriptionConfig(), now }) {
  if (!config.enabled) return
  const recipients = actorId === transaction.buyerId ? [transaction.sellerId] : actorId === transaction.sellerId ? [transaction.buyerId] : [transaction.buyerId, transaction.sellerId]
  for (const recipientId of recipients) {
    const id = idFor('delivery', eventKey, recipientId, config.templateId)
    if (await tx.getDelivery(id)) continue
    const expiresAt = kind === 'near' ? transaction.scheduledAt : kind === 'result' ? deadline(transaction) : now + 86400000
    await tx.createDelivery(id, { kind: 'delivery', transactionId: transaction._id, recipientId, templateId: config.templateId, eventKey, reminderType: kind, transactionStatus: transaction.status, scheduledAt: transaction.scheduledAt, status: 'pending', createdAt: now, expiresAt })
  }
}
const short = (value, fallback) => [...String(value || fallback).replace(/[\r\n\t]/g, ' ').trim()].slice(0, 20).join('') || fallback
function statusLabel(transaction, kind) {
  if (kind === 'near') return '待交接'
  if (kind === 'result' || (transaction.status === 'awaiting_handover' && (transaction.buyerResult === 'success' || transaction.sellerResult === 'success'))) return '待反馈'
  return { pending_seller: '待确认', awaiting_handover: '已预约', completed: '已完成', cancelled: '已取消', failed: '已失败', abnormal: '结果异常' }[transaction.status] || '状态更新'
}
function buildPayload({ transaction, recipientOpenid, peerNickname, kind, config }) {
  const time = new Date(Number(transaction.scheduledAt) + 8 * 3600000)
  if (!Number.isFinite(time.getTime())) throw error('INVALID_SCHEDULE', '预约时间异常')
  const pad = n => String(n).padStart(2, '0')
  const values = { mode: transaction.fulfillmentMode === 'online' ? '线上交付' : '线下交接', status: statusLabel(transaction, kind), time: `${time.getUTCFullYear()}年${time.getUTCMonth() + 1}月${time.getUTCDate()}日 ${pad(time.getUTCHours())}:${pad(time.getUTCMinutes())}`, location: transaction.fulfillmentMode === 'online' ? '线上' : short(transaction.locationText, '请查看预约详情'), nickname: short(peerNickname, '对方用户') }
  return { touser: recipientOpenid, templateId: config.templateId, page: `pages/transaction-detail/index?transactionId=${encodeURIComponent(transaction._id)}`, miniprogramState: config.miniprogramState, lang: 'zh_CN', data: Object.fromEntries(FIELD_NAMES.map(name => [config.fields[name], { value: values[name] }])) }
}
function isCurrentDelivery(delivery, transaction, now) {
  if (!transaction || !participant(transaction, delivery.recipientId) || delivery.expiresAt <= now || delivery.scheduledAt !== transaction.scheduledAt) return false
  if (['near', 'result'].includes(delivery.reminderType)) {
    if (transaction.status !== 'awaiting_handover' || transaction.buyerResult === 'failure' || transaction.sellerResult === 'failure') return false
    if (delivery.reminderType === 'result' && transaction[participant(transaction, delivery.recipientId) + 'Result']) return false
    return true
  }
  return transaction.status === delivery.transactionStatus
}
async function dispatchDelivery({ id, transactions, config = getSubscriptionConfig(), now, clock = () => now == null ? Date.now() : now, send }) {
  if (!config.enabled) return { status: 'disabled' }
  // Query outside the transaction; only document reads/writes are used to claim.
  const candidate = await transactions.getDelivery(id)
  const candidateGrant = candidate && candidate.kind === 'delivery' && candidate.status === 'pending' ? await transactions.findGrant({ recipientId: candidate.recipientId, transactionId: candidate.transactionId, templateId: config.templateId, before: candidate.createdAt }) : null
  const claim = await transactions.runTransaction(async tx => {
    const now = clock()
    const delivery = await tx.getDelivery(id)
    if (!delivery || delivery.kind !== 'delivery' || delivery.status !== 'pending') return { status: 'skipped' }
    const transaction = await tx.getTransaction(delivery.transactionId)
    if (delivery.templateId !== config.templateId || !isCurrentDelivery(delivery, transaction, now)) { await tx.updateDelivery(id, { status: 'stale', updatedAt: now }); return { status: 'stale' } }
    const grant = candidateGrant ? await tx.getDelivery(candidateGrant._id) : null
    if (grant && grant.status !== 'available') return { status: 'skipped' }
    if (!grant) { await tx.updateDelivery(id, { status: 'no_authorization', updatedAt: now }); return { status: 'no_authorization' } }
    const user = await tx.getUser(delivery.recipientId)
    if (!user || !user._openid || user.status === 'disabled') { await tx.updateDelivery(id, { status: 'unavailable', updatedAt: now }); return { status: 'unavailable' } }
    const peerId = delivery.recipientId === transaction.buyerId ? transaction.sellerId : transaction.buyerId
    const peer = await tx.getUser(peerId)
    const conversation = await tx.getConversation(transaction.conversationId)
    const snapshot = delivery.recipientId === transaction.buyerId ? conversation && conversation.sellerSnapshot : conversation && conversation.buyerSnapshot
    const payload = buildPayload({ transaction, recipientOpenid: user._openid, peerNickname: peer && peer.nickname || snapshot && snapshot.nickname, kind: delivery.reminderType, config })
    await tx.updateDelivery(grant._id, { status: 'consumed', deliveryId: id, updatedAt: now })
    await tx.updateDelivery(id, { status: 'dispatching', grantId: grant._id, attemptedAt: now, updatedAt: now })
    return { status: 'dispatching', payload }
  })
  if (!claim.payload) return claim
  // At most one API attempt: an ambiguous timeout must not resend a possibly delivered notification.
  let status = 'unknown', errorCode = ''
  try {
    const response = await send(claim.payload)
    if (response && response.errCode != null) { errorCode = String(response.errCode); status = Number(response.errCode) === 0 ? 'sent' : 'failed' }
  } catch (failure) {
    errorCode = failure.errCode == null ? failure.code || 'UNKNOWN_OUTCOME' : String(failure.errCode)
    if (failure.errCode != null) status = 'failed'
  }
  await transactions.runTransaction(async tx => tx.updateDelivery(id, { status, errorCode, updatedAt: clock() }))
  return { status }
}
async function dispatchPending({ transactions, config = getSubscriptionConfig(), now, clock = () => now == null ? Date.now() : now, deadline = Infinity, send, transactionId }) {
  const summary = { sent: 0, skipped: 0, failed: 0 }
  if (!config.enabled) return { ...summary, disabled: true }
  let cursor = null
  for (let page = 0; page < 5; page++) {
    const result = await transactions.listDeliveries({ transactionId, cursor, limit: 20 })
    for (const row of result.rows) {
      if (clock() >= deadline) return { ...summary, hasMore: true }
      try { const result = await dispatchDelivery({ id: row._id, transactions, config, clock, send }); if (result.status === 'sent') summary.sent++; else if (['failed', 'unknown'].includes(result.status)) summary.failed++; else summary.skipped++ }
      catch (failure) { summary.failed++; console.error('Subscription dispatch failed', { code: failure.code || 'INTERNAL_ERROR' }) }
    }
    cursor = result.nextCursor
    if (!cursor) break
  }
  return summary
}
module.exports = { getSubscriptionConfig, publicSubscriptionConfig, recordSubscription, queueSubscription, buildPayload, dispatchDelivery, dispatchPending }
