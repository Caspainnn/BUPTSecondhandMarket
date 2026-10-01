const { ENV_ID } = require('./config/env')
const { listConversations, syncMessageBadge } = require('./services/conversations')
const { getCurrentUser } = require('./services/user')

App({
  globalData: {
    user: null,
    pendingProtected: null,
    resumeProtected: null,
    currentConversation: null,
  },

  onShow() {
    if (this.badgeTimer) clearInterval(this.badgeTimer)
    this.foregroundToken = {}
    this.refreshUnread()
    this.badgeTimer = setInterval(() => this.refreshUnread(), 15000)
  },
  onHide() {
    this.foregroundToken = null
    if (this.badgeTimer) { clearInterval(this.badgeTimer); this.badgeTimer = null }
  },
  async refreshUnread() {
    if (!this.foregroundToken || this.refreshingUnread || !wx.cloud) return
    const pages = getCurrentPages()
    const route = pages.length ? pages[pages.length - 1].route : ''
    if (['pages/messages/index', 'pages/conversation/index'].includes(route)) return
    const token = this.foregroundToken
    this.refreshingUnread = true
    try {
      const user = await getCurrentUser()
      if (!user || !user.profileCompleted || this.foregroundToken !== token) return
      const result = await listConversations(null, 1)
      const current = getCurrentPages()
      const currentRoute = current.length ? current[current.length - 1].route : ''
      if (this.foregroundToken === token && !['pages/messages/index', 'pages/conversation/index'].includes(currentRoute)) syncMessageBadge(result.totalUnread)
    } catch (error) { console.warn('Unread badge refresh failed', error) }
    finally { this.refreshingUnread = false }
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('当前微信基础库不支持云开发')
      wx.showModal({
        title: '无法启动云服务',
        content: '请升级微信或微信开发者工具后重试。',
        showCancel: false,
      })
      return
    }

    wx.cloud.init({
      env: ENV_ID,
      traceUser: true,
    })
  },
})
