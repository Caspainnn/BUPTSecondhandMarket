const { getTransactionStatusLabel } = require('../../services/transaction-state')
const { listTransactions } = require('../../services/transactions')
const { requireCompletedProfile } = require('../../services/user')

Page({
  data: { mode: 'completed', nextCursor: null, role: 'buyer', roleName: '我买到的', state: 'loading', error: '', transactions: [], pendingCounts: { buyer: 0, seller: 0 } },
  onLoad(options) { if (options.mode === 'all') { this.setData({ mode: 'all' }); wx.setNavigationBarTitle({ title: '全部订单' }) } },
  async onShow() { const user = await requireCompletedProfile(); if (!user) return; await this.load() },
  async load() { this.setData({ state: 'loading' }); try { const result = await listTransactions(this.data.role, this.data.mode === 'all' ? '' : 'completed', null, 20); this.setData({ state: 'ready', transactions: result.transactions.map((item) => ({ ...item, statusLabel: getTransactionStatusLabel(item.status), scheduledText: new Date(Number(item.scheduledAt)).toLocaleString() })), nextCursor: result.nextCursor, pendingCounts: result.pendingCounts }) } catch (error) { this.setData({ state: 'error', error: error.message }) } },
  async more() {
    if (!this.data.nextCursor || this.loadingMore) return
    this.loadingMore = true
    const role = this.data.role
    try { const result = await listTransactions(role, this.data.mode === 'all' ? '' : 'completed', this.data.nextCursor, 20); if (this.data.role === role) this.setData({ transactions: [...this.data.transactions, ...result.transactions.map(item => ({ ...item, statusLabel: getTransactionStatusLabel(item.status), scheduledText: new Date(Number(item.scheduledAt)).toLocaleString() }))], nextCursor: result.nextCursor }) }
    catch (error) { console.warn('Orders pagination failed', error); wx.showToast({ title: '暂时未能加载，请重试', icon: 'none' }) }
    finally { this.loadingMore = false }
  },
  switchRole(event) { const role = event.currentTarget.dataset.role; this.setData({ role, roleName: role === 'buyer' ? '我买到的' : '我卖出的' }); this.load() },
  open(event) { wx.navigateTo({ url: `/pages/transaction-detail/index?transactionId=${event.currentTarget.dataset.id}` }) },
})
