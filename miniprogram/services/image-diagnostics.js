const { callCloud } = require('./cloud-result')
async function diagnosePostImages(postId) {
  const result = await callCloud('diagnoseImages', { postId })
  const lines = []
  for (const file of result.files) {
    if (!file.exists) { lines.push(file.label + '：云端文件不可用或未设置'); continue }
    try {
      const downloaded = await wx.cloud.downloadFile({ fileID: file.fileId })
      lines.push(file.label + '：可读取')
      if (downloaded.tempFilePath) wx.getFileSystemManager().unlink({ filePath: downloaded.tempFilePath, fail: () => {} })
    } catch (error) {
      lines.push(file.label + '：云端存在，当前账号读取失败（' + (error.errCode || '未知错误') + '）')
    }
  }
  return lines.join(String.fromCharCode(10))
}
module.exports = { diagnosePostImages }
