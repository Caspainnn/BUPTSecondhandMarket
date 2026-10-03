function initialCampus(user) {
  return user && user.profileCompleted && user.campusId ? user.campusId : ''
}

function createPostListState({ user } = {}) {
  return {
    campusId: initialCampus(user),
    sort: 'comprehensive',
    priceSort: '',
    keyword: '',
    direction: '',
    contentType: '',
    categoryIds: [],
    posts: [],
    nextCursor: null,
    exhausted: false,
    loading: false,
    loadingMore: false,
    error: '',
    requestToken: '',
  }
}

function uniquePosts(rows) {
  const seen = new Set()
  return rows.filter((post) => post && post._id && !seen.has(post._id) && seen.add(post._id))
}

function reducePostListState(state, event) {
  switch (event.type) {
    case 'CAMPUS_CHANGE':
      return { ...createPostListState(), campusId: event.campusId || '', sort: state.sort, priceSort: state.priceSort, keyword: state.keyword, direction: state.direction || '', contentType: state.contentType || '', categoryIds: [...(state.categoryIds || [])] }
    case 'FILTER_CHANGE':
      return { ...createPostListState(), campusId: state.campusId, sort: state.sort, priceSort: state.priceSort, keyword: state.keyword, direction: event.direction || '', contentType: event.contentType || '', categoryIds: event.contentType === 'service' ? [] : [...(event.categoryIds || [])] }
    case 'DIRECTION_CHANGE':
      return { ...createPostListState(), campusId: state.campusId, sort: state.sort, priceSort: state.priceSort, keyword: state.keyword, direction: event.direction || '' }
    case 'PRICE_SORT_CHANGE':
      return { ...state, priceSort: event.priceSort, posts: [], nextCursor: null, exhausted: false, loading: false, loadingMore: false, requestToken: '', error: '' }
    case 'SEARCH_CHANGE':
      return { ...state, keyword: event.keyword.trim(), posts: [], nextCursor: null, exhausted: false, loading: false, loadingMore: false, requestToken: '', error: '' }
    case 'SORT_CHANGE':
      return { ...state, sort: event.sort, posts: [], nextCursor: null, exhausted: false, loading: false, loadingMore: false, requestToken: '', error: '' }
    case 'REFRESH':
      return { ...state, posts: [], nextCursor: null, exhausted: false, error: '', requestToken: '' }
    case 'LOAD_START':
      return { ...state, loading: !event.append, loadingMore: Boolean(event.append), error: '', requestToken: event.token }
    case 'LOAD_SUCCESS':
      if (event.token !== state.requestToken) return state
      return { ...state, posts: uniquePosts(event.posts || []), nextCursor: event.nextCursor || null, exhausted: !event.nextCursor, loading: false, loadingMore: false }
    case 'LOAD_MORE_SUCCESS':
      if (event.token !== state.requestToken) return state
      return { ...state, posts: uniquePosts([...state.posts, ...(event.posts || [])]), nextCursor: event.nextCursor || null, exhausted: !event.nextCursor, loading: false, loadingMore: false }
    case 'FAILURE':
      if (event.token && event.token !== state.requestToken) return state
      return { ...state, loading: false, loadingMore: false, error: event.message || '加载失败，请重试' }
    default:
      return state
  }
}

function formatPrice(unitPriceCents) {
  if (unitPriceCents == null) return '面议'
  return unitPriceCents === 0 ? '免费赠送' : `¥${(unitPriceCents / 100).toFixed(2)}`
}

function selectDiscoverablePosts(posts) {
  return (posts || []).filter((post) => (post.direction === 'need' || post.contentType === 'service' || post.availableQuantity > 0) && (post.status === undefined || post.status === 'active'))
}

module.exports = { createPostListState, formatPrice, reducePostListState, selectDiscoverablePosts }
