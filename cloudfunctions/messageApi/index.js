const cloud = require('wx-server-sdk')
const service = require('./message')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function currentUser() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return null
  const result = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
  return result.data[0] || null
}

function transactionRepository(transaction) {
  const conversations = transaction.collection('conversations')
  const messages = transaction.collection('messages')
  return {
    async getPost(id) { try { return (await transaction.collection('posts').doc(id).get()).data || null } catch (error) { return null } },
    async getConversation(id) { try { return (await conversations.doc(id).get()).data || null } catch (error) { return null } },
    async findByRequest(conversationId, senderId, requestId) { const result = await messages.where({ conversationId, senderId, requestId }).limit(1).get(); return result.data[0] || null },
    async createMessage(data) { const result = await messages.add({ data }); return { _id: result._id, ...data } },
    async updateConversation(id, patch) { await conversations.doc(id).update({ data: patch }); return (await conversations.doc(id).get()).data },
  }
}

function repository() {
  const conversations = db.collection('conversations')
  const messages = db.collection('messages')
  return {
    async runTransaction(work) { return db.runTransaction((transaction) => work(transactionRepository(transaction))) },
    async getConversation(id) { try { return (await conversations.doc(id).get()).data || null } catch (error) { return null } },
    async getUser(id) { try { return (await db.collection('users').doc(id).get()).data || null } catch (error) { return null } },
    async getTransactions(ids) { return (await db.collection('transactions').where({ _id: _.in(ids) }).limit(50).get()).data },
    async listMessages({ conversationId, before, limit }) {
      const conditions = [{ conversationId }]
      if (before) conditions.push(_.or([{ createdAt: _.lt(before.createdAt) }, { createdAt: _.eq(before.createdAt), _id: _.lt(before.id) }]))
      const result = await messages.where(_.and(conditions)).orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(limit).get()
      const last = result.data[result.data.length - 1]
      return { rows: result.data, nextBefore: result.data.length === limit && last ? { createdAt: last.createdAt, id: last._id } : null }
    },
    async getTotalUnread(userId) {
      const aggregate = db.command.aggregate
      const [buyer, seller] = await Promise.all([
        conversations.aggregate().match({ buyerId: userId }).group({ _id: null, total: aggregate.sum('$buyerUnread') }).end(),
        conversations.aggregate().match({ sellerId: userId }).group({ _id: null, total: aggregate.sum('$sellerUnread') }).end(),
      ])
      return Number((buyer.list[0] || {}).total || 0) + Number((seller.list[0] || {}).total || 0)
    },
  }
}

exports.main = async (event = {}) => {
  try {
    const actor = await currentUser()
    const messages = repository()
    const actions = {
      send: () => service.sendMessage({ actor, conversationId: event.conversationId, text: event.text, requestId: event.requestId, messages, now: db.serverDate() }),
      sendPostCard: () => service.sendPostCard({ actor, conversationId: event.conversationId, postId: event.postId, requestId: event.requestId, messages, now: db.serverDate() }),
      list: () => service.listMessages({ actor, conversationId: event.conversationId, before: event.before, limit: event.limit, messages }),
      markRead: () => service.markConversationRead({ actor, conversationId: event.conversationId, messages, now: db.serverDate() }),
    }
    if (!actions[event.action]) throw Object.assign(new Error('不支持的消息操作'), { code: 'INVALID_ACTION' })
    return { ok: true, data: await actions[event.action]() }
  } catch (error) {
    return { ok: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message || '消息服务异常，请稍后重试' } }
  }
}
