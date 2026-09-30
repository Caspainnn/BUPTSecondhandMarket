const cloud = require('wx-server-sdk')
const { setupDatabase } = require('./setup')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function createDatabaseAdapter() {
  return {
    async ensureCollection(name) {
      try {
        await db.collection(name).limit(1).get()
        return
      } catch (queryError) {
        try {
          await db.createCollection(name)
          return
        } catch (createError) {
          await db.collection(name).limit(1).get()
        }
      }
    },

    async upsert(collection, id, data) {
      await db.collection(collection).doc(id).set({ data })
    },
  }
}

exports.main = async (event = {}) => {
  try {
    const result = await setupDatabase({
      confirm: event.confirm,
      database: createDatabaseAdapter(),
    })
    return { ok: true, data: result }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || '数据库初始化失败，请查看云函数日志',
      },
    }
  }
}
