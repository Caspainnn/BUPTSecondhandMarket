# 第三阶段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐发现筛选、站内通知、预约提醒及超时自动完成。
**Architecture:** 沿用现有云函数仓库适配器及原子交易逻辑；站内通知在事务内记录，微信发送独立处理。提醒与自动完成由云端定时触发，不依赖客户端在线。
**Tech Stack:** 微信原生 JS/CommonJS、WXML/WXSS、微信云开发、Node 内建测试。
**Spec:** docs/superpowers/specs/2026-10-03-stage-3-reminders-design.md

## Global Constraints

- 当前对话直接实施，继续 main，不新建工作树或分支。按用户要求范围确认后开工，不重复要求实施授权。
- 不增加依赖、支付或图片权限变更；保留发现页内瀑布流及用户手调 transaction-entry 尺寸。
- UI先提供原型审阅；每项交付供用户验收。微信模板待审，不能标记真机通知通过。
- 本阶段提交/推送需用户授权，不自动归档提交。

## Review Focus

- 零金额与单侧边界合法；面议必须从有金额限制的分页结果排除。
- 切换方向、服务、校区或排序时，成色兼容性及已确认筛选保持正确。
- 定时与手动失败竞争，最终库存只扣减或释放一次。
- 扫描发现预约后预约已取消，不能生成失效提醒或覆盖终态。
- 未配置/拒绝订阅/发送失败，通知及待办仍完整，不能回滚交易。

## Task 1：发现筛选

Files: miniprogram/pages/discover/index.js、index.wxml、index.wxss；miniprogram/services/post-list-state.js、posts.js及现有测试；cloudfunctions/postApi/post-service.js、index.js及测试。
Interface: listPosts继续兼容现有位置参数，末尾增filters对象；云端list请求增minPriceCents、maxPriceCents、conditionIds。金额使用整数分，省略表示不限，成色仅provide/item。
- [ ] 提供浅蓝紧凑筛选面板HTML原型供用户审阅。
- [ ] 添加失败测试：min=0合法；上限小于下限、负数、小数分及非法成色拒绝；成色归一为provide/item；校区切换保持新增条件；金额+排序分页排除面议。
- [ ] 运行对应Node测试，观察预期失败。
- [ ] 最小实现校验、服务端查询条件、客户端状态及面板。云查询在分页前追加unitPriceCents gte/lte和conditionId in；有金额限制不进入negotiable分页分支。
- [ ] 运行Node测试及结构检查，整理postApi部署和筛选人工验收步骤。

## Task 2：自动完成及定时基础

Files: cloudfunctions/transactionApi/transaction.js、index.js、transaction.test.js；新增cloudfunctions/appointmentTimer的业务/入口/测试/package.json/config.json；miniprogram/services/transaction-state.js及测试；预约卡片显示处。
Interface: 自动完成业务接收transactionId、可信now及transactions仓库，事务内重新读取；生成completionSource=timeout，保持buyerResult/sellerResult原值。定时入口无用户身份调用能力，不暴露客户端强制完成操作。
- [ ] 添加并运行失败测试：scheduledAt+3600000前不完成；到期无反馈或单成功完成；失败/pending/终态跳过；重复及竞争仅一笔库存流水，需求关闭，服务持续开放。
- [ ] 提取最小共享成功收尾逻辑，接入系统事件、库存/需求锁及定时分页扫描。以云端时间判断，每分钟触发，逾期补扫。
- [ ] 验证失败测试转绿、旧结果流程回归；更新预计完成时间及completionSource对应文案。
- [ ] 记录实际触发器配置与部署步骤，提供双账号验收。

## Task 3：站内通知与待办

Files: 新增cloudfunctions/notificationApi入口/业务/测试/package.json；新增通知集合初始化函数；transactionApi事务适配器；miniprogram/services/notifications.js；messages页面及通知列表页、app.json；database/README.md。
Interface: notifications记录recipientId、transactionId、eventKey、type、text、createdAt、readAt、todoStatus；eventKey唯一确定交易事件/接收者。notificationApi按可信actor返回list/read/count，拒绝其他用户读取或标记。
- [ ] 提供消息入口与通知列表原型供审阅。
- [ ] 添加失败测试：身份隔离、同事件重复不新增、已读不解除待办、终态取消失效待办、角标不重复计算待办。
- [ ] 事务生成通知，状态变化解除相关待办；实现消息入口和分页列表、跳转及未读汇总。
- [ ] 运行测试、结构检查并写新增集合、权限与唯一索引部署说明。

## Task 4：预约提醒

