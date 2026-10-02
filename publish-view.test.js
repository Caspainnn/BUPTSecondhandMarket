const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const test = require('node:test')

const read = (file) => fs.readFileSync(file, 'utf8')
const pagePath = 'miniprogram/pages/publish/index'
function loadPage() {
  let page
  vm.runInNewContext(read(pagePath + '.js'), {
    require: (name) => require(require('node:path').resolve('miniprogram/pages/publish', name)),
    Page: (definition) => { page = definition },
  })
  page.data = { ...page.data }
  page.setData = (patch) => Object.assign(page.data, patch)
  return page
}

test('publish defaults to selling and switching tabs preserves the draft', () => {
  const page = loadPage()
  assert.equal(page.data.activeTab, 'sell')
  const form = page.data.form
  form.title = '测试草稿'
  page.switchTab({ currentTarget: { dataset: { tab: 'wanted' } } })
  assert.equal(page.data.activeTab, 'wanted')
  page.switchTab({ currentTarget: { dataset: { tab: 'invalid' } } })
  assert.equal(page.data.activeTab, 'wanted')
  page.switchTab({ currentTarget: { dataset: { tab: 'sell' } } })
  assert.equal(page.data.activeTab, 'sell')
  assert.equal(page.data.form, form)
  assert.equal(page.data.form.title, '测试草稿')
})

test('publish exposes two tabs, a retained selling form and an honest wanted placeholder', () => {
  const wxml = read(pagePath + '.wxml')
  assert.match(wxml, /data-tab="sell"[^>]*bindtap="switchTab"[^>]*>发闲置</)
  assert.match(wxml, /data-tab="wanted"[^>]*bindtap="switchTab"[^>]*>求购</)
  assert.match(wxml, /hidden="{{activeTab !== 'sell'}}"[\s\S]*<post-form/)
  const placeholder = wxml.match(/<view wx:if="{{activeTab === 'wanted'}}"[\s\S]*<\/view>/)?.[0] || ''
  assert.match(placeholder, /后续开放/)
  for (const text of ['预算', '期望程度', '需求期限', '响应求购']) assert.ok(placeholder.includes(text))
  assert.doesNotMatch(placeholder, /<(?:button|input|textarea|post-form)\b|bindsubmit=/)
})

test('wanted mode cannot invoke the selling submission', async () => {
  const page = loadPage()
  page.data.activeTab = 'wanted'
  page.state = { status: 'idle', form: {} }
  page.apply = () => assert.fail('wanted placeholder must not start uploads')
  await page.submit()
})

test('single-line fields and pickers share a centered height while textarea keeps top padding', () => {
  const css = read('miniprogram/components/post-form/index.wxss')
  const shared = css.match(/\.field input,\s*\.picker\s*\{([^}]*)\}/)?.[1] || ''
  assert.match(shared, /height:\s*88rpx/)
  assert.match(shared, /padding:\s*0 22rpx/)
  assert.match(shared, /line-height:\s*86rpx/)
  const base = css.match(/\.field input,\s*\.field textarea,\s*\.picker\s*\{([^}]*)\}/)?.[1] || ''
  assert.match(base, /box-sizing:\s*border-box/)
  const textarea = css.match(/\.field textarea\s*\{([^}]*)\}/)?.[1] || ''
  assert.match(textarea, /height:\s*220rpx/)
  assert.match(textarea, /padding:\s*22rpx/)
  assert.match(textarea, /line-height:\s*1\.5/)
})

test('image cards use corner removal, no move controls, and an equally sized trailing add tile', () => {
  const wxml = read('miniprogram/components/post-form/index.wxml')
  const css = read('miniprogram/components/post-form/index.wxss')
  assert.match(wxml, /class="remove-image"[^>]*data-index="{{index}}"[^>]*bindtap="remove"[^>]*><image[^>]*src="\/assets\/icons\/close.svg"[^>]*\/><\/view>/)
  assert.doesNotMatch(wxml, /左移|右移|move-row|bindtap="move"/)
  assert.ok(wxml.indexOf('class="add-image"') > wxml.indexOf('class="remove-image"'))
  assert.match(wxml, /form.images.length < 6/)
  const tile = css.match(/\.image-item,\.add-image\{([^}]*)\}/)?.[1] || ''
  for (const rule of [/width:calc\(\(100% - 32rpx\) \/ 3\)/, /height:0/, /padding-bottom:calc\(\(100% - 32rpx\) \/ 3\)/, /flex:0 0 calc\(\(100% - 32rpx\) \/ 3\)/, /box-sizing:border-box/, /margin:0/]) assert.match(tile, rule)
  assert.match(css, /\.image-item\{position:relative/)
  const remove = css.match(/\.remove-image\{([^}]*)\}/)?.[1] || ''
  for (const rule of [/position:absolute/, /top:-12rpx/, /right:-12rpx/, /left:auto/]) assert.match(remove, rule)
})

test('corner removal forwards the tapped image index', () => {
  let component
  vm.runInNewContext(read('miniprogram/components/post-form/index.js'), {
    require: (name) => require(require('node:path').resolve('miniprogram/components/post-form', name)),
    Component: (definition) => { component = definition },
  })
  let event
  component.methods.remove.call({ triggerEvent: (name, detail) => { event = { name, index: detail.index } } },
    { currentTarget: { dataset: { index: '1' } } })
  assert.deepEqual(event, { name: 'removeimage', index: 1 })
})

test('provided vector icons are stored and reused for removal and campus selection', () => {
  assert.match(read('miniprogram/assets/icons/close.svg'), /fill="#999999"/)
  assert.match(read('miniprogram/assets/icons/dropdown.svg'), /fill="#707070"/)
  assert.match(read('miniprogram/components/post-form/index.wxml'), /class="picker dropdown-picker"[\s\S]*src="\/assets\/icons\/dropdown.svg"/)
})
test('every picker reuses the dropdown vector instead of text glyphs', () => {
  for (const file of ['components/post-form', 'pages/discover', 'pages/profile-edit', 'pages/transaction-create']) {
    const wxml = read('miniprogram/' + file + '/index.wxml')
    const pickers = [...wxml.matchAll(/<picker\b[\s\S]*?<\/picker>/g)]
    assert.ok(pickers.length)
    for (const picker of pickers) assert.match(picker[0], /src="\/assets\/icons\/dropdown.svg"/, file)
  }
})
test('image actions avoid native button defaults that override positioning and margins', () => {
  const wxml = read('miniprogram/components/post-form/index.wxml')
  const images = wxml.slice(0, wxml.indexOf('<label'))
  assert.doesNotMatch(images, /<button\b/)
  assert.match(images, /<view class="remove-image" aria-role="button"/)
  assert.match(images, /<view wx:if="{{form.images.length < 6}}" class="add-image" aria-role="button"/)
})
test('new publish forms restore the profile campus after saving without overriding a selected draft campus',()=>{
 const page=loadPage()
 const {createPostFormState}=require('./miniprogram/services/post-form-state')
 page.defaultCampusId='bupt-shahe';page.state=createPostFormState();page.sync()
 assert.equal(page.data.form.campusId,'bupt-shahe')
 page.apply({type:'PATCH_FORM',patch:{campusId:'bupt-xitucheng',title:'Draft'}})
 page.sync();assert.equal(page.data.form.campusId,'bupt-xitucheng')
 page.apply({type:'SAVE_SUCCESS',post:{_id:'post'}})
 assert.equal(page.data.form.campusId,'bupt-shahe');assert.equal(page.data.form.title,'')
})
