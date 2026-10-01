const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),test=require('node:test')
const path='miniprogram/pages/profile/index'
function setup(fail=false){
 let page,saved
 const user={nickname:'旧昵称',avatarFileId:'cloud://avatar.jpg',campusId:'campus',profileCompleted:true}
 vm.runInNewContext(fs.readFileSync(path+'.js','utf8'),{
 Page:x=>page=x,
 setInterval:()=>1,clearInterval:()=>{},console:{warn(){}},
 require:()=>({
 listTransactions:async()=>({transactions:[],nextCursor:null}),getCurrentUser:async()=>user,getCampuses:async()=>[{campusId:'campus',name:'沙河'}],
 uploadAvatar:async()=> 'cloud://new.jpg',
 saveProfile:async input=>{saved=input;if(fail)throw Error('保存失败');return {...input,profileCompleted:true}},
 }),
 wx:{showToast:()=>{},navigateTo:()=>{}},
 })
 page.setData=x=>Object.assign(page.data,x)
 return {page,getSaved:()=>saved}
}
test('my page displays editable profile fields without a separate edit entry',()=>{
 const xml=fs.readFileSync(path+'.wxml','utf8')
 assert.doesNotMatch(xml,/bindtap="editProfile"/)
 assert.match(xml,/open-type="chooseAvatar"/)
 assert.match(xml,/type="nickname"/)
 assert.match(xml,/<picker/)
 assert.match(xml,/bindtap="save"/)
})
test('profile fields initialize and save directly on the my page',async()=>{
 const s=setup();await s.page.onShow()
 assert.equal(s.page.data.form.nickname,'旧昵称')
 s.page.onNicknameInput({detail:{value:'新昵称'}})
 await s.page.save()
 assert.equal(s.getSaved().nickname,'新昵称')
 assert.equal(s.page.data.dirty,false)
})
test('failed profile save keeps inline edits for retry',async()=>{
 const s=setup(true);await s.page.onShow()
 s.page.onNicknameInput({detail:{value:'新昵称'}})
 await s.page.save()
 assert.equal(s.page.data.form.nickname,'新昵称')
 assert.equal(s.page.data.dirty,true)
 assert.equal(s.page.data.message,'保存失败')
})
test('switching tabs retains unsaved edits',async()=>{
 const s=setup();await s.page.onShow()
 s.page.onNicknameInput({detail:{value:'草稿昵称'}})
 await s.page.onShow()
 assert.equal(s.page.data.form.nickname,'草稿昵称')
})

test('retrying campus load does not discard an edited nickname',async()=>{
 const s=setup();await s.page.onShow()
 s.page.onNicknameInput({detail:{value:'草稿'}})
 s.page.data.campuses=[]
 await s.page.retry()
 assert.equal(s.page.data.form.nickname,'草稿')
 assert.equal(s.page.data.campuses.length,1)
})