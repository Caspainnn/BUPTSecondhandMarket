# Stage 1 Minimum Trade Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the complete sale-item loop from publishing and discovery through text chat, reservation, inventory movement, handover result, and personal management.

**Architecture:** Keep the native Mini Program client thin and split trusted cloud logic into four domain APIs: `postApi`, `conversationApi`, `messageApi`, and `transactionApi`. Each cloud function delegates to pure, Node-testable domain modules; all inventory and transaction state changes run through cloud database transactions and append audit records.

**Tech Stack:** Native WeChat Mini Program (WXML/WXSS/CommonJS), WeChat Cloud Development, `wx-server-sdk`, cloud database transactions, cloud storage, Node.js 20 built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-30-stage-1-minimum-trade-loop-design.md`

## Global Constraints

- Work directly in `E:\MyProjects\BUPTSecondhandMarket` on `main`; do not create a worktree unless the user changes this decision.
- Use only native Mini Program and Cloud Development APIs; add no UI framework or runtime dependency beyond `wx-server-sdk`.
- Anonymous users may browse discovery and public post detail; publish, chat, message, and transaction actions require a complete profile.
- Money crosses trust boundaries as a decimal string and is stored as integer cents; never calculate persisted money with floating-point arithmetic.
- User-facing post categories exclude `服务` in Stage 1; condition values and all limits must match the spec verbatim.
- Client input, user IDs, ownership, snapshots, inventory counts, and state are untrusted; cloud functions re-read and validate authoritative records.
- A single conversation is unique by `postId + buyerId + sellerId`; a conversation may have at most one non-terminal transaction.
- Inventory-changing writes, transaction state, audit events, inventory movements, and the corresponding system message must succeed atomically or not at all.
- Cloud functions return `{ ok: true, data }` or `{ ok: false, error: { code, message } }`; user-visible failures preserve form contents.
- Complete each task using RED → GREEN → full regression → commit. Do not implement later tasks early.

## Review Focus

- Decimal input such as `0`, `12`, `12.5`, `12.50`, `0001.20`, negative values, exponent notation, and more than two decimals must produce deterministic cents or a validation error; Task 2 pins these cases.
- A stale seller confirmation racing another buyer must never oversell or double-reserve; Task 9 includes concurrent repository simulations and Task 12 includes cloud integration verification.
- Duplicate client retries with the same request ID must return the original result without duplicating a post, message, transaction, event, or inventory movement; Tasks 3, 7, and 9 pin idempotency.
- Session or page changes must stop polling so messages are not fetched into the wrong conversation and timers do not leak; Task 8 tests lifecycle cleanup.
- A transaction that fails and releases stock, then receives an opposing success result, must become abnormal without re-reserving stock; Task 10 pins that exact transition.

---

### Task 1: Stage 1 constants and database bootstrap

**Files:**
- Create: `miniprogram/config/market.js`
- Create: `cloudfunctions/setupStage1Database/setup.js`
- Create: `cloudfunctions/setupStage1Database/setup.test.js`
- Create: `cloudfunctions/setupStage1Database/index.js`
- Create: `cloudfunctions/setupStage1Database/package.json`
- Modify: `database/README.md`
- Modify: `docs/数据模型规划.md`

**Interfaces:**
- Produces: client constants `POST_CATEGORIES`, `POST_CONDITIONS`, `CAMPUSES`, `POST_LIMITS`, `MESSAGE_LIMITS`, and `TRANSACTION_LIMITS`.
- Produces: `setupStage1Database({ confirm, database }) -> Promise<{ collections: string[], indexes: IndexSpec[], rules: RuleSpec[] }>`.
- Creates collections `posts`, `conversations`, `messages`, `transactions`, `transaction_events`, and `inventory_movements`; returns and documents the required index/rule declarations for manual console configuration.

- [ ] **Step 1: Write failing bootstrap tests**

Test confirmation phrase `INIT_STAGE_1`, idempotent collection creation, and deterministic index/rule declarations for discovery pagination, unique conversation lookup, message pagination, participant transaction lists, and audit lookup.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test cloudfunctions/setupStage1Database/setup.test.js`

