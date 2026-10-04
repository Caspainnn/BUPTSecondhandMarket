const MAX_NICKNAME_LENGTH = 20

class ProfileError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ProfileError'
    this.code = code
  }
}

function validateProfile(input = {}) {
  const nickname = typeof input.nickname === 'string' ? input.nickname.trim() : ''
  if (!nickname || [...nickname].length > MAX_NICKNAME_LENGTH) {
    throw new ProfileError('INVALID_NICKNAME', '昵称应为 1 到 20 个字符')
  }

  const avatarFileId = typeof input.avatarFileId === 'string'
    ? input.avatarFileId.trim()
    : ''
  if (!avatarFileId.startsWith('cloud://')) {
    throw new ProfileError('INVALID_AVATAR', '请选择并上传头像')
  }

  const campusId = typeof input.campusId === 'string' ? input.campusId.trim() : ''
  if (!campusId) {
    throw new ProfileError('INVALID_CAMPUS', '请选择常驻校区')
  }

  if (input.contactInfo !== undefined && (typeof input.contactInfo !== 'string' || [...input.contactInfo.trim()].length > 100)) throw new ProfileError('INVALID_CONTACT', '联系方式不能超过 100 个字符')
  if (input.contactType !== undefined && !['', '微信', 'QQ', '邮箱', '电话'].includes(input.contactType)) throw new ProfileError('INVALID_CONTACT', '请选择有效的联系方式类型')
  return { nickname, avatarFileId, campusId, ...(input.contactType !== undefined ? { contactType: input.contactType } : {}), ...(input.contactInfo !== undefined ? { contactInfo: input.contactInfo.trim() } : {}) }
}

async function updateUserProfile({ openid, input, users, campuses, now }) {
  if (!openid) {
    throw new ProfileError('INVALID_IDENTITY', '无法获取微信身份')
  }

  const profile = validateProfile(input)

  try {
    const user = await users.findByOpenid(openid)
    if (!user) {
      throw new ProfileError('USER_NOT_FOUND', '用户资料不存在，请重新登录')
    }
    if (user.status !== 'active') {
      throw new ProfileError('USER_DISABLED', '当前账号无法更新资料')
    }

    const campus = await campuses.findById(profile.campusId)
    if (!campus || !campus.enabled || campus.schoolId !== 'bupt') {
      throw new ProfileError('INVALID_CAMPUS', '所选校区不可用')
    }

    return await users.updateById(user._id, {
      nickname: profile.nickname,
      avatarFileId: profile.avatarFileId,
      schoolId: 'bupt',
      campusId: profile.campusId,
      ...(profile.contactInfo !== undefined ? { contactInfo: profile.contactInfo } : {}),
      ...(profile.contactType !== undefined ? { contactType: profile.contactType } : {}),
      profileCompleted: true,
      updatedAt: now,
    })
  } catch (error) {
    if (error instanceof ProfileError) {
      throw error
    }
    throw new ProfileError('INTERNAL_ERROR', '资料保存失败，请稍后重试')
  }
}

module.exports = {
  MAX_NICKNAME_LENGTH,
  ProfileError,
  updateUserProfile,
  validateProfile,
}
