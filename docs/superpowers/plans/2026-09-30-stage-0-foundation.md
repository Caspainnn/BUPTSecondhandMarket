# 邮子二手铺阶段 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可在微信开发者工具与真机运行的原生小程序，完成匿名浏览、微信身份建档、必填资料维护和北邮三校区云端持久化闭环。

**Architecture:** 小程序端仅包含首页、我的和资料编辑三个页面，通过统一用户服务调用两个云函数。云函数从可信上下文获取 OpenID，并独占用户写权限；学校和校区通过可复现的种子数据导入云数据库。可脱离微信运行的校验和状态逻辑使用 Node.js 内置测试验证，微信 API 与云环境使用开发者工具及真机验收。

**Tech Stack:** 微信原生小程序、微信云开发、JavaScript、`wx-server-sdk`、Node.js 内置 `node:test`

**Spec:** `docs/superpowers/specs/2026-09-30-stage-0-foundation-design.md`

## Global Constraints

- AppID 固定为 `wx598761603636d41f`。
- 云环境 ID 固定为 `cloud1-d1gi2dzcp1275d460`。
- 不引入跨端框架、第三方 UI 库或测试框架。
- 首页允许匿名访问；首次受保护操作或进入“我的”时才调用登录云函数。
- 头像、昵称和常驻校区均为资料完成的必填项。
- V1 学校固定为北京邮电大学，校区固定为西土城、沙河和海南三个启用项。
- 客户端不得直接写 `users`、`schools` 或 `campuses`。
- AppSecret、云密钥和 Token 不得进入客户端、文档、日志或 Git。
- 不实现商品、求购、聊天、交易、库存或通知业务。
- 本地自测通过不等于云端部署或真机验收通过。

## Review Focus

- 重复调用 `login`：必须复用同一 OpenID 的已有用户，不能产生重复记录；由 Task 3 测试覆盖。
- 伪造、停用或跨学校校区：必须拒绝资料更新；由 Task 4 测试覆盖。
- 昵称只有空白或超过长度上限：必须返回稳定业务错误且不写数据库；由 Task 4 测试覆盖。
- 头像上传成功但资料保存失败：页面必须保留输入并允许重试，不显示保存成功；由 Task 5 状态测试与人工验收覆盖。
- 云函数、网络或身份初始化失败：客户端必须恢复可操作状态并显示错误；由 Task 5 状态测试与人工验收覆盖。

---

### Task 1: 原生小程序骨架与配置

**Files:**
- Create: `miniprogram/app.js`
- Create: `miniprogram/app.json`
- Create: `miniprogram/app.wxss`
- Create: `miniprogram/sitemap.json`
- Create: `miniprogram/config/env.js`
- Create: `miniprogram/pages/home/index.js`
- Create: `miniprogram/pages/home/index.json`
- Create: `miniprogram/pages/home/index.wxml`
- Create: `miniprogram/pages/home/index.wxss`
- Create: `miniprogram/pages/profile/index.js`
- Create: `miniprogram/pages/profile/index.json`
- Create: `miniprogram/pages/profile/index.wxml`
- Create: `miniprogram/pages/profile/index.wxss`
- Create: `miniprogram/pages/profile-edit/index.js`
- Create: `miniprogram/pages/profile-edit/index.json`
- Create: `miniprogram/pages/profile-edit/index.wxml`
- Create: `miniprogram/pages/profile-edit/index.wxss`
- Modify: `project.config.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `ENV_ID: string` from `miniprogram/config/env.js`; registered routes for home, profile and profile-edit; `App.globalData.user: object | null`.
- Consumes: no prior task interfaces.

- [ ] **Step 1: Add the minimal app configuration**

Set `miniprogramRoot` to `miniprogram/`, `cloudfunctionRoot` to `cloudfunctions/`, register the three pages, and configure the bottom tab bar with “首页”和“我的”.

- [ ] **Step 2: Initialize cloud capability**

In `app.js`, call `wx.cloud.init({ env: ENV_ID, traceUser: true })`; fail visibly in development if cloud capability is unavailable.

- [ ] **Step 3: Build static page shells**

Home shows the “邮子二手铺 / 邮二手” identity and anonymous-access copy. Profile and profile-edit render stable loading, empty and error placeholders without calling business services yet.

- [ ] **Step 4: Verify in WeChat Developer Tools**

Import the repository root. Expected: compilation succeeds, home opens without login, and all three routes can render without JavaScript errors.

- [ ] **Step 5: Commit**

Run: `git add .gitignore project.config.json miniprogram && git commit -m "feat: scaffold native mini program"`

### Task 2: 基础数据、权限与部署文档

**Files:**
- Create: `database/seeds/schools.json`
- Create: `database/seeds/campuses.json`
- Create: `database/README.md`
- Create: `README.md`

**Interfaces:**
- Produces: school ID `bupt`; campus IDs `bupt-xitucheng`, `bupt-shahe`, `bupt-hainan`; documented collection permissions and indexes.
- Consumes: cloud environment `cloud1-d1gi2dzcp1275d460` from Task 1.

- [ ] **Step 1: Create deterministic seed data**

Add one enabled school and three enabled campuses with stable IDs, names and sort order. Keep the import files valid for the cloud database console.

- [ ] **Step 2: Document collection creation and access control**

Document creation of `users`, `schools`, and `campuses`; read-only client access for region data; no direct client access to user writes; and the required unique/query indexes from the spec.

- [ ] **Step 3: Write the root README**

Cover project purpose, concise directory tree, prerequisites, import steps, cloud function deployment, security boundaries, current phase, service-category blocker, and links to design/plan/acceptance documents.

- [ ] **Step 4: Validate seed files**

Run: `node -e "const fs=require('fs'); for (const f of ['database/seeds/schools.json','database/seeds/campuses.json']) JSON.parse(fs.readFileSync(f,'utf8')); console.log('seed json ok')"`

Expected: `seed json ok`.

- [ ] **Step 5: Commit**

Run: `git add README.md database && git commit -m "docs: add cloud database setup"`

### Task 3: 幂等登录云函数

**Files:**
- Create: `cloudfunctions/login/package.json`
- Create: `cloudfunctions/login/index.js`
- Create: `cloudfunctions/login/login.js`
- Create: `cloudfunctions/login/login.test.js`

**Interfaces:**
- Produces: `loginUser({ openid, users, now }) -> Promise<{ user, created }>`; deployed cloud function `login` returns `{ ok, data?, error? }`.
- Consumes: `users` collection schema and school ID `bupt` from Task 2.

- [ ] **Step 1: Write failing login tests**

Cover creating a first-time incomplete active user, returning an existing user without creating another, rejecting a missing OpenID, and surfacing a database failure as a stable internal error.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test cloudfunctions/login/login.test.js`

