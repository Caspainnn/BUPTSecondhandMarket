const { callCloud } = require('./cloud-result')

async function requestAppointmentSubscription({ transactionId, config, pending, requestId, nativeRequest, record }) {
  if (!config || !config.enabled || !config.templateId) return { status: 'disabled' }
  let input = pending
  if (!input) {
    const request = nativeRequest || (typeof wx !== 'undefined' && typeof wx.requestSubscribeMessage === 'function' ? options => wx.requestSubscribeMessage(options) : null)
    if (!request) return { status: 'unavailable' }
    const outcome = await new Promise(resolve => {
      try { request({ tmplIds: [config.templateId], success: response => resolve(response && response[config.templateId] === 'accept' ? 'accepted' : 'rejected'), fail: () => resolve('unavailable') }) }
      catch (error) { resolve('unavailable') }
    })
    if (outcome !== 'accepted') return { status: outcome }
    input = { transactionId, accepted: true, requestId: requestId || `${Date.now()}-${Math.random().toString(36).slice(2)}` }
  }
  try {
    const result = await (record || (data => callCloud('transactionApi', { action: 'subscribe', ...data })))(input)
    if (result && result.disabled) return { status: 'disabled' }
    return { status: 'accepted' }
  } catch (error) { return { status: 'record_failed', pending: input } }
}
module.exports = { requestAppointmentSubscription }
