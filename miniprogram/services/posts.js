const { callCloud } = require('./cloud-result')

const postAction = (action, data = {}) => callCloud('postApi', { action, ...data })
const createPost = (input, requestId) => postAction('create', { input, requestId }).then((data) => data.post)
const updatePost = (postId, input, requestId) => postAction('update', { postId, input, requestId }).then((data) => data.post)
const getPost = (postId) => postAction('detail', { postId }).then((data) => data.post)
const listPosts = (campusId, cursor, limit = 20, direction = '', contentType = '', categoryIds = [], sort = 'newest', priceSort = '', keyword = '', filters = {}) => postAction('list', { campusId, cursor, limit, direction, contentType, categoryIds, sort, priceSort, keyword, minPriceCents: filters.minPriceCents, maxPriceCents: filters.maxPriceCents, conditionIds: filters.conditionIds })
const listMyPosts = (status, cursor, limit = 20) => postAction('listMine', { status, cursor, limit })
const setPostStatus = (postId, status, requestId) => postAction('setStatus', { postId, status, requestId }).then((data) => data.post)

function compressImage(src, quality) {
  return new Promise((resolve, reject) => wx.compressImage({ src, quality, success: (result) => resolve(result.tempFilePath), fail: reject }))
}

function fileInfo(filePath) {
  return new Promise((resolve, reject) => wx.getFileSystemManager().getFileInfo({ filePath, success: resolve, fail: reject }))
}

const TARGET_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

async function prepareImage(filePath) {
  let bestPath = filePath
  let bestSize = (await fileInfo(filePath)).size
  if (!Number.isFinite(bestSize) || bestSize <= 0) throw new Error('无法读取图片大小，请重新选择图片')
  let compressionFailed = false
  for (const quality of [80, 60, 40]) {
    if (bestSize <= TARGET_IMAGE_BYTES) break
    try {
      const candidate = await compressImage(filePath, quality)
      const size = (await fileInfo(candidate)).size
      if (Number.isFinite(size) && size > 0 && size < bestSize) {
        bestPath = candidate
        bestSize = size
      }
    } catch (error) {
      compressionFailed = true
      break
    }
  }
  if (bestSize > MAX_IMAGE_BYTES) {
    throw new Error(compressionFailed
      ? '图片压缩失败，当前图片超过 5 MB，请重试或选择其他图片'
      : '单张图片压缩后仍超过 5 MB，请裁剪或选择其他图片')
  }
  return bestPath
}
async function uploadPostImages(images, ownerId) {
  if (!ownerId) throw new Error('无法确认上传用户，请重新进入页面')
  const fileIds = []
  for (const image of images) {
    if (image.fileId) { fileIds.push(image.fileId); continue }
    const extension = (image.tempPath.match(/\.(jpe?g|png|webp)$/i) || [])[1]
    if (!extension) throw new Error('只支持 JPEG、PNG 或 WebP 图片')
    const compressed = await prepareImage(image.tempPath)
    const safeOwnerId = String(ownerId).replace(/[^a-zA-Z0-9_-]/g, '_')
    const result = await wx.cloud.uploadFile({ cloudPath: `posts/${safeOwnerId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension.toLowerCase()}`, filePath: compressed })
    fileIds.push(result.fileID)
  }
  return fileIds
}

module.exports = { createPost, getPost, listMyPosts, listPosts, setPostStatus, updatePost, uploadPostImages }
