const { CAMPUSES } = require('../../config/market')
const { createTransactionState, reduceTransactionState } = require('../../services/transaction-state')
const { createTransaction } = require('../../services/transactions')
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
    const initial = localParts(Date.now())
    this.state = createTransactionState({ conversationId: this.conversationId, campusId: user.campusId })
    this.state = reduceTransactionState(this.state, { type: 'PATCH_FORM', patch: { scheduledAt: `${initial.date} ${initial.time}` } })
    this.setData({ date: initial.date, time: initial.time, conversation: getApp().globalData.currentConversation || null })
    this.sync()
  },
  sync() { const campus = CAMPUSES.find((item) => item.id === this.state.form.campusId); this.setData({ form: this.state.form, status: this.state.status, error: this.state.error, campusName: campus ? campus.name : '请选择校区' }) },
  apply(event) { this.state = reduceTransactionState(this.state, event); this.sync() },
  patch(event) { const field = event.currentTarget.dataset.field; const value = field === 'quantity' ? Number(event.detail.value) : event.detail.value; this.apply({ type: 'PATCH_FORM', patch: { [field]: value } }) },
  pickCampus(event) { this.apply({ type: 'PATCH_FORM', patch: { campusId: CAMPUSES[Number(event.detail.value)].id } }) },
  pickDate(event) { this.setData({ date: event.detail.value }); this.apply({ type: 'PATCH_FORM', patch: { scheduledAt: `${event.detail.value} ${this.data.time}` } }) },
  pickTime(event) { this.setData({ time: event.detail.value }); this.apply({ type: 'PATCH_FORM', patch: { scheduledAt: `${this.data.date} ${event.detail.value}` } }) },
  async submit() {
    if (this.state.status === 'submitting') return
    const requestId = this.state.requestId || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    this.apply({ type: 'SUBMIT_START', requestId })
    try {
      const scheduledAt = new Date(this.state.form.scheduledAt.replace(/-/g, '/')).getTime()
      const transaction = await createTransaction({ conversationId: this.conversationId, ...this.state.form, scheduledAt }, this.state.requestId)
      this.apply({ type: 'SUBMIT_SUCCESS', transaction })
      wx.navigateBack()
    } catch (error) { this.apply({ type: 'FAILURE', message: error.message }) }
  },
})