Expected: FAIL because `loginUser` does not exist.

- [ ] **Step 3: Implement the minimal pure login service**

Implement `loginUser({ openid, users, now })`; query by `_openid`, return the first existing record, otherwise create exactly one record with `schoolId: 'bupt'`, empty profile fields, `profileCompleted: false`, `status: 'active'`, and cloud-provided timestamps.

- [ ] **Step 4: Add the cloud wrapper**

Use `cloud.getWXContext().OPENID`, adapt the cloud database collection to the pure service, and return stable success/error envelopes without logging OpenID or profile content.

- [ ] **Step 5: Run tests**

Run: `node --test cloudfunctions/login/login.test.js`

Expected: all login tests PASS.

- [ ] **Step 6: Commit**

Run: `git add cloudfunctions/login && git commit -m "feat: add idempotent cloud login"`

### Task 4: 资料校验与更新云函数

**Files:**
- Create: `cloudfunctions/updateProfile/package.json`
- Create: `cloudfunctions/updateProfile/index.js`
- Create: `cloudfunctions/updateProfile/profile.js`
- Create: `cloudfunctions/updateProfile/profile.test.js`

**Interfaces:**
- Produces: `validateProfile(input) -> { nickname, avatarFileId, campusId }`; `updateUserProfile({ openid, input, users, campuses, now }) -> Promise<user>`; deployed cloud function `updateProfile` returns `{ ok, data?, error? }`.
- Consumes: school ID `bupt`, campus fields and `users` schema from Task 2.

- [ ] **Step 1: Write failing validation tests**

Cover trimming a valid nickname; rejecting blank or overlong nickname; rejecting missing/non-cloud avatar file ID; rejecting nonexistent, disabled or non-BUPT campus; rejecting missing user and disabled user; and producing `profileCompleted: true` only on a valid full update.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test cloudfunctions/updateProfile/profile.test.js`

Expected: FAIL because the profile functions do not exist.

- [ ] **Step 3: Implement validation and update**

Use a single nickname maximum of 20 Unicode code points. Require `avatarFileId` to begin with `cloud://`. Resolve the campus from the database before updating the current OpenID record; write normalized values and a cloud timestamp in one update.

- [ ] **Step 4: Add the cloud wrapper**

Read OpenID from `getWXContext()`, never from request data. Map validation, authorization and internal failures to stable error codes such as `INVALID_NICKNAME`, `INVALID_AVATAR`, `INVALID_CAMPUS`, `USER_DISABLED`, and `INTERNAL_ERROR`.

