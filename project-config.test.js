const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

test('excludes mini program test files from packaging', () => {
  const config = JSON.parse(fs.readFileSync('project.config.json', 'utf8'))
  const ignored = config.packOptions.ignore.map((item) => item.value)

  assert.ok(ignored.includes('pages/profile-edit/view.test.js'))
})
