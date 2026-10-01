class ConversationError extends Error {
  constructor(code, message) { super(message); this.name = 'ConversationError'; this.code = code }
}

function requireActor(actor) {
  if (!actor || actor.status !== 'active' || !actor.profileCompleted) throw new ConversationError('PROFILE_REQUIRED', '请先完善个人资料')
}

function requireRequestId(requestId) {
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.trim().length > 64) throw new ConversationError('INVALID_REQUEST', '请求标识无效')
  return requestId.trim()
}

function uniqueKey(postId, buyerId, sellerId) { return `${postId}:${buyerId}:${sellerId}` }
function isDuplicate(error) { return error && (error.code === 'DUPLICATE_KEY' || error.errCode === -502001 || /duplicate/i.test(error.message || '')) }

async function openConversation({ actor, postId, requestId, conversations, now }) {
  requireActor(actor)
  const normalizedRequestId = requireRequestId(requestId)
  const post = await conversations.findPost(postId)
  if (!post) throw new ConversationError('POST_NOT_FOUND', '商品不存在')
  if (post.ownerId === actor._id) throw new ConversationError('SELF_CONTACT', '不能联系自己发布的商品')
  const key = uniqueKey(post._id, actor._id, post.ownerId)
  const existing = await conversations.findByKey(key)
  if (existing) return { conversation: existing, created: false }
  if (post.status !== 'active' || post.availableQuantity <= 0) throw new ConversationError('POST_UNAVAILABLE', '商品当前不可预约')
  const data = {
    uniqueKey: key,
    postId: post._id,
    buyerId: actor._id,
    sellerId: post.ownerId,
    buyerSnapshot: { nickname: actor.nickname, avatarFileId: actor.avatarFileId },
    sellerSnapshot: { nickname: post.ownerNickname, avatarFileId: post.ownerAvatarFileId },
    postSnapshot: { postId: post._id, title: post.title, coverFileId: post.imageFileIds[0], unitPriceCents: post.unitPriceCents },
    buyerUnread: 0,
    sellerUnread: 0,
    lastMessageText: '',
    lastMessageType: '',
    lastMessageAt: now,
    openRequestId: normalizedRequestId,
    createdAt: now,
    updatedAt: now,
  }
  try { return { conversation: await conversations.create(data), created: true } }
  catch (error) {
    if (!isDuplicate(error)) throw error
    const winner = await conversations.findByKey(key)
    if (!winner) throw new ConversationError('CONCURRENT_CREATE_FAILED', '会话创建冲突，请重试')
    return { conversation: winner, created: false }
  }
}

async function listConversations({ actor, cursor, limit, conversations }) {
  requireActor(actor)
  const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 20)
  const result = await conversations.list({ userId: actor._id, cursor: cursor || null, limit: pageSize })
  const rows = result.rows.filter((row) => row.buyerId === actor._id || row.sellerId === actor._id)
  const totalUnread = await conversations.getTotalUnread(actor._id)
  return { conversations: rows, nextCursor: result.nextCursor || null, totalUnread }
}

module.exports = { ConversationError, listConversations, openConversation, uniqueKey }
