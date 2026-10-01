const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict'),test=require('node:test')
const state=require('./miniprogram/services/transaction-state')
function card() {
 let component,submitted=[];const context={module:{exports:{}}}
 vm.runInNewContext(fs.readFileSync('miniprogram/services/order-card-controller.js','utf8'),{
  module:context.module,
  require:name=>name.endsWith('/transactions')?{submitResult:async(id,result)=>submitted.push({id,result})}:require(path.resolve('miniprogram/services',name)),
  wx:{showModal:options=>options.success({confirm:true}),showToast(){}},console:{warn(){}},
 })
 component=context.module.exports
 const instance={...component.methods,data:{...component.data,userId:'buyer'},setData(patch){Object.assign(this.data,patch)},triggerEvent(){this.changed=true}}
 return {instance,submitted}
}
test('inline order card disables early success but permits failure and waits after actor submission',async()=>{
 const {instance,submitted}=card()
 instance.data.transaction={_id:'t',buyerId:'buyer',sellerId:'seller',status:'awaiting_handover',scheduledAt:Date.now()+3600000}
 instance.sync();assert.equal(instance.data.canResult,true);assert.equal(instance.data.successDisabled,true)
 await instance.act({currentTarget:{dataset:{action:'success'}}});assert.equal(submitted.length,0)
 await instance.act({currentTarget:{dataset:{action:'failure'}}});assert.equal(submitted[0].result,'failure');assert.equal(instance.changed,true)
 instance.data.transaction.buyerResult='success';instance.sync();assert.equal(instance.data.canResult,false);assert.equal(instance.data.waitingOther,true)
})
test('pending order card offers buyer editing and seller accept/reject, with outsider controls hidden',()=>{
 const {instance}=card();instance.data.transaction={_id:'t',buyerId:'buyer',sellerId:'seller',status:'pending_seller',scheduledAt:Date.now()}
 instance.sync();assert.equal(instance.data.canEdit,true);assert.deepEqual(Array.from(instance.data.actions),['withdraw'])
 instance.data.userId='seller';instance.sync();assert.equal(instance.data.canEdit,false);assert.deepEqual(Array.from(instance.data.actions),['confirm','reject'])
 instance.data.userId='other';instance.sync();assert.equal(instance.data.actions.length,0);assert.equal(instance.data.canResult,false)
})
test('my transactions queries only completed orders while all orders includes every status',async()=>{
 let page,queries=[]
 vm.runInNewContext(fs.readFileSync('miniprogram/pages/my-transactions/index.js','utf8'),{
 Page:value=>page=value,require:name=>name.endsWith('/transactions')?{listTransactions:async(role,status)=>{queries.push(status);return {transactions:[],pendingCounts:{}}}}:name.endsWith('/transaction-state')?state:{},wx:{setNavigationBarTitle(){}},
 })
 page.setData=patch=>Object.assign(page.data,patch)
 await page.load();assert.equal(queries[0],'completed')
 page.onLoad({mode:'all'});await page.load();assert.equal(queries[1],'')
})

test('ongoing orders use persisted statuses across both roles and follow every page',async()=>{
 let service,requests=[]
 const context={module:{exports:{}},require:()=>({callCloud:async(name,input)=>{
 requests.push(input)
 assert.equal(input.role,'');assert.notEqual(input.status,'ongoing')
 if(input.status==='pending_seller')return {transactions:[{_id:'buyer-pending',status:'pending_seller',updatedAt:1}],nextCursor:null}
 return input.cursor?{transactions:[{_id:'older-handover',status:'awaiting_handover',updatedAt:0}],nextCursor:null}:{transactions:[{_id:'seller-handover',status:'awaiting_handover',updatedAt:2}],nextCursor:{id:'next'}}
 }})}
 vm.runInNewContext(fs.readFileSync('miniprogram/services/transactions.js','utf8'),context)
 service=context.module.exports;requests=[]
 const result=await service.listOngoingTransactions()
 assert.deepEqual(Array.from(result.transactions,row=>row._id),['seller-handover','buyer-pending','older-handover'])
 assert.equal(requests.length,3)
})

test('profile renders fetched ongoing orders through native templates and preserves each editing draft',async()=>{
 let page
 vm.runInNewContext(fs.readFileSync('miniprogram/pages/profile/index.js','utf8'),{
 Page:value=>page=value,
 require:name=>name.endsWith('/order-card-controller')?require('./miniprogram/services/order-card-controller'):name.endsWith('/transactions')?{listOngoingTransactions:async()=>({transactions:[{_id:'t',buyerId:'buyer',sellerId:'seller',status:'pending_seller',scheduledAt:Date.now()+3600000,campusId:'bupt-shahe',quantity:1,locationText:'Gate',postSnapshot:{title:'Item'}}],nextCursor:null})}:{},
 })
 page.setData=patch=>Object.assign(page.data,patch);page.ongoingToken={};page.data.user={_id:'buyer',profileCompleted:true}
 await page.loadOngoing()
 assert.equal(page.data.ongoing.length,1);assert.equal(page.data.ongoingViews.length,1);assert.equal(page.data.ongoingViews[0].canEdit,true)
 page.orderEdit({currentTarget:{dataset:{id:'t'}}})
 page.orderPatch({currentTarget:{dataset:{id:'t',field:'locationText'}},detail:{value:'New gate'}})
 await page.loadOngoing()
 assert.equal(page.data.ongoingViews[0].editing,true);assert.equal(page.data.ongoingViews[0].form.locationText,'New gate')
 const xml=fs.readFileSync('miniprogram/pages/profile/index.wxml','utf8')
 assert.doesNotMatch(xml,/<order-card\b/);assert.match(xml,/template is="ongoing-order"/)
 const config=JSON.parse(fs.readFileSync('miniprogram/pages/profile/index.json','utf8'))
 assert.equal(config.usingComponents['order-card'],undefined)
})