Files: appointmentTimer业务/入口/测试；transactionApi确认路径；notifications。
Interface: 以transactionId+reminderType+recipientId去重；确认时距交接<=900000毫秒立即生成临期提醒，否则定时生成；到scheduledAt生成结果待确认。
- [ ] 添加失败测试：15分钟边界、当前分钟、确认晚于交接时、重复扫描、取消竞争、离线超过截止时间补处理。
- [ ] 事务重读状态并记录提醒；到期自动完成后不再产生待处理提醒。
- [ ] 验证测试转绿，并提供短时预约人工验收操作。

## Task 5：微信订阅接入（审核依赖）

Files: 新增订阅发送业务与测试、云函数config.json权限；客户端订阅配置与授权调用；subscription_deliveries初始化/索引；部署文档。
Interface: 审核通过后填入真实templateId及字段键；无配置跳过授权和发送。发送结果不作为业务状态依据。
- [ ] 核对官方一次性订阅授权/发送额度规则与真实模板参数约束。
- [ ] 添加失败测试：缺配置/拒绝授权/发送失败不影响站内事务，重试不重复成功发送；无授权不假定可发。
- [ ] 最小接入合理用户操作节点授权与云端发送，记录成功/失败，不盲目用一个授权发送所有提醒。
- [ ] 真机双账号验证；待审核期间本项保持待开始，其他项可验收。

## Final verification

- [ ] node --test --test-reporter=dot
- [ ] node scripts/verify-structure.js
- [ ] git -c core.safecrlf=false diff --check
- [ ] 独立审查已完成改动并修复重要问题；同步README、开发计划、阶段3验收与开发记录。
- [ ] 用户人工验收；微信待审核部分明确单列，不把整个阶段标记完成。

## 实施记录

S3-01已完成并获用户验收。S3-02本地实现待人工验收：定时入口合入transactionApi，不新增appointmentTimer独立部署包，以便直接复用事务/库存逻辑。详细证据与取舍见阶段3开发记录。


## 最新范围调整：取消独立系统通知（用户确认）

2026-10-03用户明确确认：不新增系统通知/公告入口，不新增独立待办列表、通知页或通知角标。当前“我的”已承载进行中预约操作，聊天已有预约动态，避免重复功能。通知原型仅作为已放弃方案的历史材料，不继续接入。

此决定覆盖本文此前有关notifications集合、notificationApi、通知初始化、消息页系统入口及独立待办的规划；相关Task/S3-03不再执行，也不新增这些集合或云函数。暂不做维护公告，未来有实际需求时另议。

保留定时预约提醒、一小时自动完成及微信订阅。未授权或发送失败不影响交易状态，用户打开小程序仍通过原聊天和“我的”查看预约；站内信息复用聊天系统动态，不建设独立通知中心。订阅发送记录如确需实现，以交易/提醒事件关联，后续设计不再依赖notificationId。

S3-01筛选验收已通过；S3-02一小时自动完成按用户要求稍后验收，保持待验收，不视为取消。下一项继续讨论并实现S3-04定时提醒，与待审核微信模板接入衔接。


## 2026-10-03 本轮实现完成，等待用户验收

用户授权根据第三阶段验收单完成所有当前可做事项。S3-01已验收；S3-02保持待验收；S3-03已取消；S3-04一句话聊天提醒已实现；S3-05订阅接口/授权按钮/发送记录已接入但默认关闭，等待新模板审核、真实ID和字段键；S3-06本地回归通过，真机双账号待验收。本节为最新状态，覆盖之前“尚未实现/待开始”的历史进度。

临期15分钟扫描、短期确认即时提醒、到时结果提醒、旧记录补处理均复用聊天，一句话不附卡片，不抢占最新预约卡片操作。定时先完成已到一小时的订单再处理提醒，跳过迟到临期及终态。订阅按接收者取对方昵称，线上地点为线上；一次授权只对应一次外部尝试，授权保存失败可幂等重试。未获得批准模板的真实参数不猜测，不弹授权。

独立只读审查发现并修复：系统提醒requestId包含交易标识兼容既有唯一索引；订阅队列写入移到核心事务提交后并隔离故障；授权候选事务外查、事务内按ID重读消费；逐条及重试刷新时钟过滤过期提醒。补充批次截止预算和hasMore最终分页状态。订阅尽力队列在提交后崩溃可能漏发；外部结果未知不自动重试，保留站内信息，未引入额外补发后台。

完整Node测试232项通过，部署与分组验收见docs/阶段3验收.md、集合/权限/索引见database/README.md。没有替用户部署、编译真机、提交或推送，没有将待验收项目标记为已完成。
