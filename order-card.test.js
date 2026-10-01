const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict'),test=require('node:test')
const state=require('./miniprogram/services/transaction-state')
function card() {
 let component,submitted=[]
 vm.runInNewContext(fs.readFileSync('miniprogram/components/order-card/index.js','utf8'),{
  Component:value=>component=value,
  require:name=>name.endsWith('/transactions')?{submitResult:async(id,result)=>submitted.push({id,result})}:require(path.resolve('miniprogram/components/order-card',name)),
  wx:{showModal:options=>options.success({confirm:true}),showToast(){}},console:{warn(){}},
 })
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

test('profile order card registration resolves to complete BOM-free component files',()=>{
 const config=JSON.parse(fs.readFileSync('miniprogram/pages/profile/index.json','utf8'))
 const base=path.resolve('miniprogram/pages/profile',config.usingComponents['order-card'])
 const app=JSON.parse(fs.readFileSync('miniprogram/app.json','utf8'))
 assert.equal(app.usingComponents['order-card'],'/components/order-card/index')
 for(const ext of ['js','json','wxml','wxss']){
  const data=fs.readFileSync(base+'.'+ext)
  assert.notEqual(data.subarray(0,3).toString('hex'),'efbbbf')
 }
 assert.equal(JSON.parse(fs.readFileSync(base+'.json','utf8')).component,true)
})
