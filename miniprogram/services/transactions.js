const { callCloud } = require('./cloud-result')

const action = (name, data = {}) => callCloud('transactionApi', { action: name, ...data })
const createTransaction = (input, requestId) => action('create', { ...input, requestId }).then((data) => data.transaction)
const reviseTransaction = (transactionId, input, requestId) => action('revise', { transactionId, ...input, requestId })
const withdrawTransaction = (transactionId, reason, requestId) => action('withdraw', { transactionId, reason, requestId })
const respondTransaction = (transactionId, decision, reason, requestId) => action('respond', { transactionId, decision, reason, requestId })
const cancelTransaction = (transactionId, reason, requestId) => action('cancel', { transactionId, reason, requestId })
const submitResult = (transactionId, result, requestId) => action('submitResult', { transactionId, result, requestId })
const listTransactions = (role, status, cursor, limit = 20) => action('list', { role, status, cursor, limit })
const getTransaction = (transactionId) => action('detail', { transactionId })

async function listOngoingTransactions() {
  const groups = await Promise.all(['pending_seller', 'awaiting_handover'].map(async status => {
    const rows = []
    let cursor = null
    do {
      const result = await listTransactions('', status, cursor, 20)
      rows.push(...result.transactions)
      cursor = result.nextCursor || null
    } while (cursor)
    return rows
  }))
  const rows = groups.flat()
  return { transactions: rows.filter((row, index) => ['pending_seller', 'awaiting_handover'].includes(row.status) && rows.findIndex(item => item._id === row._id) === index).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), nextCursor: null }
}

const refreshAppointments = () => action('refresh')

module.exports = { refreshAppointments, listOngoingTransactions, reviseTransaction, cancelTransaction, createTransaction, getTransaction, listTransactions, respondTransaction, submitResult, withdrawTransaction }
