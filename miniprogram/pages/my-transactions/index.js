const { getTransactionStatusLabel } = require('../../services/transaction-state')
const { listTransactions } = require('../../services/transactions')
const { requireCompletedProfile } = require('../../services/user')

Page({
  data: { role: 'buyer', roleName: '我买到的', state: 'loading', error: '', transactions: [], pendingCounts: { buyer: 0, seller: 0 } },
  async onShow() { const user = await requireCompletedProfile(); if (!user) return; await this.load() },
  async load() { this.setData({ state: 'loading' }); try { const result = await listTransactions(this.data.role, '', null, 20); this.setData({ state: 'ready', transactions: result.transactions.map((item) => ({ ...item, statusLabel: getTransactionStatusLabel(item.status), scheduledText: new Date(Number(item.scheduledAt)).toLocaleString() })), pendingCounts: result.pendingCounts }) } catch (error) { this.setData({ state: 'error', error: error.message }) } },
  switchRole(event) { const role = event.currentTarget.dataset.role; this.setData({ role, roleName: role === 'buyer' ? '我买到的' : '我卖出的' }); this.load() },
  open(event) { wx.navigateTo({ url: `/pages/transaction-detail/index?transactionId=${event.currentTarget.dataset.id}` }) },
})
