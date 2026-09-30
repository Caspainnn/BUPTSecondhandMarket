Page({
  data: {
    isLoggedIn: false,
  },

  openProtectedDemo() {
    wx.showToast({
      title: '登录守卫将在后续任务接入',
      icon: 'none',
    })
  },
})
