const { respondTransaction, withdrawTransaction, reviseTransaction } = require('../../services/transactions')
const { getTransactionStatusLabel } = require('../../services/transaction-state')
const { CAMPUSES } = require('../../config/market')
const { createChatState, reduceChatState, startPolling } = require('../../services/chat-state')
const { listMessages, markRead, sendMessage, syncMessageBadge } = require('../../services/conversations')
const { requireCompletedProfile } = require('../../services/user')

Page({
  data: { messages: [], draft: '', loading: true, sending: false, error: '', canCreateTransaction: false, conversation: null, imageError: false, cardBusy: false, editingMessageId: '', editForm: {}, campuses: CAMPUSES },
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
  sync() {
    const latest = new Map()
    for (const message of this.state.messages) if (message.transactionId) latest.set(message.transactionId, message._id)
    const messages = this.state.messages.map(item => {
      const current = item.currentTransaction
      const isLatest = latest.get(item.transactionId) === item._id
      const card = isLatest && current ? current : item.transactionCard
      const pending = isLatest && current && current.status === 'pending_seller'
      return { ...item, mine: item.senderId === this.userId,
        canRespond: Boolean(pending && current.sellerId === this.userId),
        canRevise: Boolean(pending && current.buyerId === this.userId),
        transactionCard: card ? { ...card, statusLabel: getTransactionStatusLabel(card.status),
          campusName: (CAMPUSES.find(campus => campus.id === card.campusId) || {}).name || '',
          scheduledText: this.formatAppointment(card.scheduledAt) } : null }
    })
    this.setData({ messages, draft: this.state.draft, loading: this.state.loading, sending: this.state.sending, error: this.state.error })
  },
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
  async actOnCard(event) {
    if (this.data.cardBusy) return
    const { id, action } = event.currentTarget.dataset
    const message = this.data.messages.find(item => item.transactionId === id && ((action === 'confirm' || action === 'reject') ? item.canRespond : item.canRevise))
    if (!message || !['confirm', 'reject', 'withdraw'].includes(action)) return
    this.setData({ cardBusy: true })
    try {
      const confirmed = await new Promise(resolve => wx.showModal({
        title: action === 'confirm' ? '接受预约' : action === 'reject' ? '拒绝预约' : '撤回预约',
        content: action === 'confirm' ? '接受后将预留商品库存，是否继续？' : '确定执行此操作吗？',
        success: result => resolve(result.confirm), fail: () => resolve(false),
      }))
      if (!confirmed) return
      this.cardRequestIds = this.cardRequestIds || {}
      const key = id + ':' + action
      const requestId = this.cardRequestIds[key] || (this.cardRequestIds[key] = Date.now() + '-' + Math.random().toString(36).slice(2))
      if (action === 'withdraw') await withdrawTransaction(id, '', requestId)
      else await respondTransaction(id, action, '', requestId)
      delete this.cardRequestIds[key]
      this.setData({ editingMessageId: '' })
      await this.fetchLatest()
    } catch (error) { wx.showToast({ title: error.message || '操作失败，请重试', icon: 'none' }); await this.fetchLatest() }
    finally { this.setData({ cardBusy: false }) }
  },
  editCard(event) {
    if (this.data.cardBusy) return
    const message = this.data.messages.find(item => item._id === event.currentTarget.dataset.message)
    if (!message || !message.canRevise) return
    const transaction = message.currentTransaction
    const parts = this.formatAppointment(transaction.scheduledAt).split(' ')
    const campusIndex = CAMPUSES.findIndex(campus => campus.id === transaction.campusId)
    this.editRequestId = ''
    this.editingTransactionId = transaction._id
    this.setData({ editingMessageId: message._id, editForm: {
      quantity: transaction.quantity, locationText: transaction.locationText,
      campusId: transaction.campusId, campusIndex, date: parts[0], time: parts[1],
    } })
  },
  patchCardEdit(event) {
    if (this.data.cardBusy) return
    const field = event.currentTarget.dataset.field
    const patch = { [field]: field === 'quantity' || field === 'campusIndex' ? Number(event.detail.value) : event.detail.value }
    if (field === 'campusIndex') patch.campusId = (CAMPUSES[patch.campusIndex] || {}).id || ''
    this.editRequestId = ''
    this.setData({ editForm: { ...this.data.editForm, ...patch } })
  },
  cancelCardEdit() { if (!this.data.cardBusy) this.setData({ editingMessageId: '' }) },
  async saveCardEdit() {
    if (this.data.cardBusy || !this.data.editingMessageId) return
    this.setData({ cardBusy: true })
    try {
      const form = this.data.editForm
      const scheduledAt = new Date((form.date + ' ' + form.time).replace(/-/g, '/')).getTime()
      this.editRequestId = this.editRequestId || Date.now() + '-' + Math.random().toString(36).slice(2)
      await reviseTransaction(this.editingTransactionId, { quantity: Number(form.quantity), campusId: form.campusId, locationText: form.locationText, scheduledAt }, this.editRequestId)
      this.editRequestId = ''
      this.setData({ editingMessageId: '' })
      await this.fetchLatest()
    } catch (error) { wx.showToast({ title: error.message || '修改失败，请重试', icon: 'none' }); await this.fetchLatest() }
    finally { this.setData({ cardBusy: false }) }
  },
  openTransaction(event) { wx.navigateTo({ url: '/pages/transaction-detail/index?transactionId=' + event.currentTarget.dataset.id }) },
  createTransaction() { if (!this.data.canCreateTransaction) return; wx.navigateTo({ url: `/pages/transaction-create/index?conversationId=${this.conversationId}` }) },
})
