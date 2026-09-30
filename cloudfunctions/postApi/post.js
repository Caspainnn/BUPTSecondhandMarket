const CATEGORY_IDS = new Set(['digital', 'books', 'mobility', 'daily', 'fashion', 'sports', 'tickets', 'other'])
const CONDITION_IDS = new Set(['new', 'like_new', 'visible_wear', 'worn_functional', 'partially_faulty'])
const CAMPUS_IDS = new Set(['bupt-xitucheng', 'bupt-shahe', 'bupt-hainan'])

class PostError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PostError'
    this.code = code
  }
}

const length = (value) => [...value].length

function boundedText(value, min, max, code, message) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (length(normalized) < min || length(normalized) > max) throw new PostError(code, message)
  return normalized
}

function parsePriceToCents(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new PostError('INVALID_PRICE', '请输入正确的参考价格')
  }
  const [yuan, decimals = ''] = value.split('.')
  const cents = Number(yuan) * 100 + Number(decimals.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents > 99999999) {
    throw new PostError('INVALID_PRICE', '参考价格不能超过 999999.99 元')
  }
  return cents
}

function validateQuantity(value) {
  if (!Number.isInteger(value) || value < 1 || value > 99) {
    throw new PostError('INVALID_QUANTITY', '库存数量必须是 1 至 99 的整数')
  }
  return value
}

function validatePostInput(input = {}) {
  const title = boundedText(input.title, 2, 30, 'INVALID_TITLE', '标题需为 2 至 30 个字符')
  const description = boundedText(input.description, 10, 1000, 'INVALID_DESCRIPTION', '描述需为 10 至 1000 个字符')
  const images = Array.isArray(input.imageFileIds) ? input.imageFileIds : []
  if (images.length < 1 || images.length > 6 || images.some((id) => typeof id !== 'string' || !/^cloud:\/\/.+\.(?:jpe?g|png|webp)$/i.test(id))) {
    throw new PostError('INVALID_IMAGES', '请上传 1 至 6 张 JPEG、PNG 或 WebP 图片')
  }
  if (!CATEGORY_IDS.has(input.categoryId)) throw new PostError('INVALID_CATEGORY', '请选择有效分类')
  if (!CONDITION_IDS.has(input.conditionId)) throw new PostError('INVALID_CONDITION', '请选择有效的新旧程度')
  if (!CAMPUS_IDS.has(input.campusId)) throw new PostError('INVALID_CAMPUS', '请选择有效校区')

  const defect = typeof input.defectDescription === 'string' ? input.defectDescription.trim() : ''
  if (input.conditionId === 'partially_faulty') {
    boundedText(defect, 2, 200, 'INVALID_DEFECT_DESCRIPTION', '请填写 2 至 200 个字符的故障说明')
  } else if (defect) {
    throw new PostError('INVALID_DEFECT_DESCRIPTION', '只有部分功能异常商品需要故障说明')
  }

  return {
    title,
    description,
    imageFileIds: [...images],
    categoryId: input.categoryId,
    unitPriceCents: parsePriceToCents(input.price),
    totalQuantity: validateQuantity(input.totalQuantity),
    conditionId: input.conditionId,
    defectDescription: defect,
    schoolId: 'bupt',
    campusId: input.campusId,
  }
}

function validateInventoryEdit({ totalQuantity, reservedQuantity, soldQuantity }) {
  validateQuantity(totalQuantity)
  if (!Number.isInteger(reservedQuantity) || !Number.isInteger(soldQuantity) || reservedQuantity < 0 || soldQuantity < 0 || totalQuantity < reservedQuantity + soldQuantity) {
    throw new PostError('INVALID_QUANTITY', '总库存不能低于已预约数量与已售数量之和')
  }
}

module.exports = { PostError, parsePriceToCents, validateInventoryEdit, validatePostInput }
