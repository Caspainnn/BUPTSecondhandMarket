const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
exports.main = async (event = {}) => {
  try {
    if (!cloud.getWXContext().OPENID) throw new Error('请先登录')
    if (typeof event.postId !== 'string' || !event.postId || event.postId.length > 128) throw new Error('商品标识无效')
    const { data: post } = await cloud.database().collection('posts').doc(event.postId).get()
    const files = (post.imageFileIds || []).slice(0, 6).map((fileId, index) => ({ label: '商品图' + (index + 1), fileId }))
    files.push({ label: '卖家头像', fileId: post.ownerAvatarFileId || '' })
    const valid = files.filter(file => typeof file.fileId === 'string' && file.fileId.startsWith('cloud://'))
    const result = valid.length ? await cloud.getTempFileURL({ fileList: valid.map(file => file.fileId) }) : { fileList: [] }
    return { ok: true, data: { files: files.map(file => {
      const info = result.fileList.find(item => item.fileID === file.fileId)
      return { ...file, exists: Boolean(info && info.status === 0) }
    }) } }
  } catch (error) {
    return { ok: false, error: { code: 'IMAGE_DIAGNOSIS_FAILED', message: error.message || '图片检查失败' } }
  }
}