Expected: FAIL because `setup.js` and Stage 1 declarations do not exist.

- [ ] **Step 3: Implement constants and bootstrap**

Use the exact category, condition, file, character, price, quantity, message, appointment, and location limits from the spec. The setup function may create missing collections but must not delete or overwrite business records; indexes and security rules remain explicit manual console steps because `wx-server-sdk` does not manage them reliably.

- [ ] **Step 4: Verify GREEN and parse configuration**

Run: `node --test cloudfunctions/setupStage1Database/setup.test.js`

Run: `node -e "JSON.parse(require('fs').readFileSync('cloudfunctions/setupStage1Database/package.json','utf8')); console.log('ok')"`

Expected: all tests pass and print `ok`.

- [ ] **Step 5: Commit**

```bash
git add miniprogram/config/market.js cloudfunctions/setupStage1Database database/README.md docs/数据模型规划.md
git commit -m "feat: define stage 1 data foundation"
```

### Task 2: Trusted post validation and inventory invariants

**Files:**
- Create: `cloudfunctions/postApi/post.js`
- Create: `cloudfunctions/postApi/post.test.js`
- Create: `cloudfunctions/postApi/package.json`

**Interfaces:**
- Produces: `parsePriceToCents(value: string) -> number`.
- Produces: `validatePostInput(input) -> NormalizedPostInput` with title, description, image file IDs, category, unit price cents, total quantity, condition, optional defect description, school, and campus.
- Produces: `validateInventoryEdit({ totalQuantity, reservedQuantity, soldQuantity }) -> void`.
- Uses `cloud://` image IDs only and rejects `服务` in Stage 1.

- [ ] **Step 1: Write failing validation tests**

Cover every field boundary, the five conditions, conditional `defectDescription` of 2–200 characters, 1–6 JPEG/PNG/WebP cloud file IDs, quantity 1–99, free price, the Review Focus decimal cases, and edits below reserved plus sold inventory.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test cloudfunctions/postApi/post.test.js`

Expected: FAIL because validation exports do not exist.

- [ ] **Step 3: Implement minimal pure validation**

Do not accept number input for money. Return normalized strings and integer cents; throw stable domain errors with codes such as `INVALID_TITLE`, `INVALID_PRICE`, `INVALID_IMAGES`, `INVALID_CONDITION`, and `INVALID_QUANTITY`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test cloudfunctions/postApi/post.test.js`

Expected: all post validation tests pass.

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/postApi
git commit -m "feat: validate sale posts and inventory"
```

### Task 3: Post domain cloud API

**Files:**
- Create: `cloudfunctions/postApi/index.js`
- Create: `cloudfunctions/postApi/post-service.js`
- Create: `cloudfunctions/postApi/post-service.test.js`

**Interfaces:**
- Consumes: Task 2 post validators.
- Produces actions:
  - `create({ input, requestId }) -> { post }`
  - `update({ postId, input, requestId }) -> { post }`
  - `setStatus({ postId, status, reason?, requestId }) -> { post }`
  - `list({ campusId?, cursor?, limit }) -> { posts, nextCursor }`
  - `listMine({ status?, cursor?, limit }) -> { posts, nextCursor }`
  - `detail({ postId }) -> { post }`
- `list` returns only active posts with `availableQuantity > 0`, ordered by `publishedAt desc, _id desc`, with a maximum page size of 20.

- [ ] **Step 1: Write failing service tests**

Test identity/profile requirements for writes, anonymous public reads, ownership, campus filtering, stable cursor pagination, public-field projection, request idempotency, snapshot-safe edits, downlisting, and hidden zero-availability posts.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test cloudfunctions/postApi/post-service.test.js`

Expected: FAIL because post service actions do not exist.

- [ ] **Step 3: Implement service and cloud adapter**

Create records with `totalQuantity = availableQuantity`, zero reserved/sold quantities, `status = active`, `schoolId = bupt`, server timestamps, and a unique create key derived from owner plus request ID. Public detail omits private identity fields; owner listing returns all lifecycle states.

