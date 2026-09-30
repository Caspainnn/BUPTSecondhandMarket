const { callCloud } = require('./cloud-result')

function cacheUser(user) {
  getApp().globalData.user = user
  return user
}

async function getCurrentUser(forceRefresh = false) {
  const cached = getApp().globalData.user
  if (cached && !forceRefresh) {
    return cached
  }

  const data = await callCloud('login')
  return cacheUser(data.user)
}

async function requireCompletedProfile() {
  const user = await getCurrentUser()
  if (!user.profileCompleted) {
    wx.navigateTo({ url: '/pages/profile-edit/index' })
    return null
  }
  return user
}

async function getCampuses() {
  const result = await wx.cloud.database()
    .collection('campuses')
    .where({ schoolId: 'bupt', enabled: true })
    .orderBy('sortOrder', 'asc')
    .get()
  return result.data
}

async function uploadAvatar(tempPath) {
  if (!tempPath) {
    throw new Error('请选择头像')
  }

  const extensionMatch = tempPath.match(/\.[a-zA-Z0-9]+$/)
  const extension = extensionMatch ? extensionMatch[0].toLowerCase() : '.jpg'
  const nonce = Math.random().toString(36).slice(2, 10)
  const cloudPath = `avatars/${Date.now()}-${nonce}${extension}`
  const result = await wx.cloud.uploadFile({ cloudPath, filePath: tempPath })
  return result.fileID
}

async function saveProfile(input) {
  const data = await callCloud('updateProfile', input)
  return cacheUser(data.user)
}

module.exports = {
  getCampuses,
  getCurrentUser,
  requireCompletedProfile,
  saveProfile,
  uploadAvatar,
}
