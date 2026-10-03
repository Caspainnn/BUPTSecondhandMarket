const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path')
test('plain reminders remain text and preserve actions on the most recent appointment card', () => {
  let page
  vm.runInNewContext(fs.readFileSync('miniprogram/pages/conversation/index.js', 'utf8'), { Page: value => page = value, require: name => require(path.resolve('miniprogram/pages/conversation', name)) })
  const current = { _id: 't', buyerId: 'buyer', sellerId: 'seller', status: 'awaiting_handover', scheduledAt: 0, postSnapshot: {} }
  page.state = { messages: [{ _id: 'card', transactionId: 't', senderId: 'seller', transactionCard: current, currentTransaction: current }, { _id: 'plain', type: 'system', senderId: 'system', reminderType: 'result', transactionId: 't', currentTransaction: current, text: '已到交接时间，请提交结果。' }] }
  page.userId = 'buyer'; page.data = { conversation: { buyerId: 'buyer', sellerId: 'seller' } }; page.setData = data => Object.assign(page.data, data)
  page.sync()
  assert.equal(page.data.messages[0].canResult, true)
  assert.equal(page.data.messages[1].transactionCard, null)
  assert.equal(page.data.messages[1].canResult, false)
})
