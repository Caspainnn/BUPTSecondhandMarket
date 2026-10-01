const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test')
function setup(){
 let definition;const requests=[],events=[]
 const wx={cloud:{getTempFileURL:async({fileList})=>{requests.push(fileList);return {fileList:fileList.map(fileID=>({fileID,status:0,tempFileURL:'https://example.com/image.jpg'}))}}}}
 vm.runInNewContext(fs.readFileSync('miniprogram/components/cloud-image/index.js','utf8'),{Component:x=>definition=x,wx})
 const instance={data:{},properties:{src:'cloud://env/image.jpg'},setData:x=>Object.assign(instance.data,x),triggerEvent:(...x)=>events.push(x),...definition.methods}
 return {definition,instance,requests,events,wx}
}
test('cloud image resolves file ID to HTTPS before rendering and retains local assets',async()=>{
 const s=setup()
 await s.instance.resolveSource('cloud://env/image.jpg')
 assert.equal(s.instance.data.resolvedSrc,'https://example.com/image.jpg')
 assert.equal(s.requests.length,1)
 await s.instance.resolveSource('/assets/icons/send.svg')
 assert.equal(s.instance.data.resolvedSrc,'/assets/icons/send.svg')
 assert.equal(s.requests.length,1)
})
test('failed cloud resolution does not render cloud ID as local path and emits error',async()=>{
 const s=setup();s.wx.cloud.getTempFileURL=async()=>({fileList:[{status:-1}]})
 await s.instance.resolveSource('cloud://env/image.jpg')
 assert.equal(s.instance.data.resolvedSrc,'')
 assert.equal(s.events[0][0],'error')
})
test('all dynamic image sources use global cloud image component',()=>{
 const app=JSON.parse(fs.readFileSync('miniprogram/app.json','utf8'))
 assert.equal(app.usingComponents['cloud-image'],'/components/cloud-image/index')
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name])
 for(const f of walk('miniprogram').filter(f=>f.endsWith('.wxml')&&!f.includes('/cloud-image/'))){
 assert.doesNotMatch(fs.readFileSync(f,'utf8'),/<image\b[^>]*src="{{/,f)
 }
})

test('each cloud image user explicitly declares the component dependency',()=>{
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name])
 for(const f of walk('miniprogram').filter(f=>f.endsWith('.wxml')&&!f.includes('/cloud-image/'))){
  if(!fs.readFileSync(f,'utf8').includes('<cloud-image'))continue
  const config=JSON.parse(fs.readFileSync(f.replace('.wxml','.json'),'utf8'))
  assert.equal(config.usingComponents?.['cloud-image'],'/components/cloud-image/index',f)
  for(const ext of ['js','json','wxml','wxss'])assert.ok(fs.existsSync('miniprogram/components/cloud-image/index.'+ext))
 }
})
