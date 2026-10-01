const { POST_CATEGORIES, POST_CONDITIONS, CAMPUSES } = require('../../config/market')
const { callCloud } = require('../../services/cloud-result')
const { formatPrice } = require('../../services/post-list-state')
const { getPost, setPostStatus } = require('../../services/posts')
const { consumeProtectedResume, requireCompletedProfile } = require('../../services/user')

const nameOf = (items, id) => (items.find((item) => item.id === id) || {}).name || id

Page({
  data: { state: 'loading', error: '', post: null, busy: false },
  async onLoad(options) { this.postId = options.postId; await this.load() },
  onShow() { if (this.postId && consumeProtectedResume('/pages/post-detail/index', 'contactSeller')) this.contactSeller() },
  async load() {
    this.setData({ state: 'loading', error: '' })
    try {
      const post = await getPost(this.postId)
      this.setData({ state: 'ready', post: { ...post, priceLabel: formatPrice(post.unitPriceCents), categoryName: nameOf(POST_CATEGORIES, post.categoryId), conditionName: nameOf(POST_CONDITIONS, post.conditionId), campusName: nameOf(CAMPUSES, post.campusId), unavailable: post.status !== 'active' || post.availableQuantity <= 0 } })
    } catch (error) { this.setData({ state: 'error', error: error.message }) }
  },
  edit() { wx.navigateTo({ url: `/pages/post-edit/index?postId=${this.postId}` }) },
  async toggleStatus() {
    if (this.data.busy) return
    this.setData({ busy: true })
    try { await setPostStatus(this.postId, this.data.post.status === 'active' ? 'offline' : 'active', `${Date.now()}`); await this.load() }
    catch (error) { wx.showToast({ title: error.message, icon: 'none' }) }
    finally { this.setData({ busy: false }) }
  },
  async contactSeller() {
    if (this.data.busy || this.data.post.unavailable) return
    this.setData({ busy: true })
    try {
      const user = await requireCompletedProfile('contactSeller')
      if (!user) return
      const result = await callCloud('conversationApi', { action: 'open', postId: this.postId, requestId: `${Date.now()}` })
      getApp().globalData.currentConversation = result.conversation
      wx.navigateTo({ url: `/pages/conversation/index?conversationId=${result.conversation._id}` })
    } catch (error) { wx.showToast({ title: error.message || '暂时无法联系卖家', icon: 'none' }) }
    finally { this.setData({ busy: false }) }
  },
})
