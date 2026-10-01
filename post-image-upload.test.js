const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const test = require('node:test')
const MB = 1024 * 1024
function setup(sizes, failCompression = false) {
  const uploads = [], qualities = []
  const sizesByPath = { 'photo.jpg': sizes[0] }
  const wx = {
    getFileSystemManager: () => ({ getFileInfo: ({ filePath, success }) => success({ size: sizesByPath[filePath] }) }),
    compressImage: ({ quality, success, fail }) => {
      qualities.push(quality)
      if (failCompression) return fail(new Error('compress failed'))
      const tempFilePath = 'compressed' + qualities.length + '.jpg'
      sizesByPath[tempFilePath] = sizes[Math.min(qualities.length, sizes.length - 1)]
      success({ tempFilePath })
    },
    cloud: { uploadFile: async (input) => { uploads.push(input); return { fileID: 'cloud-image' } } },
  }
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync('miniprogram/services/posts.js', 'utf8'), { wx, module, require: () => ({}) })
  return { upload: () => module.exports.uploadPostImages([{ tempPath: 'photo.jpg' }], 'owner'), uploads, qualities, service: module.exports }
}
test('small photos use filesystem manager and upload without degrading quality', async () => {
  const s = setup([MB])
  await s.upload()
  assert.deepEqual(s.qualities, [])
  assert.equal(s.uploads[0].filePath, 'photo.jpg')
})
test('large phone photos compress progressively toward 2 MB', async () => {
  const s = setup([12 * MB, 6 * MB, 3 * MB, 1.5 * MB])
  await s.upload()
  assert.deepEqual(s.qualities, [80, 60, 40])
  assert.equal(s.uploads[0].filePath, 'compressed3.jpg')
})
test('compressed photos up to 5 MB are accepted if 2 MB target cannot be reached', async () => {
  const s = setup([10 * MB, 4 * MB, 4 * MB, 4 * MB])
  await s.upload()
  assert.equal(s.uploads.length, 1)
})
test('photos above final limit fail clearly without uploading', async () => {
  const s = setup([10 * MB, 8 * MB, 7 * MB, 6 * MB])
  await assert.rejects(s.upload(), /压缩后.*5 MB/)
  assert.equal(s.uploads.length, 0)
})
test('failed compression preserves acceptable original and rejects oversized original', async () => {
  const acceptable = setup([4 * MB], true)
  await acceptable.upload()
  assert.equal(acceptable.uploads[0].filePath, 'photo.jpg')
  const large = setup([10 * MB], true)
  await assert.rejects(large.upload(), /压缩失败/)
  assert.equal(large.uploads.length, 0)
})
test('existing cloud photos skip all local work', async () => {
  const s = setup([])
  assert.deepEqual(Array.from(await s.service.uploadPostImages([{ fileId: 'existing' }], 'owner')), ['existing'])
  assert.deepEqual(s.qualities, [])
})