- [ ] **Step 4: Verify GREEN and syntax**

Run: `node --test cloudfunctions/postApi/post.test.js cloudfunctions/postApi/post-service.test.js`

Run: `node --check cloudfunctions/postApi/index.js`

Expected: tests and syntax pass.

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/postApi
git commit -m "feat: add trusted post cloud api"
```

### Task 4: Publish, edit, and image upload client flow

**Files:**
- Create: `miniprogram/services/posts.js`
- Create: `miniprogram/services/post-form-state.js`
- Create: `miniprogram/services/post-form-state.test.js`
- Create: `miniprogram/components/post-form/index.js`
- Create: `miniprogram/components/post-form/index.json`
- Create: `miniprogram/components/post-form/index.wxml`
- Create: `miniprogram/components/post-form/index.wxss`
- Create: `miniprogram/pages/publish/index.js`
- Create: `miniprogram/pages/publish/index.json`
- Create: `miniprogram/pages/publish/index.wxml`
- Create: `miniprogram/pages/publish/index.wxss`
- Create: `miniprogram/pages/post-edit/index.js`
- Create: `miniprogram/pages/post-edit/index.json`
- Create: `miniprogram/pages/post-edit/index.wxml`
- Create: `miniprogram/pages/post-edit/index.wxss`
- Modify: `project.config.json`

**Interfaces:**
- Consumes: `postApi` actions from Task 3 and constants from Task 1.
- Produces: create/edit form state with `PATCH`, `ADD_IMAGES`, `REMOVE_IMAGE`, `MOVE_IMAGE`, `UPLOAD_START`, `UPLOAD_SUCCESS`, `SAVE_START`, `SAVE_SUCCESS`, and `FAILURE` transitions.
- Produces: `uploadPostImages(tempFiles) -> Promise<string[]>` that compresses/rejects files above 2 MB and uploads to `posts/<user>/<nonce>.<ext>`.

- [ ] **Step 1: Write failing form-state tests**

Test preservation after upload/save failure, image count/order, conditional defect field, cents-safe price string, double-submit prevention, request ID reuse on retry, and reset only after confirmed create success.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test miniprogram/services/post-form-state.test.js`

Expected: FAIL because form state does not exist.

- [ ] **Step 3: Implement form state, service, shared component, and pages**

The publish tab always creates; edit uses a separate non-tab page. Default campus comes from the completed profile. Add all new test files under `miniprogram/` to `packOptions.ignore`.

- [ ] **Step 4: Verify GREEN and package exclusions**

Run: `node --test miniprogram/services/post-form-state.test.js project-config.test.js`

Expected: tests pass and every Mini Program test file is excluded from packaging.

- [ ] **Step 5: Commit**

```bash
git add miniprogram/services/posts.js miniprogram/services/post-form-state* miniprogram/components/post-form miniprogram/pages/publish miniprogram/pages/post-edit project.config.json project-config.test.js
git commit -m "feat: add post publishing and editing flow"
```

### Task 5: Discovery and post detail client flow

**Files:**
- Create: `miniprogram/services/post-list-state.js`
- Create: `miniprogram/services/post-list-state.test.js`
- Create: `miniprogram/pages/discover/index.js`
- Create: `miniprogram/pages/discover/index.json`
- Create: `miniprogram/pages/discover/index.wxml`
- Create: `miniprogram/pages/discover/index.wxss`
- Create: `miniprogram/pages/post-detail/index.js`
- Create: `miniprogram/pages/post-detail/index.json`
- Create: `miniprogram/pages/post-detail/index.wxml`
- Create: `miniprogram/pages/post-detail/index.wxss`
- Modify: `miniprogram/app.json`

**Interfaces:**
- Consumes: `posts.list`, `posts.detail`, and auth/profile service.
- Produces: cursor list state with `LOAD_START`, `LOAD_SUCCESS`, `LOAD_MORE_SUCCESS`, `REFRESH`, `CAMPUS_CHANGE`, and `FAILURE`.
- Produces: owner actions edit/downlist and buyer action contact seller; unavailable posts expose history-only detail.

