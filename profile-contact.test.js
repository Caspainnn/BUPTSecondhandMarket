const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
test('profile service rejects stale deployed responses instead of reporting contact saved', async () => {
  const app = { globalData: {} }
  let response = { user: { nickname: 'demo' } }
  const context = { module: { exports: {} }, getApp: () => app, require: () => ({ callCloud: async () => response }) }
  vm.runInNewContext(fs.readFileSync('miniprogram/services/user.js', 'utf8'), context)
  const input = { contactType: 'QQ', contactInfo: '123456' }
  await assert.rejects(context.module.exports.saveProfile(input), /updateProfile/)
  assert.equal(app.globalData.user, undefined)
  response = { user: { ...input } }
  await context.module.exports.saveProfile(input)
  assert.equal(app.globalData.user.contactType, 'QQ')
  assert.equal(app.globalData.user.contactInfo, '123456')
})
