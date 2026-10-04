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

const SAFE_ROUTES = new Set([
  '/pages/publish/index', '/pages/messages/index', '/pages/post-detail/index', '/pages/conversation/index',
  '/pages/transaction-create/index', '/pages/transaction-detail/index', '/pages/my-posts/index', '/pages/my-transactions/index',
])
const SAFE_ACTIONS = new Set(['', 'contactSeller'])

function currentSafeRoute() {
  const pages = getCurrentPages()
  const route = pages.length ? `/${pages[pages.length - 1].route}` : ''
  return SAFE_ROUTES.has(route) ? route : ''
}

async function requireCompletedProfile(action = '') {
  const user = await getCurrentUser()
  if (!user.profileCompleted) {
    const route = currentSafeRoute()
    getApp().globalData.pendingProtected = { route, action: SAFE_ACTIONS.has(action) ? action : '' }
    wx.navigateTo({ url: '/pages/profile-edit/index' })
    return null
  }
  return user
}

function prepareProtectedResume() {
  const app = getApp()
  app.globalData.resumeProtected = app.globalData.pendingProtected
  app.globalData.pendingProtected = null
}

function consumeProtectedResume(route, action = '') {
  const app = getApp()
  const pending = app.globalData.resumeProtected
  if (!pending || pending.route !== route || pending.action !== action) return false
  app.globalData.resumeProtected = null
  return true
}

async function getCampuses() {
  const data = await callCloud('getCampuses')
  return data.campuses
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
  if (input.contactInfo !== undefined && (data.user.contactInfo || '') !== input.contactInfo.trim() || input.contactType !== undefined && (data.user.contactType || '') !== input.contactType) throw new Error('联系方式未保存，请更新云函数updateProfile后重试')
  return cacheUser(data.user)
}

module.exports = {
  getCampuses,
  getCurrentUser,
  consumeProtectedResume,
  prepareProtectedResume,
  requireCompletedProfile,
  saveProfile,
  uploadAvatar,
}
