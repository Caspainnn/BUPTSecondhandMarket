class CampusesError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CampusesError'
    this.code = code
  }
}

async function listEnabledCampuses(repository) {
  try {
    const campuses = await repository.findAll()
    return campuses
      .filter((campus) => campus.schoolId === 'bupt' && campus.enabled === true)
      .sort((left, right) => left.sortOrder - right.sortOrder)
  } catch (error) {
    throw new CampusesError('INTERNAL_ERROR', '校区加载失败，请稍后重试')
  }
}

module.exports = { CampusesError, listEnabledCampuses }
