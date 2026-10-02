const { createPostFormState, reducePostFormState } = require('../../services/post-form-state')
const { createPost, uploadPostImages } = require('../../services/posts')
const { requireCompletedProfile } = require('../../services/user')

Page({
  data: { activeTab: 'sell', form: createPostFormState().form, status: 'loading', error: '' },
  async initialize() {
    if (this.initializing || this.state) return
    this.initializing = true
    try {
      const user = await requireCompletedProfile()
      if (!user) return
      this.userId = user._id
      this.defaultCampusId = user.campusId
      this.state = createPostFormState({ form: { campusId: user.campusId } })
      this.sync()
    } finally { this.initializing = false }
  },
  switchTab(e) { const tab = e.currentTarget.dataset.tab; if (['sell', 'wanted'].includes(tab)) this.setData({ activeTab: tab }) },
  onLoad() { this.initialize() },
  onShow() { if (!this.state) this.initialize() },
  sync() {
    if (!this.state.form.campusId && this.defaultCampusId) this.state = { ...this.state, form: { ...this.state.form, campusId: this.defaultCampusId } }
    this.setData({ form: this.state.form, status: this.state.status, error: this.state.error })
  },
  apply(event) { this.state = reducePostFormState(this.state, event); this.sync() },
  onPatch(e) { const patch = { ...e.detail.patch }; if (patch.totalQuantity !== undefined) patch.totalQuantity = Number(patch.totalQuantity); this.apply({ type: 'PATCH_FORM', patch }) },
  onAddImages(e) { this.apply({ type: 'ADD_IMAGES', images: e.detail.images }) },
  onRemoveImage(e) { this.apply({ type: 'REMOVE_IMAGE', index: e.detail.index }) },
  onMoveImage(e) { this.apply({ type: 'MOVE_IMAGE', ...e.detail }) },
  onFailure(e) { this.apply({ type: 'FAILURE', message: e.detail.message }) },
  async submit() {
    if (this.data.activeTab !== 'sell' || !this.state || ['saving', 'uploading'].includes(this.state.status)) return
    const requestId = this.state.requestId || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    try {
      this.apply({ type: 'UPLOAD_START' })
      const fileIds = await uploadPostImages(this.state.form.images, this.userId)
      this.apply({ type: 'UPLOAD_SUCCESS', fileIds })
      this.apply({ type: 'SAVE_START', requestId })
      const post = await createPost({ ...this.state.form, imageFileIds: fileIds }, this.state.requestId)
      this.apply({ type: 'SAVE_SUCCESS', post })
      wx.showToast({ title: '发布成功', icon: 'success' })
      wx.navigateTo({ url: `/pages/post-detail/index?postId=${post._id}` })
    } catch (error) { this.apply({ type: 'FAILURE', message: error.message || '发布失败，请重试' }) }
  },
})
