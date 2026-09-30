const POST_CATEGORIES = [
  { id: 'digital', name: '数码' },
  { id: 'books', name: '教材书籍' },
  { id: 'mobility', name: '校园出行' },
  { id: 'daily', name: '生活用品' },
  { id: 'fashion', name: '服饰美妆' },
  { id: 'sports', name: '运动娱乐' },
  { id: 'tickets', name: '票券卡券' },
  { id: 'other', name: '其他' },
]

const POST_CONDITIONS = [
  { id: 'new', name: '全新未使用' },
  { id: 'like_new', name: '几乎全新' },
  { id: 'visible_wear', name: '明显使用痕迹' },
  { id: 'worn_functional', name: '外观较旧，功能正常' },
  { id: 'partially_faulty', name: '部分功能异常' },
]

const CAMPUSES = [
  { id: 'bupt-xitucheng', name: '西土城校区' },
  { id: 'bupt-shahe', name: '沙河校区' },
  { id: 'bupt-hainan', name: '海南校区' },
]

const POST_LIMITS = {
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
}

const MESSAGE_LIMITS = { textMax: 500, pageSize: 20 }

const TRANSACTION_LIMITS = {
  minLeadMinutes: 10,
  maxAdvanceDays: 14,
  locationMin: 2,
  locationMax: 50,
}

module.exports = {
  CAMPUSES,
  MESSAGE_LIMITS,
  POST_CATEGORIES,
  POST_CONDITIONS,
  POST_LIMITS,
  TRANSACTION_LIMITS,
}
