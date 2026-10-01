const { PostError, validateInventoryEdit, validatePostInput } = require('./post')

function requireWriter(actor) {
  if (!actor || actor.status !== 'active' || !actor.profileCompleted) {
    throw new PostError('PROFILE_REQUIRED', '请先完善个人资料')
  }
}

function requireRequestId(requestId) {
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 64) {
    throw new PostError('INVALID_REQUEST', '请求标识无效')
  }
  return requestId.trim()
}

function publicPost(post) {
  const { createRequestId, ownerId, ...result } = post
  return result
}

async function createPost({ actor, input, requestId, posts, now }) {
  requireWriter(actor)
  const normalizedRequestId = requireRequestId(requestId)
  const existing = await posts.findByCreateRequest(actor._id, normalizedRequestId)
  if (existing) return { post: existing, created: false }
  const normalized = validatePostInput(input)
  const post = await posts.create({
    ownerId: actor._id,
    ownerNickname: actor.nickname,
    ownerAvatarFileId: actor.avatarFileId,
    ...normalized,
    availableQuantity: normalized.totalQuantity,
    reservedQuantity: 0,
    soldQuantity: 0,
    status: 'active',
    createRequestId: normalizedRequestId,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  return { post, created: true }
}

async function ownedPost(actor, postId, posts) {
  requireWriter(actor)
  const post = await posts.findById(postId)
  if (!post) throw new PostError('POST_NOT_FOUND', '商品不存在')
  if (post.ownerId !== actor._id) throw new PostError('FORBIDDEN', '你没有权限操作该商品')
  return post
}

async function updatePost({ actor, postId, input, posts, now }) {
  const current = await ownedPost(actor, postId, posts)
  const normalized = validatePostInput(input)
  validateInventoryEdit({
    totalQuantity: normalized.totalQuantity,
    reservedQuantity: current.reservedQuantity,
    soldQuantity: current.soldQuantity,
  })
  const availableQuantity = normalized.totalQuantity - current.reservedQuantity - current.soldQuantity
  const post = await posts.update(postId, { ...normalized, availableQuantity, updatedAt: now })
  return { post }
}

async function setPostStatus({ actor, postId, status, posts, now }) {
  const current = await ownedPost(actor, postId, posts)
  if (!['active', 'offline'].includes(status)) throw new PostError('INVALID_STATUS', '商品状态无效')
  if (status === 'active' && current.availableQuantity <= 0) throw new PostError('NO_AVAILABLE_STOCK', '商品暂无可预约库存')
  return { post: await posts.update(postId, { status, updatedAt: now }) }
}

async function listPosts({ campusId, cursor, limit, posts }) {
  const query = { campusId: campusId || '', cursor: cursor || null, limit: Math.min(Math.max(Number(limit) || 20, 1), 20) }
  const result = await posts.listPublic(query)
  return { posts: result.rows.map(publicPost), nextCursor: result.nextCursor, query }
}

async function listMyPosts({ actor, status, cursor, limit, posts }) {
  requireWriter(actor)
  const result = await posts.listMine({ ownerId: actor._id, status: status || '', cursor: cursor || null, limit: Math.min(Math.max(Number(limit) || 20, 1), 20) })
  return { posts: result.rows, nextCursor: result.nextCursor }
}

async function getPostDetail({ actor, postId, posts }) {
  const post = await posts.findById(postId)
  if (!post) throw new PostError('POST_NOT_FOUND', '商品不存在')
  return { post: { ...publicPost(post), isOwner: Boolean(actor && actor._id === post.ownerId) } }
}

module.exports = { createPost, getPostDetail, listMyPosts, listPosts, setPostStatus, updatePost }
