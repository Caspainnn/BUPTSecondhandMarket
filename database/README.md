# 云数据库初始化

目标环境：`cloud1-d1gi2dzcp1275d460`

本目录只保存可公开、可重复导入的基础数据。不要在这里保存 OpenID、用户资料、AppSecret、云密钥或 Token。

## 1. 推荐：使用一次性云函数初始化

1. 在微信开发者工具中右键 `cloudfunctions/setupDatabase`，选择“上传并部署：云端安装依赖”。
2. 在云开发控制台打开 `setupDatabase`，使用以下参数进行云端测试：

```json
{
  "confirm": "INIT_STAGE_0"
}
```

成功结果包含 `ok: true`、三个集合名称、1 所学校和 3 个校区。该函数可重复执行：它只创建缺失集合，并按固定文档 ID 写入基础数据，不会删除或覆盖 `users` 中的用户资料。

初始化成功后，从云端删除 `setupDatabase`；小程序客户端不需要也不会调用它。

该函数不配置权限和索引。请继续执行第 3 节和第 5 节，避免在云函数中保存管理密钥。

## 2. 备用：手动创建与导入

在微信开发者工具的“云开发 → 数据库”中创建：

1. `users`
2. `schools`
3. `campuses`

云函数使用管理员权限访问这些集合，客户端不直接写入。

若已运行 `setupDatabase`，集合和基础数据已经存在，不需要再次导入。

## 3. 配置权限

在各集合的“权限设置 → 自定义安全规则”中配置：

`users`：

```json
{
  "read": false,
  "write": false
}
```

`schools` 与 `campuses`：

```json
{
  "read": false,
  "write": false
}
```

用户资料由 `login` 和 `updateProfile` 云函数读写，校区列表由 `getCampuses` 云函数读取。客户端不直接访问这些集合。

## 4. 手动导入基础数据

分别向对应集合导入：

- `schools` ← `database/seeds/schools.json`
- `campuses` ← `database/seeds/campuses.json`

使用“新增记录”模式。重复导入前先按业务 ID 检查已有数据，避免出现重复学校或校区。

种子文件采用 CloudBase 要求的 JSON Lines 格式：UTF-8 编码，每行是一条完整 JSON 记录；不要改成顶层数组。

导入后应有 1 所学校和 3 个启用校区：西土城、沙河、海南。

## 5. 创建索引

| 集合 | 索引字段 | 类型 | 用途 |
| --- | --- | --- | --- |
| `users` | `_openid` 升序 | 唯一 | 一个微信身份只对应一个用户 |
| `schools` | `schoolId` 升序 | 唯一 | 稳定学校业务 ID |
| `campuses` | `campusId` 升序 | 唯一 | 稳定校区业务 ID |

若控制台不允许为系统字段 `_openid` 创建唯一索引，应保留普通索引，并依赖 `login` 云函数的幂等查询；上线并发压测前必须再次确认唯一性保障。

## 6. 验证

在控制台检查：

- 三个集合均存在；
- `schools` 只有 `schoolId = bupt` 的启用记录；
- `campuses` 的三个 `schoolId` 都是 `bupt`；
- 客户端无法直接写入任一集合；
- `getCampuses` 云函数可以读取三个校区，客户端无法直接读写集合。

## 7. 阶段 1 交易集合初始化

阶段 0 验收完成后，右键 `cloudfunctions/setupStage1Database`，选择“上传并部署：云端安装依赖”，再使用以下参数进行一次云端测试：

```json
{
  "confirm": "INIT_STAGE_1"
}
```

该函数只创建缺失的 `posts`、`conversations`、`messages`、`transactions`、`transaction_events` 和 `inventory_movements`，可以安全重复执行，不会删除或覆盖业务记录。返回值中的 `indexes` 和 `rules` 是需要在控制台配置的声明；云函数不会自动修改索引或安全规则。

初始化成功并完成下述人工配置后，从云端删除 `setupStage1Database`。

### 7.1 权限

六个阶段 1 集合均设置为：

```json
{
  "read": false,
  "write": false
}
```

公开商品、个人发布、会话、消息和交易数据均通过对应云函数按身份裁剪后返回，客户端不直接访问集合。

### 7.2 索引

| 集合 | 索引名 | 字段（按顺序） | 类型 |
| --- | --- | --- | --- |
| `posts` | `discovery` | `status`、`campusId`、`availableQuantity` 升序，`publishedAt`、`_id` 降序 | 普通 |
| `posts` | `owner_posts` | `ownerId`、`status` 升序，`updatedAt` 降序 | 普通 |
| `posts` | `owner_create_request` | `ownerId`、`createRequestId` 升序 | 唯一 |
| `conversations` | `unique_conversation` | `uniqueKey` 升序 | 唯一 |
| `conversations` | `buyer_conversations` | `buyerId` 升序、`updatedAt` 降序 | 普通 |
| `conversations` | `seller_conversations` | `sellerId` 升序、`updatedAt` 降序 | 普通 |
| `messages` | `conversation_messages` | `conversationId` 升序、`createdAt` 和 `_id` 降序 | 普通 |
| `messages` | `sender_request` | `senderId`、`requestId` 升序 | 唯一 |
| `transactions` | `buyer_transactions` | `buyerId`、`status` 升序，`updatedAt` 降序 | 普通 |
| `transactions` | `seller_transactions` | `sellerId`、`status` 升序，`updatedAt` 降序 | 普通 |
| `transactions` | `active_conversation` | `conversationId`、`activeKey` 升序 | 唯一 |
| `transaction_events` | `transaction_events` | `transactionId` 升序、`createdAt` 降序 | 普通 |
| `transaction_events` | `actor_request` | `actorId`、`requestId` 升序 | 唯一 |
| `inventory_movements` | `post_movements` | `postId` 升序、`createdAt` 降序 | 普通 |
| `inventory_movements` | `transaction_movements` | `transactionId` 升序、`createdAt` 降序 | 普通 |
