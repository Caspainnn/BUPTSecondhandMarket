const test = require('node:test')
const assert = require('node:assert/strict')

const { ConversationError, listConversations, openConversation } = require('./conversation')

const buyer = { _id: 'buyer-1', nickname: '买家', avatarFileId: 'cloud://buyer.jpg', status: 'active', profileCompleted: true }
const seller = { _id: 'seller-1', nickname: '卖家', avatarFileId: 'cloud://seller.jpg', status: 'active', profileCompleted: true }
const salePost = { _id: 'post-1', ownerId: seller._id, ownerNickname: seller.nickname, ownerAvatarFileId: seller.avatarFileId, title: '二手书', imageFileIds: ['cloud://cover.jpg'], unitPriceCents: 1200, status: 'active', availableQuantity: 2 }

function repository({ post = salePost, conversations = [], duplicateOnce = false } = {}) {
  let duplicate = duplicateOnce
  const rows = conversations
  return {
    rows,
    async findPost(id) { return id === post?._id ? post : null },
    async findByKey(key) { return rows.find((item) => item.uniqueKey === key) || null },
    async create(data) {
      if (duplicate) { duplicate = false; if (!rows.some((item) => item.uniqueKey === data.uniqueKey)) rows.push({ _id: 'winner', ...data }); throw Object.assign(new Error('duplicate'), { code: 'DUPLICATE_KEY' }) }
      const row = { _id: `c-${rows.length + 1}`, ...data }; rows.push(row); return row
    },
    async list({ userId, limit }) { return { rows: rows.filter((item) => item.buyerId === userId || item.sellerId === userId).slice(0, limit), nextCursor: null } },
    async getTotalUnread(userId) { return rows.reduce((sum, item) => sum + (item.buyerId === userId ? Number(item.buyerUnread || 0) : item.sellerId === userId ? Number(item.sellerUnread || 0) : 0), 0) },
  }
}

test('opens once and reuses the deterministic post-buyer-seller conversation', async () => {
  const conversations = repository()
  const first = await openConversation({ actor: buyer, postId: salePost._id, requestId: 'r1', conversations, now: 100 })
  const second = await openConversation({ actor: buyer, postId: salePost._id, requestId: 'r2', conversations, now: 200 })
  assert.equal(first.conversation._id, second.conversation._id)
  assert.equal(first.conversation.uniqueKey, 'post-1:buyer-1:seller-1')
  assert.equal(conversations.rows.length, 1)
})

test('recovers the winner after a simultaneous unique-key conflict', async () => {
  const conversations = repository({ duplicateOnce: true })
  const result = await openConversation({ actor: buyer, postId: salePost._id, requestId: 'r1', conversations, now: 100 })
  assert.equal(result.conversation._id, 'winner')
  assert.equal(conversations.rows.length, 1)
})

test('records fixed buyer and seller roles with post snapshot', async () => {
  const { conversation } = await openConversation({ actor: buyer, postId: salePost._id, requestId: 'r1', conversations: repository(), now: 100 })
  assert.equal(conversation.buyerId, buyer._id)
  assert.equal(conversation.sellerId, seller._id)
  assert.deepEqual(conversation.postSnapshot, { direction: 'provide', contentType: 'item', postId: 'post-1', title: '二手书', coverFileId: 'cloud://cover.jpg', unitPriceCents: 1200 })
})

test('requires a complete active profile and a bounded request id', async () => {
  for (const actor of [null, { ...buyer, profileCompleted: false }, { ...buyer, status: 'disabled' }]) {
    await assert.rejects(openConversation({ actor, postId: 'post-1', requestId: 'r', conversations: repository(), now: 1 }), (error) => error.code === 'PROFILE_REQUIRED')
  }
  await assert.rejects(openConversation({ actor: buyer, postId: 'post-1', requestId: '', conversations: repository(), now: 1 }), (error) => error.code === 'INVALID_REQUEST')
})

test('rejects self-contact and unavailable new conversations', async () => {
  await assert.rejects(openConversation({ actor: seller, postId: 'post-1', requestId: 'r', conversations: repository(), now: 1 }), (error) => error.code === 'SELF_CONTACT')
  for (const post of [{ ...salePost, status: 'offline' }, { ...salePost, availableQuantity: 0 }]) {
    await assert.rejects(openConversation({ actor: buyer, postId: 'post-1', requestId: 'r', conversations: repository({ post }), now: 1 }), (error) => error.code === 'POST_UNAVAILABLE')
  }
})

test('reuses an existing historical conversation even after the post is unavailable', async () => {
  const existing = { _id: 'old', uniqueKey: 'post-1:buyer-1:seller-1', buyerId: buyer._id, sellerId: seller._id }
  const conversations = repository({ post: { ...salePost, status: 'offline' }, conversations: [existing] })
  assert.equal((await openConversation({ actor: buyer, postId: 'post-1', requestId: 'r', conversations, now: 1 })).conversation._id, 'old')
})

test('lists only participant conversations and totals unread beyond the current page', async () => {
  const rows = [
    { _id: 'a', buyerId: buyer._id, sellerId: seller._id, buyerUnread: 2, sellerUnread: 5 },
    { _id: 'b', buyerId: 'other', sellerId: buyer._id, buyerUnread: 8, sellerUnread: 3 },
    { _id: 'hidden', buyerId: 'x', sellerId: 'y', buyerUnread: 99, sellerUnread: 99 },
  ]
  const result = await listConversations({ actor: buyer, limit: 1, conversations: repository({ conversations: rows }) })
  assert.deepEqual(result.conversations.map((item) => item._id), ['a'])
  assert.equal(result.totalUnread, 5)
})

test('rejects unsupported repository failures with a stable domain error type', () => {
  assert.equal(new ConversationError('X', 'x').code, 'X')
})
