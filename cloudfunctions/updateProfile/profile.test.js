const test = require('node:test')
const assert = require('node:assert/strict')

const { updateUserProfile, validateProfile } = require('./profile')

const validInput = {
  nickname: '  邮小二  ',
  avatarFileId: 'cloud://env/avatar/openid-1.jpg',
  campusId: 'bupt-shahe',
}

test('contact information is optional, trimmed, clearable and bounded',()=>{
 assert.equal(validateProfile(validInput).contactInfo,undefined)
 assert.equal(validateProfile({...validInput,contactInfo:'  WeChat: example  '}).contactInfo,'WeChat: example')
 assert.equal(validateProfile({...validInput,contactInfo:'  '}).contactInfo,'')
 assert.throws(()=>validateProfile({...validInput,contactInfo:'x'.repeat(101)}),error=>error.code==='INVALID_CONTACT')
})

function createRepositories({
  user = { _id: 'user-1', _openid: 'openid-1', status: 'active' },
  campus = {
    campusId: 'bupt-shahe',
    schoolId: 'bupt',
    enabled: true,
    name: '沙河校区',
  },
} = {}) {
  const updates = []

  return {
    updates,
    users: {
      async findByOpenid() {
        return user
      },
      async updateById(id, changes) {
        updates.push({ id, changes })
        return { ...user, ...changes }
      },
    },
    campuses: {
      async findById() {
        return campus
      },
    },
  }
}

test('normalizes a valid profile', () => {
  assert.deepEqual(validateProfile(validInput), {
    nickname: '邮小二',
    avatarFileId: 'cloud://env/avatar/openid-1.jpg',
    campusId: 'bupt-shahe',
  })
})

test('rejects blank and overlong nicknames', () => {
  assert.throws(
    () => validateProfile({ ...validInput, nickname: '   ' }),
    (error) => error.code === 'INVALID_NICKNAME',
  )
  assert.throws(
    () => validateProfile({ ...validInput, nickname: '邮'.repeat(21) }),
    (error) => error.code === 'INVALID_NICKNAME',
  )
})

test('rejects missing or non-cloud avatar file IDs', () => {
  for (const avatarFileId of ['', 'https://example.com/avatar.jpg']) {
    assert.throws(
      () => validateProfile({ ...validInput, avatarFileId }),
      (error) => error.code === 'INVALID_AVATAR',
    )
  }
})

test('rejects nonexistent, disabled, and non-BUPT campuses', async () => {
  const invalidCampuses = [
    null,
    { campusId: 'bupt-shahe', schoolId: 'bupt', enabled: false },
    { campusId: 'other-campus', schoolId: 'other', enabled: true },
  ]

  for (const campus of invalidCampuses) {
    const repositories = createRepositories({ campus })
    await assert.rejects(
      updateUserProfile({
        openid: 'openid-1',
        input: validInput,
        users: repositories.users,
        campuses: repositories.campuses,
        now: new Date(),
      }),
      (error) => error.code === 'INVALID_CAMPUS',
    )
    assert.equal(repositories.updates.length, 0)
  }
})

test('rejects missing and disabled users', async () => {
  for (const [user, code] of [
    [null, 'USER_NOT_FOUND'],
    [{ _id: 'user-1', status: 'disabled' }, 'USER_DISABLED'],
  ]) {
    const repositories = createRepositories({ user })
    await assert.rejects(
      updateUserProfile({
        openid: 'openid-1',
        input: validInput,
        users: repositories.users,
        campuses: repositories.campuses,
        now: new Date(),
      }),
      (error) => error.code === code,
    )
    assert.equal(repositories.updates.length, 0)
  }
})

test('writes a complete normalized profile in one update', async () => {
  const repositories = createRepositories()
  const now = new Date('2026-09-30T01:00:00.000Z')

  const user = await updateUserProfile({
    openid: 'openid-1',
    input: validInput,
    users: repositories.users,
    campuses: repositories.campuses,
    now,
  })

  assert.deepEqual(repositories.updates, [
    {
      id: 'user-1',
      changes: {
        nickname: '邮小二',
        avatarFileId: 'cloud://env/avatar/openid-1.jpg',
        schoolId: 'bupt',
        campusId: 'bupt-shahe',
        profileCompleted: true,
        updatedAt: now,
      },
    },
  ])
  assert.equal(user.profileCompleted, true)
})
