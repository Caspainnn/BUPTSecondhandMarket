const cloud = require('wx-server-sdk')
const { loginUser } = require('./login')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function createUsersRepository() {
  const collection = db.collection('users')

  return {
    async findByOpenid(openid) {
      const result = await collection.where({ _openid: openid }).limit(1).get()
      return result.data[0] || null
    },

    async create(user) {
      const result = await collection.add({ data: user })
      return { _id: result._id, ...user }
    },
  }
}

function toPublicUser(user) {
  const { _openid, ...publicUser } = user
  return publicUser
}

exports.main = async () => {
  try {
    const { OPENID } = cloud.getWXContext()
    const result = await loginUser({
      openid: OPENID,
      users: createUsersRepository(),
      now: db.serverDate(),
    })

    return {
      ok: true,
      data: {
        user: toPublicUser(result.user),
        created: result.created,
      },
    }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || '登录失败，请稍后重试',
      },
    }
  }
}
