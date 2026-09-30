const assert = require('node:assert/strict')
const test = require('node:test')

const { createPostFormState, reducePostFormState } = require('./post-form-state')

test('preserves every default field when initialized with a partial form', () => {
  const state = createPostFormState({ form: { campusId: 'bupt-shahe' } })
  assert.equal(state.form.campusId, 'bupt-shahe')
  assert.deepEqual(state.form.images, [])
  assert.equal(state.form.title, '')
})

test('patches fields and conditionally clears defect description', () => {
  let state = createPostFormState()
  state = reducePostFormState(state, { type: 'PATCH_FORM', patch: { title: '显示器', conditionId: 'partially_faulty', defectDescription: 'HDMI 无信号' } })
  assert.equal(state.form.defectDescription, 'HDMI 无信号')
  state = reducePostFormState(state, { type: 'PATCH_FORM', patch: { conditionId: 'new' } })
  assert.equal(state.form.defectDescription, '')
})

test('adds at most six images and supports remove and move', () => {
  let state = createPostFormState()
  state = reducePostFormState(state, { type: 'ADD_IMAGES', images: Array.from({ length: 7 }, (_, i) => ({ tempPath: `${i}.jpg` })) })
  assert.equal(state.form.images.length, 6)
  state = reducePostFormState(state, { type: 'MOVE_IMAGE', from: 5, to: 0 })
  assert.equal(state.form.images[0].tempPath, '5.jpg')
  state = reducePostFormState(state, { type: 'REMOVE_IMAGE', index: 0 })
  assert.equal(state.form.images.length, 5)
})

test('upload and save failures preserve every form field and image', () => {
  let state = createPostFormState({ form: { title: '显示器', price: '12.50', images: [{ tempPath: 'a.jpg' }] } })
  state = reducePostFormState(state, { type: 'UPLOAD_START' })
  state = reducePostFormState(state, { type: 'FAILURE', message: '上传失败' })
  assert.equal(state.form.title, '显示器')
  assert.equal(state.form.price, '12.50')
  assert.equal(state.form.images[0].tempPath, 'a.jpg')
})

test('upload success replaces pending images with cloud file ids', () => {
  let state = createPostFormState({ form: { images: [{ tempPath: 'a.jpg' }, { tempPath: 'b.png' }] } })
  state = reducePostFormState(state, { type: 'UPLOAD_SUCCESS', fileIds: ['cloud://a.jpg', 'cloud://b.png'] })
  assert.deepEqual(state.form.images.map((item) => item.fileId), ['cloud://a.jpg', 'cloud://b.png'])
})

test('save start prevents duplicates and retry reuses request id', () => {
  let state = createPostFormState()
  state = reducePostFormState(state, { type: 'SAVE_START', requestId: 'request-1' })
  assert.equal(state.status, 'saving')
  assert.equal(state.requestId, 'request-1')
  assert.equal(reducePostFormState(state, { type: 'SAVE_START', requestId: 'request-2' }), state)
  state = reducePostFormState(state, { type: 'FAILURE', message: '失败' })
  state = reducePostFormState(state, { type: 'SAVE_START', requestId: 'request-2' })
  assert.equal(state.requestId, 'request-1')
})

test('create success resets only after confirmed save while edit success retains form', () => {
  const form = { title: '显示器', images: [{ fileId: 'cloud://a.jpg' }] }
  const created = reducePostFormState(createPostFormState({ mode: 'create', form }), { type: 'SAVE_SUCCESS', post: { _id: 'p' } })
  assert.equal(created.form.title, '')
  assert.equal(created.createdPost._id, 'p')
  const edited = reducePostFormState(createPostFormState({ mode: 'edit', form }), { type: 'SAVE_SUCCESS', post: { _id: 'p' } })
  assert.equal(edited.form.title, '显示器')
})
