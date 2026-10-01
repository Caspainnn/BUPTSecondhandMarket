const { getTransactionStatusLabel } = require('../../services/transaction-state')
const { CAMPUSES } = require('../../config/market')
const { createChatState, reduceChatState, startPolling } = require('../../services/chat-state')
const { listMessages, markRead, sendMessage, syncMessageBadge } = require('../../services/conversations')
const { requireCompletedProfile } = require('../../services/user')

Page({
  data: { messages: [], draft: '', loading: true, sending: false, error: '', canCreateTransaction: false, conversation: null, imageError: false },
  onLoad(options) { this.conversationId = options.conversationId; this.state = createChatState(this.conversationId); this.sync() },
  async onShow() {
    const user = await requireCompletedProfile()
    if (!user) return
    this.userId = user._id
    const conversation = getApp().globalData.currentConversation
    this.setData({ conversation: conversation && conversation._id === this.conversationId ? conversation : null, imageError: false, canCreateTransaction: Boolean(conversation && conversation._id === this.conversationId && conversation.buyerId === user._id) })
    this.stopPolling()
    this.stop = startPolling(() => this.fetchLatest(), 3000)
  },
  onHide() { this.stopPolling() },
  onUnload() { this.stopPolling() },
  stopPolling() { if (this.stop) { this.stop(); this.stop = null } },
  sync() { this.setData({ messages: this.state.messages.map((item) => ({ ...item, mine: item.senderId === this.userId, transactionCard: item.transactionCard ? { ...item.transactionCard, statusLabel: getTransactionStatusLabel(item.transactionCard.status), campusName: (CAMPUSES.find(campus => campus.id === item.transactionCard.campusId) || {}).name || '', scheduledText: this.formatAppointment(item.transactionCard.scheduledAt) } : null })), draft: this.state.draft, loading: this.state.loading, sending: this.state.sending, error: this.state.error }) },
  apply(event) { this.state = reduceChatState(this.state, event); this.sync() },
  onDraft(event) { this.apply({ type: 'DRAFT_CHANGE', value: event.detail.value }) },
  async fetchLatest() {
    const conversationId = this.conversationId
    try {
      const result = await listMessages(conversationId, null, 50)
      this.apply({ type: 'MESSAGES_SUCCESS', conversationId, messages: result.messages, nextBefore: result.nextBefore })
      const read = await markRead(conversationId)
      this.apply({ type: 'MARK_READ_SUCCESS', conversationId, totalUnread: read.totalUnread })
      syncMessageBadge(read.totalUnread)
    } catch (error) { this.apply({ type: 'FAILURE', operation: 'load', message: error.message }) }
  },
  async loadOlder() {
    if (this.state.loading || this.state.exhausted) return
    this.apply({ type: 'LOAD_START' })
    try {
      const result = await listMessages(this.conversationId, this.state.nextBefore, 20)
      this.apply({ type: 'MESSAGES_SUCCESS', conversationId: this.conversationId, messages: result.messages, nextBefore: result.nextBefore })
    } catch (error) { this.apply({ type: 'FAILURE', operation: 'load', message: error.message }) }
  },
  async submit() {
    if (this.state.sending || !this.state.draft.trim()) return
    const requestId = this.state.requestId || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.apply({ type: 'SEND_START', requestId })
    try {
      const result = await sendMessage(this.conversationId, this.state.draft, this.state.requestId)
      this.apply({ type: 'SEND_SUCCESS', conversationId: this.conversationId, message: result.message })
    } catch (error) { this.apply({ type: 'FAILURE', operation: 'send', message: error.message }) }
  },
  onImageError(event) { this.setData({ imageError: true }); console.warn('商品图片加载失败', event.detail.errMsg || '未知错误') },
  openPost() { if (this.data.conversation) wx.navigateTo({ url: '/pages/post-detail/index?postId=' + this.data.conversation.postId }) },
  formatAppointment(timestamp) {
    const date = new Date(timestamp)
    const pad = value => String(value).padStart(2, '0')
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
  },
  openTransaction(event) { wx.navigateTo({ url: '/pages/transaction-detail/index?transactionId=' + event.currentTarget.dataset.id }) },
  createTransaction() { if (!this.data.canCreateTransaction) return; wx.navigateTo({ url: `/pages/transaction-create/index?conversationId=${this.conversationId}` }) },
})
