const { processAppointmentReminders } = require('./reminders')
const { autoCompleteTransaction } = require('./transaction')

function isTrustedTimer(event, context) {
  const sources = String(context.SOURCE || '').split(',')
  return event.Type === 'Timer' && event.TriggerName === 'appointment-timeout' && !context.OPENID && !sources.includes('wx_client')
}

async function runTimeoutBatch({ transactions, now, clock = () => now, deadline = Infinity, maxPages = 20 }) {
  let cursor = null
  const summary = { scanned: 0, completed: 0, failed: 0, hasMore: false }
  for (let page = 0; page < maxPages; page++) {
    if (clock() >= deadline) return { ...summary, hasMore: true }
    const result = await transactions.listDue({ before: now - 3600000, deadlineBefore: now, cursor, limit: 20 })
    for (const row of result.rows) {
      if (clock() >= deadline) return { ...summary, hasMore: true }
      summary.scanned++
      try {
        const outcome = await autoCompleteTransaction({ transactionId: row._id, transactions, now, clock })
        if (outcome.completed) summary.completed++
      } catch (error) {
        summary.failed++
        console.error('Timeout completion failed', { code: error.code || 'INTERNAL_ERROR' })
      }
    }
    cursor = result.nextCursor
    summary.hasMore = Boolean(cursor)
    if (!cursor) break
  }
  return summary
}

module.exports = { isTrustedTimer, runTimeoutBatch }

async function runAppointmentBatch({ transactions, now, clock = () => now, deadline = Infinity, maxPages = 20 }) {
  const summary = await runTimeoutBatch({ transactions, now, clock, deadline, maxPages })
  summary.reminded = 0
  const timeoutHasMore = summary.hasMore
  let cursor = null
  for (let page = 0; page < maxPages; page++) {
    if (clock() >= deadline) return { ...summary, hasMore: true }
    const result = await transactions.listDue({ before: now + 900000, reminderBefore: now, cursor, limit: 20 })
    for (const row of result.rows) {
      if (clock() >= deadline) return { ...summary, hasMore: true }
      try { summary.reminded += await processAppointmentReminders({ transactionId: row._id, transactions, now, clock }) }
      catch (error) { summary.failed++; console.error('Appointment reminder failed', { code: error.code || 'INTERNAL_ERROR' }) }
    }
    cursor = result.nextCursor
    summary.hasMore = timeoutHasMore || Boolean(cursor)
    if (!cursor) break
  }
  return summary
}
module.exports.runAppointmentBatch = runAppointmentBatch


async function runPageRefreshBatch({ transactions, userId, now, clock = () => now, deadline = Infinity }) {
  const summary = { scanned: 0, completed: 0, reminded: 0, failed: 0, hasMore: false }
  let cursor = null
  for (let page = 0; page < 20; page++) {
    if (clock() >= deadline) return { ...summary, hasMore: true }
    const result = await transactions.list({ userId, role: '', status: 'awaiting_handover', cursor, limit: 20 })
    for (const row of result.rows) {
      if (clock() >= deadline) return { ...summary, hasMore: true }
      summary.scanned++
      const outcome = await autoCompleteTransaction({ transactionId: row._id, transactions, now, clock })
      if (outcome.completed) summary.completed++
      else summary.reminded += await processAppointmentReminders({ transactionId: row._id, transactions, now, clock })
    }
    cursor = result.nextCursor; summary.hasMore = Boolean(cursor)
    if (!cursor) break
  }
  return summary
}
module.exports.runPageRefreshBatch = runPageRefreshBatch
