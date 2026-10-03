# 第二阶段内容生态实施计划

> **For agentic workers:** Use superpowers:executing-plans to implement task by task. Steps use checkbox syntax. 不自行委派代理。

**Goal:** 在阶段一基础上交付我提供/我需要、物品与持续服务、需求预约及信息卡片。

**Architecture:** 扩展现有 postApi、conversationApi、messageApi、transactionApi 及原生页面；保留库存域，服务和无商品帖需求预约不调用库存变更。帖子字段兼容旧数据，需求预约锁在数据库事务中更新。

**Tech Stack:** 原生微信小程序、微信云开发、CommonJS JavaScript、Node 内置测试；不新增框架或运行依赖。

**Spec:** docs/阶段2范围草案.md（2026-10-02 用户整体确认）。

## Global Constraints

- 直接 main 开发，保护手动修改，不建 worktree、不切分支；本轮不推送。
- 图片选填，最多六张，沿用既有格式、压缩和最终 5MB 限制；描述选填 0–1000 字。
- 旧帖子缺少方向/类型时视为提供物品；旧会话、交易、系统消息保持可读可操作。
- 需求方为买家、提供方为卖家；买家发起、卖家确认。
- 一条需求跨会话最多一笔 pending_seller 或 awaiting_handover 预约。
- 服务无库存，持续接单；需求成功关闭，失败或取消可再约。线上服务仍需时间与交付方式。
- 不改阶段一时间、结果确认、未读、轮询、审计、幂等及库存规则。
- 信息卡片不自动切换交易对象；图片消息延期。
- 保留原生 order-card.wxml 模板，不重新引入自定义订单组件；保留 transaction-entry 手动尺寸。

## Review Focus

- 旧库存商品不能因字段缺省进入无库存分支；任务1/3回归。
- 两个卖家会话同时发起需求预约只能一个成功；任务3事务及真机检查。
- 失败后再预约时，旧预约重复请求或迟到结果不能清除新预约锁；任务3按交易ID释放锁。
- 隐藏字段、类型切换、发布方向切换及保存失败不能污染另一个草稿；任务4状态测试。
- 全部校区服务并入列表时分页不能重复或遗漏；任务2分页测试。

## Task 1: 帖子类型与云端校验

Files: miniprogram/config/market.js; cloudfunctions/postApi/post.js, post-service.js, post.test.js, post-service.test.js。
Interfaces: validatePostInput(input) 返回规范帖子；新增 direction='provide'|'need'、contentType='item'|'service'，旧数据按 provide/item 归一。campusId='' 仅用于全部校区服务；预算存整数分或 null；提供物品沿用 unitPriceCents 和库存字段。

