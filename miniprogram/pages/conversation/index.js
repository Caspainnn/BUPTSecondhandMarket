const { respondTransaction, withdrawTransaction, reviseTransaction, submitResult } = require('../../services/transactions')
const { getAppointmentProgress, getTransactionActions, getTransactionStatusLabel } = require('../../services/transaction-state')
const { CAMPUSES, SERVICE_APPOINTMENT_CAMPUSES } = require('../../config/market')
const { createChatState, reduceChatState, startPolling } = require('../../services/chat-state')
const { listMessages, markRead, sendMessage, sendPostCard, syncMessageBadge } = require('../../services/conversations')
const { listMyPosts } = require('../../services/posts')
const { formatPrice } = require('../../services/post-list-state')
const { requireCompletedProfile } = require('../../services/user')

Page({
  data: { cardPickerOpen: false, cardPosts: [], cardNextCursor: null, cardLoading: false, cardSending: false, keyboardHeight: 0, scrollTarget: '', messages: [], draft: '', loading: true, sending: false, error: '', canCreateTransaction: false, conversation: null, peer: null, peerRole: '', imageError: false, cardBusy: false, editingMessageId: '', editForm: {}, campuses: CAMPUSES },
  onLoad(options) { this.conversationId = options.conversationId; this.state = createChatState(this.conversationId); this.sync() },
  async onShow() {
    const user = await requireCompletedProfile()
    if (!user) return
    this.userId = user._id
    const conversation = getApp().globalData.currentConversation
    const active = conversation && conversation._id === this.conversationId ? conversation : null
    const isBuyer = Boolean(active && active.buyerId === user._id)
    this.setData({ peer: active ? (isBuyer ? active.sellerSnapshot : active.buyerSnapshot) : null, peerRole: active ? (isBuyer ? '卖家' : '买家') : '', conversation: conversation && conversation._id === this.conversationId ? conversation : null, imageError: false, canCreateTransaction: Boolean(conversation && conversation._id === this.conversationId && conversation.buyerId === user._id) })
    if (this.state) this.sync()
    this.stopPolling()
    this.stop = startPolling(() => this.fetchLatest(), 3000)
  },
  onHide() { this.stopPolling(); this.setData({ keyboardHeight: 0 }) },
  onUnload() { this.stopPolling() },
  stopPolling() { if (this.stop) { this.stop(); this.stop = null } },
  sync(callback) {
    const latest = new Map()
    for (const message of this.state.messages) if (message.transactionId) latest.set(message.transactionId, message._id)
    const messages = this.state.messages.map(item => {
      const current = item.currentTransaction
      const isLatest = latest.get(item.transactionId) === item._id
      const card = isLatest && current ? current : item.transactionCard
      const pending = isLatest && current && current.status === 'pending_seller'
      const actions = isLatest && current ? getTransactionActions(current, this.userId, Date.now()) : []
      const participants = current || this.data.conversation || {}
      const actorId = item.actorId || (item.senderId !== 'system' ? item.senderId : item.recipientId === participants.buyerId ? participants.sellerId : item.recipientId === participants.sellerId ? participants.buyerId : '')
      const roleLabel = actorId === participants.buyerId ? '买家' : actorId === participants.sellerId ? '卖家' : ''
      const senderLabel = actorId === this.userId ? (roleLabel ? '你（' + roleLabel + '）' : '你') : roleLabel || '预约动态'
      return { ...item, senderLabel, canResult: actions.includes('success') || actions.includes('failure'), successDisabled: !actions.includes('success'), mine: actorId === this.userId, canReservePost: Boolean(item.postCard && this.data.conversation && this.data.conversation.buyerId === this.userId && actorId === this.data.conversation.sellerId && item.postCard.direction !== 'need' && item.postCard.contentType !== 'service'), postCard: item.postCard ? { ...item.postCard, priceLabel: formatPrice(item.postCard.unitPriceCents) } : null,
        canRespond: Boolean(pending && current.sellerId === this.userId),
        canRevise: Boolean(pending && current.buyerId === this.userId),
        transactionCard: card ? { ...card, progress: getAppointmentProgress(card, Date.now(), item.text || ''), statusLabel: card.status === 'cancelled' && card.cancelType === 'seller_rejected' ? '卖家已拒绝交易' : card.status === 'cancelled' && card.cancelType === 'buyer_withdrew' ? '买家已撤回预约' : getTransactionStatusLabel(card.status), progressTone: ['failed', 'abnormal', 'cancelled'].includes(card.status) ? 'alert' : card.status === 'completed' ? 'success' : 'pending',
          campusName: card.fulfillmentMode === 'online' ? '线上' : (CAMPUSES.find(campus => campus.id === card.campusId) || {}).name || '',
          scheduledText: this.formatAppointment(card.scheduledAt) } : null }
    })
    this.setData({ messages, loading: this.state.loading, sending: this.state.sending, error: this.state.error }, callback)
  },
  apply(event) {
    const previous = this.state.messages[this.state.messages.length - 1]
    this.state = reduceChatState(this.state, event)
    if (event.type === 'SEND_SUCCESS' && event.conversationId === this.conversationId && !this.state.draft) this.setData({ draft: '', hasDraft: false })
    const latest = this.state.messages[this.state.messages.length - 1]
    const received = event.type === 'MESSAGES_SUCCESS' && !this.loadingOlder && latest && (!previous || previous._id !== latest._id)
    const follow = event.type === 'SEND_SUCCESS' || (received && this.atBottom !== false)
    this.sync(() => { if (follow) this.scrollToBottom(); else if (received) this.setData({ hasNewMessages: true }) })
  },
  scrollToBottom() {
    this.atBottom = true
    this.setData({ scrollTarget: '', hasNewMessages: false }, () => this.setData({ scrollTarget: 'bottom-anchor' }))
  },
  onHistoryTouchStart() { this.historyTouching = true },
  onHistoryTouchEnd() { this.historyTouching = false },
  onHistoryScroll(event) { if (this.historyTouching && event.detail.deltaY < 0) this.atBottom = false },
  onHistoryBottom() { this.atBottom = true; this.setData({ hasNewMessages: false }) },
  onKeyboardHeight(event) {
    const keyboardHeight = Math.max(0, Number(event.detail.height) || 0)
    this.setData({ keyboardHeight }, () => { if (keyboardHeight > 0) this.scrollToBottom() })
  },
  onInputBlur() { this.setData({ keyboardHeight: 0 }) },
  onDraft(event) {
    this.state = reduceChatState(this.state, { type: 'DRAFT_CHANGE', value: event.detail.value })
    this.setData({ hasDraft: Boolean(event.detail.value.trim()), error: '' })
  },
  async fetchLatest() {
    if (this.fetchingLatest) return
    this.fetchingLatest = true
    const conversationId = this.conversationId
    try {
      const result = await listMessages(conversationId, null, 50)
      this.apply({ type: 'MESSAGES_SUCCESS', conversationId, messages: result.messages, nextBefore: result.nextBefore })
      try {
        const read = await markRead(conversationId)
        this.apply({ type: 'MARK_READ_SUCCESS', conversationId, totalUnread: read.totalUnread })
        syncMessageBadge(read.totalUnread)
      } catch (error) { console.warn('Conversation read receipt failed', error) }
    } catch (error) { console.warn('Conversation refresh failed', error); this.apply({ type: 'FAILURE', operation: 'load', message: '消息暂时未能刷新，请稍后重试' }) }
    finally { this.fetchingLatest = false }
  },
  async loadOlder() {
    if (this.state.loading || this.state.exhausted) return
    this.loadingOlder = true
    this.apply({ type: 'LOAD_START' })
    try {
      const result = await listMessages(this.conversationId, this.state.nextBefore, 20)
      this.apply({ type: 'MESSAGES_SUCCESS', conversationId: this.conversationId, messages: result.messages, nextBefore: result.nextBefore })
    } catch (error) { console.warn('Conversation refresh failed', error); this.apply({ type: 'FAILURE', operation: 'load', message: '消息暂时未能刷新，请稍后重试' }) }
    finally { this.loadingOlder = false }
  },
  async submit() {
    if (this.state.sending || !this.state.draft.trim()) return
    const requestId = this.state.requestId || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.apply({ type: 'SEND_START', requestId })
    try {
      const result = await sendMessage(this.conversationId, this.state.draft, this.state.requestId)
      this.apply({ type: 'SEND_SUCCESS', conversationId: this.conversationId, message: result.message })
      await this.fetchLatest()
    } catch (error) { console.warn('Conversation send failed', error); this.apply({ type: 'FAILURE', operation: 'send', message: '消息未发送，请重试' }); wx.showToast({ title: '消息未发送，请重试', icon: 'none' }) }
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
    if (['success', 'failure'].includes(action)) {
      const message = this.data.messages.find(item => item.transactionId === id && item.canResult)
      if (!message || (action === 'success' && message.successDisabled)) return
      this.setData({ cardBusy: true })
      try {
        const confirmed = await new Promise(resolve => wx.showModal({ title: action === 'success' ? '确认交接成功' : '确认交接失败', content: action === 'success' ? '请确认已完成交接，提交后不可修改。' : '提交失败后预约结束，结果不可修改。', success: result => resolve(result.confirm), fail: () => resolve(false) }))
        if (!confirmed) return
        this.cardRequestIds = this.cardRequestIds || {}
        const key = id + ':' + action
        const requestId = this.cardRequestIds[key] || (this.cardRequestIds[key] = Date.now() + '-' + Math.random().toString(36).slice(2))
        await submitResult(id, action, requestId)
        delete this.cardRequestIds[key]
        await this.fetchLatest()
      } catch (error) { console.warn('Handover result failed', error); wx.showToast({ title: '操作未完成，请刷新后重试', icon: 'none' }); await this.fetchLatest() }
      finally { this.setData({ cardBusy: false }) }
      return
    }
    const message = this.data.messages.find(item => item.transactionId === id && ((action === 'confirm' || action === 'reject') ? item.canRespond : item.canRevise))
    if (!message || !['confirm', 'reject', 'withdraw'].includes(action)) return
    this.setData({ cardBusy: true })
    try {
      const confirmed = await new Promise(resolve => wx.showModal({
        title: action === 'confirm' ? '接受预约' : action === 'reject' ? '拒绝预约' : '撤回预约',
        content: action === 'confirm' ? '确认接受这份预约清单？' : '确定执行此操作吗？',
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
    const campuses = transaction.postSnapshot.contentType === 'service' ? SERVICE_APPOINTMENT_CAMPUSES : CAMPUSES
    const campusIndex = campuses.findIndex(campus => campus.id === transaction.campusId)
    this.setData({ campuses, editingService: transaction.postSnapshot.contentType === 'service', editingNeed: transaction.postSnapshot.direction === 'need' })
    this.editRequestId = ''
    this.editingTransactionId = transaction._id
    this.setData({ editingMessageId: message._id, editForm: {
      quantity: transaction.quantity, locationText: transaction.locationText, itemDescription: transaction.itemDescription || '', fulfillmentMode: transaction.fulfillmentMode || 'offline',
      campusId: transaction.campusId, campusIndex, date: parts[0], time: parts[1],
    } })
  },
  patchCardEdit(event) {
    if (this.data.cardBusy) return
    const field = event.currentTarget.dataset.field
    const patch = { [field]: field === 'quantity' || field === 'campusIndex' ? Number(event.detail.value) : event.detail.value }
    if (field === 'campusIndex') { patch.campusId = (this.data.campuses[patch.campusIndex] || {}).id || ''; patch.fulfillmentMode = patch.campusId === '' ? 'online' : 'offline' }
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
      await reviseTransaction(this.editingTransactionId, { itemDescription: form.itemDescription, fulfillmentMode: form.fulfillmentMode, quantity: Number(form.quantity), campusId: form.campusId, locationText: form.locationText, scheduledAt }, this.editRequestId)
      this.editRequestId = ''
      this.setData({ editingMessageId: '' })
      await this.fetchLatest()
    } catch (error) { wx.showToast({ title: error.message || '修改失败，请重试', icon: 'none' }); await this.fetchLatest() }
    finally { this.setData({ cardBusy: false }) }
  },
  async openCardPicker() { if (this.data.cardSending) return; this.setData({ cardPickerOpen: true, cardPosts: [], cardNextCursor: null }); await this.loadCardPosts(false) },
  closeCardPicker() { if (!this.data.cardSending) this.setData({ cardPickerOpen: false }) },
  async loadCardPosts(append) {
    if (this.data.cardLoading) return
    this.setData({ cardLoading: true })
    try { const result = await listMyPosts('', append ? this.data.cardNextCursor : null, 20); this.setData({ cardPosts: append ? [...this.data.cardPosts, ...result.posts] : result.posts, cardNextCursor: result.nextCursor }) }
    catch (error) { console.warn('Card picker failed', error); wx.showToast({ title: '信息加载失败，请重试', icon: 'none' }) }
    finally { this.setData({ cardLoading: false }) }
  },
  moreCardPosts() { return this.loadCardPosts(true) },
  async sendCard(event) {
    if (this.data.cardSending) return
    const postId = event.currentTarget.dataset.id
    this.setData({ cardSending: true })
    this.postCardRequests = this.postCardRequests || {}
    const requestId = this.postCardRequests[postId] || (this.postCardRequests[postId] = Date.now() + '-' + Math.random().toString(36).slice(2))
    try { await sendPostCard(this.conversationId, postId, requestId); delete this.postCardRequests[postId]; this.setData({ cardPickerOpen: false }); await this.fetchLatest(); this.scrollToBottom() }
    catch (error) { console.warn('Card send failed', error); wx.showToast({ title: '卡片未发送，请重试', icon: 'none' }) }
    finally { this.setData({ cardSending: false }) }
  },
  openCardPost(event) { wx.navigateTo({ url: '/pages/post-detail/index?postId=' + encodeURIComponent(event.currentTarget.dataset.id) + '&fromCard=1&conversationId=' + encodeURIComponent(this.conversationId) }) },
  reserveCardPost(event) { if (!this.data.canCreateTransaction) return; wx.navigateTo({ url: '/pages/transaction-create/index?conversationId=' + encodeURIComponent(this.conversationId) + '&linkedPostId=' + encodeURIComponent(event.currentTarget.dataset.id) }) },
  openTransaction(event) { wx.navigateTo({ url: '/pages/transaction-detail/index?transactionId=' + event.currentTarget.dataset.id }) },
  createTransaction() { if (!this.data.canCreateTransaction) return; wx.navigateTo({ url: `/pages/transaction-create/index?conversationId=${this.conversationId}` }) },
})
