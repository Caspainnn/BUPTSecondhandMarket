const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), test = require('node:test')
function deferred() { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve } }
function messagePage(list) {
  let page; const timers = new Map(), badges = []; let id = 0
  vm.runInNewContext(fs.readFileSync('miniprogram/pages/messages/index.js', 'utf8'), {
    Page: value => page = value,
    require: name => name.endsWith('/user') ? { requireCompletedProfile: async () => ({ _id: 'buyer' }) } : { listConversations: list, syncMessageBadge: value => badges.push(value) },
    setInterval: (fn, delay) => { timers.set(++id, { fn, delay }); return id }, clearInterval: key => timers.delete(key), console: { warn() {} },
  })
  page.setData = patch => Object.assign(page.data, patch)
  return { page, timers, badges }
}
test('message list refreshes every five seconds without clearing content, and stops when hidden', async () => {
  let calls = 0
  const { page, timers } = messagePage(async () => { calls++; return { conversations: [{ _id: 'c', buyerId: 'buyer', sellerSnapshot: { nickname: 'seller' }, buyerUnread: calls }], totalUnread: calls } })
  await page.onShow(); assert.equal(calls, 1); assert.equal([...timers.values()][0].delay, 5000)
  await [...timers.values()][0].fn(); assert.equal(calls, 2); assert.equal(page.data.state, 'ready'); assert.equal(page.data.conversations[0].unread, 2)
  page.onHide(); assert.equal(timers.size, 0); await page.refresh(); assert.equal(calls, 2)
})
test('message refresh skips overlapping requests and ignores late results after hiding', async () => {
  const pending = deferred(); let calls = 0
  const { page, badges } = messagePage(() => { calls++; return pending.promise })
  page.visibleToken = {}; page.userId = 'buyer'
  const first = page.refresh(); await page.refresh(); assert.equal(calls, 1)
  page.onHide(); pending.resolve({ conversations: [], totalUnread: 9 }); await first
  assert.equal(badges.length, 0); assert.equal(page.data.state, 'loading')
})
test('background message refresh failures retain the existing list', async () => {
  const { page } = messagePage(async () => { throw Error('technical error') })
  page.visibleToken = {}; page.data.state = 'ready'; const rows = [{ _id: 'existing' }]; page.data.conversations = rows
  await page.refresh(); assert.equal(page.data.state, 'ready'); assert.equal(page.data.conversations, rows); assert.equal(page.data.error, '')
})
test('application refreshes badges every fifteen seconds, skips chat pages, and stops in background', async () => {
  let app, route = 'pages/discover/index', calls = 0, timer, badges = []
  vm.runInNewContext(fs.readFileSync('miniprogram/app.js', 'utf8'), {
    App: value => app = value,
    require: name => name.endsWith('/env') ? {} : name.endsWith('/user') ? { getCurrentUser: async () => ({ profileCompleted: true }) } : { listConversations: async () => { calls++; return { totalUnread: 3 } }, syncMessageBadge: value => badges.push(value) },
    wx: { cloud: {} }, getCurrentPages: () => [{ route }],
    setInterval: (fn, delay) => { timer = { fn, delay }; return 1 }, clearInterval: () => { timer = null }, console: { warn() {} },
  })
  app.onShow(); await new Promise(resolve => setImmediate(resolve)); assert.equal(timer.delay, 15000); assert.equal(calls, 1); assert.equal(badges[0], 3)
  route = 'pages/messages/index'; await timer.fn(); assert.equal(calls, 1)
  route = 'pages/conversation/index'; await timer.fn(); assert.equal(calls, 1)
  app.onHide(); assert.equal(timer, null); await app.refreshUnread(); assert.equal(calls, 1)
})