- [ ] 添加失败测试：旧商品默认类型；四种组合；零图成功、七图失败；描述留空；预算为空显示面议；服务不要求成色/库存，物品仍校验库存。
- [ ] 执行 node --test cloudfunctions/postApi/*.test.js，确认新规则测试失败。
- [ ] 实现最小类型归一与校验，更新权限、编辑和上下架判断；已有关联预约的帖子禁止切换供需方向或内容类型，避免交易语义变化。
- [ ] 重跑目标测试并确认旧商品校验通过，git diff --check。

## Task 2: 列表筛选与供需会话角色

Files: cloudfunctions/postApi/index.js, post-service.js; cloudfunctions/conversationApi/conversation.js, index.js, conversation.test.js; miniprogram/services/posts.js, conversations.js。
Interfaces: listPosts 参数增加 direction 筛选（空表示全部）；建立会话仍保持 postId+buyerId+sellerId 唯一，need 帖子 owner 是 buyer，provide 帖子 owner 是 seller。

- [ ] 添加失败测试：需求发布者是买家，响应者是卖家；自己不能联系自己；旧会话复用；全校区服务纳入指定校区，分页无重复；关闭帖子不能新建会话但历史可读。
- [ ] 执行相关域 node --test，确认新行为失败。
- [ ] 扩展公开与本人列表查询，保留默认校区；会话角色可信地从帖子方向解析，不信任客户端角色。
- [ ] 重跑目标测试，覆盖既有混合 Date/毫秒排序与完整分页，git diff --check。

## Task 3: 服务与需求预约云端闭环

Files: cloudfunctions/transactionApi/transaction.js, index.js, transaction.test.js, inventory.test.js; cloudfunctions/messageApi/message.js; database/README.md。
Interfaces: createTransaction/reviseTransaction 扩展物品说明、线上/线下方式与交付说明；交易快照保存 direction/contentType/inventoryManaged，只有 provide/item 为库存管理路径。需求帖子保存 activeTransactionId，创建/释放/成功关闭均在现有数据库事务中完成。

- [ ] 添加失败测试：持续服务多会话预约无库存流水；需求跨会话双请求只有一个成功；无商品帖清单记录说明/数量；线上时间与交付方式必填；仅买家发起。
- [ ] 添加释放锁测试：拒绝/撤回/取消/失败可再约，旧请求不释放新锁；双方成功关闭需求；相反结果沿用异常、不重新占库存或改写新预约。
- [ ] 执行 node --test cloudfunctions/transactionApi/*.test.js，确认新增场景失败。
- [ ] 按库存管理标记分流，复用原状态机、事件和系统卡片；只释放属于当前交易的需求锁。失败后迟到成功变异常保持需求原关闭策略，不自动成交。
- [ ] 运行上述测试以及全量 node --test --test-reporter=dot；旧库存守恒、并发和重复流水测试必须通过。更新必要字段/索引说明，不自动修改云端权限。

## Task 4: 原生发布、详情、发现与订单页面

Files: miniprogram/components/post-form/index.*; miniprogram/pages/publish/index.*; pages/post-edit/index.*; pages/post-detail/index.*; pages/discover/index.*; pages/my-posts/index.*; pages/transaction-create/index.*; pages/transaction-detail/index.*; pages/conversation/index.*; pages/profile/order-card.wxml; services/post-form-state.js, post-list-state.js, transaction-state.js, order-card-controller.js 及相关测试。
Interfaces: 同一 post-form 接收方向/类型，切换保存对应草稿；交易页面按快照类型显示说明、数量或服务交付方式，操作仍调用现有 transactions 服务。

- [ ] 添加状态失败测试：方向/类型切换不丢草稿；服务隐藏成色故障库存；需要预算可为空；无图发布；发布后恢复常驻校区；线上/线下切换和订单独立编辑。
- [ ] 执行 node --test miniprogram/services/*.test.js，确认新场景失败。
- [ ] 实现我提供/我需要及类型选择，混合双列布局和方向筛选；无图卡片使用文字布局。适配本人发布及服务/需求详情状态，预约清单和消息卡片显示正确字段，不改变已验收键盘布局。
- [ ] 重跑目标与全量测试，JS/JSON 检查及 git diff --check；交给用户编译、体验版及双账号验收。

## Task 5: 信息卡片消息

Files: cloudfunctions/messageApi/message.js, index.js, message.test.js; miniprogram/services/conversations.js；pages/conversation/index.*; services/chat-state.js, chat-state.test.js。
Interfaces: sendPostCard({actor, conversationId, postId, requestId, messages, now}) 校验参与者及本人帖子所有权，保存最小公开快照；客户端点击用 postId 跳转详情，不改 conversationId/预约对象。

- [ ] 添加失败测试：双方可发自己帖子；拒绝伪造别人帖子和越权会话；重复请求一次消息/未读；无图快照正常；更新时间及预览置顶。
- [ ] 执行 node --test cloudfunctions/messageApi/*.test.js，确认新场景失败。
- [ ] 扩展事务消息类型、未读及会话预览；原生选择本人发布与渲染卡片，不加入图片消息。
- [ ] 重跑消息及全量测试；用户双账号验收卡片、详情返回和原聊天预约对象保持。

## Task 6: 部署交接与逐项验收

Files: README.md; docs/开发计划.md; 开发日志.md; docs/阶段2验收.md; database/README.md。

- [ ] 运行 node --test --test-reporter=dot、必要 JS/JSON 静态检查和 git diff --check，记录真实结果，不沿用阶段一169数字声称阶段二通过。
- [ ] 列出需重新部署的 postApi/conversationApi/messageApi/transactionApi，以实际变更为准，使用“上传并部署：云端安装依赖”；列出必要索引配置，不能因有本地声明声称云端已配置。
- [ ] 用户重新编译并上传体验版，按验收单双账号逐项确认；只将用户明确通过的项目改为通过。
- [ ] 每项验收后同步文档；全部通过后按授权归档，不自行推送、不建版本号或标签。

## 执行方式

建议在当前对话由主助手逐项实施，先交付发布与浏览，再交付预约闭环，最后信息卡片；每组达到可验收状态后暂停等用户验收。计划需用户审阅后执行。