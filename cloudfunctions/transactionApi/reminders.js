const { deadline } = require('./timeout')
const NEAR_WINDOW_MS = 15 * 60000

async function appendReminder(tx, transaction, type, now) {
  const text = type === 'near' ? '预约即将开始，请按约定时间交接。' : '已到约定交接时间，请提交交接结果。'
  const key = `system:reminder:${transaction._id}:${type}`
  await tx.createSystemMessage({ conversationId: transaction.conversationId, transactionId: transaction._id, senderId: 'system', actorId: 'system', recipientId: '', type: 'system', reminderType: type, text, requestKey: key, createdAt: now })
  const conversation = await tx.getConversation(transaction.conversationId)
  await tx.updateConversation(transaction.conversationId, { lastMessageText: text, lastMessageType: 'system', lastMessageAt: now, updatedAt: now, buyerUnread: Number(conversation.buyerUnread || 0) + 1, sellerUnread: Number(conversation.sellerUnread || 0) + 1 })
  await tx.createEvent({ transactionId: transaction._id, actorId: 'system', type: `reminder_${type}`, requestId: key, requestKey: key, createdAt: now })
  if (tx.queueSubscription) await tx.queueSubscription(transaction, key, type, now)
}

async function remindInTransaction(tx, transaction, now) {
  if (!transaction || transaction.status !== 'awaiting_handover' || typeof transaction.scheduledAt !== 'number' || !Number.isFinite(transaction.scheduledAt) || transaction.buyerResult === 'failure' || transaction.sellerResult === 'failure' || now >= deadline(transaction)) return 0
  let sent = 0
  const patch = {}
  if (!transaction.nearRemindedAt && now >= transaction.scheduledAt - NEAR_WINDOW_MS && now <= transaction.scheduledAt) {
    await appendReminder(tx, transaction, 'near', now)
    patch.nearRemindedAt = now; sent++
  }
  if (!transaction.resultRemindedAt && now >= transaction.scheduledAt) {
    await appendReminder(tx, transaction, 'result', now)
    patch.resultRemindedAt = now; sent++
  }
  // A late scan skips the stale near reminder instead of replaying every missed event.
  patch.nextReminderAt = transaction.resultRemindedAt || patch.resultRemindedAt ? null : transaction.nearRemindedAt || patch.nearRemindedAt || now > transaction.scheduledAt ? transaction.scheduledAt : transaction.scheduledAt - NEAR_WINDOW_MS
  await tx.updateTransaction(transaction._id, patch)
  return sent
}

async function processAppointmentReminders({ transactionId, transactions, now, clock = () => now }) {
  return transactions.runTransaction(async tx => remindInTransaction(tx, await tx.getTransaction(transactionId), clock()))
}
module.exports = { NEAR_WINDOW_MS, processAppointmentReminders, remindInTransaction }
