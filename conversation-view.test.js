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
