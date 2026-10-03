const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
let checked = 0
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.superpowers'].includes(item.name)) continue
    const file = path.join(dir, item.name)
    if (item.isDirectory()) { walk(file); continue }
    if (/\.js$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
      if (result.status !== 0) throw new Error(file + '\n' + result.stderr)
      checked++
    }
    if (/\.json$/.test(file)) JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    if (/\.wxml$/.test(file)) {
      const content = fs.readFileSync(file, 'utf8'), stack = []
      const tags = content.match(/<\/?[a-zA-Z][\w-]*(?:[^<>"']|"[^"]*"|'[^']*')*>/g) || []
      for (const tag of tags) {
        if (/\/>$/.test(tag)) continue
        const name = tag.match(/^<\/?([\w-]+)/)[1]
        if (/^<\//.test(tag)) { if (stack.pop() !== name) throw new Error('WXML tag mismatch: ' + file + ' ' + tag) }
        else stack.push(name)
      }
      if (stack.length) throw new Error('WXML unclosed tags: ' + file + ' ' + stack.join(','))
    }
  }
}
walk('miniprogram'); walk('cloudfunctions')
console.log('JavaScript syntax, JSON and WXML structure checked; JS files: ' + checked)
