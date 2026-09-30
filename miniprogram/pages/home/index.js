const { requireCompletedProfile } = require('../../services/user')

Page({
  data: {
    checking: false,
  },

  async openProtectedDemo() {
    if (this.data.checking) return
    this.setData({ checking: true })

    try {
      const user = await requireCompletedProfile()
      if (user) {
        wx.showToast({ title: '资料完整，可以继续', icon: 'success' })
      }
    } catch (error) {
      wx.showToast({ title: error.message || '登录失败，请重试', icon: 'none' })
    } finally {
      this.setData({ checking: false })
    }
  },
})
