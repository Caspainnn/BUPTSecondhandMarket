const cloud = require('wx-server-sdk')
const service = require('./post-service')

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
  const collection = db.collection('posts')
  const list = async (query, ownerId) => {
    const conditions = ownerId
      ? [{ ownerId }, ...(query.status ? [{ status: query.status }] : [])]
      : [{ status: 'active' }, { availableQuantity: _.gt(0) }, ...(query.campusId ? [{ campusId: query.campusId }] : [])]
    if (query.cursor) {
      conditions.push(_.or([
        { publishedAt: _.lt(query.cursor.publishedAt) },
        { publishedAt: _.eq(query.cursor.publishedAt), _id: _.lt(query.cursor.id) },
      ]))
    }
    const result = await collection.where(_.and(conditions)).orderBy(ownerId ? 'updatedAt' : 'publishedAt', 'desc').orderBy('_id', 'desc').limit(query.limit).get()
    const last = result.data[result.data.length - 1]
    return { rows: result.data, nextCursor: result.data.length === query.limit && last ? { publishedAt: last.publishedAt, id: last._id } : null }
  }
  return {
    async findByCreateRequest(ownerId, createRequestId) { const result = await collection.where({ ownerId, createRequestId }).limit(1).get(); return result.data[0] || null },
    async create(data) { const result = await collection.add({ data }); return { _id: result._id, ...data } },
    async findById(id) { try { const result = await collection.doc(id).get(); return result.data || null } catch (error) { return null } },
    async update(id, patch) { await collection.doc(id).update({ data: patch }); const result = await collection.doc(id).get(); return result.data },
    async listPublic(query) { return list(query, '') },
    async listMine(query) { return list(query, query.ownerId) },
  }
}

exports.main = async (event = {}) => {
  try {
    const posts = repository()
    const actor = ['create', 'update', 'setStatus', 'listMine', 'detail'].includes(event.action) ? await currentUser() : null
    const actions = {
      create: () => service.createPost({ actor, input: event.input, requestId: event.requestId, posts, now: db.serverDate() }),
      update: () => service.updatePost({ actor, postId: event.postId, input: event.input, posts, now: db.serverDate() }),
      setStatus: () => service.setPostStatus({ actor, postId: event.postId, status: event.status, posts, now: db.serverDate() }),
      list: () => service.listPosts({ campusId: event.campusId, cursor: event.cursor, limit: event.limit, posts }),
      listMine: () => service.listMyPosts({ actor, status: event.status, cursor: event.cursor, limit: event.limit, posts }),
      detail: () => service.getPostDetail({ actor, postId: event.postId, posts }),
    }
    if (!actions[event.action]) throw Object.assign(new Error('不支持的商品操作'), { code: 'INVALID_ACTION' })
    return { ok: true, data: await actions[event.action]() }
  } catch (error) {
    return { ok: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message || '商品服务异常，请稍后重试' } }
  }
}
