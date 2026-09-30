const { callCloud } = require('./cloud-result')

const postAction = (action, data = {}) => callCloud('postApi', { action, ...data })
const createPost = (input, requestId) => postAction('create', { input, requestId }).then((data) => data.post)
const updatePost = (postId, input, requestId) => postAction('update', { postId, input, requestId }).then((data) => data.post)
const getPost = (postId) => postAction('detail', { postId }).then((data) => data.post)

function compressImage(src) {
  return new Promise((resolve, reject) => wx.compressImage({ src, quality: 80, success: (result) => resolve(result.tempFilePath), fail: reject }))
}

function fileInfo(filePath) {
  return new Promise((resolve, reject) => wx.getFileInfo({ filePath, success: resolve, fail: reject }))
}

async function uploadPostImages(images, ownerId) {
  if (!ownerId) throw new Error('无法确认上传用户，请重新进入页面')
  const fileIds = []
  for (const image of images) {
    if (image.fileId) { fileIds.push(image.fileId); continue }
    const extension = (image.tempPath.match(/\.(jpe?g|png|webp)$/i) || [])[1]
    if (!extension) throw new Error('只支持 JPEG、PNG 或 WebP 图片')
    const compressed = await compressImage(image.tempPath)
    const info = await fileInfo(compressed)
    if (info.size > 2 * 1024 * 1024) throw new Error('单张图片不能超过 2 MB')
    const safeOwnerId = String(ownerId).replace(/[^a-zA-Z0-9_-]/g, '_')
    const result = await wx.cloud.uploadFile({ cloudPath: `posts/${safeOwnerId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension.toLowerCase()}`, filePath: compressed })
    fileIds.push(result.fileID)
  }
  return fileIds
}

module.exports = { createPost, getPost, updatePost, uploadPostImages }
