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
