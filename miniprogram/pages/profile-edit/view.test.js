const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('avatar picker uses a fixed circular visual with a transparent button overlay', () => {
  const wxml = fs.readFileSync(path.join(__dirname, 'index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(__dirname, 'index.wxss'), 'utf8')
  const avatarPicker = wxss.match(/\.avatar-picker\s*\{([^}]*)\}/)?.[1] || ''
  const avatarButton = wxss.match(/\.avatar-button\s*\{([^}]*)\}/)?.[1] || ''

  assert.match(wxml, /class="avatar-picker"/)
  assert.match(avatarPicker, /flex:\s*0 0 168rpx/)
  assert.match(avatarPicker, /overflow:\s*hidden/)
  assert.match(avatarPicker, /border-radius:\s*50%/)
  assert.match(avatarButton, /position:\s*absolute/)
  assert.match(avatarButton, /opacity:\s*0/)
})
