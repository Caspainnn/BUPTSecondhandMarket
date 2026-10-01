const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const test = require('node:test')
const file = 'miniprogram/pages/post-detail/index'
function setup(post) {
  let page
  const calls = [], modals = []
  vm.runInNewContext(fs.readFileSync(file + '.js', 'utf8'), {
    Page: (value) => { page = value },
    require: (name) => {
      if (name.endsWith('/market')) return { POST_CATEGORIES: [], POST_CONDITIONS: [], CAMPUSES: [] }
      if (name.endsWith('/cloud-result')) return { callCloud: async (api, data) => { calls.push({ api, data }); return { conversation: { _id: 'conversation' } } } }
      if (name.endsWith('/user')) return { requireCompletedProfile: async () => ({ _id: 'buyer' }) }
      return {}
    },
    wx: { showModal: (options) => modals.push(options), navigateTo: () => {}, showToast: () => {} },
    getApp: () => ({ globalData: {} }),
  })
  page.data.post = post
  page.setData = (patch) => Object.assign(page.data, patch)
  page.postId = 'post'
  return { page, calls, modals }
}
test('own product always explains self-chat restriction without a cloud request', async () => {
  for (const unavailable of [false, true]) {
    const s = setup({ isOwner: true, unavailable })
    await s.page.contactSeller()
    assert.equal(s.calls.length, 0)
    assert.equal(s.modals[0]?.content, '这个商品是你自己想要卖的，所以不能和自己聊一聊。')
    assert.equal(s.modals[0]?.showCancel, false)
  }
})
test('buyer can still contact an available seller', async () => {
  const s = setup({ isOwner: false, unavailable: false })
  await s.page.contactSeller()
  assert.equal(s.calls[0].api, 'conversationApi')
  assert.equal(s.calls[0].data.action, 'open')
})
test('public detail has only a chat action and owner gray styling remains tappable', () => {
  const wxml = fs.readFileSync(file + '.wxml', 'utf8')
  const css = fs.readFileSync(file + '.wxss', 'utf8')
  assert.doesNotMatch(wxml, /bindtap="edit"|bindtap="toggleStatus"/)
  assert.match(wxml, /post.isOwner \? 'own-contact'/)
  assert.match(wxml, /disabled="{{!post.isOwner && post.unavailable}}"/)
  assert.match(wxml, /聊一聊/)
  assert.match(css, /\.contact\.own-contact\s*\{/)
})
