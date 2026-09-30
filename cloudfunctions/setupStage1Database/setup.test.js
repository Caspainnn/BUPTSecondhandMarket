const assert = require('node:assert/strict')
const test = require('node:test')

const {
  COLLECTIONS,
  INDEXES,
  RULES,
  setupStage1Database,
} = require('./setup')
const {
  CAMPUSES,
  MESSAGE_LIMITS,
  POST_CATEGORIES,
  POST_CONDITIONS,
  POST_LIMITS,
  TRANSACTION_LIMITS,
} = require('../../miniprogram/config/market')

function createDatabase() {
  const collections = new Set()
  return {
    collections,
    async ensureCollection(name) {
      collections.add(name)
    },
  }
}

test('requires the explicit stage one confirmation phrase', async () => {
  await assert.rejects(
    setupStage1Database({ confirm: 'wrong', database: createDatabase() }),
    (error) => error.code === 'INVALID_CONFIRM',
  )
})

test('creates six collections and returns deterministic console declarations', async () => {
  const database = createDatabase()
  const result = await setupStage1Database({
    confirm: 'INIT_STAGE_1',
    database,
  })

  assert.deepEqual([...database.collections], COLLECTIONS)
  assert.deepEqual(result, {
    collections: COLLECTIONS,
    indexes: INDEXES,
    rules: RULES,
  })
  assert.equal(COLLECTIONS.length, 6)
  assert.ok(INDEXES.some((index) => index.collection === 'conversations' && index.unique))
  assert.deepEqual(INDEXES[0].fields, [
    { field: 'status', order: 'asc' },
    { field: 'campusId', order: 'asc' },
    { field: 'availableQuantity', order: 'asc' },
    { field: 'publishedAt', order: 'desc' },
    { field: '_id', order: 'desc' },
  ])
  assert.ok(RULES.every((rule) => rule.read === false && rule.write === false))
})

test('is idempotent when collection creation is repeated', async () => {
  const database = createDatabase()
  await setupStage1Database({ confirm: 'INIT_STAGE_1', database })
  await setupStage1Database({ confirm: 'INIT_STAGE_1', database })
  assert.deepEqual([...database.collections], COLLECTIONS)
})

test('exports the exact approved market constants', () => {
  assert.deepEqual(POST_CATEGORIES.map((item) => item.name), [
    '数码',
    '教材书籍',
    '校园出行',
    '生活用品',
    '服饰美妆',
    '运动娱乐',
    '票券卡券',
    '其他',
  ])
  assert.deepEqual(POST_CONDITIONS.map((item) => item.name), [
    '全新未使用',
    '几乎全新',
    '明显使用痕迹',
    '外观较旧，功能正常',
    '部分功能异常',
  ])
  assert.deepEqual(CAMPUSES.map((item) => item.name), [
    '西土城校区',
    '沙河校区',
    '海南校区',
  ])
  assert.deepEqual(POST_LIMITS, {
    titleMin: 2,
    titleMax: 30,
    descriptionMin: 10,
    descriptionMax: 1000,
    imageMin: 1,
    imageMax: 6,
    imageMaxBytes: 2 * 1024 * 1024,
    priceMaxCents: 99999999,
    quantityMin: 1,
    quantityMax: 99,
    defectMin: 2,
    defectMax: 200,
  })
  assert.deepEqual(MESSAGE_LIMITS, { textMax: 500, pageSize: 20 })
  assert.deepEqual(TRANSACTION_LIMITS, {
    minLeadMinutes: 10,
    maxAdvanceDays: 14,
    locationMin: 2,
    locationMax: 50,
  })
})
