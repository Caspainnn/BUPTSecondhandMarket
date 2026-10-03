const { getAutoCompleteAt, getAppointmentProgress, getTransactionActions, getTransactionStatusLabel } = require('./transaction-state')
const { respondTransaction, withdrawTransaction, cancelTransaction, submitResult, reviseTransaction } = require('./transactions')
const { CAMPUSES, SERVICE_APPOINTMENT_CAMPUSES } = require('../config/market')
function parts(timestamp) {
  const date = new Date(timestamp), pad = value => String(value).padStart(2, '0')
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` }
}
const definition = {
  properties: { transaction: { type: Object, value: null }, userId: String },
  data: { actions: [], canResult: false, successDisabled: true, canEdit: false, busy: false, editing: false, form: {}, campuses: CAMPUSES },
  observers: { 'transaction,userId': function () { this.sync() } },
  methods: {
    sync() {
      const item = this.data.transaction
      if (!item) return
      const actions = getTransactionActions(item, this.data.userId, Date.now())
      const scheduled = parts(item.scheduledAt)
      const isService = (item.postSnapshot || {}).contentType === 'service'
      this.setData({ isService, isNeed: (item.postSnapshot || {}).direction === 'need', campuses: isService ? SERVICE_APPOINTMENT_CAMPUSES : CAMPUSES })
      this.setData({ actions: actions.filter(action => !['success','failure'].includes(action)), canResult: actions.includes('success') || actions.includes('failure'), successDisabled: !actions.includes('success'), canEdit: item.status === 'pending_seller' && item.buyerId === this.data.userId, statusLabel: getTransactionStatusLabel(item.status), progress: getAppointmentProgress(item, Date.now()), progressTone: ['failed', 'abnormal', 'cancelled'].includes(item.status) ? 'alert' : item.status === 'completed' ? 'success' : 'pending', scheduledText: scheduled.date + ' ' + scheduled.time, autoCompleteText: item.status === 'awaiting_handover' ? (() => { const deadline = parts(getAutoCompleteAt(item)); return deadline.date + ' ' + deadline.time })() : '', campusName: (this.data.campuses.find(campus => campus.id === item.campusId) || {}).name || '', waitingOther: item.status === 'awaiting_handover' && Boolean(item.buyerId === this.data.userId ? item.buyerResult : item.sellerResult) })
    },
    async act(event) {
      if (this.data.busy) return
      this.sync()
      const action = event.currentTarget.dataset.action
      if (!getTransactionActions(this.data.transaction, this.data.userId, Date.now()).includes(action)) return
      this.setData({ busy: true })
      try {
        const labels = { confirm: '接受预约', reject: '拒绝预约', withdraw: '撤回预约', cancel: '取消交易', success: '交接成功', failure: '交接失败' }
        const result = await new Promise(resolve => wx.showModal({ title: labels[action], content: ['success','failure'].includes(action) ? '交接结果提交后不可修改，请确认。' : '确定执行此操作吗？', editable: action === 'cancel', placeholderText: '请输入取消原因（2–200字）', success: resolve, fail: () => resolve({ confirm: false }) }))
        if (!result.confirm) return
        this.requestIds = this.requestIds || {}
        const requestId = this.requestIds[action] || (this.requestIds[action] = Date.now() + '-' + Math.random().toString(36).slice(2))
        const id = this.data.transaction._id
        if (action === 'confirm' || action === 'reject') await respondTransaction(id, action, '', requestId)
        else if (action === 'withdraw') await withdrawTransaction(id, '', requestId)
        else if (action === 'cancel') await cancelTransaction(id, result.content || '', requestId)
        else await submitResult(id, action, requestId)
        delete this.requestIds[action]
        this.setData({ editing: false })
        this.triggerEvent('changed')
      } catch (error) { console.warn('Order card action failed', error); wx.showToast({ title: '操作未完成，请刷新后重试', icon: 'none' }); this.triggerEvent('changed') }
      finally { this.setData({ busy: false }) }
    },
    edit() {
      if (this.data.busy || !this.data.canEdit) return
      const item = this.data.transaction, scheduled = parts(item.scheduledAt)
      this.editRequest = ''
      this.setData({ editing: true, form: { quantity: item.quantity, campusId: item.campusId, campusIndex: this.data.campuses.findIndex(campus => campus.id === item.campusId), locationText: item.locationText, itemDescription: item.itemDescription || '', fulfillmentMode: item.fulfillmentMode || 'offline', ...scheduled } })
    },
    patch(event) {
      if (this.data.busy) return
      const field = event.currentTarget.dataset.field, value = event.detail.value
      const form = { ...this.data.form, [field]: value }
      if (field === 'campusIndex') { form.campusId = this.data.campuses[Number(value)].id; form.fulfillmentMode = form.campusId === '' ? 'online' : 'offline' }
      this.editRequest = ''; this.setData({ form })
    },
    closeEdit() { if (!this.data.busy) this.setData({ editing: false }) },
    async save() {
      if (this.data.busy) return
      this.setData({ busy: true })
      try {
        const form = this.data.form
        this.editRequest = this.editRequest || Date.now() + '-' + Math.random().toString(36).slice(2)
        await reviseTransaction(this.data.transaction._id, { itemDescription: form.itemDescription, fulfillmentMode: form.fulfillmentMode, quantity: Number(form.quantity), campusId: form.campusId, locationText: form.locationText, scheduledAt: new Date((form.date + ' ' + form.time).replace(/-/g, '/')).getTime() }, this.editRequest)
        this.editRequest = ''; this.setData({ editing: false }); this.triggerEvent('changed')
      } catch (error) { console.warn('Order card edit failed', error); wx.showToast({ title: '请检查数量、地点和预约时间', icon: 'none' }) }
      finally { this.setData({ busy: false }) }
    },
    open() { wx.navigateTo({ url: '/pages/transaction-detail/index?transactionId=' + this.data.transaction._id }) },
  },
}

module.exports = definition
