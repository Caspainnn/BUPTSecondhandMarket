const { createPostFormState, reducePostFormState } = require('../../services/post-form-state')
const { getPost, updatePost, uploadPostImages } = require('../../services/posts')
const { requireCompletedProfile } = require('../../services/user')

Page({
  data: { form: createPostFormState().form, status: 'loading', error: '' },
  async onLoad(options) { this.postId = options.postId; try { const user = await requireCompletedProfile(); if (!user) return; this.userId = user._id; const post = await getPost(this.postId); this.state = createPostFormState({ mode: 'edit', form: { ...post, price: (post.unitPriceCents / 100).toFixed(2), images: post.imageFileIds.map((fileId) => ({ fileId, tempPath: fileId })) } }); this.sync() } catch (error) { this.state = createPostFormState({ mode: 'edit', status: 'error', error: error.message }); this.sync() } },
  sync() { this.setData({ form: this.state.form, status: this.state.status, error: this.state.error }) },
  apply(event) { this.state = reducePostFormState(this.state, event); this.sync() },
  onPatch(e) { const patch = { ...e.detail.patch }; if (patch.totalQuantity !== undefined) patch.totalQuantity = Number(patch.totalQuantity); this.apply({ type: 'PATCH_FORM', patch }) },
  onAddImages(e) { this.apply({ type: 'ADD_IMAGES', images: e.detail.images }) }, onRemoveImage(e) { this.apply({ type: 'REMOVE_IMAGE', index: e.detail.index }) }, onMoveImage(e) { this.apply({ type: 'MOVE_IMAGE', ...e.detail }) }, onFailure(e) { this.apply({ type: 'FAILURE', message: e.detail.message }) },
  async submit() { if (['saving', 'uploading'].includes(this.state.status)) return; const requestId = this.state.requestId || `${Date.now()}-${Math.random().toString(36).slice(2)}`; try { this.apply({ type: 'UPLOAD_START' }); const fileIds = await uploadPostImages(this.state.form.images, this.userId); this.apply({ type: 'UPLOAD_SUCCESS', fileIds }); this.apply({ type: 'SAVE_START', requestId }); const post = await updatePost(this.postId, { ...this.state.form, imageFileIds: fileIds }, this.state.requestId); this.apply({ type: 'SAVE_SUCCESS', post }); wx.showToast({ title: '保存成功', icon: 'success' }); setTimeout(() => wx.navigateBack(), 500) } catch (error) { this.apply({ type: 'FAILURE', message: error.message || '保存失败，请重试' }) } },
})
