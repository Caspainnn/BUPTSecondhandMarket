const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
function queryCommand() {
  const evaluate = (row, condition) => typeof condition === 'function' ? condition(row) : Object.entries(condition).every(([key, value]) => typeof value === 'function' ? value(row[key]) : row[key] === value)
  return { and: parts => row => parts.every(part => evaluate(row, part)), or: parts => row => parts.some(part => evaluate(row, part)), gt: value => candidate => candidate != null && candidate > value, lt: value => candidate => candidate < value, eq: value => candidate => candidate === value, exists: value => candidate => (candidate !== undefined) === value }
}
function loadApi(path, database, service) {
  const exports = {}
  const cloud = { init() {}, DYNAMIC_CURRENT_ENV: 'env', database: () => database, getWXContext: () => ({ OPENID: 'trusted' }) }
  vm.runInNewContext(fs.readFileSync(path, 'utf8'), { exports, require: name => name === 'wx-server-sdk' ? cloud : service || require(require('node:path').resolve(require('node:path').dirname(path), name)) })
  return exports.main
}
test('stage2 real post repository paginates mixed local and all-campus services without gaps', async () => {
  const rows = Array.from({ length: 27 }, (_, i) => ({ _id: String(i).padStart(2, '0'), publishedAt: i + 1, status: 'active', direction: i % 3 === 0 ? 'need' : 'provide', contentType: i % 2 === 0 ? 'service' : 'item', campusId: i % 2 === 0 ? '' : 'bupt-shahe', availableQuantity: 1 }))
  rows.push({ _id: 'foreign', publishedAt: 100, status: 'active', campusId: 'bupt-hainan', availableQuantity: 1 })
  rows.push({ _id: 'sold', publishedAt: 101, status: 'active', campusId: 'bupt-shahe', availableQuantity: 0 })
  let predicate, size
  const collection = { where(condition) { predicate = condition; return this }, orderBy() { return this }, limit(value) { size = value; return this }, async get() { return { data: rows.filter(predicate).sort((a, b) => b.publishedAt - a.publishedAt).slice(0, size) } } }
  const main = loadApi('cloudfunctions/postApi/index.js', { command: queryCommand(), collection: () => collection })
  const first = await main({ action: 'list', campusId: 'bupt-shahe', limit: 20 })
  const second = await main({ action: 'list', campusId: 'bupt-shahe', limit: 20, cursor: first.data.nextCursor })
  assert.equal(first.ok, true); assert.equal(second.ok, true)
  const ids = [...first.data.posts, ...second.data.posts].map(row => row._id)
  assert.equal(ids.length, 27); assert.equal(new Set(ids).size, 27)
  const needed = await main({ action: 'list', campusId: 'bupt-shahe', direction: 'need' })
  assert.equal(needed.data.posts.length, 9)
  assert.ok(needed.data.posts.every(row => row.direction === 'need'))
  const services = await main({ action: 'list', contentType: 'service' })
  assert.equal(services.data.posts.length, 14)
  assert.ok(services.data.posts.every(row => row.contentType === 'service'))
  rows[1].categoryId = 'books'
  const books = await main({ action: 'list', contentType: 'item', categoryId: 'books' })
  assert.deepEqual(books.data.posts.map(row => row._id), ['01'])
  rows[3].categoryId = 'digital'
  const multiple = await main({ action: 'list', categoryIds: ['books', 'digital'] })
  assert.deepEqual(multiple.data.posts.map(row => row._id), ['03', '01'])
  const invalid = await main({ action: 'list', categoryIds: ['unknown'] })
  assert.equal(invalid.ok, false)
  rows[1].title = 'Bike [repair]'
  rows[3].description = 'bike [repair] nearby'
  const searchMain = loadApi('cloudfunctions/postApi/index.js', { command: queryCommand(), collection: () => collection, RegExp: ({ regexp, options }) => value => new RegExp(regexp, options).test(value || '') })
  const searched = await searchMain({ action: 'list', keyword: ' [repair] ', categoryIds: ['books', 'digital'], limit: 1 })
  assert.equal(searched.ok, true)
  assert.equal(searched.data.posts[0]._id, '03')
  const nextSearch = await searchMain({ action: 'list', keyword: '[repair]', categoryIds: ['books', 'digital'], limit: 1, cursor: searched.data.nextCursor })
  assert.equal(nextSearch.data.posts[0]._id, '01')
  const noMatch = await searchMain({ action: 'list', keyword: '.*' })
  assert.equal(noMatch.data.posts.length, 0)
})
test('discovery sorts all pages by price with ties and puts negotiable posts last', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ _id: String(i).padStart(2, '0'), publishedAt: i, status: 'active', availableQuantity: 1, unitPriceCents: i < 22 ? Math.floor(i / 2) * 100 : null }))
  let predicate, size, orders
  const collection = { where(condition) { predicate = condition; orders = []; return this }, orderBy(field, direction) { orders.push([field, direction]); return this }, limit(value) { size = value; return this }, async get() { return { data: rows.filter(predicate).sort((a, b) => { for (const [field, direction] of orders) { const comparison = a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0; if (comparison) return direction === 'asc' ? comparison : -comparison } return 0 }).slice(0, size) } } }
  const main = loadApi('cloudfunctions/postApi/index.js', { command: queryCommand(), collection: () => collection })
  for (const sort of ['price_asc', 'price_desc', 'oldest', 'newest']) {
    let cursor = null, found = []
    do {
      const result = await main({ action: 'list', sort, limit: 5, cursor })
      assert.equal(result.ok, true)
      found.push(...result.data.posts); cursor = result.data.nextCursor
    } while (cursor)
    assert.equal(found.length, 25); assert.equal(new Set(found.map(p => p._id)).size, 25)
    if (sort.startsWith('price_')) {
      assert.ok(found.slice(-3).every(p => p.unitPriceCents === null))
      const prices = found.slice(0, 22).map(p => p.unitPriceCents)
      assert.deepEqual(prices, [...prices].sort((a, b) => sort === 'price_asc' ? a - b : b - a))
    } else assert.equal(found[0].publishedAt, sort === 'oldest' ? 0 : 24)
  }
})

test('stage2 transaction API ignores a forged client actor', async () => {
  const actor = { _id: 'trusted-user', status: 'active', profileCompleted: true }
  const database = { command: {}, collection: () => ({ where() { return this }, limit() { return this }, async get() { return { data: [actor] } } }) }
  const main = loadApi('cloudfunctions/transactionApi/index.js', database, { createTransaction: async input => ({ actor: input.actor }) })
  const result = await main({ action: 'create', actor: { _id: 'forged' } })
  assert.equal(result.data.actor._id, 'trusted-user')
})
