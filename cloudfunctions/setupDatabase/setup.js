const COLLECTIONS = ['users', 'schools', 'campuses']

const SCHOOL = {
  id: 'bupt',
  data: {
    schoolId: 'bupt',
    name: '北京邮电大学',
    enabled: true,
  },
}

const CAMPUSES = [
  {
    id: 'bupt-xitucheng',
    data: {
      campusId: 'bupt-xitucheng',
      schoolId: 'bupt',
      name: '西土城校区',
      enabled: true,
      sortOrder: 10,
    },
  },
  {
    id: 'bupt-shahe',
    data: {
      campusId: 'bupt-shahe',
      schoolId: 'bupt',
      name: '沙河校区',
      enabled: true,
      sortOrder: 20,
    },
  },
  {
    id: 'bupt-hainan',
    data: {
      campusId: 'bupt-hainan',
      schoolId: 'bupt',
      name: '海南校区',
      enabled: true,
      sortOrder: 30,
    },
  },
]

class SetupError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SetupError'
    this.code = code
  }
}

async function setupDatabase({ confirm, database }) {
  if (confirm !== 'INIT_STAGE_0') {
    throw new SetupError('INVALID_CONFIRM', '请输入正确的阶段 0 初始化确认口令')
  }

  try {
    for (const collection of COLLECTIONS) {
      await database.ensureCollection(collection)
    }

    await database.upsert('schools', SCHOOL.id, SCHOOL.data)
    for (const campus of CAMPUSES) {
      await database.upsert('campuses', campus.id, campus.data)
    }

    return {
      collections: [...COLLECTIONS],
      schools: 1,
      campuses: CAMPUSES.length,
    }
  } catch (error) {
    if (error instanceof SetupError) {
      throw error
    }
    throw new SetupError('INTERNAL_ERROR', '数据库初始化失败，请查看云函数日志')
  }
}

module.exports = { CAMPUSES, COLLECTIONS, SCHOOL, SetupError, setupDatabase }
