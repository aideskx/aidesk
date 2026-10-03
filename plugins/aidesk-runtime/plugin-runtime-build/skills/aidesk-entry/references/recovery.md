# 失败恢复与原号对账

每次写入先生成一个不可变 `operationId` 和规范 `requestSha256`。Pre Hook 在 `PLUGIN_DATA/operations/` 保存操作摘要及目标关联：主体、目标和对象只以单向哈希或受限类型保存，保留工具、阶段、回执观察摘要和时间；同一原号再次出现时只接受相同摘要，摘要冲突直接停止。

目标任务和结果写入先由 Pre Hook 使用同包领域合同校验。明确返回 `task_request_invalid` 或 `result_request_invalid` 仅表示本次调用在派发及建立恢复记录之前被拒绝，可修正本次参数后重新提交；这不解除同号已有的恢复记录或未知状态。服务已经返回错误、缺少回执或出现 `recovery_record_conflict` 时，仍按下面的原号对账规则处理。脚本路径均以 SKILL.md 所在目录为基准。规范业务摘要用同包 `../../scripts/domain/contracts.mjs` 的 `requestDigest` 根据原参数计算，排除 `expectedAccountSubject` 和已有的 `requestSha256`，不能把整个 MCP 参数对象的摘要用于服务对账。

工具回执缺失、超时、网络中断或 Post 结果为错误时，状态是 `unknown`，不是成功或取消。先用对应的 `*_operation` 工具沿原号读取，不能改正文、换账号、另开号或把模型自报当作服务回执。

宿主任务创建也按同一原则保存真实回执。未知创建结果只核原创建原件，不根据标题、最近任务、业务 ID 或链接猜测 `threadId`；已有真实任务就接续原入口。Hook 观察记录用于恢复线索，不替代服务终态、宿主任务存在或成果验证。

本机任务派发未知时，按原 `contextId` 读取 owner 状态，不再次 create。宿主报告 busy 时保留原任务，不自动归档或替换；跨对话 read/resume/interrupt 先准备访问并取得本次真实 snapshot 见证。CLI 回合完成只表示该回合退出，后续应读取实际报告和结果。

更新安装未知且已有 ticket 时只查询原 ticket 的 `aidesk_host_update_read({action:"status",ticket})`；保存的回执仍为 unknown 时不能称已经完成宿主对账。只读 check 仅观察当前加载包及公开发行，安装库存和配置来源未核验，不产生票据，也不解除旧安装原号的未知状态。check 或 prepare 失败且没有 ticket 时说明具体原因，不调用 status、编造票据或换号重试。需要更新时的 prepare/apply 完整重查安装与来源，继续遵守宿主修改审批，不能通过只读工具、shell 或改权限绕过。旧 MCP 连接未激活时停止依赖新版的动作，重新连接后核实际包与远端版本。

本机摘要导出和清理使用 [数据权利](data-rights.md) 的正式工具链。任务工作文件、宿主聊天、独立导出与恢复元数据分别处理；删除见证不完整时只沿真实原号读取，不重发云端删除。显式本机维护命令继续保留准确主体／目标过滤和确认，不能把本机清理结果当作云端删除。
