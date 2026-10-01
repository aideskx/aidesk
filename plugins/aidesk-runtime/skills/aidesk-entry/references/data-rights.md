# 数据权利与本地留存

只保存继续工作所需的目标引用、操作号、请求摘要、必要状态和恢复关联。密码、Token、验证码、完整 MCP 回执、完整对话、目标正文和无关文件不写入 Plugin 数据目录。

服务侧的导出、删除预览、删除、取消和状态读取必须使用服务当前实际提供的工具。删除前先读准确对象和当前版本；预览不是删除，未知结果不重复提交。只有服务返回明确的 `deleted` 或 `cancelled` 终态，才向用户报告服务侧已完成。服务工具不可用时，本机摘要操作不冒充云端删除或导出。

本机 `PLUGIN_DATA` 只作为恢复原件的受限目录，文件使用最小权限并保存摘要而非正文。写入 Hook 为每条记录保存主体哈希、`operationId`、请求哈希、工具、阶段、目标哈希和受限对象标识哈希；不会保存原始 `goalId`、公开正文、Token 或回执内容。云端服务原件、宿主任务和本地恢复记录分别说明，不把本机路径当作云端备份。

在获得本机路径和准确主体后，可以只读导出摘要。下面的脚本路径均以入口 `SKILL.md` 所在目录为基准：

```text
node ../../scripts/lifecycle-hook.mjs --export-summary --data-root <PLUGIN_DATA> --account-subject <subject> [--goal-id <goalId>] [--target-kind <kind> --target-id <id>]
```

本机清理要求准确主体、目标或对象过滤条件及显式 `--confirm`；它只改本机恢复账本，不调用云端服务，也不删除宿主任务：

```text
node ../../scripts/lifecycle-hook.mjs --clean-recovery --data-root <PLUGIN_DATA> --account-subject <subject> --goal-id <goalId> [--target-kind <kind> --target-id <id>] --confirm
```

导出结果只返回哈希、阶段、工具、操作号和时间等摘要，并明确 `bodyStored:false`、`credentialsStored:false`。清理没有过滤条件、主体不匹配或缺少确认时拒绝；清理后如需删除服务侧数据，仍须沿服务合同执行并读取明确终态。
