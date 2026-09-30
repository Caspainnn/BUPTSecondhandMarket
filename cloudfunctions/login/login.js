class LoginError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'LoginError'
    this.code = code
  }
}

async function loginUser({ openid, users, now }) {
  if (!openid) {
    throw new LoginError('INVALID_IDENTITY', '无法获取微信身份')
  }

  try {
    const existing = await users.findByOpenid(openid)
    if (existing) {
      return { user: existing, created: false }
    }

    const user = await users.create({
      _openid: openid,
      nickname: '',
      avatarFileId: '',
      schoolId: 'bupt',
      campusId: '',
      profileCompleted: false,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })

    return { user, created: true }
  } catch (error) {
    if (error instanceof LoginError) {
      throw error
    }
    throw new LoginError('INTERNAL_ERROR', '登录失败，请稍后重试')
  }
}

module.exports = { LoginError, loginUser }
