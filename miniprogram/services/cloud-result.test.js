const test = require('node:test')
const assert = require('node:assert/strict')

const { unwrapCloudResult } = require('./cloud-result')

test('returns data from a successful cloud envelope', () => {
  assert.deepEqual(
    unwrapCloudResult({ result: { ok: true, data: { value: 1 } } }),
    { value: 1 },
  )
})

test('throws the stable cloud error code and message', () => {
  assert.throws(
    () => unwrapCloudResult({
      result: {
        ok: false,
        error: { code: 'INVALID_CAMPUS', message: '所选校区不可用' },
      },
    }),
    (error) => error.code === 'INVALID_CAMPUS' && error.message === '所选校区不可用',
  )
})

test('maps malformed cloud responses to a retryable internal error', () => {
  assert.throws(
    () => unwrapCloudResult({}),
    (error) => error.code === 'INTERNAL_ERROR',
  )
})
