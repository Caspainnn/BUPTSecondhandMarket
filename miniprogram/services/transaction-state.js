const STATUS_LABELS = {
  pending_seller: '待卖家确认',
  awaiting_handover: '待交接',
  completed: '交易完成',
  failed: '交接失败',
  abnormal: '结果异常',
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
  if (transaction.status === 'awaiting_handover' && now < Number(transaction.scheduledAt)) return ['cancel']
  if (['awaiting_handover', 'failed'].includes(transaction.status) && now >= Number(transaction.scheduledAt) && !transaction[`${role}Result`]) return ['success', 'failure']
  return []
}

function getTransactionStatusLabel(status) { return STATUS_LABELS[status] || status }

function getPostManagementActions(post) {
  const actions = ['edit']
  if (post.status === 'active' && post.availableQuantity > 0) actions.push('downlist')
  if (post.status === 'offline' && post.availableQuantity > 0) actions.push('relist')
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

module.exports = { createTransactionState, derivePendingCounts, getPostManagementActions, getTransactionActions, getTransactionStatusLabel, reduceTransactionState }
