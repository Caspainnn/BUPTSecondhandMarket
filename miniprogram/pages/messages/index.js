const { listConversations, syncMessageBadge } = require('../../services/conversations')
const { requireCompletedProfile } = require('../../services/user')

Page({
  data: { state: 'loading', error: '', conversations: [], totalUnread: 0 },
  async onShow() {
    this.stopPolling()
    const token = this.visibleToken = {}
    try {
      const user = await requireCompletedProfile()
      if (!user || this.visibleToken !== token) return
      this.userId = user._id
      await this.refresh()
      if (this.visibleToken === token) this.timer = setInterval(() => this.refresh(), 5000)
    } catch (error) {
      console.warn('Message list initialization failed', error)
      if (this.visibleToken === token && this.data.state !== 'ready') this.setData({ state: 'error', error: '消息暂时未能加载，请重试' })
    }
  },
  onHide() { this.stopPolling() },
  onUnload() { this.stopPolling() },
  stopPolling() { this.visibleToken = null; if (this.timer) { clearInterval(this.timer); this.timer = null } },
  async refresh() {
    if (!this.visibleToken || this.refreshing) return
    const token = this.visibleToken
    this.refreshing = true
    try {
      const result = await listConversations(null, 20)
      if (this.visibleToken !== token) return
      const messageTime = item => { const value = item.lastMessageAt === undefined ? item.createdAt : item.lastMessageAt; const time = typeof value === 'number' ? value : new Date(value).getTime(); return Number.isFinite(time) ? time : 0 }
      const conversations = [...result.conversations].sort((a, b) => messageTime(b) - messageTime(a) || (a._id < b._id ? 1 : a._id > b._id ? -1 : 0)).map(item => ({
        ...item,
        peer: item.buyerId === this.userId ? item.sellerSnapshot : item.buyerSnapshot,
        unread: item.buyerId === this.userId ? item.buyerUnread : item.sellerUnread,
      }))
      this.setData({ state: 'ready', error: '', conversations, totalUnread: result.totalUnread })
      syncMessageBadge(result.totalUnread)
    } catch (error) {
      console.warn('Message list refresh failed', error)
      if (this.visibleToken === token && this.data.state !== 'ready') this.setData({ state: 'error', error: '消息暂时未能加载，请重试' })
    } finally { this.refreshing = false }
  },
  openConversation(event) { const conversation = this.data.conversations.find(item => item._id === event.currentTarget.dataset.id); getApp().globalData.currentConversation = conversation; wx.navigateTo({ url: `/pages/conversation/index?conversationId=${event.currentTarget.dataset.id}` }) },
  retry() { this.onShow() },
})
