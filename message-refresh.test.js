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

test('message list moves the latest appointment or text conversation to the top regardless of timestamp type',async()=>{
 const {page}=messagePage(async()=>({conversations:[{_id:'older',buyerId:'buyer',lastMessageAt:'2026-10-01T10:00:00Z',sellerSnapshot:{}},{_id:'latest-card',buyerId:'buyer',lastMessageAt:Date.parse('2026-10-02T10:00:00Z'),sellerSnapshot:{}}],totalUnread:1}))
 await page.onShow()
 assert.deepEqual(Array.from(page.data.conversations,item=>item._id),['latest-card','older'])
 page.onHide()
})

test('cloud conversation listing sorts mixed legacy timestamps before paging',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');let reads=0
 const rows=Array.from({length:105},(_,index)=>({_id:String(index).padStart(3,'0'),buyerId:'buyer',lastMessageAt:index===104?Date.parse('2026-10-02T10:00:00Z'):'2026-10-01T10:00:00Z'}))
 const command={or:value=>({or:value}),and:value=>({and:value}),gt:value=>({gt:value})}
 const collection={where(query){let after='';for(const condition of query.and||[])if(condition._id)after=condition._id.gt;return {orderBy(){return this},limit(limit){this.limitValue=limit;return this},async get(){reads++;return {data:rows.filter(row=>row._id>after).slice(0,this.limitValue)}}}}}
 const db={command,collection:()=>collection}
 const context={exports:{},require:name=>name==='wx-server-sdk'?{init(){},database:()=>db}:{} }
 vm.runInNewContext(fs.readFileSync('cloudfunctions/conversationApi/index.js','utf8')+'\n;globalThis.testRepository=repository',context)
 const repository=context.testRepository()
 const first=await repository.list({userId:'buyer',cursor:null,limit:2})
 assert.equal(first.rows[0]._id,'104');assert.equal(reads,2)
 const second=await repository.list({userId:'buyer',cursor:first.nextCursor,limit:2})
 assert.ok(second.rows.every(row=>!first.rows.some(previous=>previous._id===row._id)))
})
