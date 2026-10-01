const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

test('excludes mini program test files from packaging', () => {
  const config = JSON.parse(fs.readFileSync('project.config.json', 'utf8'))
  const ignored = config.packOptions.ignore.map((item) => item.value)
  const collect = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = `${directory}/${entry.name}`
    return entry.isDirectory() ? collect(fullPath) : [fullPath]
  })
  const tests = collect('miniprogram')
    .filter((file) => file.endsWith('.test.js'))
    .map((file) => file.replace(/^miniprogram\//, ''))

  assert.deepEqual(tests.filter((file) => !ignored.includes(file)), [])
})

test('wires the final four-tab navigation and every Stage 1 page', () => {
  const app = JSON.parse(fs.readFileSync('miniprogram/app.json', 'utf8'))
  assert.deepEqual(app.tabBar.list.map((item) => [item.pagePath, item.text]), [
    ['pages/discover/index', '发现'],
    ['pages/publish/index', '发布'],
    ['pages/messages/index', '消息'],
    ['pages/profile/index', '我的'],
  ])
  const requiredPages = [
    'pages/discover/index', 'pages/publish/index', 'pages/messages/index', 'pages/profile/index',
    'pages/profile-edit/index', 'pages/post-detail/index', 'pages/post-edit/index', 'pages/conversation/index',
    'pages/transaction-create/index', 'pages/transaction-detail/index', 'pages/my-posts/index', 'pages/my-transactions/index',
  ]
  assert.deepEqual(requiredPages.filter((page) => !app.pages.includes(page)), [])
  assert.equal(app.tabBar.list.some((item) => item.pagePath === 'pages/home/index'), false)
})

test('keeps every Stage 1 cloud function under the configured cloud root', () => {
  const config = JSON.parse(fs.readFileSync('project.config.json', 'utf8'))
  assert.equal(config.cloudfunctionRoot, 'cloudfunctions/')
  for (const name of ['setupStage1Database', 'postApi', 'conversationApi', 'messageApi', 'transactionApi']) {
    assert.equal(fs.existsSync(`${config.cloudfunctionRoot}${name}/index.js`), true, `${name} is deployable`)
  }
})
