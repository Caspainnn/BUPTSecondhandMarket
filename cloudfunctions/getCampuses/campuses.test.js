const assert = require('node:assert/strict')
const test = require('node:test')

const { listEnabledCampuses } = require('./campuses')

test('returns enabled BUPT campuses in sort order', async () => {
  const campuses = await listEnabledCampuses({
    findAll: async () => [
      { campusId: 'disabled', schoolId: 'bupt', enabled: false, sortOrder: 0 },
      { campusId: 'hainan', schoolId: 'bupt', enabled: true, sortOrder: 30 },
      { campusId: 'other', schoolId: 'other', enabled: true, sortOrder: 1 },
      { campusId: 'xitucheng', schoolId: 'bupt', enabled: true, sortOrder: 10 },
      { campusId: 'shahe', schoolId: 'bupt', enabled: true, sortOrder: 20 },
    ],
  })

  assert.deepEqual(
    campuses.map((campus) => campus.campusId),
    ['xitucheng', 'shahe', 'hainan'],
  )
})