- [ ] **Step 1: Write failing list-state tests**

Test anonymous default `all`, completed-user default campus, session campus change, refresh replacement, append de-duplication, stale request rejection, pagination exhaustion, free labels, and hidden unavailable cards.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test miniprogram/services/post-list-state.test.js`

Expected: FAIL because list state does not exist.

- [ ] **Step 3: Implement discovery and detail pages**

Use a two-column grid, 20-item pages, pull-to-refresh, reach-bottom pagination, four campus choices plus all, and chronological ordering. Do not add keyword search or recommendation logic.

- [ ] **Step 4: Verify GREEN and app config**

Run: `node --test miniprogram/services/post-list-state.test.js project-config.test.js`

Run: `node -e "JSON.parse(require('fs').readFileSync('miniprogram/app.json','utf8')); console.log('ok')"`

Expected: tests pass and app configuration parses.

- [ ] **Step 5: Commit**

```bash
git add miniprogram/services/post-list-state* miniprogram/pages/discover miniprogram/pages/post-detail miniprogram/app.json project.config.json project-config.test.js
git commit -m "feat: add campus discovery and post detail"
```

### Task 6: Unique conversation domain

**Files:**
- Create: `cloudfunctions/conversationApi/conversation.js`
- Create: `cloudfunctions/conversationApi/conversation.test.js`
- Create: `cloudfunctions/conversationApi/index.js`
- Create: `cloudfunctions/conversationApi/package.json`

**Interfaces:**
- Produces actions:
  - `open({ postId, requestId }) -> { conversation }`
  - `list({ cursor?, limit }) -> { conversations, nextCursor, totalUnread }`
- Enforces unique key `postId:buyerId:sellerId`, refuses self-contact and new conversation creation for unavailable/downlisted posts, and allows retrieval of existing historical conversations.

- [ ] **Step 1: Write failing conversation tests**

Test unique reuse, simultaneous create conflict recovery, participant roles, complete-profile requirement, self-contact rejection, unavailable new-contact rejection, historical reuse, participant-only list results, and unread total calculation.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test cloudfunctions/conversationApi/conversation.test.js`

Expected: FAIL because conversation domain does not exist.

- [ ] **Step 3: Implement conversation service and adapter**

Use a deterministic unique key plus unique index; if concurrent creation loses the unique race, re-read and return the existing conversation.

- [ ] **Step 4: Verify GREEN and syntax**

Run: `node --test cloudfunctions/conversationApi/conversation.test.js`

Run: `node --check cloudfunctions/conversationApi/index.js`

Expected: tests and syntax pass.

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/conversationApi
git commit -m "feat: add unique product conversations"
```

### Task 7: Text message domain and unread accounting

**Files:**
- Create: `cloudfunctions/messageApi/message.js`
- Create: `cloudfunctions/messageApi/message.test.js`
- Create: `cloudfunctions/messageApi/index.js`
- Create: `cloudfunctions/messageApi/package.json`

**Interfaces:**
- Produces actions:
  - `send({ conversationId, text, requestId }) -> { message, conversation }`
  - `list({ conversationId, before?, limit }) -> { messages, nextBefore }`
  - `markRead({ conversationId }) -> { unreadCount: 0, totalUnread }`

- [ ] **Step 1: Write failing message tests**

Test trimming, blank/501-character rejection, participant access, chronological page reconstruction, sender/recipient unread behavior, idempotent retry, plain-text URL preservation, system-message immutability, and atomic conversation summary update.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test cloudfunctions/messageApi/message.test.js`

Expected: FAIL because message domain does not exist.

- [ ] **Step 3: Implement message service and cloud adapter**

Persist message type `text` or `system`; `messageApi` accepts only user text, while transaction-domain code writes system messages directly using the same documented schema. Increment only the recipient unread counter and update conversation preview/time in the same trusted operation.

- [ ] **Step 4: Verify GREEN and syntax**

