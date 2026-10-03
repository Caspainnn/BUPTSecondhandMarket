const { CAMPUSES, SERVICE_APPOINTMENT_CAMPUSES } = require('../../config/market')
const { createTransactionState, reduceTransactionState } = require('../../services/transaction-state')
const { createTransaction } = require('../../services/transactions')
const { getPost } = require('../../services/posts')
const { requireCompletedProfile } = require('../../services/user')

function localParts(time) {
  const date = new Date(time)
  const pad = (value) => String(value).padStart(2, '0')
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` }
}

Page({
  data: { campuses: CAMPUSES, campusName: '', form: {}, status: 'loading', error: '', date: '', time: '', conversation: null },
  async onLoad(options) {
    const user = await requireCompletedProfile()
    if (!user) return
    this.conversationId = options.conversationId
    this.linkedPostId = options.linkedPostId || ''
    const initial = localParts(Date.now())
    this.state = createTransactionState({ conversationId: this.conversationId, campusId: user.campusId })
    this.state = reduceTransactionState(this.state, { type: 'PATCH_FORM', patch: { scheduledAt: `${initial.date} ${initial.time}` } })
    const conversation = getApp().globalData.currentConversation
    const current = conversation && conversation._id === this.conversationId ? conversation : null
    let snapshot = (current || {}).postSnapshot || {}
    if (this.linkedPostId) {
      try { const post = await getPost(this.linkedPostId); if (post.status !== 'active' || post.availableQuantity <= 0 || post.direction === 'need' || post.contentType === 'service') throw new Error('商品当前不可预约'); snapshot = { ...post, coverFileId: (post.imageFileIds || [])[0] || '' }; this.setData({ availableQuantity: post.availableQuantity }) }
      catch (error) { this.state.status = 'unavailable'; this.state.error = error.message; this.sync(); return }
    }
    this.setData({ date: initial.date, time: initial.time, conversation: current ? { ...current, postSnapshot: snapshot } : null, isService: snapshot.contentType === 'service', isNeed: snapshot.direction === 'need', campuses: snapshot.contentType === 'service' ? SERVICE_APPOINTMENT_CAMPUSES : CAMPUSES })
    this.sync()
  },
  sync() { const campus = this.data.campuses.find((item) => item.id === this.state.form.campusId); this.setData({ form: this.state.form, status: this.state.status, error: this.state.error, campusName: campus ? campus.name : '请选择校区' }) },
  apply(event) { this.state = reduceTransactionState(this.state, event); this.sync() },
  patch(event) { const field = event.currentTarget.dataset.field; const value = field === 'quantity' ? Number(event.detail.value) : event.detail.value; this.apply({ type: 'PATCH_FORM', patch: { [field]: value } }) },
  pickCampus(event) { this.apply({ type: 'PATCH_FORM', patch: { campusId: this.data.campuses[Number(event.detail.value)].id, fulfillmentMode: this.data.campuses[Number(event.detail.value)].id === '' ? 'online' : 'offline' } }) },
  pickDate(event) { this.setData({ date: event.detail.value }); this.apply({ type: 'PATCH_FORM', patch: { scheduledAt: `${event.detail.value} ${this.data.time}` } }) },
  pickTime(event) { this.setData({ time: event.detail.value }); this.apply({ type: 'PATCH_FORM', patch: { scheduledAt: `${this.data.date} ${event.detail.value}` } }) },
  async submit() {
    if (['submitting', 'unavailable'].includes(this.state.status)) return
    const requestId = this.state.requestId || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.apply({ type: 'SUBMIT_START', requestId })
    try {
      const scheduledAt = new Date(this.state.form.scheduledAt.replace(/-/g, '/')).getTime()
      const transaction = await createTransaction({ conversationId: this.conversationId, ...this.state.form, linkedPostId: this.linkedPostId, scheduledAt }, this.state.requestId)
      this.apply({ type: 'SUBMIT_SUCCESS', transaction })
      wx.navigateBack()
    } catch (error) { this.apply({ type: 'FAILURE', message: error.message }) }
  },
})
