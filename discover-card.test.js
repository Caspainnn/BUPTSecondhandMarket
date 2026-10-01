const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs')
test('discover cards show readable campus names instead of internal IDs',()=>{
 const js=fs.readFileSync('miniprogram/pages/discover/index.js','utf8')
 const xml=fs.readFileSync('miniprogram/pages/discover/index.wxml','utf8')
 assert.match(js,/campusName:.*CAMPUSES.find/)
 assert.match(xml,/item.campusName/)
 assert.doesNotMatch(xml,/item.campusId/)
})
