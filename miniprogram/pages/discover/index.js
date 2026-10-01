const { CAMPUSES } = require('../../config/market')
const { createPostListState, formatPrice, reducePostListState, selectDiscoverablePosts } = require('../../services/post-list-state')
const { listPosts } = require('../../services/posts')
const { getCurrentUser } = require('../../services/user')

const campusOptions = [{ id: '', name: '全部校区' }, ...CAMPUSES]

Page({
  data: { campusOptions, campusName: '全部校区', posts: [], loading: true, loadingMore: false, exhausted: false, error: '' },
  async onLoad() {
    let user = null
    try { user = await getCurrentUser() } catch (error) { /* Anonymous browsing remains available. */ }
    this.state = createPostListState({ user })
    this.sync()
    await this.load(false)
  },
  sync() {
    const posts = selectDiscoverablePosts(this.state.posts).map((post) => ({ ...post, priceLabel: formatPrice(post.unitPriceCents), campusName: (CAMPUSES.find(campus => campus.id === post.campusId) || {}).name || '校区未设置' }))
    const campus = campusOptions.find((item) => item.id === this.state.campusId) || campusOptions[0]
    this.setData({ campusName: campus.name, posts, loading: this.state.loading, loadingMore: this.state.loadingMore, exhausted: this.state.exhausted, error: this.state.error })
  },
  apply(event) { this.state = reducePostListState(this.state, event); this.sync() },
  async load(append) {
    if (!this.state || this.state.loading || this.state.loadingMore || (append && this.state.exhausted)) return
    const token = `${Date.now()}-${Math.random()}`
    this.apply({ type: 'LOAD_START', token, append })
    try {
      const result = await listPosts(this.state.campusId, append ? this.state.nextCursor : null, 20)
      this.apply({ type: append ? 'LOAD_MORE_SUCCESS' : 'LOAD_SUCCESS', token, posts: result.posts, nextCursor: result.nextCursor })
    } catch (error) {
      this.apply({ type: 'FAILURE', token, message: error.message })
    } finally {
      wx.stopPullDownRefresh()
    }
  },
  changeCampus(event) {
    const campus = campusOptions[Number(event.detail.value)] || campusOptions[0]
    this.apply({ type: 'CAMPUS_CHANGE', campusId: campus.id })
    this.load(false)
  },
  onPullDownRefresh() { this.apply({ type: 'REFRESH' }); this.load(false) },
  onReachBottom() { this.load(true) },
  retry() { this.load(false) },
  openPost(event) { wx.navigateTo({ url: `/pages/post-detail/index?postId=${event.currentTarget.dataset.id}` }) },
})
