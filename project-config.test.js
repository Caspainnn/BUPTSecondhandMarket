const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')

test('excludes mini program test files from packaging', () => {
  const config = JSON.parse(fs.readFileSync('project.config.json', 'utf8'))
  const ignored = config.packOptions.ignore.map((item) => item.value)
  const collect = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = `${directory}/${entry.name}`
    return entry.isDirectory() ? collect(fullPath) : [fullPath]
  })
  const tests = collect('miniprogram')
    .filter((file) => file.endsWith('.test.js'))
    .map((file) => file.replace(/^miniprogram\//, ''))

  assert.deepEqual(tests.filter((file) => !ignored.includes(file)), [])
})
