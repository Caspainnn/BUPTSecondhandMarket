const cloud = require('wx-server-sdk')
const service = require('./transaction')
const subscription = require('./subscription')
const subscriptionConfig = subscription.getSubscriptionConfig()
const { runPageRefreshBatch } = require('./timer')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function currentUser() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return null
  const result = await db.collection('users').where({ _openid: OPENID }).limit(1).get()
  return result.data[0] || null
}

function transactionRepository(transaction, subscriptionIntents = []) {
  const collections = {
    conversations: transaction.collection('conversations'),
    posts: transaction.collection('posts'),
    transactions: transaction.collection('transactions'),
    events: transaction.collection('transaction_events'),
    movements: transaction.collection('inventory_movements'),
    messages: transaction.collection('messages'),
    users: transaction.collection('users'),
    deliveries: transaction.collection('subscription_deliveries'),
  }
  const get = async (collection, id) => { try { return (await collection.doc(id).get()).data || null } catch (error) { return null } }
  const update = async (collection, id, patch) => {
    const data = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === undefined ? _.remove() : value]))
    await collection.doc(id).update({ data })
    return get(collection, id)
  }
  const adapter = {
    getUser: (id) => get(collections.users, id),
    getDelivery: (id) => get(collections.deliveries, id),
    async createDelivery(id, data) { await collections.deliveries.doc(id).set({ data }); return { _id: id, ...data } },
    updateDelivery: (id, patch) => update(collections.deliveries, id, patch),
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
  adapter.queueSubscription = async (transaction, eventKey, kind, now, actorId) => { if (subscriptionConfig.enabled) subscriptionIntents.push({ transaction, eventKey, kind, now, actorId }) }
  return adapter
}

function repository() {
  const transactions = db.collection('transactions')
  const events = db.collection('transaction_events')
  const get = async (collection, id) => { try { return (await collection.doc(id).get()).data || null } catch (error) { return null } }
  return {
    async runTransaction(work) {
      let intents = []
      const result = await db.runTransaction(transaction => { intents = []; return work(transactionRepository(transaction, intents)) })
      // Optional outbound notification writes happen only after the business commit.
      for (const intent of intents) {
        try { await db.runTransaction(transaction => subscription.queueSubscription({ ...intent, tx: transactionRepository(transaction), config: subscriptionConfig })) }
        catch (error) { console.error('Subscription queue unavailable', { code: error.code || 'INTERNAL_ERROR' }) }
      }
      return result
    },
    getDelivery: id => get(db.collection('subscription_deliveries'), id),
    async findGrant({ recipientId, transactionId, templateId, before }) {
      const result = await db.collection('subscription_deliveries').where({ kind: 'grant', recipientId, transactionId, templateId, status: 'available', createdAt: _.lte(before) }).orderBy('createdAt', 'asc').limit(1).get()
      return result.data[0] || null
    },
    async list({ userId, role, status, cursor, limit }) {
      const participant = role ? { [`${role}Id`]: userId } : _.or([{ buyerId: userId }, { sellerId: userId }])
      const conditions = [participant]
      if (status) conditions.push({ status: status === 'ongoing' ? _.in(service.ACTIVE_STATUSES) : status })
      if (cursor) conditions.push(_.or([{ updatedAt: _.lt(cursor.updatedAt) }, { updatedAt: _.eq(cursor.updatedAt), _id: _.lt(cursor.id) }]))
      const result = await transactions.where(_.and(conditions)).orderBy('updatedAt', 'desc').orderBy('_id', 'desc').limit(limit).get()
      const last = result.data[result.data.length - 1]
      return { rows: result.data, nextCursor: result.data.length === limit && last ? { updatedAt: last.updatedAt, id: last._id } : null }
    },
    async listDue({ before, deadlineBefore, reminderBefore, cursor, limit, userId }) {
      const conditions = [{ status: 'awaiting_handover' }]
      if (userId) conditions.push(_.or([{ buyerId: userId }, { sellerId: userId }]))
      if (deadlineBefore != null) conditions.push(_.or([{ autoCompleteAt: _.lte(deadlineBefore) }, _.and([{ autoCompleteAt: _.exists(false) }, { scheduledAt: _.lte(before) }])]))
      else conditions.push({ scheduledAt: _.lte(before) })
      if (reminderBefore != null) conditions.push(_.or([_.and([{ nextReminderAt: _.lte(reminderBefore) }, { nextReminderAt: _.gte(0) }]), { nextReminderAt: _.exists(false) }]))
      if (reminderBefore != null) conditions.push(_.or([{ autoCompleteAt: _.gt(reminderBefore) }, _.and([{ autoCompleteAt: _.exists(false) }, { scheduledAt: _.gt(reminderBefore - 3600000) }])]))
      if (cursor) conditions.push(_.or([{ scheduledAt: _.gt(cursor.scheduledAt) }, { scheduledAt: _.eq(cursor.scheduledAt), _id: _.gt(cursor.id) }]))
      const result = await transactions.where(_.and(conditions)).orderBy('scheduledAt', 'asc').orderBy('_id', 'asc').limit(limit).get()
      const last = result.data[result.data.length - 1]
      return { rows: result.data, nextCursor: result.data.length === limit && last ? { scheduledAt: last.scheduledAt, id: last._id } : null }
    },
    async listDeliveries({ transactionId, recipientId, cursor, limit }) {
      const conditions = [{ kind: 'delivery', status: 'pending' }]
      if (transactionId) conditions.push({ transactionId })
      if (recipientId) conditions.push({ recipientId })
      if (cursor) conditions.push(_.or([{ createdAt: _.gt(cursor.createdAt) }, { createdAt: _.eq(cursor.createdAt), _id: _.gt(cursor.id) }]))
      const result = await db.collection('subscription_deliveries').where(_.and(conditions)).orderBy('createdAt', 'asc').orderBy('_id', 'asc').limit(limit).get()
      const last = result.data[result.data.length - 1]
      return { rows: result.data, nextCursor: result.data.length === limit && last ? { createdAt: last.createdAt, id: last._id } : null }
    },
    async pendingCounts(userId) {
      const active = _.in(service.ACTIVE_STATUSES)
      const [buyer, seller] = await Promise.all([transactions.where({ buyerId: userId, status: active }).count(), transactions.where({ sellerId: userId, status: active }).count()])
      return { buyer: buyer.total, seller: seller.total }
    },
    getUser: id => get(db.collection('users'), id),
    getConversation: id => get(db.collection('conversations'), id),
    getTransaction: (id) => get(transactions, id),
    async getEvents(transactionId) { return (await events.where({ transactionId }).orderBy('createdAt', 'asc').get()).data },
  }
}

