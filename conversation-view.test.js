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

test('conversation header shows the peer first, product second, then message history',()=>{
 const xml=fs.readFileSync('miniprogram/pages/conversation/index.wxml','utf8')
 assert.match(xml,/peer.avatarFileId/)
 assert.match(xml,/peer.nickname/)
 const seller=xml.indexOf('class="seller-bar"'),product=xml.indexOf('class="product-bar"'),messages=xml.indexOf('<scroll-view')
 assert.ok(seller>=0 && seller<product && product<messages)
})

test('appointments render structured cards with a transaction detail entry',()=>{
 const xml=fs.readFileSync('miniprogram/pages/conversation/index.wxml','utf8')
 assert.match(xml,/item.transactionCard/)
 assert.match(xml,/class="transaction-card"/)
 for(const field of ['quantity','locationText','scheduledText','progress.title'])assert.ok(xml.includes('item.transactionCard.'+field))
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

test('conversation header selects the other participant for buyer and seller',async()=>{
 const vm=require('node:vm');let page,actor='buyer'
 const conversation={_id:'c',buyerId:'buyer',sellerId:'seller',buyerSnapshot:{nickname:'Buyer',avatarFileId:'buyer-avatar'},sellerSnapshot:{nickname:'Seller',avatarFileId:'seller-avatar'}}
 vm.runInNewContext(fs.readFileSync('miniprogram/pages/conversation/index.js','utf8'),{
  Page:value=>page=value,
  getApp:()=>({globalData:{currentConversation:conversation}}),
  require:name=>name.endsWith('/user')?{requireCompletedProfile:async()=>({_id:actor})}:name.endsWith('/chat-state')?{startPolling:()=>()=>{}}:{},
 })
 page.conversationId='c';page.setData=patch=>Object.assign(page.data,patch)
 await page.onShow();assert.equal(page.data.peer.nickname,'Seller');assert.equal(page.data.peer.avatarFileId,'seller-avatar');assert.equal(page.data.canCreateTransaction,true)
 actor='seller';await page.onShow();assert.equal(page.data.peer.nickname,'Buyer');assert.equal(page.data.peer.avatarFileId,'buyer-avatar');assert.equal(page.data.canCreateTransaction,false)
})

function conversationLayoutPage(){
 const vm=require('node:vm'),path=require('node:path');let page;const patches=[]
 vm.runInNewContext(fs.readFileSync('miniprogram/pages/conversation/index.js','utf8'),{
 Page:value=>page=value,require:name=>require(path.resolve('miniprogram/pages/conversation',name)),wx:{getWindowInfo:()=>({windowHeight:700})},
 })
 page.setData=(patch,callback)=>{patches.push(patch);Object.assign(page.data,patch);if(callback)callback()}
 page.onLoad({conversationId:'c'})
 return {page,patches}
}
test('sending retriggers bottom positioning while polling respects reading older messages',()=>{
 const {page,patches}=conversationLayoutPage()
 page.state.messages=[{_id:'a',createdAt:1}];page.atBottom=false
 page.apply({type:'SEND_SUCCESS',conversationId:'c',message:{_id:'b',createdAt:2}})
 assert.equal(page.data.scrollTarget,'bottom-anchor')
 assert.equal(patches[patches.length-2].scrollTarget,'')
 page.onHistoryTouchStart();page.onHistoryScroll({detail:{deltaY:-20}});page.onHistoryTouchEnd()
 const before=patches.length
 page.apply({type:'MESSAGES_SUCCESS',conversationId:'c',messages:[{_id:'d',createdAt:4}]})
 assert.equal(page.data.hasNewMessages,true)
 page.onHistoryBottom();page.apply({type:'MESSAGES_SUCCESS',conversationId:'c',messages:[{_id:'e',createdAt:5}]})
 assert.equal(page.data.scrollTarget,'bottom-anchor')
})

test('automatic scroll events do not disable following incoming messages',()=>{
 const {page}=conversationLayoutPage()
 page.scrollToBottom()
 page.onHistoryScroll({detail:{deltaY:-20}})
 assert.equal(page.atBottom,true)
 page.apply({type:'MESSAGES_SUCCESS',conversationId:'c',messages:[{_id:'incoming',createdAt:4}]})
 assert.equal(page.data.scrollTarget,'bottom-anchor')
 assert.equal(page.data.hasNewMessages,false)
})

test('seller goods card exposes appointment action only to the conversation buyer',()=>{
 const {page}=conversationLayoutPage()
 page.data.conversation={_id:'c',buyerId:'buyer',sellerId:'seller',postSnapshot:{direction:'need',contentType:'item'}}
 page.state.messages=[{_id:'card',senderId:'seller',postCard:{postId:'goods',direction:'provide',contentType:'item',unitPriceCents:100}}]
 page.userId='buyer';page.sync()
 assert.equal(page.data.messages[0].canReservePost,true)
 page.data.conversation.postSnapshot.contentType='service';page.sync()
 assert.equal(page.data.messages[0].canReservePost,true)
 page.userId='seller';page.sync()
 assert.equal(page.data.messages[0].canReservePost,false)
})

test('typing and polling never write the controlled textarea value back to the native input',()=>{
 const {page,patches}=conversationLayoutPage()
 patches.length=0
 page.onDraft({detail:{value:'unfinished message'}})
 page.apply({type:'MESSAGES_SUCCESS',conversationId:'c',messages:[{_id:'incoming',createdAt:1}]})
 page.apply({type:'MARK_READ_SUCCESS',conversationId:'c',totalUnread:0})
 assert.equal(page.state.draft,'unfinished message')
 assert.ok(patches.every(patch=>!Object.hasOwn(patch,'draft')))
})

test('send response preserves text typed after the submitted message',()=>{
 const {page}=conversationLayoutPage()
 page.onDraft({detail:{value:'first'}})
 page.apply({type:'SEND_START',requestId:'r'})
 page.onDraft({detail:{value:'next message'}})
 page.apply({type:'SEND_SUCCESS',conversationId:'c',message:{_id:'sent',createdAt:1}})
 assert.equal(page.state.draft,'next message')
})
test('keyboard layout uses current viewport units and restores full height after blur',()=>{
 const {page}=conversationLayoutPage()
 page.onKeyboardHeight({detail:{height:300}})
 assert.equal(page.data.keyboardHeight,300)
 page.onInputBlur();assert.equal(page.data.keyboardHeight,0)
 const xml=fs.readFileSync('miniprogram/pages/conversation/index.wxml','utf8')
 assert.match(xml,/adjust-position="\{\{false\}\}"/)
 assert.match(xml,/height: calc\(100vh - /);assert.doesNotMatch(xml,/viewportHeight/)
 assert.match(xml,/scroll-into-view="\{\{scrollTarget\}\}"/)
})

test('appointment cards distinguish the event actor including legacy system cards',()=>{
 const {page}=conversationLayoutPage()
 page.userId='buyer'
 const current={buyerId:'buyer',sellerId:'seller',status:'cancelled',scheduledAt:Date.now()}
 page.state.messages=[{_id:'own',transactionId:'t',senderId:'buyer',actorId:'buyer',transactionCard:current,currentTransaction:current},{_id:'peer',transactionId:'t',senderId:'system',recipientId:'buyer',transactionCard:current,currentTransaction:current}]
 page.sync();assert.equal(page.data.messages[0].mine,true);assert.equal(page.data.messages[1].mine,false)
 assert.equal(page.data.messages[0].senderLabel,'\u4f60\uff08\u4e70\u5bb6\uff09');assert.equal(page.data.messages[1].senderLabel,'\u5356\u5bb6')
 const css=fs.readFileSync('miniprogram/pages/conversation/index.wxss','utf8')
 assert.match(css,/\.mine \.transaction-card\{background:#2479b8/)
})
