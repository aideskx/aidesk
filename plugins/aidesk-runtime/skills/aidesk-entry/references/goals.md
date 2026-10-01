# 目标、定稿与任务

草稿、正式目标、旧私人目标、服务受理、宿主任务和结果回报是不同事实。保存草稿不表示已经开展；服务受理不表示宿主任务已经创建；宿主观察也不替代服务终态。

新目标使用实际目录支持的 `aidesk-goal-draft-v2`。保存前先完成 `aidesk_account_status`、`aidesk_platform_account_prepare` 和 `aidesk_platform_subscription_read`；写入必须带一次性的 `operationId`、领域 `contract` 和已核实的 `expectedAccountSubject`。草稿阶段只记录用户正在编辑的内容和分享意向，不把草稿当作公开目标。

定稿形成新的正式目标时，分享默认开启：应在定稿回执和公开投影可用时向用户展示将要公开的摘要、`publicId`/版本和单目标开关。用户可以在定稿时关闭该目标分享，也可以用实际提供的分享偏好工具调整以后新目标的默认值；每次改变都沿目标的 `goalId`、当前版本、一次性 `operationId` 和预期主体核对。公开投影只包含产品合同允许的摘要，完整目标内容仍按权限保存。

旧私人目标和已经存在的私人目标保留原状态；不能因为新默认而批量公开。若用户要把旧目标纳入社区，先取得该准确目标的明确意图并按当前版本重新定稿。分享工具、主体或权限不可用时，报告实际不可用或未知，不声称已公开，也不借 Hook 或本地记录代替服务写入。

正式开展使用 `aidesk-goal-service-v2`，长期目标绑定准确的 `goalId` 与版本。结果未知只用原操作号和原摘要查询，不换号重试。只有服务任务预留返回 `creationDisposition:fresh` 时，才允许按用户明确意图创建一次宿主任务；保留宿主真实 `hostId`、`threadId` 或 `clientThreadId`，不猜编号。

目标任务记录应分开保存创建、分享决定、公开投影、送达、宿主观察和报告。服务回执、宿主观察和模型自报分别呈现；报告中的本地文件或摘要不等于服务终态或宿主可进入。

取得真实任务报告后，结果回报使用 `aidesk_goal_result_record`，并绑定准确的 `goalId`、`goalVersion`、任务 `attemptId`、`reportId` 和结果正文中的来源、限制、成果位置及验证级别。结果服务只保存带来源的个人结果事实；记录成功不证明宿主确实执行、来源仍可访问或用户已经达成目标。结果写入未知时沿同一 `operationId` 调用 `aidesk_goal_result_operation` 对账，不能换号重放。

读取使用 `aidesk_goal_result_read`，按真实结果 ID／版本或有界列表继续分页；发现事实错误时先读当前版本，再以 `expectedVersion` 调用 `aidesk_goal_result_correct` 新增更正版本，保留旧版本和来源关系。更正、导出、删除和宿主任务状态分别报告，不把结果服务回执写成任务完成或能力证明。
