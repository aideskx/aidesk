# 账号写入、冻结功能与恢复

在账号开通、家庭／学习者添加、成员或权益请求，以及账号持久操作未知与恢复时完整读取本参考。首次业务开通另按[原开通顺序](account-setup.md)；它不能代替本人选择及[选择核验](selection-binding.md)。本参考中的 `aidesk_operation_status` 处理原账号操作；已进入教学的事务与来源继续服从原教学加载参考及完整服务器 Skill，不将账号恢复改造成教学事务重发。

用户明确要求开通或添加时：

- `aidesk_create_family`：使用用户确认的名称创建家庭；先从当前结果识别已有家庭，避免把再次打开误当成新建。
- `aidesk_create_learner`：使用用户明确指定、且当前 `canManage` 为真的家庭和确认的学习者名称。多个家庭时先明确目标，不默认选第一个。姓名只是用户给定的显示名，不据此推断年龄、能力或其他儿童资料。
- 每项写入在首次调用前确定一个 UUID `operationId`，该操作后续恢复与查询保持同一编号。请求只含工具声明字段；管理权和目标是受控操作参数，不代表调用者权限，真实主体和权限由服务核验。

成员与成员权益扩展（冻结，未启用）：

`aidesk_request_membership`、`aidesk_read_members`、`aidesk_review_membership`、`aidesk_update_member`、`aidesk_remove_member`、`aidesk_read_entitlements` 和 `aidesk_change_entitlement` 仅为既有 MCP/SQL 客户端保留的兼容声明。本期单账号基线不提供家庭成员申请、审批、角色/范围/代次、跨账号共享或按成员发行权益；入口不得自动调用这些工具，服务默认会拒绝调用。旧 SQL、历史表和领域方法仍保留为冻结兼容回归，不能据此宣称本期能力。

付费权益按账号共享；普通用户的 MCP 入口仅通过 `aidesk_read_context` 读取账号订阅及当前有效权益。购买、续费和权益变更属于后端受控路径，本入口不提供支付或套餐管理工具；即使用户要求发放或续期，也不得调用冻结的 `aidesk_change_entitlement`，不把用户确认或 `canIssueEntitlements` 当作解冻授权。创建学习者不会自动选择它，也不会通过 MCP 发放或续期权益。

所有写入若返回 `outcome_unknown`，或网络、超时、取消、中断及不可信成功响应导致结果未知，用原编号调用 `aidesk_operation_status`。查得 `completed` 后说明该历史操作已完成；脱敏回执不证明仍有当前权限或权益。查得 `not_found` 仍保持原编号，只有用户明确恢复同一操作时才按原参数恢复，不自动重试。状态查询失败、撤权或参数冲突时停止后续依赖操作，不能换编号、换参数盲试，也不能把“已发请求”说成“已保存”。

