const { listTransactions } = require('../../services/transactions')
const { getCurrentUser, getCampuses, saveProfile, uploadAvatar } = require('../../services/user')

Page({
  data: { state: 'loading', message: '', user: null, form: { nickname: '', avatarFileId: '', campusId: '' }, campuses: [], campusIndex: -1, dirty: false, busy: false, ongoing: [], ongoingCursor: null, ongoingLoading: false, ongoingError: '' },
  async onShow() {
    this.onHide()
    this.ongoingToken = {}
    this.ongoingTimer = setInterval(() => this.loadOngoing(), 5000)
    this.loadOngoing()
    if (this.data.dirty || this.data.busy) return
    try {
      const user = await getCurrentUser()
      this.setData({ state: 'ready', message: '', user, form: { nickname: user.nickname || '', avatarFileId: user.avatarFileId || '', campusId: user.campusId || '' } })
      this.loadOngoing()
      const campuses = await getCampuses()
      this.setData({ campuses, campusIndex: campuses.findIndex(campus => campus.campusId === user.campusId) })
    } catch (error) { this.setData({ state: this.data.user ? 'ready' : 'error', message: error.message || '资料加载失败，请重试' }) }
  },
  patch(patch) {
    if (this.data.busy) return
    this.setData({ form: { ...this.data.form, ...patch }, dirty: true, message: '' })
  },
  onNicknameInput(event) { this.patch({ nickname: event.detail.value }) },
  onCampusChange(event) {
    if (this.data.busy) return
    const campusIndex = Number(event.detail.value)
    const campus = this.data.campuses[campusIndex]
    if (!campus) return
    this.patch({ campusId: campus.campusId })
    this.setData({ campusIndex })
  },
  async onChooseAvatar(event) {
    if (this.data.busy || !event.detail.avatarUrl) return
    this.setData({ busy: true, message: '' })
    try {
      const avatarFileId = await uploadAvatar(event.detail.avatarUrl)
      this.setData({ form: { ...this.data.form, avatarFileId }, dirty: true })
    } catch (error) { this.setData({ message: error.message || '头像上传失败，请重试' }) }
    finally { this.setData({ busy: false }) }
  },
  async save() {
    if (this.data.busy) return
    this.setData({ busy: true, message: '' })
    try {
      const user = await saveProfile({ ...this.data.form })
      this.setData({ user, dirty: false, form: { nickname: user.nickname, avatarFileId: user.avatarFileId, campusId: user.campusId } })
      wx.showToast({ title: '资料已保存', icon: 'success' })
    } catch (error) { this.setData({ message: error.message || '资料保存失败，请重试' }) }
    finally { this.setData({ busy: false }) }
  },
  onHide() { this.ongoingToken = null; if (this.ongoingTimer) { clearInterval(this.ongoingTimer); this.ongoingTimer = null } },
  onUnload() { this.onHide() },
  async loadOngoing(event) {
    if (!this.ongoingToken || this.loadingOngoing || !this.data.user || !this.data.user.profileCompleted) return
    const token = this.ongoingToken
    const more = event && event.currentTarget && event.currentTarget.dataset.more
    this.loadingOngoing = true
    this.setData({ ongoingLoading: true })
    try {
      const result = await listTransactions('', 'ongoing', more ? this.data.ongoingCursor : null, 20)
      if (!more) {
        while (result.nextCursor && result.transactions.length < this.data.ongoing.length && this.ongoingToken === token) {
          const next = await listTransactions('', 'ongoing', result.nextCursor, 20)
          result.transactions.push(...next.transactions)
          result.nextCursor = next.nextCursor
        }
      }
      if (this.ongoingToken !== token) return
      const rows = more ? [...this.data.ongoing, ...result.transactions] : result.transactions
      this.setData({ ongoing: rows.filter((item, index) => rows.findIndex(row => row._id === item._id) === index), ongoingCursor: result.nextCursor, ongoingError: '' })
    } catch (error) {
      console.warn('Ongoing orders refresh failed', error)
      if (this.ongoingToken === token && !this.data.ongoing.length) this.setData({ ongoingError: '暂时未能加载，点击重试' })
    } finally { this.loadingOngoing = false; if (this.ongoingToken === token) this.setData({ ongoingLoading: false }) }
  },
  openAllOrders() { wx.navigateTo({ url: '/pages/my-transactions/index?mode=all' }) },
  openMyPosts() { wx.navigateTo({ url: '/pages/my-posts/index' }) },
  openMyTransactions() { wx.navigateTo({ url: '/pages/my-transactions/index' }) },
  async retry() {
    if (!this.data.user) return this.onShow()
    try {
      this.loadOngoing()
      const campuses = await getCampuses()
      this.setData({ campuses, campusIndex: campuses.findIndex(campus => campus.campusId === this.data.form.campusId), message: '' })
    } catch (error) { this.setData({ message: error.message || '校区加载失败，请重试' }) }
  },
})
