const test = require('node:test')
const assert = require('node:assert/strict')

const { loginUser } = require('./login')

function createUsers(existing = null) {
  const created = []

  return {
    created,
    async findByOpenid() {
      return existing
    },
    async create(user) {
      created.push(user)
      return { _id: 'user-1', ...user }
    },
  }
}

test('creates an incomplete active user on first login', async () => {
  const users = createUsers()
  const now = new Date('2026-09-30T00:00:00.000Z')

  const result = await loginUser({ openid: 'openid-1', users, now })

  assert.equal(result.created, true)
  assert.deepEqual(result.user, {
    _id: 'user-1',
    _openid: 'openid-1',
    nickname: '',
    avatarFileId: '',
    schoolId: 'bupt',
    campusId: '',
    profileCompleted: false,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  })
  assert.equal(users.created.length, 1)
})

test('returns an existing user without creating another record', async () => {
  const existing = { _id: 'existing-user', _openid: 'openid-1' }
  const users = createUsers(existing)

  const result = await loginUser({
    openid: 'openid-1',
    users,
    now: new Date(),
  })

  assert.deepEqual(result, { user: existing, created: false })
  assert.equal(users.created.length, 0)
})

test('rejects a login without a trusted OpenID', async () => {
  await assert.rejects(
    loginUser({ openid: '', users: createUsers(), now: new Date() }),
    (error) => error.code === 'INVALID_IDENTITY',
  )
})

test('maps database failures to a stable internal error', async () => {
  const users = {
    async findByOpenid() {
      throw new Error('database unavailable')
    },
  }

  await assert.rejects(
    loginUser({ openid: 'openid-1', users, now: new Date() }),
    (error) => error.code === 'INTERNAL_ERROR',
  )
})