exports.main = async (event = {}) => {
  try {
    const context = cloud.getWXContext()
    if (event.Type === 'Timer') throw Object.assign(new Error('自动完成已改为页面刷新时检查'), { code: 'FORBIDDEN' })
    const actor = await currentUser()
    const transactions = repository()
    const now = Date.now()
    let refreshSummary
    const actions = {
      refresh: () => Promise.resolve(refreshSummary),
      create: () => service.createTransaction({ ...event, actor, transactions, now }),
      revise: () => service.reviseTransaction({ ...event, actor, transactions, now }),
      withdraw: () => service.withdrawTransaction({ ...event, actor, transactions, now }),
      respond: () => service.respondTransaction({ ...event, actor, transactions, now }),
      cancel: () => service.cancelTransaction({ ...event, actor, transactions, now }),
      submitResult: () => service.submitTransactionResult({ ...event, actor, transactions, now }),
      subscribe: () => subscription.recordSubscription({ actor, transactionId: event.transactionId, accepted: event.accepted, requestId: event.requestId, transactions, config: subscriptionConfig, now }),
      list: () => service.listTransactions({ ...event, actor, transactions }),
      detail: async () => ({ ...await service.getTransactionDetail({ actor, transactionId: event.transactionId, transactions }), subscription: subscription.publicSubscriptionConfig(subscriptionConfig) }),
    }
    if (!actions[event.action]) throw Object.assign(new Error('不支持的交易操作'), { code: 'INVALID_ACTION' })
    if (!actor || actor.status !== 'active' || !actor.profileCompleted) throw Object.assign(new Error('请先完善个人资料'), { code: 'PROFILE_REQUIRED' })
    refreshSummary = await runPageRefreshBatch({ transactions, userId: actor._id, now, clock: () => Date.now(), deadline: now + 15000 })
    const data = await actions[event.action]()
    {
      const deliveries = data.transaction && !['detail', 'list'].includes(event.action) ? transactions : { ...transactions, listDeliveries: query => transactions.listDeliveries({ ...query, recipientId: actor._id }) }
      try { await subscription.dispatchPending({ transactions: deliveries, config: subscriptionConfig, clock: () => Date.now(), transactionId: data.transaction && !['detail', 'list'].includes(event.action) ? data.transaction._id : undefined, send: payload => cloud.openapi.subscribeMessage.send(payload) }) } catch (error) { console.error('Subscription dispatch unavailable', { code: error.code || 'INTERNAL_ERROR' }) }
    }
    return { ok: true, data }
  } catch (error) {
    return { ok: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message || '交易服务异常，请稍后重试' } }
  }
}
