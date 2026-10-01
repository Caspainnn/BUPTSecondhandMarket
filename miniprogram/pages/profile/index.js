const { getCurrentUser, getCampuses, saveProfile, uploadAvatar } = require('../../services/user')

Page({
  data: { state: 'loading', message: '', user: null, form: { nickname: '', avatarFileId: '', campusId: '' }, campuses: [], campusIndex: -1, dirty: false, busy: false },
  async onShow() {
    if (this.data.dirty || this.data.busy) return
    try {
      const user = await getCurrentUser()
      this.setData({ state: 'ready', message: '', user, form: { nickname: user.nickname || '', avatarFileId: user.avatarFileId || '', campusId: user.campusId || '' } })
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
  openMyPosts() { wx.navigateTo({ url: '/pages/my-posts/index' }) },
  openMyTransactions() { wx.navigateTo({ url: '/pages/my-transactions/index' }) },
  async retry() {
    if (!this.data.user) return this.onShow()
    try {
      const campuses = await getCampuses()
      this.setData({ campuses, campusIndex: campuses.findIndex(campus => campus.campusId === this.data.form.campusId), message: '' })
    } catch (error) { this.setData({ message: error.message || '校区加载失败，请重试' }) }
  },
})
