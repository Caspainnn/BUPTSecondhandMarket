class MessageError extends Error {
  constructor(code, message) { super(message); this.name = 'MessageError'; this.code = code }
}

function requireActor(actor) {
  if (!actor || actor.status !== 'active' || !actor.profileCompleted) throw new MessageError('PROFILE_REQUIRED', '请先完善个人资料')
}

function requireParticipant(actor, conversation) {
  if (!conversation) throw new MessageError('CONVERSATION_NOT_FOUND', '会话不存在')
  if (conversation.buyerId !== actor._id && conversation.sellerId !== actor._id) throw new MessageError('FORBIDDEN', '你无权访问该会话')
  return conversation.buyerId === actor._id ? 'buyer' : 'seller'
}

function normalizeText(text) {
  if (typeof text !== 'string') throw new MessageError('INVALID_TEXT', '消息内容无效')
  const value = text.trim()
  if (!value || value.length > 500) throw new MessageError('INVALID_TEXT', '消息须为 1 至 500 个字符')
  return value
}

function normalizeRequestId(requestId) {
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.trim().length > 64) throw new MessageError('INVALID_REQUEST', '请求标识无效')
  return requestId.trim()
}

async function sendMessage({ actor, conversationId, text, requestId, messages, now }) {
  requireActor(actor)
  const normalizedText = normalizeText(text)
  const normalizedRequestId = normalizeRequestId(requestId)
  return messages.runTransaction(async (tx) => {
    const conversation = await tx.getConversation(conversationId)
    const role = requireParticipant(actor, conversation)
    const existing = await tx.findByRequest(conversationId, actor._id, normalizedRequestId)
    if (existing) return { message: existing, conversation }
    const message = await tx.createMessage({ conversationId, senderId: actor._id, recipientId: role === 'buyer' ? conversation.sellerId : conversation.buyerId, type: 'text', text: normalizedText, requestId: normalizedRequestId, createdAt: now })
    const patch = {
      lastMessageText: normalizedText,
      lastMessageType: 'text',
      lastMessageAt: now,
      updatedAt: now,
      buyerUnread: Number(conversation.buyerUnread || 0),
      sellerUnread: Number(conversation.sellerUnread || 0),
    }
    if (role === 'buyer') patch.sellerUnread += 1
    else patch.buyerUnread += 1
    return { message, conversation: await tx.updateConversation(conversationId, patch) }
  })
}

async function listMessages({ actor, conversationId, before, limit, messages }) {
  requireActor(actor)
  requireParticipant(actor, await messages.getConversation(conversationId))
  const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 50)
  const result = await messages.listMessages({ conversationId, before: before || null, limit: pageSize })
  return { messages: [...result.rows].reverse(), nextBefore: result.nextBefore || null }
}

async function markConversationRead({ actor, conversationId, messages, now }) {
  requireActor(actor)
  await messages.runTransaction(async (tx) => {
    const conversation = await tx.getConversation(conversationId)
    const role = requireParticipant(actor, conversation)
    const patch = role === 'buyer' ? { buyerUnread: 0, buyerLastReadAt: now } : { sellerUnread: 0, sellerLastReadAt: now }
    await tx.updateConversation(conversationId, patch)
  })
  return { unreadCount: 0, totalUnread: await messages.getTotalUnread(actor._id) }
}

module.exports = { MessageError, listMessages, markConversationRead, sendMessage }
