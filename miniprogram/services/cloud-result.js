class CloudResultError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CloudResultError'
    this.code = code
  }
}

function unwrapCloudResult(response) {
  const envelope = response && response.result
  if (!envelope || typeof envelope.ok !== 'boolean') {
    throw new CloudResultError('INTERNAL_ERROR', '云服务响应异常，请稍后重试')
  }
  if (!envelope.ok) {
    const error = envelope.error || {}
    throw new CloudResultError(
      error.code || 'INTERNAL_ERROR',
      error.message || '云服务调用失败，请稍后重试',
    )
  }
  return envelope.data
}

async function callCloud(name, data = {}) {
  const response = await wx.cloud.callFunction({ name, data })
  return unwrapCloudResult(response)
}

module.exports = { CloudResultError, callCloud, unwrapCloudResult }
