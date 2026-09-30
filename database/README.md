# 云数据库初始化

目标环境：`cloud1-d1gi2dzcp1275d460`

本目录只保存可公开、可重复导入的基础数据。不要在这里保存 OpenID、用户资料、AppSecret、云密钥或 Token。

## 1. 创建集合

在微信开发者工具的“云开发 → 数据库”中创建：

1. `users`
2. `schools`
3. `campuses`

云函数使用管理员权限访问这些集合，客户端不直接写入。

## 2. 配置权限

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
  "read": true,
  "write": false
}
```

用户资料由 `login` 和 `updateProfile` 云函数读写。学校与校区允许客户端读取，但只能由云端维护。

## 3. 导入基础数据

分别向对应集合导入：

- `schools` ← `database/seeds/schools.json`
- `campuses` ← `database/seeds/campuses.json`

使用“新增记录”模式。重复导入前先按业务 ID 检查已有数据，避免出现重复学校或校区。

导入后应有 1 所学校和 3 个启用校区：西土城、沙河、海南。

## 4. 创建索引

| 集合 | 索引字段 | 类型 | 用途 |
| --- | --- | --- | --- |
| `users` | `_openid` 升序 | 唯一 | 一个微信身份只对应一个用户 |
| `schools` | `schoolId` 升序 | 唯一 | 稳定学校业务 ID |
| `campuses` | `campusId` 升序 | 唯一 | 稳定校区业务 ID |
| `campuses` | `schoolId`、`enabled`、`sortOrder` 均升序 | 普通组合索引 | 查询启用校区并排序 |

若控制台不允许为系统字段 `_openid` 创建唯一索引，应保留普通索引，并依赖 `login` 云函数的幂等查询；上线并发压测前必须再次确认唯一性保障。

## 5. 验证

在控制台检查：

- 三个集合均存在；
- `schools` 只有 `schoolId = bupt` 的启用记录；
- `campuses` 的三个 `schoolId` 都是 `bupt`；
- 客户端无法直接写入任一集合；
- 客户端可以读取学校和校区列表。
