const STATUS_LABELS = {
  pending_seller: '待卖家确认',
  awaiting_handover: '待交接',
  completed: '交易完成',
  failed: '交易失败',
  abnormal: '交接结果不一致',
  cancelled: '已取消',
}

function createTransactionState({ conversationId = '', campusId = '' } = {}) {
  return { conversationId, status: 'idle', error: '', requestId: '', transaction: null, form: { quantity: 1, campusId, locationText: '', scheduledAt: '' } }
}

function reduceTransactionState(state, event) {
  switch (event.type) {
    case 'PATCH_FORM': return { ...state, error: '', form: { ...state.form, ...event.patch } }
    case 'SUBMIT_START': return state.status === 'submitting' ? state : { ...state, status: 'submitting', error: '', requestId: state.requestId || event.requestId }
    case 'SUBMIT_SUCCESS': return { ...state, status: 'success', error: '', requestId: '', transaction: event.transaction }
    case 'FAILURE': return { ...state, status: 'error', error: event.message || '操作失败，请重试' }
    default: return state
  }
}

function getTransactionActions(transaction, userId, now) {
  const role = transaction.buyerId === userId ? 'buyer' : transaction.sellerId === userId ? 'seller' : ''
  if (!role) return []
  if (transaction.status === 'pending_seller') return role === 'buyer' ? ['withdraw'] : ['confirm', 'reject']
  if (transaction.status === 'awaiting_handover' && now < Number(transaction.scheduledAt)) return transaction[role + 'Result'] ? [] : ['cancel', 'failure']
  if (['awaiting_handover', 'failed'].includes(transaction.status) && !transaction[role + 'Result']) return now >= Number(transaction.scheduledAt) ? ['success', 'failure'] : ['failure']
  return []
}

function getTransactionStatusLabel(status) { return STATUS_LABELS[status] || status }

function getAutoCompleteAt(transaction) {
  const duration = Number.isFinite(transaction.autoCompleteAfterMs) && transaction.autoCompleteAfterMs > 0 ? transaction.autoCompleteAfterMs : 3600000
  return typeof transaction.scheduledAt === 'number' ? transaction.scheduledAt + duration : null
}

function getAppointmentProgress(transaction, now, eventText = '') {
  const status = transaction.status
  const autoCompleteAt = getAutoCompleteAt(transaction)
  if (status === 'pending_seller') return { title: '待确认', detail: '待卖家确认预约清单' }
  if (status === 'awaiting_handover') {
    if (transaction.buyerResult === 'success' || eventText.includes('买家已确认交接成功')) return { autoCompleteAt, title: '待确认', detail: '买家已确认成功，待卖家确认交接结果' }
    if (transaction.sellerResult === 'success' || eventText.includes('卖家已确认交接成功')) return { autoCompleteAt, title: '待确认', detail: '卖家已确认成功，待买家确认交接结果' }
    return { autoCompleteAt, title: '待交接', detail: now < Number(transaction.scheduledAt) ? '预约已确认，请按约定时间和地点交接' : '已到约定时间，待双方提交交接结果' }
  }
  if (status === 'completed') return { title: '已完成', detail: transaction.completionSource === 'timeout' ? '已到自动完成截止时间，无失败反馈，已自动完成' : '买卖双方均已确认交接成功' }
  if (status === 'cancelled') {
    const detail = transaction.cancelType === 'seller_rejected' || eventText.includes('卖家已拒绝') ? '卖家已拒绝预约，可重新协商后发起' : transaction.cancelType === 'buyer_withdrew' || eventText.includes('买家已撤回') ? '买家已撤回预约，可重新发起' : '预约已取消，可重新协商后发起'
    return { title: '已取消', detail: transaction.cancelReason ? `${detail}；原因：${transaction.cancelReason}` : detail }
  }
  if (status === 'failed') return { title: '交易失败', detail: transaction.buyerResult === 'failure' ? '买家反馈交接失败，本次预约已结束' : transaction.sellerResult === 'failure' ? '卖家反馈交接失败，本次预约已结束' : '已收到交接失败反馈，本次预约已结束' }
  if (status === 'abnormal') return { title: '交接结果不一致', detail: '买卖双方交接结果不一致，请核实情况' }
  return { title: getTransactionStatusLabel(status), detail: eventText }
}

function getPostManagementActions(post) {
  if ((post.direction || 'provide') === 'provide' && (post.contentType || 'item') === 'item' && (post.status === 'sold' || (post.availableQuantity === 0 && !post.reservedQuantity && post.soldQuantity > 0))) return ['republish']
  const actions = ['edit']
  if (post.status === 'active' && (post.direction === 'need' || post.contentType === 'service' || post.availableQuantity > 0)) actions.push('downlist')
  if (post.status === 'offline' && (post.direction === 'need' || post.contentType === 'service' || post.availableQuantity > 0)) actions.push('relist')
  return actions
}

function derivePendingCounts(rows, userId) {
  const active = ['pending_seller', 'awaiting_handover']
  return (rows || []).reduce((counts, item) => {
    if (!active.includes(item.status)) return counts
    if (item.buyerId === userId) counts.buyer += 1
    if (item.sellerId === userId) counts.seller += 1
    return counts
  }, { buyer: 0, seller: 0 })
}

module.exports = { getAutoCompleteAt, getAppointmentProgress, createTransactionState, derivePendingCounts, getPostManagementActions, getTransactionActions, getTransactionStatusLabel, reduceTransactionState }
