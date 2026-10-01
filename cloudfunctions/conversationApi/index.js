const cloud = require('wx-server-sdk')
const service = require('./conversation')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function currentUser() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return null
  const result = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
  return result.data[0] || null
}

function repository() {
  const conversations = db.collection('conversations')
  return {
    async findPost(id) { try { return (await db.collection('posts').doc(id).get()).data || null } catch (error) { return null } },
    async findByKey(key) { const result = await conversations.where({ uniqueKey: key }).limit(1).get(); return result.data[0] || null },
    async create(data) { const result = await conversations.add({ data }); return { _id: result._id, ...data } },
    async list({ userId, cursor, limit }) {
      const conditions = [_.or([{ buyerId: userId }, { sellerId: userId }])]
      if (cursor) conditions.push(_.or([{ updatedAt: _.lt(cursor.updatedAt) }, { updatedAt: _.eq(cursor.updatedAt), _id: _.lt(cursor.id) }]))
      const result = await conversations.where(_.and(conditions)).orderBy('updatedAt', 'desc').orderBy('_id', 'desc').limit(limit).get()
      const last = result.data[result.data.length - 1]
      return { rows: result.data, nextCursor: result.data.length === limit && last ? { updatedAt: last.updatedAt, id: last._id } : null }
    },
    async getTotalUnread(userId) {
      const [buyer, seller] = await Promise.all([
        conversations.aggregate().match({ buyerId: userId }).group({ _id: null, total: db.command.aggregate.sum('$buyerUnread') }).end(),
        conversations.aggregate().match({ sellerId: userId }).group({ _id: null, total: db.command.aggregate.sum('$sellerUnread') }).end(),
      ])
      return Number((buyer.list[0] || {}).total || 0) + Number((seller.list[0] || {}).total || 0)
    },
  }
}

exports.main = async (event = {}) => {
  try {
    const actor = await currentUser()
    const conversations = repository()
    const actions = {
      open: () => service.openConversation({ actor, postId: event.postId, requestId: event.requestId, conversations, now: db.serverDate() }),
      list: () => service.listConversations({ actor, cursor: event.cursor, limit: event.limit, conversations }),
    }
    if (!actions[event.action]) throw Object.assign(new Error('不支持的会话操作'), { code: 'INVALID_ACTION' })
    return { ok: true, data: await actions[event.action]() }
  } catch (error) {
    return { ok: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message || '会话服务异常，请稍后重试' } }
  }
}
