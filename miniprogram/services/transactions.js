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

module.exports = { reviseTransaction, cancelTransaction, createTransaction, getTransaction, listTransactions, respondTransaction, submitResult, withdrawTransaction }
