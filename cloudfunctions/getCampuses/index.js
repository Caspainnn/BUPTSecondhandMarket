const cloud = require('wx-server-sdk')
const { listEnabledCampuses } = require('./campuses')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async () => {
  try {
    const campuses = await listEnabledCampuses({
      async findAll() {
        const result = await db.collection('campuses').get()
        return result.data
      },
    })
    return { ok: true, data: { campuses } }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || '校区加载失败，请稍后重试',
      },
    }
  }
}
