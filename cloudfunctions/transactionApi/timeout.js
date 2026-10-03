const config = require('./timeout-config.json')
const LEGACY_TIMEOUT_MS = 3600000
function configuredTimeoutMs(raw = config) {
  const hours = raw.autoCompleteAfterHours
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || Math.round(hours * 3600000) < 1 || hours > 24 * 365) throw new Error('autoCompleteAfterHours须为大于0且不超过8760的小时数')
  return Math.round(hours * 3600000)
}
function timeoutMs(transaction) { return Number.isFinite(transaction.autoCompleteAfterMs) && transaction.autoCompleteAfterMs > 0 ? transaction.autoCompleteAfterMs : LEGACY_TIMEOUT_MS }
function deadline(transaction) { return Number(transaction.scheduledAt) + timeoutMs(transaction) }
module.exports = { configuredTimeoutMs, timeoutMs, deadline, LEGACY_TIMEOUT_MS }