Run: `node --test cloudfunctions/messageApi/message.test.js`

Run: `node --check cloudfunctions/messageApi/index.js`

Expected: tests and syntax pass.

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/messageApi
git commit -m "feat: add text messages and unread counts"
```

### Task 8: Message list and chat client

**Files:**
- Create: `miniprogram/services/conversations.js`
- Create: `miniprogram/services/chat-state.js`
- Create: `miniprogram/services/chat-state.test.js`
- Create: `miniprogram/pages/messages/index.js`
- Create: `miniprogram/pages/messages/index.json`
- Create: `miniprogram/pages/messages/index.wxml`
- Create: `miniprogram/pages/messages/index.wxss`
- Create: `miniprogram/pages/conversation/index.js`
- Create: `miniprogram/pages/conversation/index.json`
- Create: `miniprogram/pages/conversation/index.wxml`
- Create: `miniprogram/pages/conversation/index.wxss`
- Modify: `miniprogram/app.json`

**Interfaces:**
- Consumes: Task 6/7 APIs.
- Produces: message-tab unread badge synchronization and chat polling every 3 seconds only while the page is visible.
- Produces: `startPolling(fetcher, intervalMs) -> stop()` with stale-conversation guards.

- [ ] **Step 1: Write failing chat-state and lifecycle tests**

Test optimistic-send prevention, request ID reuse, failure-preserved draft, message de-duplication, unread clearing, polling stop on hide/unload, no cross-conversation updates, and total unread badge values.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test miniprogram/services/chat-state.test.js`

Expected: FAIL because chat state does not exist.

- [ ] **Step 3: Implement service and pages**

Use cloud-function polling rather than direct database reads. Stop timers on `onHide` and `onUnload`; restart and immediately refresh on `onShow`. Exclude the new test file from packaging.

- [ ] **Step 4: Verify GREEN and package config**

Run: `node --test miniprogram/services/chat-state.test.js project-config.test.js`

Expected: tests pass with lifecycle cleanup assertions.

- [ ] **Step 5: Commit**

```bash
git add miniprogram/services/conversations.js miniprogram/services/chat-state* miniprogram/pages/messages miniprogram/pages/conversation miniprogram/app.json project.config.json project-config.test.js
git commit -m "feat: add message list and text chat"
```

### Task 9: Transaction creation, seller response, and atomic reservation

**Files:**
- Create: `cloudfunctions/transactionApi/transaction.js`
- Create: `cloudfunctions/transactionApi/transaction.test.js`
- Create: `cloudfunctions/transactionApi/inventory.js`
- Create: `cloudfunctions/transactionApi/inventory.test.js`
- Create: `cloudfunctions/transactionApi/index.js`
- Create: `cloudfunctions/transactionApi/package.json`

**Interfaces:**
- Produces actions:
  - `create({ conversationId, quantity, scheduledAt, campusId, locationText, requestId }) -> { transaction }`
  - `withdraw({ transactionId, reason, requestId }) -> { transaction }`
  - `respond({ transactionId, decision: 'confirm'|'reject', reason?, requestId }) -> { transaction, post }`
  - `list({ role?, status?, cursor?, limit }) -> { transactions, nextCursor, pendingCounts }`
  - `detail({ transactionId }) -> { transaction, events }`
- Produces `reserveInventory`, `releaseInventory`, and audit movement builders used again in Task 10.

- [ ] **Step 1: Write failing transaction and inventory tests**

Test buyer-only creation, exact 10-minute and 14-day boundaries, campus/location validation, authoritative post snapshot, quantity availability, one active transaction per conversation, seller-only response, stale status, deterministic idempotency, concurrent seller confirmations, invariant preservation, and no duplicate events/messages/movements.

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test cloudfunctions/transactionApi/transaction.test.js cloudfunctions/transactionApi/inventory.test.js`

Expected: FAIL because transaction modules do not exist.

- [ ] **Step 3: Implement create, withdraw, reject, and confirm**

Use `pending_seller` and `awaiting_handover` internal states. Confirmation transactionally decrements available, increments reserved, records event/movement, and appends a system message using a transaction-local helper/schema (not a cross-function import). Reject/withdraw uses terminal `cancelled` with distinct event types. List/detail queries return participant records only.

- [ ] **Step 4: Verify GREEN and syntax**

Run: `node --test cloudfunctions/transactionApi/transaction.test.js cloudfunctions/transactionApi/inventory.test.js`

Run: `node --check cloudfunctions/transactionApi/index.js`

Expected: tests and syntax pass.

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/transactionApi
git commit -m "feat: add transaction requests and reservations"
```

