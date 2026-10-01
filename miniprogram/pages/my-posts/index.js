const { getPostManagementActions } = require('../../services/transaction-state')
const { listMyPosts, setPostStatus } = require('../../services/posts')
const { requireCompletedProfile } = require('../../services/user')

Page({
  data: { state: 'loading', error: '', posts: [] },
  async onShow() { const user = await requireCompletedProfile(); if (!user) return; await this.load() },
  async load() { this.setData({ state: 'loading' }); try { const result = await listMyPosts('', null, 20); this.setData({ state: 'ready', posts: result.posts.map((post) => ({ ...post, actions: getPostManagementActions(post) })) }) } catch (error) { this.setData({ state: 'error', error: error.message }) } },
  edit(event) { wx.navigateTo({ url: `/pages/post-edit/index?postId=${event.currentTarget.dataset.id}` }) },
  detail(event) { wx.navigateTo({ url: `/pages/post-detail/index?postId=${event.currentTarget.dataset.id}` }) },
  async status(event) { try { await setPostStatus(event.currentTarget.dataset.id, event.currentTarget.dataset.status, `${Date.now()}`); await this.load() } catch (error) { wx.showToast({ title: error.message, icon: 'none' }) } },
})
