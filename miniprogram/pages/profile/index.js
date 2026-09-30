const { getCurrentUser } = require('../../services/user')

Page({
  data: {
    state: 'loading',
    message: '',
    user: null,
  },

  async onShow() {
    this.setData({ state: 'loading', message: '' })
    try {
      const user = await getCurrentUser(true)
      this.setData({ state: 'ready', user })
    } catch (error) {
      this.setData({
        state: 'error',
        message: error.message || '资料加载失败，请稍后重试',
      })
    }
  },

  editProfile() {
    wx.navigateTo({ url: '/pages/profile-edit/index' })
  },

  retry() {
    this.onShow()
  },
})
