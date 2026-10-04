const test = require('node:test')
const assert = require('node:assert/strict')
const { getContact } = require('./contact')
const actor = { _id: 'buyer', status: 'active' }
const repository = { async get(collection, id) { return ({ posts: { p: { ownerId: 'seller' } }, conversations: { c: { buyerId: 'buyer', sellerId: 'seller' } }, users: { seller: { status: 'active', contactType: '微信', contactInfo: 'wx-demo', _openid: 'secret' }, buyer: { status: 'active', contactType: 'QQ', contactInfo: '12345' } } })[collection][id] || null } }
test('post returns only owner contact and conversation returns opposite participant contact', async () => {
  assert.deepEqual(await getContact({ actor, postId: 'p', repository }), { contactType: '微信', contactInfo: 'wx-demo' })
  assert.deepEqual(await getContact({ actor, conversationId: 'c', repository }), { contactType: '微信', contactInfo: 'wx-demo' })
  assert.deepEqual(await getContact({ actor: { _id: 'seller', status: 'active' }, conversationId: 'c', repository }), { contactType: 'QQ', contactInfo: '12345' })
})
test('blocks outsiders and anonymous readers and returns empty for missing contact', async () => {
  await assert.rejects(getContact({ actor: { _id: 'other', status: 'active' }, conversationId: 'c', repository }), { code: 'FORBIDDEN' })
  await assert.rejects(getContact({ postId: 'p', repository }), { code: 'PROFILE_REQUIRED' })
  assert.deepEqual(await getContact({ actor, postId: 'p', repository: { get: async (collection) => collection === 'posts' ? { ownerId: 'seller' } : { status: 'active' } } }), { contactInfo: '', contactType: '' })
})
