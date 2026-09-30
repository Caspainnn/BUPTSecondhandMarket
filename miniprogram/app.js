const { ENV_ID } = require('./config/env')

App({
  globalData: {
    user: null,
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
