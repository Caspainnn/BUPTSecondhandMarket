const cloud = require('wx-server-sdk')
const { updateUserProfile } = require('./profile')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function createUsersRepository() {
  const collection = db.collection('users')

  return {
    async findByOpenid(openid) {
      const result = await collection.where({ _openid: openid }).limit(1).get()
      return result.data[0] || null
    },

    async updateById(id, changes) {
      await collection.doc(id).update({ data: changes })
      const result = await collection.doc(id).get()
      return result.data
    },
  }
}

function createCampusesRepository() {
  const collection = db.collection('campuses')

  return {
    async findById(campusId) {
      const result = await collection.where({ campusId }).limit(1).get()
      return result.data[0] || null
    },
  }
}

function toPublicUser(user) {
  const { _openid, ...publicUser } = user
  return publicUser
}

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    const user = await updateUserProfile({
      openid: OPENID,
      input: event,
      users: createUsersRepository(),
      campuses: createCampusesRepository(),
      now: db.serverDate(),
    })

    return {
      ok: true,
      data: { user: toPublicUser(user) },
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || '资料保存失败，请稍后重试',
      },
    }
  }
}
