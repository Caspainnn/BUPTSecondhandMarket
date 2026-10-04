const { callCloud } = require('../../services/cloud-result')
Component({
  properties: { postId: String, conversationId: String },
  data: { loading: true, error: false, contactInfo: '', label: '' },
  observers: { 'postId, conversationId': function () { this.loadContact() } },
  methods: {
    async loadContact() {
      const { postId, conversationId } = this.properties
      if (!postId && !conversationId) return
      const request = (this.request || 0) + 1
      this.request = request
      this.setData({ loading: true, error: false, contactInfo: '' })
      try {
        const result = await callCloud('contactApi', { postId, conversationId })
        if (request !== this.request) return
        this.setData({ loading: false, contactInfo: result.contactInfo || '', label: '复制' + (result.contactType || '联系方式') })
      } catch (error) { if (request === this.request) this.setData({ loading: false, error: true }) }
    },
    copy() {
      if (this.data.error) { this.loadContact(); return }
      if (!this.data.contactInfo) return
      wx.setClipboardData({ data: this.data.contactInfo, success: () => wx.showToast({ title: '已复制', icon: 'success' }), fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }) })
    },
  },
})
