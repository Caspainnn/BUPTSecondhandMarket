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
    if (!ownerId && (query.sort || '').startsWith('price_') && !query.pricePhase) {
      const phase = query.cursor && query.cursor.pricePhase || 'priced'
      const first = await list({ ...query, pricePhase: phase }, '')
      if (query.minPriceCents != null || query.maxPriceCents != null || phase === 'negotiable' || first.rows.length === query.limit) return first
      const rest = await list({ ...query, pricePhase: 'negotiable', cursor: null, limit: query.limit - first.rows.length }, '')
      return { rows: [...first.rows, ...rest.rows], nextCursor: rest.nextCursor }
    }
    const timeField = ownerId ? 'updatedAt' : query.pricePhase === 'negotiable' ? 'publishedAt' : (query.sort || '').startsWith('price_') ? 'unitPriceCents' : 'publishedAt'
    const order = query.pricePhase === 'negotiable' ? query.timeSort || 'desc' : !ownerId && ['oldest', 'price_asc'].includes(query.sort) ? 'asc' : 'desc'
    const conditions = ownerId
      ? [{ ownerId }, ...(query.status ? [{ status: query.status }] : [])]
      : [{ status: 'active' }, _.or([{ availableQuantity: _.gt(0) }, { direction: 'need' }, { contentType: 'service' }]), ...(query.campusId ? [_.or([{ campusId: query.campusId }, { campusId: '', contentType: 'service' }])] : [])]
    if (query.keyword) {
      const regexp = db.RegExp({ regexp: query.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' })
      conditions.push(_.or([{ title: regexp }, { description: regexp }]))
    }
    if (query.direction === 'need') conditions.push({ direction: 'need' })
    if (query.direction === 'provide') conditions.push(_.or([{ direction: 'provide' }, { direction: _.exists(false) }]))
    if (query.contentType === 'service') conditions.push({ contentType: 'service' })
    if (query.contentType === 'item') conditions.push(_.or([{ contentType: 'item' }, { contentType: _.exists(false) }]))
    if (query.categoryIds && query.categoryIds.length) conditions.push(_.or(query.categoryIds.map(categoryId => ({ categoryId }))))
    if (query.minPriceCents != null) conditions.push({ unitPriceCents: _.gte(query.minPriceCents) })
    if (query.maxPriceCents != null) { conditions.push({ unitPriceCents: _.gte(0) }); conditions.push({ unitPriceCents: _.lte(query.maxPriceCents) }) }
    if (query.conditionIds && query.conditionIds.length) conditions.push({ conditionId: _.in(query.conditionIds) })
    if (query.pricePhase === 'priced') conditions.push({ unitPriceCents: _.gt(-1) })
    if (query.pricePhase === 'negotiable') conditions.push(_.or([{ unitPriceCents: null }, { unitPriceCents: _.exists(false) }]))
    const fields = [[timeField, order]]
    if (query.pricePhase === 'priced') fields.push(['publishedAt', query.timeSort || 'desc'])
    fields.push(['_id', query.pricePhase ? query.timeSort || 'desc' : order])
    if (query.cursor) {
      conditions.push(_.or(fields.map(([field, direction], index) => {
        const part = {}
        for (let i = 0; i < index; i++) { const previous = fields[i][0]; part[previous] = _.eq(previous === '_id' ? query.cursor.id : query.cursor[previous]) }
        part[field] = (direction === 'asc' ? _.gt : _.lt)(field === '_id' ? query.cursor.id : query.cursor[field])
        return part
      })))
    }
    let request = collection.where(_.and(conditions))
    for (const [field, direction] of fields) request = request.orderBy(field, direction)
    const result = await request.limit(query.limit).get()
    const last = result.data[result.data.length - 1]
    return { rows: result.data, nextCursor: result.data.length === query.limit && last ? { [timeField]: last[timeField], publishedAt: last.publishedAt, id: last._id, ...(query.pricePhase ? { pricePhase: query.pricePhase } : {}) } : null }
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
      list: () => service.listPosts({ campusId: event.campusId, direction: event.direction, contentType: event.contentType, categoryId: event.categoryId, categoryIds: event.categoryIds, sort: event.sort, priceSort: event.priceSort, keyword: event.keyword, minPriceCents: event.minPriceCents, maxPriceCents: event.maxPriceCents, conditionIds: event.conditionIds, cursor: event.cursor, limit: event.limit, posts }),
      listMine: () => service.listMyPosts({ actor, status: event.status, cursor: event.cursor, limit: event.limit, posts }),
      detail: () => service.getPostDetail({ actor, postId: event.postId, posts }),
    }
    if (!actions[event.action]) throw Object.assign(new Error('不支持的商品操作'), { code: 'INVALID_ACTION' })
    return { ok: true, data: await actions[event.action]() }
  } catch (error) {
    return { ok: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message || '商品服务异常，请稍后重试' } }
  }
}
