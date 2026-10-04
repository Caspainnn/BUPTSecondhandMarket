const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
test('sold-out relisting reuses information but creates a new post without changing history', async () => {
  const original = { _id: 'old', ownerId: 'seller', status: 'sold', title: '教材', direction: 'provide', contentType: 'item', totalQuantity: 2, availableQuantity: 0, soldQuantity: 2, unitPriceCents: 1000, imageFileIds: ['cloud://old'], campusId: 'bupt-shahe' }
  let page, created, updates = 0
  const services = { getPost: async () => { const { ownerId, ...publicPost } = original; return { ...publicPost, isOwner: true } }, uploadPostImages: async images => images.map(item => item.fileId), createPost: async input => { created = input; return { _id: 'new' } }, updatePost: async () => { updates++; return original } }
  vm.runInNewContext(fs.readFileSync('miniprogram/pages/post-edit/index.js', 'utf8'), { Page: value => page = value, wx: { setNavigationBarTitle() {}, showToast() {}, navigateBack() {} }, setTimeout: fn => fn(), require: name => name.endsWith('/posts') ? services : name.endsWith('/user') ? { requireCompletedProfile: async () => ({ _id: 'seller' }) } : require('./miniprogram/services/post-form-state') })
  page.data = { ...page.data }; page.setData = patch => Object.assign(page.data, patch)
  await page.onLoad({ postId: 'old', relist: '1' }); assert.equal(page.data.form.title, original.title); assert.equal(page.data.form.price, '10.00'); assert.equal(page.data.form.totalQuantity, 2); assert.equal(page.data.form.images[0].fileId, 'cloud://old'); await page.submit()
  assert.equal(created.relistSourcePostId, 'old'); assert.equal(updates, 0); assert.equal(created.title, original.title)
  assert.equal(created.imageFileIds[0], 'cloud://old'); assert.equal(original.status, 'sold'); assert.equal(original.soldQuantity, 2)
})
