const cloud = require('wx-server-sdk')
const service = require('./transaction')

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
  const collections = {
    conversations: transaction.collection('conversations'),
    posts: transaction.collection('posts'),
    transactions: transaction.collection('transactions'),
    events: transaction.collection('transaction_events'),
    movements: transaction.collection('inventory_movements'),
    messages: transaction.collection('messages'),
  }
  const get = async (collection, id) => { try { return (await collection.doc(id).get()).data || null } catch (error) { return null } }
  const update = async (collection, id, patch) => {
    const data = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === undefined ? _.remove() : value]))
    await collection.doc(id).update({ data })
    return get(collection, id)
  }
  return {
    getConversation: (id) => get(collections.conversations, id),
    getPost: (id) => get(collections.posts, id),
    getTransaction: (id) => get(collections.transactions, id),
    async findActive(conversationId) { const result = await collections.transactions.where({ conversationId, activeKey: 'active' }).limit(1).get(); return result.data[0] || null },
    async findRequest(requestKey) {
      const event = await collections.events.where({ requestKey }).limit(1).get()
      if (event.data[0]) return get(collections.transactions, event.data[0].transactionId)
      const created = await collections.transactions.where({ createRequestKey: requestKey }).limit(1).get()
      return created.data[0] || null
    },
    async createTransaction(data) { const result = await collections.transactions.add({ data }); return { _id: result._id, ...data } },
    updateTransaction: (id, patch) => update(collections.transactions, id, patch),
    updatePost: (id, patch) => update(collections.posts, id, patch),
    async createEvent(data) { await collections.events.add({ data }) },
    async createMovement(data) { await collections.movements.add({ data }) },
    async createSystemMessage(data) { await collections.messages.add({ data: { ...data, requestId: data.requestKey } }) },
    async updateConversation(id, patch) { await update(collections.conversations, id, patch) },
  }
}

function repository() {
  const transactions = db.collection('transactions')
  const events = db.collection('transaction_events')
  const get = async (collection, id) => { try { return (await collection.doc(id).get()).data || null } catch (error) { return null } }
  return {
    async runTransaction(work) { return db.runTransaction((transaction) => work(transactionRepository(transaction))) },
    async list({ userId, role, status, cursor, limit }) {
      const participant = role ? { [`${role}Id`]: userId } : _.or([{ buyerId: userId }, { sellerId: userId }])
      const conditions = [participant]
      if (status) conditions.push({ status })
      if (cursor) conditions.push(_.or([{ updatedAt: _.lt(cursor.updatedAt) }, { updatedAt: _.eq(cursor.updatedAt), _id: _.lt(cursor.id) }]))
      const result = await transactions.where(_.and(conditions)).orderBy('updatedAt', 'desc').orderBy('_id', 'desc').limit(limit).get()
      const last = result.data[result.data.length - 1]
      return { rows: result.data, nextCursor: result.data.length === limit && last ? { updatedAt: last.updatedAt, id: last._id } : null }
    },
    async pendingCounts(userId) {
      const active = _.in(service.ACTIVE_STATUSES)
      const [buyer, seller] = await Promise.all([transactions.where({ buyerId: userId, status: active }).count(), transactions.where({ sellerId: userId, status: active }).count()])
      return { buyer: buyer.total, seller: seller.total }
    },
    getTransaction: (id) => get(transactions, id),
    async getEvents(transactionId) { return (await events.where({ transactionId }).orderBy('createdAt', 'asc').get()).data },
  }
}

exports.main = async (event = {}) => {
  try {
    const actor = await currentUser()
    const transactions = repository()
    const now = Date.now()
    const actions = {
      create: () => service.createTransaction({ actor, ...event, transactions, now }),
      withdraw: () => service.withdrawTransaction({ actor, ...event, transactions, now }),
      respond: () => service.respondTransaction({ actor, ...event, transactions, now }),
      cancel: () => service.cancelTransaction({ actor, ...event, transactions, now }),
      submitResult: () => service.submitTransactionResult({ actor, ...event, transactions, now }),
      list: () => service.listTransactions({ actor, ...event, transactions }),
      detail: () => service.getTransactionDetail({ actor, transactionId: event.transactionId, transactions }),
    }
    if (!actions[event.action]) throw Object.assign(new Error('不支持的交易操作'), { code: 'INVALID_ACTION' })
    return { ok: true, data: await actions[event.action]() }
  } catch (error) {
    return { ok: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message || '交易服务异常，请稍后重试' } }
  }
}
