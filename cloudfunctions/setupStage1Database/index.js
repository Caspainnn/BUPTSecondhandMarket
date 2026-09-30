const cloud = require('wx-server-sdk')
const { setupStage1Database } = require('./setup')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function createDatabaseAdapter() {
  return {
    async ensureCollection(name) {
      try {
        await db.collection(name).limit(1).get()
      } catch (queryError) {
        try {
          await db.createCollection(name)
        } catch (createError) {
          await db.collection(name).limit(1).get()
        }
      }
    },
  }
}

exports.main = async (event = {}) => {
  try {
    const data = await setupStage1Database({
      confirm: event.confirm,
      database: createDatabaseAdapter(),
    })
    return { ok: true, data }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || '阶段 1 数据库初始化失败，请查看云函数日志',
      },
    }
  }
}
