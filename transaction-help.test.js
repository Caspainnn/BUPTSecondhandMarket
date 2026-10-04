const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
test('help copies the provided contact and security phone without dialing', () => {
  let definition
  const copied = []
  vm.runInNewContext(fs.readFileSync('miniprogram/components/transaction-help/index.js', 'utf8'), {
    Component(value) { definition = value },
    wx: { setClipboardData(value) { copied.push(value.data); value.success() }, showToast() {} },
  })
  const context = { properties: { peer: { contactInfo: 'wechat-demo' } }, ...definition.methods }
  context.copyContact()
  context.copySecurity()
  context.properties.peer = null
  context.copyContact()
  assert.deepEqual(copied, ['wechat-demo', '01062282222'])
})
