const assert = require('node:assert/strict')
const test = require('node:test')

const {
  createPost,
  getPostDetail,
  listMyPosts,
  listPosts,
  setPostStatus,
  updatePost,
} = require('./post-service')

const actor = { _id: 'user-a', nickname: '甲', avatarFileId: 'cloud://env/a.jpg', profileCompleted: true, status: 'active' }
const input = {
  title: '出售显示器',
  description: '功能正常支持当面检查无坏点',
  imageFileIds: ['cloud://env/posts/a.jpg'],
  categoryId: 'digital',
  price: '100',
  totalQuantity: 2,
  conditionId: 'visible_wear',
  defectDescription: '',
  campusId: 'bupt-xitucheng',
}

function repository(seed = []) {
  const rows = seed.map((row) => ({ ...row }))
  return {
    rows,
    async findByCreateRequest(ownerId, requestId) { return rows.find((row) => row.ownerId === ownerId && row.createRequestId === requestId) || null },
    async create(data) { const row = { _id: `post-${rows.length + 1}`, ...data }; rows.push(row); return row },
    async findById(id) { return rows.find((row) => row._id === id) || null },
    async update(id, patch) { const row = rows.find((item) => item._id === id); Object.assign(row, patch); return row },
    async listPublic(query) { return { rows: rows.filter((row) => row.status === 'active' && row.availableQuantity > 0 && (!query.campusId || row.campusId === query.campusId)), nextCursor: null } },
    async listMine(query) { return { rows: rows.filter((row) => row.ownerId === query.ownerId && (!query.status || row.status === query.status)), nextCursor: null } },
  }
}

test('creates an active sale post and reuses the request result', async () => {
  const posts = repository()
  const first = await createPost({ actor, input, requestId: 'req-1', posts, now: 100 })
  const second = await createPost({ actor, input, requestId: 'req-1', posts, now: 200 })
  assert.equal(posts.rows.length, 1)
  assert.equal(second.post._id, first.post._id)
  assert.deepEqual(first.post, {
    _id: 'post-1', ownerId: 'user-a', ownerNickname: '甲', ownerAvatarFileId: 'cloud://env/a.jpg',
    title: '出售显示器', description: input.description, imageFileIds: input.imageFileIds,
    categoryId: 'digital', unitPriceCents: 10000, totalQuantity: 2, availableQuantity: 2,
    reservedQuantity: 0, soldQuantity: 0, conditionId: 'visible_wear', defectDescription: '',
    schoolId: 'bupt', campusId: 'bupt-xitucheng', status: 'active', createRequestId: 'req-1',
    publishedAt: 100, createdAt: 100, updatedAt: 100,
  })
})

test('requires an active completed profile for writes', async () => {
  for (const invalidActor of [null, { ...actor, profileCompleted: false }, { ...actor, status: 'disabled' }]) {
    await assert.rejects(createPost({ actor: invalidActor, input, requestId: 'x', posts: repository(), now: 1 }))
  }
})

test('updates only the owner and preserves reserved and sold inventory', async () => {
  const posts = repository([{ _id: 'p', ownerId: 'user-a', reservedQuantity: 1, soldQuantity: 1, status: 'active' }])
  const result = await updatePost({ actor, postId: 'p', input: { ...input, totalQuantity: 3 }, posts, now: 2 })
  assert.equal(result.post.availableQuantity, 1)
  await assert.rejects(updatePost({ actor: { ...actor, _id: 'other' }, postId: 'p', input, posts, now: 3 }))
  await assert.rejects(updatePost({ actor, postId: 'p', input: { ...input, totalQuantity: 1 }, posts, now: 3 }))
})

test('downlists and relists only owner posts with available inventory', async () => {
  const posts = repository([{ _id: 'p', ownerId: 'user-a', availableQuantity: 1, status: 'active' }])
  assert.equal((await setPostStatus({ actor, postId: 'p', status: 'offline', posts, now: 2 })).post.status, 'offline')
  assert.equal((await setPostStatus({ actor, postId: 'p', status: 'active', posts, now: 3 })).post.status, 'active')
  posts.rows[0].availableQuantity = 0
  await assert.rejects(setPostStatus({ actor, postId: 'p', status: 'active', posts, now: 4 }))
})

test('public listing is anonymous, campus-filtered, capped, and excludes unavailable posts', async () => {
  const posts = repository([
    { _id: 'a', ownerId: 'u', status: 'active', availableQuantity: 1, campusId: 'bupt-shahe', title: 'A', createRequestId: 'secret' },
    { _id: 'b', ownerId: 'u', status: 'active', availableQuantity: 0, campusId: 'bupt-shahe', title: 'B' },
  ])
  const result = await listPosts({ campusId: 'bupt-shahe', limit: 99, posts })
  assert.equal(result.posts.length, 1)
  assert.equal(result.query.limit, 20)
  assert.equal(result.posts[0].createRequestId, undefined)
  assert.equal(result.posts[0].ownerId, undefined)
})

test('owner listing requires identity and returns lifecycle states', async () => {
  const posts = repository([{ _id: 'p', ownerId: 'user-a', status: 'offline', availableQuantity: 1 }])
  assert.equal((await listMyPosts({ actor, status: 'offline', posts })).posts.length, 1)
  await assert.rejects(listMyPosts({ actor: null, posts }))
})

test('detail returns public fields without private idempotency data', async () => {
  const posts = repository([{ _id: 'p', ownerId: 'user-a', status: 'active', availableQuantity: 1, title: 'A', createRequestId: 'secret' }])
  const { post } = await getPostDetail({ postId: 'p', posts })
  assert.equal(post.title, 'A')
  assert.equal(post.createRequestId, undefined)
  assert.equal(post.ownerId, undefined)
  await assert.rejects(getPostDetail({ postId: 'missing', posts }))
})
