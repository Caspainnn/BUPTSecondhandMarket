const { listConversations, syncMessageBadge } = require('../../services/conversations')
const { requireCompletedProfile } = require('../../services/user')

Page({
  data: { state: 'loading', error: '', conversations: [], totalUnread: 0 },
  async onShow() {
    this.setData({ state: 'loading', error: '' })
    try {
      const user = await requireCompletedProfile()
      if (!user) return
      const result = await listConversations(null, 20)
      const conversations = result.conversations.map((item) => ({
        ...item,
        peer: item.buyerId === user._id ? item.sellerSnapshot : item.buyerSnapshot,
        unread: item.buyerId === user._id ? item.buyerUnread : item.sellerUnread,
      }))
      this.setData({ state: 'ready', conversations, totalUnread: result.totalUnread })
      syncMessageBadge(result.totalUnread)
    } catch (error) { this.setData({ state: 'error', error: error.message || '消息加载失败' }) }
  },
  openConversation(event) { wx.navigateTo({ url: `/pages/conversation/index?conversationId=${event.currentTarget.dataset.id}` }) },
  retry() { this.onShow() },
})
