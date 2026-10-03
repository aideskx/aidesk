# 目标、定稿与任务

草稿、正式目标、旧私人目标、服务受理、宿主任务和结果回报是不同事实。保存草稿不表示已经开展；服务受理不表示宿主任务已经创建；宿主观察也不替代服务终态。

新目标使用实际目录支持的 `aidesk-goal-draft-v2`。保存前先完成 `aidesk_account_status`、`aidesk_platform_account_prepare` 和 `aidesk_platform_subscription_read`；写入必须带一次性的 `operationId`、领域 `contract` 和已核实的 `expectedAccountSubject`。草稿阶段只记录用户正在编辑的内容和分享意向，不把草稿当作公开目标。

所有新生成的 UUID（包括 `goalId`、`operationId`、`attemptId`、`reportId` 及关联 ID）必须使用标准小写 UUID 形状 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`（8-4-4-4-12，共 36 个字符）；服务合同拒绝大写 UUID 和不带连字符的 32 位字符串。未知写入沿用原号对账，不重新生成。

若执行环境没有 `crypto.randomUUID()`，使用确定形状的本地生成器产生新号，例如 `const newUuid=()=>[8,4,4,4,12].map(n=>Array.from({length:n},()=>Math.floor(Math.random()*16).toString(16)).join("")).join("-")`；不要退回业务名称、日期串或自行拼接的非 UUID 值。

用户明确要求将新目标定稿时，先用 `aidesk_goal_finalization_read` 核 `defaultEligible`、当前草稿版本及尚无定稿，再读取本人当前分享偏好。默认开启且本人没有关闭当前目标或限定只预览时，展示选定的公开摘要及“分享开启，可关闭当前目标或调整以后默认值”，按当前偏好版本以 `basis:"default"` 定稿，并继续完成[社区首次公开](./community.md#首次公开)。这属于本次新目标定稿流程，无须再等待一句独立的“发布”。本人单独选择开关时使用 `basis:"goal_choice"`；当本人明确说“不分享”或“不公开”时，必须提交 `sharing:{basis:"goal_choice",enabled:false,preferenceVersion:null,projection:null}`。`sharing:null` 只表示分享状态未解决，虽然服务会保守地保持私有，但不能当作本人已经关闭。默认关闭、单目标关闭或只要求草稿／预览时不公开，不为了走默认流程改动本人偏好。

`aidesk_goal_finalization_finalize` 只固定目标版本、分享选择及最小公开投影，不创建公开映射。分享开启的定稿回执与社区公开回执是两步，只有后者及当前公开读回成立才能报告已分享，并展示真实 `publicId`／公开版本及开关。定稿成功但公开失败或未知时，明确说明“目标已定稿，公开尚未完成”，沿原号处理，不把再次定稿当作发布重试。公开投影只包含合同允许的摘要，完整目标内容仍按权限保存。

旧私人目标和已经存在的私人目标保留原状态；不能因为新默认而批量公开。若用户要把旧目标纳入社区，先取得该准确目标的明确意图并按当前版本重新定稿。分享工具、主体或权限不可用时，报告实际不可用或未知，不声称已公开，也不借 Hook 或本地记录代替服务写入。

正式开展使用 `aidesk-goal-service-v2`，长期目标绑定准确的 `goalId` 与版本。结果未知只用原操作号和原摘要查询，不换号重试。

用户明确要求建立独立目标任务后，沿同包本机工具与真实服务回执衔接：

1. `aidesk_host_task_context({action:"source"})` 返回本次宿主实际 `sourceThreadId` 与 `hostId`，不从环境、对话标题或示例猜编号。用它们和已受理的服务原号组成一次性任务 reserve 输入。
2. 在 reserve 前，调用 `aidesk_host_task_context({action:"prepare_creation",reservationInput})`，保存返回的 `contextId`。`reservationInput` 必须是随后交给真实 `aidesk_goal_task_reserve` 的完整同一原件，包含 `expectedAccountSubject` 以及 `contract:"aidesk-goal-task-v1"`、`operationId`、`goalId`、`goalVersion`、`attemptId`、`serviceOperationId`、`serviceRequestSha256`、`hostId`、`sourceThreadId` 全部字段；不能只传业务字段或另造一份。注意：宿主 `prepare_creation` 的参数形状是 `{action:"prepare_creation",reservationInput}`，权威 `aidesk_goal_task_reserve` 则必须把同一原件展开为顶层参数 `{contract,operationId,goalId,goalVersion,attemptId,serviceOperationId,serviceRequestSha256,hostId,sourceThreadId,expectedAccountSubject}`，不能把它再包成 `{reservationInput}`。只有这次服务返回 `creationDisposition:"fresh"` 且真实 Pre/Post 已被本机 owner 关联，才能创建；模型转述或重读到的旧回执不能代替。
3. 调用 `aidesk_host_task_dispatch({action:"create",contextId,prompt})` 一次。prompt传清目标、版本、attempt、原服务关联、用户授权和成果要求；目标任务先取得自身真实来源并读取准确 attempt，只有服务已有相同 threadId 的 created 记录，才保存报告及其结果。尚未登记时只做不依赖报告写入的准备并结束本回合，等待父对话按原 threadId 接续；不要用持续轮询阻止该回合结束，不另 reserve 或再建一份任务，也不先写结果绕过报告关联。不把主对话的问题变成额外业务范围。
4. `starting`、执行或持久读回 `unknown` 都不是创建成功。按同一 `contextId` 用 `aidesk_host_task_read` 读取原状态；只有 owner 返回与该 context/run/真实 threadId 绑定的 `entryProof` 且 `creationVisible:true`，才能用其 `evidence.entryUri`、`evidenceRef` 记录宿主创建 `visible:true`。owner 仍为 `starting`／`running` 时，等待原回合结束后按同一 context 读回证明，不用桌面查看替代 owner 证明。记录 `creation` 事件时，`status:"created"` 必须填 `clientThreadId:null`，真实子任务 ID 填在 `task.threadId`；只有 `pending` 使用宿主返回的临时 `clientThreadId`，此时 `task:null`；`unknown`、`not_found`、`rejected` 均填 `clientThreadId:null`、`task:null`，不猜编号。证明来自受支持默认桌面入口能力及本次真实持久读回，不能由模型、自传 profile、home 字符串或链接格式补造。证明为空时保留真实 threadId 并说明入口未核，不重建；`entryAccessible:"unknown"` 仍只表示当前页面尚未实际观测，不阻止已满足上述证明条件的 created 登记。父对话保存创建记录后，按原任务准备访问并取得 snapshot 见证，再 resume 原 threadId 交接登记结果，让子任务核准同号 created 后报告。服务接受记录、持久创建、当前页面可达和成果验证分别说明；不要根据 exit0 宣布目标完成。

后续继续、暂停或结束先沿真实 `aidesk_goal_task_read` / `aidesk_goal_task_record` 核当前目标版本和用户决定；执行决定与送达结果分别记载。要控制已有宿主任务时，调用 `aidesk_host_task_context({action:"prepare_access",expectedAccountSubject,goalId,contextId,accessAction})`，按返回的准确 snapshot 读取参数调用真实服务，再将返回的 `accessId` 用于本机 `read`、`resume` 或 `interrupt`。新对话也必须经过这次真实读取；不传模型拼接的回执。恢复只向原 `threadId` 发送新提示，暂停只请求中断 owner 正在管理的原进程。当前决定已 ended、任务身份不符、宿主忙或结果未知时保留原入口，不重建、归档或替换任务。

本机运行观察是来源证据，宿主聊天是否仍可进入需按实际访问另记。回到主对话后读取真实服务报告与结果继续协作；目标任务尚未报告时如实说明，不把本机状态哈希还原成不存在的成果。
目标任务记录应分开保存创建、分享决定、公开投影、送达、宿主观察和报告。服务回执、宿主观察和模型自报分别呈现；报告中的本地文件或摘要不等于服务终态或宿主可进入。

报告 `progress` 是不含换行的进展摘要，按 UTF-8 编码最多 2048 字节，不是 2048 个中文字符。报告引用实际成果时，按已核实范围填写路径、摘要和访问限制；未核验的内容或可达性明确写未知，不猜测。完整成果可保存在文件及后续结果 `body.summary` 中，后者允许换行但仍限 8192 UTF-8 字节。先取得真实报告回执，再保存关联结果。

取得真实任务报告后，结果回报使用 `aidesk_goal_result_record`，并绑定准确的 `goalId`、`goalVersion`、任务 `attemptId`、`reportId` 和结果正文中的来源、限制、成果位置及验证级别。结果服务只保存带来源的个人结果事实；记录成功不证明宿主确实执行、来源仍可访问或用户已经达成目标。结果写入未知时沿同一 `operationId` 调用 `aidesk_goal_result_operation` 对账，不能换号重放。

读取使用 `aidesk_goal_result_read`，按真实结果 ID／版本或有界列表继续分页；发现事实错误时先读当前版本，再以 `expectedVersion` 调用 `aidesk_goal_result_correct` 新增更正版本，保留旧版本和来源关系。更正、导出、删除和宿主任务状态分别报告，不把结果服务回执写成任务完成或能力证明。
