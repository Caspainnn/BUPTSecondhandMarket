async function getContact({ actor, postId, conversationId, repository }) {
  const fail = (code, message) => { throw Object.assign(new Error(message), { code }) }
  if (!actor || actor.status !== 'active') fail('PROFILE_REQUIRED', '请先登录')
  let peerId
  if (conversationId) {
    const conversation = await repository.get('conversations', conversationId)
    if (!conversation || ![conversation.buyerId, conversation.sellerId].includes(actor._id)) fail('FORBIDDEN', '无权查看该会话联系方式')
    peerId = actor._id === conversation.buyerId ? conversation.sellerId : conversation.buyerId
  } else if (postId) {
    const post = await repository.get('posts', postId)
    if (!post) fail('POST_NOT_FOUND', '信息不存在')
    peerId = post.ownerId
  } else fail('INVALID_REQUEST', '请选择信息或会话')
  const peer = await repository.get('users', peerId)
  return { contactInfo: peer && peer.status === 'active' ? peer.contactInfo || '' : '', contactType: peer && peer.status === 'active' ? peer.contactType || '' : '' }
}
module.exports = { getContact }
