# 云数据库初始化

## 阶段 1 推荐部署顺序

1. 部署并云端测试一次 `setupStage1Database`，参数为 `{ "confirm": "INIT_STAGE_1" }`。
2. 根据返回声明和本文第 7 节创建全部索引，将六个阶段 1 集合的客户端 `read/write` 均设为 `false`。
3. 依次部署 `postApi`、`conversationApi`、`messageApi`、`transactionApi`，均选择云端安装依赖。
4. 从云端删除一次性函数 `setupStage1Database`，清缓存后重新编译。
5. 按 `docs/阶段1验收.md` 使用两个账号验收；重点核对并发确认、取消释放、双方成功、首次失败和相反结果异常时的库存恒等式。

本地源码中的初始化函数保留用于复现环境；“删除”只指云端部署副本。

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
| `transactions` | `active_conversation` | `conversationId`、`activeKey` 升序 | 唯一；进行中固定为 `active`，终态写入 `terminal:<交易ID>` |
| `transaction_events` | `transaction_events` | `transactionId` 升序、`createdAt` 降序 | 普通 |
| `transaction_events` | `actor_request` | `actorId`、`requestId` 升序 | 唯一 |
| `inventory_movements` | `post_movements` | `postId` 升序、`createdAt` 降序 | 普通 |
| `inventory_movements` | `transaction_movements` | `transactionId` 升序、`createdAt` 降序 | 普通 |

## 阶段 2 增量（2026-10-02）

不新增集合，不重跑初始化，不改变客户端权限。旧帖子缺少 direction/contentType 按 provide/item 解释；旧交易缺少 inventoryManaged 仍执行库存路径，不需批量迁移旧记录。

新增帖子 direction（provide/need）、contentType（item/service）；全部校区服务 campusId 为空字符串。服务和需求没有物品库存字段。需求 activeTransactionId 由 transactionApi 数据库事务维护，跨会话共用同一帖子记录作为锁，终态仅清除属于当前交易的锁，成功设 status=completed。

新增交易 inventoryManaged、快照类型、需求物品 itemDescription、服务 fulfillmentMode（online/offline）；线上 campusId 为空，locationText 保存沟通/交付方式。消息 post_card 保存公开快照，不改变会话关联帖子。

### posts 列表普通索引

保留原索引，按新增查询补充以下普通组合索引（不新增唯一约束）：

| 名称 | 字段顺序 |
| --- | --- |
| public_posts_time | status 升序、publishedAt 降序、_id 降序 |
| public_posts_direction | status 升序、direction 升序、publishedAt 降序、_id 降序 |
| public_posts_campus | status 升序、campusId 升序、publishedAt 降序、_id 降序 |
| public_posts_direction_campus | status 升序、direction 升序、campusId 升序、publishedAt 降序、_id 降序 |

列表使用一个包含普通物品/服务/需求及校区覆盖的组合查询，按发布时间和_id稳定分页。实际云端若提示具体OR分支索引需求，按控制台对应查询建议补充，不能依据本地模拟断言云端索引已足够。唯一会话、活跃交易、请求幂等索引沿用阶段一。

## 阶段3自动完成增量

不新增集合或修改权限。在transactions添加普通组合索引timeout_due：status升序、scheduledAt升序、_id升序。transactionApi新增定时入口，部署和触发器配置见docs/阶段3验收.md。

已完成交易新增completionSource：participants表示双方主动确认，timeout表示定时自动完成。timeout不改写buyerResult/sellerResult，transaction_events记录系统timeout_completed事件，库存流水复用sell。旧已完成记录无completionSource仍按原展示兼容。新定时入口也会补处理现有符合规则的待交接订单。


## 阶段3提醒与可选订阅增量

站内提醒不新增集合；transactions新增nearRemindedAt/resultRemindedAt（已发时间）及nextReminderAt（下次时间，null表示无后续到时提醒）。提醒与自动完成共享timeout_due；实际云端OR组合查询若提示缺索引，按控制台建议补普通索引（status/nextReminderAt/scheduledAt/_id相关字段），保留已有索引，不放宽权限。

只有模板获批并准备启用时才手动创建subscription_deliveries，客户端read/write均为false；默认enabled=false时不读写此集合。无需重跑旧初始化函数，不新增notifications集合。

| 索引名 | 字段顺序（均升序） | 类型 |
| --- | --- | --- |
| pending_delivery | kind、status、createdAt、_id | 普通 |
| transaction_delivery | kind、status、transactionId、createdAt、_id | 普通 |
| available_grant | kind、recipientId、transactionId、templateId、status、createdAt | 普通 |

grant记录用户对指定预约的授权意图，status为available/consumed；delivery记录对应事件、收件用户内部ID、模板ID、时间及发送状态。文档ID由事件和收件人或授权请求做确定性散列，利用系统_id唯一性实现幂等。OpenID只在发送时从users读取，不保存至发送队列，不输出至日志。微信实际授权额度由接口裁决。

授权候选在事务外查询，事务内按文档ID重读并消费，避免新增事务where依赖。核心预约事务只收集通知意图，提交后再独立写订阅队列；队列不可用不回滚预约、库存和聊天。发送前先事务认领并消费授权，API在事务外只尝试一次；失败/unknown/dispatching不自动重发。启用与验收见docs/阶段3验收.md。

自动完成参数增量：新预约保存autoCompleteAfterMs和autoCompleteAt（数值时间戳）；更改云端timeout-config.json仅影响之后创建的预约，旧记录缺字段按1小时。新增普通deadline_due索引：status、autoCompleteAt、scheduledAt、_id均升序，保留timeout_due。扫描按新记录截止时间与旧记录约定时间OR兼容，不做数据迁移。


## 最新规则：用户打开页面时检查超时（2026-10-03）

用户明确改为页面加载/刷新触发，覆盖此前后台每分钟自动完成要求。transactionApi在可信用户的列表、详情和预约操作前检查其参与的待交接预约；聊天轮询先调用refresh再加载消息。比较服务端时间及预约保存的截止，符合规则执行同一库存/需求/审计事务。无操作且无人打开页面时不处理；失败、取消、异常订单不自动完成，不伪造双方成功。终态从正在进行移除。提醒同步改为页面检查时处理，迟到不补临期，超时先完成；不能再承诺离线时精准临期/到时微信提醒。

部署：只需上传部署最新transactionApi（云端安装依赖），重新编译客户端。页面检查复用已有买卖双方预约列表索引，无需新增超时索引或上传触发器。config.json已清空triggers，旧Timer入口拒绝；之前已上传的appointment-timeout可移除，或按工具支持的方式上传空触发配置，避免旧任务继续产生无用调用。

现在直接打开我的或预约详情/聊天，已有超过截止的六分钟预约应自动完成，正在进行消失；无需再等六分钟或重建。截止之前保持待交接；失败反馈不变，重复页面刷新库存与系统完成消息仅一次。新配置仍仅影响新预约。完整240项回归通过，云端与真机保持待验收。
