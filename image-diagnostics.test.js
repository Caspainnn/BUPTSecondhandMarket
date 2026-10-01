const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm')
test('diagnosis compares cloud existence with buyer access without exposing URLs', async () => {
  const module = { exports: {} }
  const wx = {
    cloud: { downloadFile: async ({ fileID }) => {
      if (fileID.includes('avatar')) throw { errCode: -502003 }
      return { tempFilePath: 'temp' }
    } },
    getFileSystemManager: () => ({ unlink: () => {} }),
  }
  vm.runInNewContext(fs.readFileSync('miniprogram/services/image-diagnostics.js', 'utf8'), {
    module, wx, require: () => ({ callCloud: async () => ({ files: [
      { label: '商品图1', fileId: 'cloud://image.jpg', exists: true },
      { label: '卖家头像', fileId: 'cloud://avatar.jpg', exists: true },
    ] }) }),
  })
  const result = await module.exports.diagnosePostImages('post')
  assert.match(result, /商品图1：可读取/)
  assert.match(result, /卖家头像：云端存在，当前账号读取失败/)
  assert.doesNotMatch(result, /cloud:\/\//)
})
test('cloud diagnostics require identity and inspect only files stored on the post', async () => {
  const cloud = {
    init: () => {}, getWXContext: () => ({ OPENID: 'buyer' }),
    database: () => ({ collection: () => ({ doc: () => ({
      get: async () => ({ data: { imageFileIds: ['cloud://image.jpg'], ownerAvatarFileId: 'cloud://avatar.jpg' } }),
    }) }) }),
    getTempFileURL: async () => ({ fileList: [
      { fileID: 'cloud://image.jpg', status: 0 }, { fileID: 'cloud://avatar.jpg', status: -1 },
    ] }),
  }
  const exports = {}
  vm.runInNewContext(fs.readFileSync('cloudfunctions/diagnoseImages/index.js', 'utf8'), { require: () => cloud, exports })
  const result = await exports.main({ postId: 'post' })
  assert.equal(result.ok, true)
  assert.equal(result.data.files[0].exists, true)
  assert.equal(result.data.files[1].exists, false)
  cloud.getWXContext = () => ({})
  assert.equal((await exports.main({ postId: 'post' })).ok, false)
})