- [ ] **Step 5: Run all cloud unit tests**

Run: `node --test cloudfunctions/login/login.test.js cloudfunctions/updateProfile/profile.test.js`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

Run: `git add cloudfunctions/updateProfile && git commit -m "feat: add profile update cloud function"`

### Task 5: 客户端用户服务、登录守卫与资料页面

**Files:**
- Create: `miniprogram/services/user.js`
- Create: `miniprogram/services/cloud-result.js`
- Create: `miniprogram/services/profile-state.js`
- Create: `miniprogram/services/profile-state.test.js`
- Modify: `miniprogram/pages/home/index.js`
- Modify: `miniprogram/pages/home/index.wxml`
- Modify: `miniprogram/pages/profile/index.js`
- Modify: `miniprogram/pages/profile/index.wxml`
- Modify: `miniprogram/pages/profile/index.wxss`
- Modify: `miniprogram/pages/profile-edit/index.js`
- Modify: `miniprogram/pages/profile-edit/index.wxml`
- Modify: `miniprogram/pages/profile-edit/index.wxss`

**Interfaces:**
- Produces: `getCurrentUser()`, `requireCompletedProfile()`, `uploadAvatar(tempPath)`, `saveProfile(input)`; deterministic edit-page state reducer for loading, uploading, saving, success and failure.
- Consumes: `login` and `updateProfile` result envelopes from Tasks 3 and 4; campus IDs from Task 2.

- [ ] **Step 1: Write failing page-state tests**

Cover save success, save failure preserving form values, upload failure returning to editable state, and retry after a cloud error.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test miniprogram/services/profile-state.test.js`

Expected: FAIL because the state reducer does not exist.

- [ ] **Step 3: Implement cloud result handling and user service**

Centralize `wx.cloud.callFunction` response parsing. Cache only the current session's user summary. `requireCompletedProfile()` navigates to profile-edit when the returned user is incomplete and otherwise resolves the user.

- [ ] **Step 4: Implement profile display and editing**

Use `button open-type="chooseAvatar"`, a nickname input, and a three-item campus picker. Upload the chosen image to a per-user-safe cloud path, then call `updateProfile`; disable duplicate submits while saving and retain form data on any failure.

- [ ] **Step 5: Wire the anonymous home demonstration**

Keep home anonymous. Its protected demonstration action invokes the guard and directs incomplete users to profile-edit without implementing any future business page.

- [ ] **Step 6: Run all local unit tests**

Run: `node --test cloudfunctions/login/login.test.js cloudfunctions/updateProfile/profile.test.js miniprogram/services/profile-state.test.js`

Expected: all tests PASS.

- [ ] **Step 7: Verify in WeChat Developer Tools**

Expected: anonymous home works; “我的” establishes identity; incomplete profile redirects correctly; failed save remains editable; completed profile reloads after navigation.

- [ ] **Step 8: Commit**

Run: `git add miniprogram cloudfunctions && git commit -m "feat: complete user profile flow"`

### Task 6: 阶段 0 部署说明与验收交接

**Files:**
- Create: `docs/阶段0验收.md`
- Modify: `README.md`
- Modify: `开发日志.md`

**Interfaces:**
- Produces: user-executable deployment and acceptance checklist; stage status set to `待验收` only after local self-tests pass.
- Consumes: all prior task deliverables.

- [ ] **Step 1: Run repository verification**

Run all Node tests, parse both seed files, inspect `git diff --check`, and compile in WeChat Developer Tools. Record exact outcomes without describing undeployed cloud resources as online.

- [ ] **Step 2: Deploy and configure with the user**

Guide the user through creating/importing the three collections, applying permissions and indexes, installing cloud-function dependencies, and uploading/deploying `login` and `updateProfile` in environment `cloud1-d1gi2dzcp1275d460`.

- [ ] **Step 3: Perform two-account真机验收**

Verify anonymous entry, first identity creation, all required fields, three campuses, persistence after restart, forged-campus rejection, account isolation and cloud-console records. Leave every item as `待验收` until the user explicitly confirms it.

- [ ] **Step 4: Synchronize project memory**

Update README stage progress, `docs/阶段0验收.md`, and the seven S0 rows in `开发日志.md`. Local completion becomes `待验收`; only explicit user approval becomes `已完成`.

- [ ] **Step 5: Final verification and commit**

Run: `node --test cloudfunctions/login/login.test.js cloudfunctions/updateProfile/profile.test.js miniprogram/services/profile-state.test.js`

Run: `git diff --check`

Expected: all tests PASS and no whitespace errors.

Commit: `git add README.md docs/阶段0验收.md 开发日志.md && git commit -m "docs: prepare stage 0 acceptance"`
