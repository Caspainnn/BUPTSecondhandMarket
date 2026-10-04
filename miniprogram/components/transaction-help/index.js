Component({
  properties: { transaction: Object, peer: Object },
  methods: {
    copyContact() {
      const value = this.properties.peer && this.properties.peer.contactInfo
      if (value) this.copy(value, '联系方式已复制')
    },
    copySecurity() { this.copy('01062282222', '安保处电话已复制') },
    copy(value, title) { wx.setClipboardData({ data: value, success: () => wx.showToast({ title, icon: 'none' }), fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }) }) },
  },
})
