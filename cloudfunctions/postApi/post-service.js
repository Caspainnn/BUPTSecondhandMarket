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
  if (existing) {
    if (existing.relistSourcePostId) { await ownedPost(actor, existing.relistSourcePostId, posts); await posts.update(existing.relistSourcePostId, { relistedAsPostId: existing._id }) }
    return { post: existing, created: false }
  }
  const normalized = validatePostInput(input)
  const sourceId = input.relistSourcePostId
  if (sourceId) {
    if (typeof sourceId !== 'string') throw new PostError('INVALID_POST', '重新上架来源无效')
    const source = await ownedPost(actor, sourceId, posts)
    if ((source.direction || 'provide') !== 'provide' || (source.contentType || 'item') !== 'item' || source.availableQuantity !== 0 || source.reservedQuantity > 0 || !(source.soldQuantity > 0)) throw new PostError('INVALID_POST', '只能重新发布已售完的物品')
  }
  const post = await posts.create({
    ownerId: actor._id,
    ownerNickname: actor.nickname,
    ownerAvatarFileId: actor.avatarFileId,
    ...normalized,
    ...(sourceId ? { relistSourcePostId: sourceId } : {}),
    ...(normalized.totalQuantity ? { availableQuantity: normalized.totalQuantity, reservedQuantity: 0, soldQuantity: 0 } : {}),
    status: 'active',
    createRequestId: normalizedRequestId,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  if (sourceId) await posts.update(sourceId, { relistedAsPostId: post._id })
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
  if ((current.direction || 'provide') !== normalized.direction || (current.contentType || 'item') !== normalized.contentType) throw new PostError('TYPE_IMMUTABLE', '已发布信息不能切换方向或物品/服务类型，请重新发布')
  if (normalized.direction === 'need' || normalized.contentType === 'service') {
    return { post: await posts.update(postId, { ...normalized, updatedAt: now }) }
  }
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
  if (current.status === 'completed') throw new PostError('NEED_COMPLETED', '已完成的需求不能重新开放，请重新发布')
  if (status === 'active' && (current.direction || 'provide') === 'provide' && (current.contentType || 'item') === 'item' && current.availableQuantity <= 0) throw new PostError('NO_AVAILABLE_STOCK', '商品暂无可预约库存')
  return { post: await posts.update(postId, { status, updatedAt: now }) }
}

async function listPosts({ campusId, direction, contentType, categoryId, categoryIds, sort = 'newest', priceSort = '', keyword = '', minPriceCents, maxPriceCents, conditionIds = [], cursor, limit, posts }) {
  if (direction && !['provide', 'need'].includes(direction)) throw new PostError('INVALID_TYPE', '信息方向无效')
  if (contentType && !['item', 'service'].includes(contentType)) throw new PostError('INVALID_TYPE', '内容类型无效')
  if (!['comprehensive', 'newest', 'oldest', 'price_asc', 'price_desc'].includes(sort)) throw new PostError('INVALID_SORT', '排序方式无效')
  if (!['', 'price_asc', 'price_desc'].includes(priceSort)) throw new PostError('INVALID_SORT', '价格排序方式无效')
  if (typeof keyword !== 'string' || [...keyword.trim()].length > 50) throw new PostError('INVALID_SEARCH', '搜索词不能超过 50 个字符')
  for (const value of [minPriceCents, maxPriceCents]) {
    if (value != null && (!Number.isSafeInteger(value) || value < 0 || value > 99999999)) throw new PostError('INVALID_PRICE_RANGE', '请输入有效价格区间')
  }
  if (minPriceCents != null && maxPriceCents != null && minPriceCents > maxPriceCents) throw new PostError('INVALID_PRICE_RANGE', '最低价格不能高于最高价格')
  if (!Array.isArray(conditionIds) || conditionIds.length > 5 || conditionIds.some(id => !['new', 'like_new', 'visible_wear', 'worn_functional', 'partially_faulty'].includes(id))) throw new PostError('INVALID_CONDITION', '物品成色无效')
  if (conditionIds.length) { direction = 'provide'; contentType = 'item' }
  const selected = categoryIds === undefined ? (categoryId ? [categoryId] : []) : categoryIds
  if (!Array.isArray(selected) || selected.length > 8 || selected.some(id => !['digital', 'books', 'mobility', 'daily', 'fashion', 'sports', 'tickets', 'other'].includes(id))) throw new PostError('INVALID_CATEGORY', '物品分类无效')
  const query = { ...(minPriceCents != null ? { minPriceCents } : {}), ...(maxPriceCents != null ? { maxPriceCents } : {}), conditionIds: [...new Set(conditionIds)], keyword: keyword.trim(), sort: priceSort || sort, timeSort: sort === 'oldest' ? 'asc' : 'desc', campusId: campusId || '', ...(direction ? { direction } : {}), ...(contentType ? { contentType } : {}), ...(selected.length && contentType !== 'service' ? { categoryIds: [...new Set(selected)], contentType: 'item' } : {}), cursor: cursor || null, limit: Math.min(Math.max(Number(limit) || 20, 1), 20) }
  const result = await posts.listPublic(query)
  return { posts: result.rows.map(publicPost), nextCursor: result.nextCursor, query }
}

async function listMyPosts({ actor, status, cursor, limit, posts }) {
  requireWriter(actor)
  const result = await posts.listMine({ excludeRepublished: true, ownerId: actor._id, status: status || '', cursor: cursor || null, limit: Math.min(Math.max(Number(limit) || 20, 1), 20) })
  return { posts: result.rows.filter(post => !post.relistedAsPostId), nextCursor: result.nextCursor }
}

async function getPostDetail({ actor, postId, posts }) {
  const post = await posts.findById(postId)
  if (!post) throw new PostError('POST_NOT_FOUND', '商品不存在')
  return { post: { ...publicPost(post), isOwner: Boolean(actor && actor._id === post.ownerId) } }
}

module.exports = { createPost, getPostDetail, listMyPosts, listPosts, setPostStatus, updatePost }
