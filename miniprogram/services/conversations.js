const { callCloud } = require('./cloud-result')

const conversationAction = (action, data = {}) => callCloud('conversationApi', { action, ...data })
const messageAction = (action, data = {}) => callCloud('messageApi', { action, ...data })

const openConversation = (postId, requestId) => conversationAction('open', { postId, requestId }).then((data) => data.conversation)
const listConversations = (cursor, limit = 20) => conversationAction('list', { cursor, limit })
const listMessages = (conversationId, before, limit = 20) => messageAction('list', { conversationId, before, limit })
const sendMessage = (conversationId, text, requestId) => messageAction('send', { conversationId, text, requestId })
const markRead = (conversationId) => messageAction('markRead', { conversationId })

function syncMessageBadge(totalUnread, tabIndex = 2) {
  if (totalUnread > 0) wx.setTabBarBadge({ index: tabIndex, text: String(Math.min(totalUnread, 99)) })
  else wx.removeTabBarBadge({ index: tabIndex })
}

const sendPostCard = (conversationId, postId, requestId) => messageAction('sendPostCard', { conversationId, postId, requestId })

module.exports = { sendPostCard, listConversations, listMessages, markRead, openConversation, sendMessage, syncMessageBadge }
