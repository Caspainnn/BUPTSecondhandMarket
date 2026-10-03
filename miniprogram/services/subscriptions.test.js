const test = require('node:test'), assert = require('node:assert/strict')
const { requestAppointmentSubscription } = require('./subscriptions')
test('missing template config never calls native authorization or recording', async () => {
  let calls = 0
  const result = await requestAppointmentSubscription({ transactionId: 't', config: { enabled: false }, nativeRequest: () => calls++, record: () => calls++ })
  assert.equal(result.status, 'disabled'); assert.equal(calls, 0)
})
test('authorization records one grant per accepted callback and supports idempotent recording retry', async () => {
  const received = [], config = { enabled: true, templateId: 'id' }
  const nativeRequest = options => { assert.deepEqual(options.tmplIds, ['id']); options.success({ id: 'accept' }) }
  let tries = 0
  const record = async input => { received.push(input); if (!tries++) throw new Error('offline') }
  const first = await requestAppointmentSubscription({ transactionId: 't', config, nativeRequest, record, requestId: 'once' })
  assert.equal(first.status, 'record_failed')
  const second = await requestAppointmentSubscription({ transactionId: 't', config, nativeRequest: () => assert.fail('retry must not ask twice'), record, pending: first.pending })
  assert.equal(second.status, 'accepted')
  assert.equal(received[0].requestId, received[1].requestId)
})
test('rejection native failure or unsupported API leaves transaction flow independent', async () => {
  const config = { enabled: true, templateId: 'id' }
  const record = () => assert.fail('no authorization must not be recorded as a grant')
  assert.equal((await requestAppointmentSubscription({ transactionId: 't', config, nativeRequest: opts => opts.success({ id: 'reject' }), record })).status, 'rejected')
  assert.equal((await requestAppointmentSubscription({ transactionId: 't', config, nativeRequest: opts => opts.fail({ errMsg: 'unsupported' }), record })).status, 'unavailable')
})
