const assert = require('node:assert/strict')
const test = require('node:test')

const {
  PostError,
  parsePriceToCents,
  validateInventoryEdit,
  validatePostInput,
} = require('./post')

const validInput = {
  title: '  出九成新显示器  ',
  description: '功能正常，无坏点，支持当面检查。',
  imageFileIds: ['cloud://env/posts/a.jpg'],
  categoryId: 'digital',
  price: '12.50',
  totalQuantity: 2,
  conditionId: 'visible_wear',
  defectDescription: '',
  campusId: 'bupt-xitucheng',
}

test('parses approved decimal prices into integer cents', () => {
  assert.equal(parsePriceToCents('0'), 0)
  assert.equal(parsePriceToCents('12'), 1200)
  assert.equal(parsePriceToCents('12.5'), 1250)
  assert.equal(parsePriceToCents('12.50'), 1250)
  assert.equal(parsePriceToCents('0001.20'), 120)
})

test('rejects unsafe or out-of-range prices', () => {
  for (const value of ['-1', '1e2', '1.234', '', '1000000', 12.5]) {
    assert.throws(() => parsePriceToCents(value), (error) => error.code === 'INVALID_PRICE')
  }
})

test('normalizes a valid sale post', () => {
  assert.deepEqual(validatePostInput(validInput), {
    direction: 'provide',
    contentType: 'item',
    title: '出九成新显示器',
    description: validInput.description,
    imageFileIds: validInput.imageFileIds,
    categoryId: 'digital',
    unitPriceCents: 1250,
    totalQuantity: 2,
    conditionId: 'visible_wear',
    defectDescription: '',
    schoolId: 'bupt',
    campusId: 'bupt-xitucheng',
  })
})

test('enforces text, image, category, quantity, and campus boundaries', () => {
  const invalid = [
    { title: '一' },
    { description: '字'.repeat(1001) },
    { imageFileIds: Array(7).fill('cloud://env/posts/a.jpg') },
    { imageFileIds: ['https://example.com/a.jpg'] },
    { imageFileIds: ['cloud://env/posts/a.gif'] },
    { categoryId: 'service' },
    { categoryId: 'unknown' },
    { totalQuantity: 0 },
    { totalQuantity: 100 },
    { totalQuantity: 1.5 },
    { campusId: 'other-campus' },
  ]

  for (const patch of invalid) {
    assert.throws(() => validatePostInput({ ...validInput, ...patch }), PostError)
  }
})

test('requires a bounded defect description only for partially faulty goods', () => {
  assert.throws(
    () => validatePostInput({ ...validInput, conditionId: 'partially_faulty', defectDescription: '' }),
    (error) => error.code === 'INVALID_DEFECT_DESCRIPTION',
  )
  const result = validatePostInput({
    ...validInput,
    conditionId: 'partially_faulty',
    defectDescription: 'HDMI 接口无信号',
  })
  assert.equal(result.defectDescription, 'HDMI 接口无信号')
  assert.throws(
    () => validatePostInput({ ...validInput, conditionId: 'new', defectDescription: '不应保留' }),
    (error) => error.code === 'INVALID_DEFECT_DESCRIPTION',
  )
})

test('prevents total inventory from dropping below reserved plus sold', () => {
  assert.doesNotThrow(() => validateInventoryEdit({ totalQuantity: 5, reservedQuantity: 2, soldQuantity: 3 }))
  assert.throws(
    () => validateInventoryEdit({ totalQuantity: 4, reservedQuantity: 2, soldQuantity: 3 }),
    (error) => error.code === 'INVALID_QUANTITY',
  )
})

test('description is optional and accepts short text while retaining its maximum', () => {
  for (const description of ['', '   ', undefined, '短', '字'.repeat(1000)]) {
    assert.equal(validatePostInput({ ...validInput, description }).description, (description || '').trim())
  }
  assert.throws(() => validatePostInput({ ...validInput, description: '字'.repeat(1001) }),
    (error) => error.code === 'INVALID_DESCRIPTION')
})