### Task 10: Cancellation and handover outcomes

**Files:**
- Modify: `cloudfunctions/transactionApi/transaction.js`
- Modify: `cloudfunctions/transactionApi/transaction.test.js`
- Modify: `cloudfunctions/transactionApi/inventory.js`
- Modify: `cloudfunctions/transactionApi/inventory.test.js`
- Modify: `cloudfunctions/transactionApi/index.js`

**Interfaces:**
- Extends Task 9 actions:
  - `cancel({ transactionId, reason, requestId }) -> { transaction, post }`
  - `submitResult({ transactionId, result: 'success'|'failure', requestId }) -> { transaction, post }`
- Internal states: `pending_seller`, `awaiting_handover`, `completed`, `failed`, `abnormal`, `cancelled`.

- [ ] **Step 1: Write failing state-transition tests**

Test pre-time cancellation by either participant, cancellation rejection at/after appointment, result rejection before appointment, first success pending, both success reserved-to-sold movement, first failure immediate release, second failure stability, later opposing success transition to abnormal without inventory change, immutable submitted result, and repeat-request idempotency.

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test cloudfunctions/transactionApi/transaction.test.js cloudfunctions/transactionApi/inventory.test.js`

Expected: new cancellation/result tests fail against Task 9 behavior.

- [ ] **Step 3: Implement cancellation and outcome transitions**

Every transition appends an event and system message. Successful completion decrements reserved and increments sold; failure/cancel decrements reserved and increments available exactly once. Abnormal after released failure changes no inventory.

- [ ] **Step 4: Verify GREEN**

Run: `node --test cloudfunctions/transactionApi/transaction.test.js cloudfunctions/transactionApi/inventory.test.js`

Expected: all transaction and inventory tests pass.

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/transactionApi
git commit -m "feat: add handover outcomes and inventory release"
```

### Task 11: Transaction and personal-management client flows

**Files:**
- Create: `miniprogram/services/transactions.js`
- Create: `miniprogram/services/transaction-state.js`
- Create: `miniprogram/services/transaction-state.test.js`
- Create: `miniprogram/pages/transaction-create/index.js`
- Create: `miniprogram/pages/transaction-create/index.json`
- Create: `miniprogram/pages/transaction-create/index.wxml`
- Create: `miniprogram/pages/transaction-create/index.wxss`
- Create: `miniprogram/pages/transaction-detail/index.js`
- Create: `miniprogram/pages/transaction-detail/index.json`
- Create: `miniprogram/pages/transaction-detail/index.wxml`
- Create: `miniprogram/pages/transaction-detail/index.wxss`
- Create: `miniprogram/pages/my-posts/index.js`
- Create: `miniprogram/pages/my-posts/index.json`
- Create: `miniprogram/pages/my-posts/index.wxml`
- Create: `miniprogram/pages/my-posts/index.wxss`
- Create: `miniprogram/pages/my-transactions/index.js`
- Create: `miniprogram/pages/my-transactions/index.json`
- Create: `miniprogram/pages/my-transactions/index.wxml`
- Create: `miniprogram/pages/my-transactions/index.wxss`
- Modify: `miniprogram/pages/profile/index.js`
- Modify: `miniprogram/pages/profile/index.wxml`
- Modify: `miniprogram/app.json`

**Interfaces:**
- Consumes: Task 3, 6, 7, 9, and 10 APIs.
- Produces: buyer transaction form, seller response controls, participant cancellation/results, role-filtered transaction lists, seller post management, and pending-action counts.

