const test = require('node:test')
const assert = require('node:assert/strict')

const { createProfileState, reduceProfileState } = require('./profile-state')

const completedForm = {
  nickname: '邮小二',
  avatarFileId: 'cloud://env/avatar.jpg',
  avatarPreview: '/tmp/avatar.jpg',
  campusId: 'bupt-shahe',
}

test('save success stores the returned user and leaves the form intact', () => {
  const saving = createProfileState({ form: completedForm, status: 'saving' })
  const user = { nickname: '邮小二', profileCompleted: true }

  const state = reduceProfileState(saving, { type: 'SAVE_SUCCESS', user })

  assert.equal(state.status, 'success')
  assert.deepEqual(state.user, user)
  assert.deepEqual(state.form, completedForm)
  assert.equal(state.error, '')
})

test('save failure preserves every form field and returns to editable state', () => {
  const saving = createProfileState({ form: completedForm, status: 'saving' })

  const state = reduceProfileState(saving, {
    type: 'FAILURE',
    message: '资料保存失败',
  })

  assert.equal(state.status, 'error')
  assert.equal(state.error, '资料保存失败')
  assert.deepEqual(state.form, completedForm)
})

test('upload failure preserves the previous avatar and remains editable', () => {
  const uploading = createProfileState({ form: completedForm, status: 'uploading' })

  const state = reduceProfileState(uploading, {
    type: 'FAILURE',
    message: '头像上传失败',
  })

  assert.equal(state.status, 'error')
  assert.equal(state.form.avatarFileId, completedForm.avatarFileId)
  assert.equal(state.form.avatarPreview, completedForm.avatarPreview)
})

test('retry clears the cloud error without clearing the form', () => {
  const failed = createProfileState({
    form: completedForm,
    status: 'error',
    error: '网络异常',
  })

  const state = reduceProfileState(failed, { type: 'RETRY' })

  assert.equal(state.status, 'idle')
  assert.equal(state.error, '')
  assert.deepEqual(state.form, completedForm)
})

test('patch form changes only the requested fields', () => {
  const initial = createProfileState({ form: completedForm })

  const state = reduceProfileState(initial, {
    type: 'PATCH_FORM',
    patch: { nickname: '新昵称' },
  })

  assert.equal(state.form.nickname, '新昵称')
  assert.equal(state.form.campusId, completedForm.campusId)
})

test('upload transitions replace the avatar only after success', () => {
  const initial = createProfileState({ form: completedForm })
  const uploading = reduceProfileState(initial, { type: 'UPLOAD_START' })
  const uploaded = reduceProfileState(uploading, {
    type: 'UPLOAD_SUCCESS',
    avatarFileId: 'cloud://env/new-avatar.jpg',
    avatarPreview: '/tmp/new-avatar.jpg',
  })

  assert.equal(uploading.status, 'uploading')
  assert.equal(uploading.form.avatarFileId, completedForm.avatarFileId)
  assert.equal(uploaded.status, 'idle')
  assert.equal(uploaded.form.avatarFileId, 'cloud://env/new-avatar.jpg')
  assert.equal(uploaded.form.avatarPreview, '/tmp/new-avatar.jpg')
})

test('save start clears an earlier error and prevents another idle action', () => {
  const failed = createProfileState({
    form: completedForm,
    status: 'error',
    error: '网络异常',
  })

  const state = reduceProfileState(failed, { type: 'SAVE_START' })

  assert.equal(state.status, 'saving')
  assert.equal(state.error, '')
  assert.deepEqual(state.form, completedForm)
})
