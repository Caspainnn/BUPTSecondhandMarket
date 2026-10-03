const { CAMPUSES, POST_CATEGORIES, POST_CONDITIONS } = require('../../config/market')
const { createPostListState, formatPrice, reducePostListState, selectDiscoverablePosts } = require('../../services/post-list-state')
const { listPosts } = require('../../services/posts')
const { getCurrentUser } = require('../../services/user')
function layoutWaterfall(heights, columnWidth, gap) {
  const bottoms = [0, 0]
  const positions = heights.map(height => {
    const column = bottoms[0] <= bottoms[1] ? 0 : 1
    const position = { left: column * (columnWidth + gap), top: bottoms[column] }
    bottoms[column] += height + gap
    return position
  })
  return { positions, height: heights.length ? Math.max(...bottoms) - gap : 0 }
}

const campusOptions = [{ id: '', name: '全部校区' }, ...CAMPUSES]

Page({
  data: { searchDraft: '', keyword: '', sortOptions: [{ id: 'comprehensive', name: '综合' }, { id: 'newest', name: '最新发布' }, { id: 'oldest', name: '最早发布' }], sortIndex: 0, sortName: '综合', priceSort: '', direction: '', filterOpen: false, filterDraft: {}, conditionOptions: [], directionOptions: [{ id: '', name: '不限' }, { id: 'provide', name: '提供' }, { id: 'need', name: '需求' }], typeOptions: [{ id: '', name: '不限' }, { id: 'item', name: '物品' }, { id: 'service', name: '服务' }], categoryOptions: [{ id: '', name: '全部分类' }, ...POST_CATEGORIES], campusOptions, campusName: '全部校区', posts: [], loading: true, loadingMore: false, exhausted: false, error: '' },
  async onLoad() {
    let user = null
    try { user = await getCurrentUser() } catch (error) { /* Anonymous browsing remains available. */ }
    this.state = createPostListState({ user })
    this.sync()
    await this.load(false)
  },
  sync() {
    const posts = selectDiscoverablePosts(this.state.posts).map((post) => ({ ...post, priceLabel: formatPrice(post.unitPriceCents), campusName: (CAMPUSES.find(campus => campus.id === post.campusId) || {}).name || '全部校区', typeLabel: post.direction === 'need' ? '需求' : '提供', isService: post.contentType === 'service' }))
    const campus = campusOptions.find((item) => item.id === this.state.campusId) || campusOptions[0]
    const filterLabel = [this.state.direction === 'need' ? '需求' : this.state.direction === 'provide' ? '提供' : '综合展示', this.state.contentType === 'service' ? '服务' : this.state.contentType === 'item' ? '物品' : '', this.state.categoryIds.length ? '已选 ' + this.state.categoryIds.length + ' 个分类' : ''].filter(Boolean).join(' · ')
    const needsLayout = this.layoutSource !== this.state.posts
    this.layoutSource = this.state.posts
    this.setData({ ...(needsLayout ? { waterfallReady: false } : {}), keyword: this.state.keyword, priceSort: this.state.priceSort, campusIndex: campusOptions.findIndex(item => item.id === this.state.campusId), sortIndex: this.data.sortOptions.findIndex(item => item.id === this.state.sort), sortName: (this.data.sortOptions.find(item => item.id === this.state.sort) || this.data.sortOptions[0]).name, direction: this.state.direction, filterLabel, hasFilters: Boolean(this.state.direction || this.state.contentType || this.state.categoryIds.length || this.state.conditionIds.length || this.state.minPriceCents != null || this.state.maxPriceCents != null), campusName: campus.name, posts, loading: this.state.loading, loadingMore: this.state.loadingMore, exhausted: this.state.exhausted, error: this.state.error }, () => { if (needsLayout) this.measureWaterfall() })
  },
  measureWaterfall() {
    const source = this.layoutSource
    if (!this.data.posts.length) { this.setData({ waterfallHeight: 0, waterfallPositions: [], waterfallReady: true }); return }
    wx.nextTick(() => {
      const query = this.createSelectorQuery()
      query.select('.post-grid').boundingClientRect()
      query.selectAll('.post-card').boundingClientRect()
      query.exec(([container, cards]) => {
        if (this.layoutSource !== source || !container || !cards || cards.length !== this.data.posts.length) return
        const width = cards[0].width
        const layout = layoutWaterfall(cards.map(card => card.height), width, Math.max(0, container.width - 2 * width))
        this.setData({ waterfallPositions: layout.positions, waterfallHeight: layout.height, waterfallReady: true })
      })
    })
  },
  onResize() { this.measureWaterfall() },
  apply(event) { this.state = reducePostListState(this.state, event); this.sync() },
  async load(append) {
    if (!this.state || this.state.loading || this.state.loadingMore || (append && this.state.exhausted)) return
    const token = `${Date.now()}-${Math.random()}`
    this.apply({ type: 'LOAD_START', token, append })
    try {
      const result = await listPosts(this.state.campusId, append ? this.state.nextCursor : null, 20, this.state.direction, this.state.contentType, this.state.categoryIds, this.state.sort, this.state.priceSort, this.state.keyword, this.state)
      this.apply({ type: append ? 'LOAD_MORE_SUCCESS' : 'LOAD_SUCCESS', token, posts: result.posts, nextCursor: result.nextCursor })
    } catch (error) {
      this.apply({ type: 'FAILURE', token, message: error.message })
    } finally {
      wx.stopPullDownRefresh()
    }
  },
  changeSearch(event) { this.setData({ searchDraft: event.detail.value }) },
  search() { const keyword = this.data.searchDraft.trim(); this.setData({ searchDraft: keyword }); this.apply({ type: 'SEARCH_CHANGE', keyword }); this.load(false) },
  clearSearch() { this.setData({ searchDraft: '' }); this.apply({ type: 'SEARCH_CHANGE', keyword: '' }); this.load(false) },
  openFilters() { this.setFilterDraft({ direction: this.state.direction, contentType: this.state.contentType, categoryIds: [...this.state.categoryIds], conditionIds: [...this.state.conditionIds], minPrice: this.state.minPriceCents == null ? '' : String(this.state.minPriceCents / 100), maxPrice: this.state.maxPriceCents == null ? '' : String(this.state.maxPriceCents / 100) }); this.setData({ filterOpen: true }) },
  closeFilters() { this.setData({ filterOpen: false }) },
  keepFiltersOpen() {},
  pickFilter(event) {
    const { key, id } = event.currentTarget.dataset
    if (!['direction', 'contentType', 'categoryId', 'conditionId'].includes(key)) return
    const draft = { ...this.data.filterDraft, [key]: id }
    if (key === 'contentType' && id === 'service') draft.categoryIds = []
    if ((key === 'direction' && id === 'need') || (key === 'contentType' && id === 'service')) draft.conditionIds = []
    if (key === 'conditionId') {
      draft.conditionIds = !id ? [] : draft.conditionIds.includes(id) ? draft.conditionIds.filter(value => value !== id) : [...draft.conditionIds, id]
      delete draft.conditionId
      if (id) { draft.direction = 'provide'; draft.contentType = 'item' }
    }
    if (key === 'categoryId') {
      draft.categoryIds = !id ? [] : draft.categoryIds.includes(id) ? draft.categoryIds.filter(value => value !== id) : [...draft.categoryIds, id]
      delete draft.categoryId
      if (id) draft.contentType = 'item'
    }
    this.setFilterDraft(draft)
  },
  setFilterDraft(draft) { this.setData({ filterDraft: draft, conditionOptions: [{ id: '', name: '不限' }, ...POST_CONDITIONS].map(item => ({ ...item, selected: item.id ? draft.conditionIds.includes(item.id) : !draft.conditionIds.length })), categoryOptions: [{ id: '', name: '全部分类' }, ...POST_CATEGORIES].map(item => ({ ...item, selected: item.id ? draft.categoryIds.includes(item.id) : !draft.categoryIds.length })) }) },
  resetFilters() { this.setFilterDraft({ direction: '', contentType: '', categoryIds: [], conditionIds: [], minPrice: '', maxPrice: '' }) },
  changePriceBound(event) { const key = event.currentTarget.dataset.key; if (['minPrice', 'maxPrice'].includes(key)) this.setData({ ['filterDraft.' + key]: event.detail.value }) },
  confirmFilters() {
    const draft = this.data.filterDraft
    const parse = value => { const text = String(value || '').trim(); if (!text) return null; if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('价格最多填写两位小数'); const [yuan, decimals = ''] = text.split('.'); const cents = Number(yuan) * 100 + Number(decimals.padEnd(2, '0')); if (!Number.isSafeInteger(cents) || cents > 99999999) throw new Error('价格不能超过999999.99'); return cents }
    try {
      const minPriceCents = parse(draft.minPrice), maxPriceCents = parse(draft.maxPrice)
      if (minPriceCents != null && maxPriceCents != null && minPriceCents > maxPriceCents) throw new Error('最低价格不能高于最高价格')
      this.apply({ ...draft, minPriceCents, maxPriceCents, type: 'FILTER_CHANGE' }); this.closeFilters(); this.load(false)
    } catch (error) { wx.showToast({ title: error.message, icon: 'none' }) }
  },
  changePriceSort() { const priceSort = this.state.priceSort === '' ? 'price_asc' : this.state.priceSort === 'price_asc' ? 'price_desc' : ''; this.apply({ type: 'PRICE_SORT_CHANGE', priceSort }); this.load(false) },
  changeSort(event) { const option = this.data.sortOptions[Number(event.detail.value)]; if (!option) return; this.apply({ type: 'SORT_CHANGE', sort: option.id }); this.load(false) },
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
