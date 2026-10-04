const test = require('node:test')
const assert = require('node:assert/strict')
const { getAppointmentProgress } = require('./miniprogram/services/transaction-state')

test('appointment progress separates stage from the next participant action', () => {
  assert.deepEqual(getAppointmentProgress({ status: 'pending_seller' }, 0), { title: '待确认', detail: '待卖家确认预约清单' })
  const confirmed = { status: 'awaiting_handover', scheduledAt: 100 }
  assert.equal(getAppointmentProgress(confirmed, 0).title, '待交接')
  assert.match(getAppointmentProgress(confirmed, 100).detail, /待双方/)
  assert.match(getAppointmentProgress({ ...confirmed, buyerResult: 'success' }, 100).detail, /待卖家/)
  assert.match(getAppointmentProgress({ ...confirmed, sellerResult: 'success' }, 100).detail, /待买家/)
  assert.deepEqual(getAppointmentProgress({ status: 'cancelled', cancelType: 'seller_rejected' }, 100), { title: '已取消', detail: '卖家已拒绝预约，可重新协商后发起' })
  assert.equal(getAppointmentProgress({ status: 'completed' }, 100).title, '已完成')
  assert.equal(getAppointmentProgress({ status: 'abnormal' }, 100).title, '交接结果不一致')
})

test('appointment progress distinguishes automatic completion and shows scheduled deadline', () => {
  assert.match(getAppointmentProgress({ status: 'completed', completionSource: 'timeout' }, 0).detail, /自动完成/)
  const progress = getAppointmentProgress({ status: 'awaiting_handover', scheduledAt: 1000 }, 0)
  assert.equal(progress.autoCompleteAt, 3601000)
})
