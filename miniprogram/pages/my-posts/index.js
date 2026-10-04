const { getPostManagementActions } = require('../../services/transaction-state')
const { listMyPosts, setPostStatus } = require('../../services/posts')
const { requireCompletedProfile } = require('../../services/user')

Page({
  data: { state: 'loading', error: '', posts: [] },
  async onShow() { const user = await requireCompletedProfile(); if (!user) return; await this.load() },
  async load() { this.setData({ state: 'loading' }); try { const result = await listMyPosts('', null, 20); this.setData({ state: 'ready', posts: result.posts.map((post) => ({ ...post, actions: getPostManagementActions(post) })) }) } catch (error) { this.setData({ state: 'error', error: error.message }) } },
  republish(event) { wx.navigateTo({ url: `/pages/post-edit/index?postId=${encodeURIComponent(event.currentTarget.dataset.id)}&relist=1` }) },
  edit(event) { wx.navigateTo({ url: `/pages/post-edit/index?postId=${event.currentTarget.dataset.id}` }) },
  detail(event) { wx.navigateTo({ url: `/pages/post-detail/index?postId=${event.currentTarget.dataset.id}` }) },
  async status(event) {
    if (this.statusBusy) return
    const { id, status } = event.currentTarget.dataset
    this.statusBusy = true
    try {
      if (status === 'offline') {
        const post = this.data.posts.find(item => item._id === id)
        const closing = post && post.direction === 'need'
        const result = await new Promise((resolve, reject) => wx.showModal({
          title: closing ? '确认关闭' : '确认下架',
          content: closing ? '确定要关闭这条需求吗？' : '确定要下架吗？',
          confirmText: closing ? '确定关闭' : '确定下架',
          cancelText: '取消',
          success: resolve,
          fail: reject,
        }))
        if (!result.confirm) return
      }
      await setPostStatus(id, status, `${Date.now()}`)
      await this.load()
    } catch (error) { wx.showToast({ title: error.message || '操作失败，请重试', icon: 'none' }) }
    finally { this.statusBusy = false }
  },
})
