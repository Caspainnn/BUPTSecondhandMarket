const { CAMPUSES, POST_CATEGORIES, POST_CONDITIONS } = require('../../config/market')

Component({
  properties: { form: Object, status: String, error: String, submitText: { type: String, value: '发布商品' } },
  data: { campuses: CAMPUSES, categories: POST_CATEGORIES, conditions: POST_CONDITIONS, categoryName: '', conditionName: '', campusName: '' },
  observers: {
    'form.categoryId, form.conditionId, form.campusId': function(categoryId, conditionId, campusId) {
      this.setData({
        categoryName: (POST_CATEGORIES.find((item) => item.id === categoryId) || {}).name || '',
        conditionName: (POST_CONDITIONS.find((item) => item.id === conditionId) || {}).name || '',
        campusName: (CAMPUSES.find((item) => item.id === campusId) || {}).name || '',
      })
    },
  },
  methods: {
    patch(event) { this.triggerEvent('patch', { patch: { [event.currentTarget.dataset.field]: event.detail.value } }) },
    pickCategory(event) { const item = this.data.categories[Number(event.detail.value)]; this.triggerEvent('patch', { patch: { categoryId: item.id } }) },
    pickCondition(event) { const item = this.data.conditions[Number(event.detail.value)]; this.triggerEvent('patch', { patch: { conditionId: item.id } }) },
    pickCampus(event) { const item = this.data.campuses[Number(event.detail.value)]; this.triggerEvent('patch', { patch: { campusId: item.id } }) },
    async chooseImages() {
      const remaining = 6 - (this.properties.form.images || []).length
      if (remaining <= 0) return
      try {
        const result = await wx.chooseMedia({ count: remaining, mediaType: ['image'], sourceType: ['album', 'camera'] })
        this.triggerEvent('addimages', { images: result.tempFiles.map((file) => ({ tempPath: file.tempFilePath, size: file.size })) })
      } catch (error) { if (!/cancel/i.test(error.errMsg || '')) this.triggerEvent('failure', { message: '图片选择失败，请重试' }) }
    },
    remove(event) { this.triggerEvent('removeimage', { index: Number(event.currentTarget.dataset.index) }) },
    move(event) { this.triggerEvent('moveimage', { from: Number(event.currentTarget.dataset.from), to: Number(event.currentTarget.dataset.to) }) },
    submit() { this.triggerEvent('submit') },
  },
})