- [ ] **Step 1: Write failing transaction-state tests**

Test role-based visible actions, result controls locked before appointment, form preservation, duplicate-submit prevention, status label `待交接`, failure/abnormal rendering, unavailable post management, and pending-count derivation.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test miniprogram/services/transaction-state.test.js`

Expected: FAIL because client transaction state does not exist.

- [ ] **Step 3: Implement service and pages**

The buyer launches creation only from conversation. Show quantity, snapshot price, campus, location, and local-time appointment. Profile links to role-aware My Posts/My Transactions; do not add favorites, history, ratings, or settings.

- [ ] **Step 4: Verify GREEN and app config**

Run: `node --test miniprogram/services/transaction-state.test.js project-config.test.js`

Run: `node -e "JSON.parse(require('fs').readFileSync('miniprogram/app.json','utf8')); console.log('ok')"`

Expected: tests pass and configuration parses.

- [ ] **Step 5: Commit**

```bash
git add miniprogram/services/transactions.js miniprogram/services/transaction-state* miniprogram/pages/transaction-create miniprogram/pages/transaction-detail miniprogram/pages/my-posts miniprogram/pages/my-transactions miniprogram/pages/profile miniprogram/app.json project.config.json project-config.test.js
git commit -m "feat: add transaction and personal management pages"
```

### Task 12: Navigation, integrated verification, deployment, and acceptance handoff

**Files:**
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/app.js`
- Modify: `miniprogram/services/user.js`
- Modify: `README.md`
- Modify: `database/README.md`
- Modify: `开发日志.md`
- Create: `docs/阶段1验收.md`

**Interfaces:**
- Consumes: all prior task interfaces.
- Produces: final four-tab navigation `发现 / 发布 / 消息 / 我的`, protected-operation return flow, one-click Stage 1 database setup instructions, cloud deployment checklist, and a numbered acceptance table whose initial status is `待验收⏳`.

- [ ] **Step 1: Write failing integration configuration tests**

Extend `project-config.test.js` to assert all four tabs, every registered page, all Mini Program tests excluded from packaging, cloud function roots intact, and no Stage 1 route points to the old placeholder home page.

- [ ] **Step 2: Run configuration tests and verify RED**

Run: `node --test project-config.test.js`

Expected: new four-tab and route assertions fail before final wiring.

- [ ] **Step 3: Wire navigation and protected return flow**

Connect publish/messages/my tabs to the existing identity/profile guard. Persist only a safe in-memory pending route/action; after profile completion, resume that route once and clear it.

- [ ] **Step 4: Write deployment and acceptance documentation**

Document deployment order: `setupStage1Database` once, configure indexes/rules, deploy `postApi`, `conversationApi`, `messageApi`, and `transactionApi`, delete cloud `setupStage1Database`, compile, then run the two-account scenario. Include explicit checks for concurrency, unread badges, cancellation, completion, failure, abnormal result, and inventory invariants.

- [ ] **Step 5: Run full local verification**

Run all `*.test.js` files with `node --test` using the explicit file list returned by `rg --files -g '*.test.js'`.

Run `node --check` over every JavaScript file under `miniprogram` and `cloudfunctions` excluding dependencies.

Parse every project/package/page JSON and both JSON Lines seed files.

Run: `git diff --check`

Expected: zero test failures, zero syntax/parse failures, and no diff-check errors.

- [ ] **Step 6: Developer Tools and two-account acceptance**

Deploy to `cloud1-d1gi2dzcp1275d460`, execute every row in `docs/阶段1验收.md`, and leave each row `待验收⏳` until the user explicitly confirms it. Record actual cloud deployment separately from local completion.

- [ ] **Step 7: Final review and commit**

Review requirements against the spec, inspect the complete diff, and commit only after local verification passes:

```bash
git add README.md database/README.md 开发日志.md docs/阶段1验收.md miniprogram
git commit -m "feat: complete stage 1 trade loop"
```

Do not mark Stage 1 complete or push a stage-completion release until every acceptance row is explicitly confirmed by the user.
