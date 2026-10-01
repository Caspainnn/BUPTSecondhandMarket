const fs=require('node:fs'),assert=require('node:assert/strict'),test=require('node:test')
test('conversation has product context with buyer transaction action and reusable send icon',()=>{
 const xml=fs.readFileSync('miniprogram/pages/conversation/index.wxml','utf8')
 const bar=xml.slice(xml.indexOf('<view class="product-bar">'), xml.indexOf('<scroll-view'))
 assert.match(bar,/postSnapshot.title/)
 assert.match(bar,/postSnapshot.coverFileId/)
 assert.match(bar,/bindtap="createTransaction"/)
 assert.match(xml,/src="\/assets\/icons\/send.svg"/)
 assert.doesNotMatch(xml,/>发送<\/button>/)
})

test('customer pages do not expose image diagnostics or technical failure text',()=>{
 for(const page of ['conversation','post-detail']){
  const xml=fs.readFileSync('miniprogram/pages/'+page+'/index.wxml','utf8')
  const js=fs.readFileSync('miniprogram/pages/'+page+'/index.js','utf8')
  assert.doesNotMatch(xml,/checkImages|图片加载失败|图片未能加载|点此检查/)
  assert.doesNotMatch(js,/diagnosePostImages|async checkImages/)
 }
})

test('conversation header shows seller first, product second, then message history',()=>{
 const xml=fs.readFileSync('miniprogram/pages/conversation/index.wxml','utf8')
 assert.match(xml,/conversation.sellerSnapshot.avatarFileId/)
 assert.match(xml,/conversation.sellerSnapshot.nickname/)
 const seller=xml.indexOf('class="seller-bar"'),product=xml.indexOf('class="product-bar"'),messages=xml.indexOf('<scroll-view')
 assert.ok(seller>=0 && seller<product && product<messages)
})

test('appointments render structured cards with a transaction detail entry',()=>{
 const xml=fs.readFileSync('miniprogram/pages/conversation/index.wxml','utf8')
 assert.match(xml,/item.transactionCard/)
 assert.match(xml,/class="transaction-card"/)
 for(const field of ['quantity','locationText','scheduledText','statusLabel'])assert.ok(xml.includes('item.transactionCard.'+field))
 assert.match(xml,/bindtap="openTransaction"/)
})

test('appointment cards offer inline role actions and editing with emphasized key fields',()=>{
 const xml=fs.readFileSync('miniprogram/pages/conversation/index.wxml','utf8')
 assert.match(xml,/catchtap="actOnCard"/)
 assert.match(xml,/catchtap="editCard"/)
 assert.match(xml,/catchtap="saveCardEdit"/)
 for(const text of ['接受','拒绝','撤回','修改'])assert.ok(xml.includes(text))
 assert.match(xml,/class="transaction-key"/)
})

test('pending cards expose only the latest message actions for the correct participant',()=>{
 const vm=require('node:vm'),path=require('node:path');let page
 vm.runInNewContext(fs.readFileSync('miniprogram/pages/conversation/index.js','utf8'),{
 Page:value=>page=value,
 require:name=>require(path.resolve('miniprogram/pages/conversation',name)),
 })
 page.setData=patch=>Object.assign(page.data,patch)
 const transaction={_id:'t',buyerId:'buyer',sellerId:'seller',status:'pending_seller',scheduledAt:Date.now()+3600000,campusId:'bupt-shahe'}
 page.state={messages:[{_id:'old',transactionId:'t',transactionCard:transaction,currentTransaction:transaction},{_id:'latest',transactionId:'t',transactionCard:transaction,currentTransaction:transaction}]}
 page.userId='buyer';page.sync()
 assert.equal(page.data.messages[0].canRevise,false)
 assert.equal(page.data.messages[1].canRevise,true)
 assert.equal(page.data.messages[1].canRespond,false)
 page.userId='seller';page.sync()
 assert.equal(page.data.messages[1].canRespond,true)
 transaction.status='cancelled';page.sync()
 assert.equal(page.data.messages[1].canRespond,false)
})
