const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createPostListState,
  formatPrice,
  reducePostListState,
  selectDiscoverablePosts,
} = require('./post-list-state')

const post = (id, availableQuantity = 1) => ({ _id: id, availableQuantity, publishedAt: 100 })

test('defaults anonymous users to all and completed users to their campus', () => {
  assert.equal(createPostListState().campusId, '')
  assert.equal(createPostListState({ user: { profileCompleted: false, campusId: 'bupt-shahe' } }).campusId, '')
  assert.equal(createPostListState({ user: { profileCompleted: true, campusId: 'bupt-shahe' } }).campusId, 'bupt-shahe')
})

test('campus change resets pagination for the current session', () => {
  const loaded = { ...createPostListState(), posts: [post('old')], nextCursor: 'next', exhausted: false }
  const changed = reducePostListState(loaded, { type: 'CAMPUS_CHANGE', campusId: 'bupt-hainan' })
  assert.equal(changed.campusId, 'bupt-hainan')
  assert.deepEqual(changed.posts, [])
  assert.equal(changed.nextCursor, null)
})

test('refresh replaces rows while load more appends without duplicates', () => {
  let state = reducePostListState(createPostListState(), { type: 'LOAD_START', token: 'a', append: false })
  state = reducePostListState(state, { type: 'LOAD_SUCCESS', token: 'a', posts: [post('1'), post('2')], nextCursor: 'c1' })
  state = reducePostListState(state, { type: 'LOAD_START', token: 'b', append: true })
  state = reducePostListState(state, { type: 'LOAD_MORE_SUCCESS', token: 'b', posts: [post('2'), post('3')], nextCursor: null })
  assert.deepEqual(state.posts.map((item) => item._id), ['1', '2', '3'])
  assert.equal(state.exhausted, true)

  state = reducePostListState(state, { type: 'REFRESH' })
  assert.deepEqual(state.posts, [])
  assert.equal(state.exhausted, false)
})

test('ignores responses from stale requests', () => {
  let state = reducePostListState(createPostListState(), { type: 'LOAD_START', token: 'new', append: false })
  const unchanged = reducePostListState(state, { type: 'LOAD_SUCCESS', token: 'old', posts: [post('stale')], nextCursor: null })
  assert.deepEqual(unchanged.posts, [])
  assert.equal(unchanged.loading, true)
})

test('marks pagination exhausted when there is no next cursor', () => {
  let state = reducePostListState(createPostListState(), { type: 'LOAD_START', token: 'a', append: false })
  state = reducePostListState(state, { type: 'LOAD_SUCCESS', token: 'a', posts: [post('1')], nextCursor: null })
  assert.equal(state.exhausted, true)
})

test('formats free labels and integer-cent prices', () => {
  assert.equal(formatPrice(0), '免费赠送')
  assert.equal(formatPrice(1250), '¥12.50')
})

test('filters unavailable cards defensively', () => {
  assert.deepEqual(selectDiscoverablePosts([post('visible'), post('hidden', 0)]).map((item) => item._id), ['visible'])
})

test('range and conditions survive campus sort refresh and reset on filter reset', () => {
  let state = reducePostListState(createPostListState(), { type: 'FILTER_CHANGE', minPriceCents: 0, maxPriceCents: 10000, conditionIds: ['new'], direction: 'need' })
  assert.equal(state.direction, 'provide')
  assert.equal(state.contentType, 'item')
  for (const event of [{ type: 'CAMPUS_CHANGE', campusId: 'bupt-shahe' }, { type: 'SORT_CHANGE', sort: 'oldest' }, { type: 'REFRESH' }]) state = reducePostListState(state, event)
  assert.equal(state.minPriceCents, 0)
  assert.equal(state.maxPriceCents, 10000)
  assert.deepEqual(state.conditionIds, ['new'])
  state = reducePostListState(state, { type: 'FILTER_CHANGE', direction: '', contentType: '', categoryIds: [], conditionIds: [] })
  assert.equal(state.minPriceCents, null)
  assert.deepEqual(state.conditionIds, [])
})
