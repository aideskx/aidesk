# 目标、定稿与任务

草稿、定稿、服务受理、宿主任务和结果回报是不同事实。保存草稿不表示已经开展，定稿不表示已经公开，服务受理不表示宿主任务已经创建。

新目标使用实际目录支持的 `aidesk-goal-draft-v2`。保存前先完成 `aidesk_account_status`、`aidesk_platform_account_prepare` 和 `aidesk_platform_subscription_read`；写入必须带一次性的 `operationId`、领域 `contract` 和已核实的 `expectedAccountSubject`。定稿沿当前目标版本和 `expectedVersion`，私有工作传 `sharing:null`；公开预览只有在用户明确要求且实际提供社区工具时才处理。

正式开展使用 `aidesk-goal-service-v2`，长期目标绑定准确的 `goalId` 与版本。结果未知只用原操作号和原摘要查询，不换号重试。只有服务任务预留返回 `creationDisposition:fresh` 时，才允许按用户明确意图创建一次宿主任务；保留宿主真实 `hostId`、`threadId` 或 `clientThreadId`，不猜编号。

目标任务记录应分开保存创建、决定、送达、宿主观察和报告。服务回执、宿主观察和模型自报分别呈现；报告中的本地文件或摘要不等于服务终态或宿主可进入。
