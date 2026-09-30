const test = require('node:test')
const assert = require('node:assert/strict')

const { setupDatabase } = require('./setup')

function createDatabase() {
  const collections = new Set()
  const documents = new Map()

  return {
    collections,
    documents,
    async ensureCollection(name) {
      collections.add(name)
    },
    async upsert(collection, id, data) {
      documents.set(`${collection}/${id}`, data)
    },
  }
}

test('requires the explicit stage zero confirmation phrase', async () => {
  const database = createDatabase()

  await assert.rejects(
    setupDatabase({ confirm: 'yes', database }),
    (error) => error.code === 'INVALID_CONFIRM',
  )
  assert.equal(database.collections.size, 0)
  assert.equal(database.documents.size, 0)
})

test('creates three collections and four deterministic seed records', async () => {
  const database = createDatabase()

  const result = await setupDatabase({
    confirm: 'INIT_STAGE_0',
    database,
  })

  assert.deepEqual([...database.collections], ['users', 'schools', 'campuses'])
  assert.equal(database.documents.size, 4)
  assert.deepEqual(database.documents.get('schools/bupt'), {
    schoolId: 'bupt',
    name: '北京邮电大学',
    enabled: true,
  })
  assert.equal(
    database.documents.get('campuses/bupt-hainan').name,
    '海南校区',
  )
  assert.deepEqual(result, {
    collections: ['users', 'schools', 'campuses'],
    schools: 1,
    campuses: 3,
  })
})

test('is idempotent when run repeatedly', async () => {
  const database = createDatabase()

  await setupDatabase({ confirm: 'INIT_STAGE_0', database })
  await setupDatabase({ confirm: 'INIT_STAGE_0', database })

  assert.equal(database.collections.size, 3)
  assert.equal(database.documents.size, 4)
})

test('maps database failures to a stable internal error', async () => {
  const database = {
    async ensureCollection() {
      throw new Error('service unavailable')
    },
  }

  await assert.rejects(
    setupDatabase({ confirm: 'INIT_STAGE_0', database }),
    (error) => error.code === 'INTERNAL_ERROR',
  )
})
