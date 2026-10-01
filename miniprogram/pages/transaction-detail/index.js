const { getTransactionActions, getTransactionStatusLabel } = require('../../services/transaction-state')
const { cancelTransaction, getTransaction, respondTransaction, submitResult, withdrawTransaction } = require('../../services/transactions')
const { requireCompletedProfile } = require('../../services/user')

const askReason = (title) => new Promise((resolve) => wx.showModal({ title, editable: true, placeholderText: '请输入原因（2–200 字）', success: (result) => resolve(result.confirm ? result.content : null), fail: () => resolve(null) }))

const formatTime = value => {
  const date = new Date(value)
  if (value === null || value === undefined || Number.isNaN(date.getTime())) return '时间未记录'
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const eventLabel = (event, transaction) => {
  const role = event.actorId === transaction.buyerId ? '买家' : event.actorId === transaction.sellerId ? '卖家' : '参与者'
  const labels = { created: '买家发起预约', modified: '买家修改预约', confirmed: '卖家接受预约', seller_rejected: '卖家拒绝预约', buyer_withdrew: '买家撤回预约', participant_cancelled: `${role}取消交易`, buyer_result_success: '买家确认交接成功', seller_result_success: '卖家确认交接成功', buyer_result_failed: '买家反馈交接失败', seller_result_failed: '卖家反馈交接失败', buyer_result_failure: '买家反馈交接失败', seller_result_failure: '卖家反馈交接失败' }
  return labels[event.type] || '交易状态更新'
}

Page({
  data: { state: 'loading', error: '', transaction: null, events: [], actions: [], statusLabel: '', scheduledText: '', busy: false },
  async onLoad(options) { this.transactionId = options.transactionId; this.operationRequestIds = {}; const user = await requireCompletedProfile(); if (!user) return; this.userId = user._id; await this.load() },
  async onShow() { if (this.userId && this.data.transaction) await this.load() },
  async load() {
    this.setData({ state: 'loading', error: '' })
    try { const result = await getTransaction(this.transactionId); const transaction = result.transaction; this.setData({ state: 'ready', transaction, events: (result.events || []).map(event => ({ ...event, label: eventLabel(event, transaction), timeText: formatTime(event.createdAt) })), actions: getTransactionActions(transaction, this.userId, Date.now()), statusLabel: getTransactionStatusLabel(transaction.status), scheduledText: formatTime(transaction.scheduledAt) }) }
    catch (error) { this.setData({ state: 'error', error: error.message }) }
  },
  async act(event) {
    if (this.data.busy) return
    const action = event.currentTarget.dataset.action
    let reason = ''
    if (['withdraw', 'reject', 'cancel'].includes(action)) { reason = await askReason(action === 'cancel' ? '取消交易' : action === 'reject' ? '拒绝交易' : '撤回交易'); if (reason === null) return }
    this.setData({ busy: true })
    try {
      const operationRequestId = this.operationRequestIds[action] || `${Date.now()}-${Math.random().toString(36).slice(2)}`
      this.operationRequestIds[action] = operationRequestId
      if (action === 'withdraw') await withdrawTransaction(this.transactionId, reason, operationRequestId)
      else if (action === 'confirm' || action === 'reject') await respondTransaction(this.transactionId, action, reason, operationRequestId)
      else if (action === 'cancel') await cancelTransaction(this.transactionId, reason, operationRequestId)
      else await submitResult(this.transactionId, action, operationRequestId)
      delete this.operationRequestIds[action]
      await this.load()
    } catch (error) { wx.showToast({ title: error.message, icon: 'none' }) }
    finally { this.setData({ busy: false }) }
  },
})
