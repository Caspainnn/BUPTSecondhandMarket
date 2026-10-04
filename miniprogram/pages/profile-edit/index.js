const { createProfileState, reduceProfileState } = require('../../services/profile-state')
const {
  getCampuses,
  getCurrentUser,
  saveProfile,
  uploadAvatar,
  prepareProtectedResume,
} = require('../../services/user')

Page({
  data: {
    status: 'loading',
    error: '',
    form: createProfileState().form,
    campuses: [],
    campusIndex: -1,
    contactTypes: ['微信', 'QQ', '电话'],
    contactTypeIndex: 0,
    contactFocused: false,
  },

  async onLoad() {
    this.profileState = createProfileState({ status: 'loading' })
    try {
      const [user, campuses] = await Promise.all([
        getCurrentUser(true),
        getCampuses(),
      ])
      const campusIndex = campuses.findIndex((campus) => campus.campusId === user.campusId)
      this.profileState = createProfileState({
        form: {
          nickname: user.nickname || '',
          contactInfo: user.contactInfo || '',
          contactType: ['微信', 'QQ', '电话'].includes(user.contactType) ? user.contactType : (user.contactInfo ? user.contactType || '' : '微信'),
          avatarFileId: user.avatarFileId || '',
          avatarPreview: user.avatarFileId || '',
          campusId: user.campusId || '',
        },
      })
      this.setData({
        status: 'idle',
        form: this.profileState.form,
        campuses,
        campusIndex,
        contactTypeIndex: Math.max(0, this.data.contactTypes.indexOf(user.contactType)),
      })
    } catch (error) {
      this.applyEvent({
        type: 'FAILURE',
        message: error.message || '资料加载失败，请重试',
      })
    }
  },

  applyEvent(event) {
    this.profileState = reduceProfileState(this.profileState, event)
    this.setData({
      status: this.profileState.status,
      error: this.profileState.error,
      form: this.profileState.form,
    })
  },

  onNicknameInput(event) {
    this.applyEvent({
      type: 'PATCH_FORM',
      patch: { nickname: event.detail.value },
    })
  },
  editField(event) { this.setData({ activeField: event.currentTarget.dataset.field }) },
  onContactTypeChange(event) {
    const contactTypeIndex = Number(event.detail.value)
    this.setData({ contactTypeIndex })
    this.applyEvent({ type: 'PATCH_FORM', patch: { contactType: this.data.contactTypes[contactTypeIndex] } })
  },
  onContactFocus() { this.setData({ contactFocused: true }) },
  onContactBlur() { this.setData({ contactFocused: false }) },
  onContactInput(event) { this.applyEvent({ type: 'PATCH_FORM', patch: { contactInfo: event.detail.value, contactType: this.profileState.form.contactType || this.data.contactTypes[this.data.contactTypeIndex] } }) },

  onCampusChange(event) {
    const campusIndex = Number(event.detail.value)
    const campus = this.data.campuses[campusIndex]
    this.setData({ campusIndex })
    this.applyEvent({
      type: 'PATCH_FORM',
      patch: { campusId: campus ? campus.campusId : '' },
    })
  },

  async onChooseAvatar(event) {
    if (this.data.status === 'uploading' || this.data.status === 'saving') return
    const tempPath = event.detail.avatarUrl
    this.applyEvent({ type: 'UPLOAD_START' })
    try {
      const avatarFileId = await uploadAvatar(tempPath)
      this.applyEvent({
        type: 'UPLOAD_SUCCESS',
        avatarFileId,
        avatarPreview: tempPath,
      })
    } catch (error) {
      this.applyEvent({
        type: 'FAILURE',
        message: error.message || '头像上传失败，请重试',
      })
    }
  },

  async submit() {
    if (this.data.status === 'uploading' || this.data.status === 'saving') return
    this.applyEvent({ type: 'SAVE_START' })
    try {
      const user = await saveProfile({
        nickname: this.profileState.form.nickname,
        avatarFileId: this.profileState.form.avatarFileId,
        campusId: this.profileState.form.campusId,
        contactInfo: this.profileState.form.contactInfo || '',
        contactType: this.profileState.form.contactType || '',
      })
      this.applyEvent({ type: 'SAVE_SUCCESS', user })
      prepareProtectedResume()
      wx.showToast({ title: '资料已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
    } catch (error) {
      this.applyEvent({
        type: 'FAILURE',
        message: error.message || '资料保存失败，请重试',
      })
    }
  },

  retryLoad() {
    this.onLoad()
  },
})
