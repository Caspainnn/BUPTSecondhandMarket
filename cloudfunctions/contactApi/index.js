const cloud = require('wx-server-sdk')
const { getContact } = require('./contact')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext()
    const users = OPENID ? await db.collection('users').where({ _openid: OPENID }).limit(1).get() : { data: [] }
    const repository = { async get(collection, id) {
      if (typeof id !== 'string' || !id) return null
      const result = await db.collection(collection).where({ _id: id }).limit(1).get()
      return result.data[0] || null
    } }
    return { ok: true, data: await getContact({ actor: users.data[0], postId: event.postId, conversationId: event.conversationId, repository }) }
  } catch (error) { return { ok: false, error: { code: error.code || 'INTERNAL_ERROR', message: error.message || '联系方式加载失败' } } }
}
