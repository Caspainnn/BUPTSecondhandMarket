const COLLECTIONS = [
  'posts',
  'conversations',
  'messages',
  'transactions',
  'transaction_events',
  'inventory_movements',
]

const asc = (field) => ({ field, order: 'asc' })
const desc = (field) => ({ field, order: 'desc' })

const INDEXES = [
  { collection: 'posts', name: 'discovery', fields: [asc('status'), asc('campusId'), asc('availableQuantity'), desc('publishedAt'), desc('_id')] },
  { collection: 'posts', name: 'owner_posts', fields: [asc('ownerId'), asc('status'), desc('updatedAt')] },
  { collection: 'posts', name: 'owner_create_request', fields: [asc('ownerId'), asc('createRequestId')], unique: true },
  { collection: 'conversations', name: 'unique_conversation', fields: [asc('uniqueKey')], unique: true },
  { collection: 'conversations', name: 'buyer_conversations', fields: [asc('buyerId'), desc('updatedAt')] },
  { collection: 'conversations', name: 'seller_conversations', fields: [asc('sellerId'), desc('updatedAt')] },
  { collection: 'messages', name: 'conversation_messages', fields: [asc('conversationId'), desc('createdAt'), desc('_id')] },
  { collection: 'messages', name: 'sender_request', fields: [asc('senderId'), asc('requestId')], unique: true },
  { collection: 'transactions', name: 'buyer_transactions', fields: [asc('buyerId'), asc('status'), desc('updatedAt')] },
  { collection: 'transactions', name: 'seller_transactions', fields: [asc('sellerId'), asc('status'), desc('updatedAt')] },
  { collection: 'transactions', name: 'active_conversation', fields: [asc('conversationId'), asc('activeKey')], unique: true },
  { collection: 'transaction_events', name: 'transaction_events', fields: [asc('transactionId'), desc('createdAt')] },
  { collection: 'transaction_events', name: 'actor_request', fields: [asc('actorId'), asc('requestId')], unique: true },
  { collection: 'inventory_movements', name: 'post_movements', fields: [asc('postId'), desc('createdAt')] },
  { collection: 'inventory_movements', name: 'transaction_movements', fields: [asc('transactionId'), desc('createdAt')] },
]

const RULES = COLLECTIONS.map((collection) => ({
  collection,
  read: false,
  write: false,
}))

class SetupStage1Error extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SetupStage1Error'
    this.code = code
  }
}

async function setupStage1Database({ confirm, database }) {
  if (confirm !== 'INIT_STAGE_1') {
    throw new SetupStage1Error('INVALID_CONFIRM', '请输入正确的阶段 1 初始化确认口令')
  }

  try {
    for (const collection of COLLECTIONS) {
      await database.ensureCollection(collection)
    }
    return { collections: COLLECTIONS, indexes: INDEXES, rules: RULES }
  } catch (error) {
    if (error instanceof SetupStage1Error) throw error
    throw new SetupStage1Error('INTERNAL_ERROR', '阶段 1 数据库初始化失败，请查看云函数日志')
  }
}

module.exports = {
  COLLECTIONS,
  INDEXES,
  RULES,
  SetupStage1Error,
  setupStage1Database,
}
