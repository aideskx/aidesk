# 旧合成范围的分享与回应

本说明与同包入口`SKILL.md`共同使用，不是独立Skill。脚本路径均以 `SKILL.md` 所在目录为基准；其中`../../scripts/…`相对入口目录解析，不以本文件所在目录为基准。转入其他场景或出现未知／恢复分支时，按入口路由补读对应同包说明。

## 旧合成范围的分享与回应

网络沿同一 `aidesk-goal-network-v1` 原件合同处理。新增发表／采用／回应及他人正文首次读取由服务按可信账号归属核当前平台订阅或旧兼容权益；平台未购、到期或暂停就停止该次新正式操作，不改合同、换账号或回退旧试用。个人目标的cooperate回执不代替网络逐次准入，网络回执中的四字段entitlement也不是平台购买或归属证明。已有原号、本人副本和撤回仍沿原权限处理；对账不能重新开放已退出范围或撤下的他人正文。

本人想分享、查找、采用或交流时，用`aidesk_goal_network_discover(view:scopes)`读取当前本人获准范围，再按需发现该范围的posts或某帖responses摘要。针对具体问题查找时，在posts/responses的`query`填一个简短相关词或短语；省略query则浏览，scopes不传query。当前查找按字面子串匹配帖子标题/正文或回应正文，不作语义排序；仅用实际返回的cohortId，同一query按nextAfterId续页，换词从afterId:null重查。摘要不当已读原件，部分页不当完整全站。没有匹配或没有获准范围时如实说明，个人工作照常推进。当前候选仍只支持合成双人范围和合成材料，不把购买、自称亲属或持有设备当共享许可。

本人想找回以前发表的帖子或回应、却没有准确编号时，分别用`aidesk_goal_network_discover(view:own_posts)`或`view:own_responses`，从`after:null`开始，按实际`nextAfter:{cohortId,id}`续页；这两种本人历史查询不先要求当前共享范围，不传顶层cohortId、authorId、query或operationId，也不prepare或保存新原号。摘要只含本人帖子最新修订或本人回应及其准确来源版本；`status`是本人记录是否撤回，`sourceStatus`是当前来源状态，均不授予他人正文权限。选定后复用原read，传回实际cohortId／postId／version及回应id；正文读取仍沿现有原件与Hook处理。关闭范围、退出、撤回或权益到期不抹去本人历史，停用账号仍拒绝。分页是当前按复合编号排序的有界发现，不是全修订导出或跨次原子快照；有新发表或修订时从首页重查，部分页不称完整历史。

旧`synthetic-invited-pair`邀请范围已退役：不再创建邀请、申请或接受，也不再读取对方私人正文。旧链接、邀请引用、接受关系和原号不恢复权限；不得尝试用其他工具或回执重开。需要核对旧范围时仅用`aidesk_goal_network_scope_read`查看必要元数据；用户明确退出时，沿实际读回版本调用`aidesk_goal_network_scope_leave`。已有原号只作元数据对账，本人历史、合法采用副本、撤回和删除沿原权限保留。独立的`synthetic-two-user-prototype`合成范围仍按当前服务资格处理；下文发现、发表、采用、回应和他人正文说明只适用于仍有效且获准的该范围。正式公共社区使用其独立工具和同包说明，不受旧邀请退役影响。

查找摘要可用于整理，不启动试用。用户要求查看另一用户原件时用`aidesk_goal_network_read`，明确post／response、准确源帖版本及必要responseId。全文属于正式书桌服务，按现有用户要求开展并采用实际受理回执；旧首次资格才开始同一连续7天窗口，旧年度按实际年度期限说明；平台归属按实际平台订阅期限，不开始旧试用，不再加确认。本人帖子／回应历史、已采用副本及原号元数据对账不重新受理。

本人选择本次要发表的有界标题和文本、可见范围及使用条件后，用`aidesk_goal_network_publish`发表；修订使用实际当前expectedVersion，冲突先读事实。当前仅支持`synthetic-test-reuse-v1`合成复用条件，不能当真实用户通用许可。私人目标、聊天、文件路径和媒体不自动展开上传；只有服务实际交付的正文才称别人可读取，不用旧官方内容采用接口代替用户分享。

采用先确定采用者自己的目标并保存准确goalId／version，再用`aidesk_goal_network_adopt`引用准确源帖版本；保留原作者、来源和使用条件，不改作者目标。采用成功只证明关系和获准副本保存。要在本人目标继续多步工作时，按入口路由补读goals并沿目标任务工具衔接实际目标任务；network采用回执不能当cooperate回执，有同一目标的原cooperate就复用，否则按已获授权取得该目标的正式受理后reserve，保留原受理与当前权益；旧资格不重算已由网络起算的窗口，平台归属不创建旧试用。

用户要求回应时，`aidesk_goal_network_respond`指向准确源帖版本，发表本次获准的真实回应。作者由当前认证决定；AI帮助整理不能冒充另一用户或作者回复，也不制造活跃。采用或回应不构成作品有效或孩子能力的背书；个人推进不等待别人反馈。

用户明确举报当前共享范围内未撤回或删除的合成帖子或回应，且当前连接提供举报工具时，用 `aidesk_goal_network_report_submit`；按原 prepare／Hook 流程保存原操作号，输入 `aidesk-goal-network-report-v1` 的准确 target（kind、cohortId、postId、sourceVersion、实际 contentSha256，回应另含 responseId）和理由 spam／privacy／harmful／other，不传 action、正文、私聊或其他人的资料。当前只在已配置受理人员的原合成双人范围开放，不把邀请范围或真实用户范围视为已开放。举报校验当前范围、来源版本和摘要，不代替全文读取的权益核验，不授正文读取权；不启动试用或代办订阅，也不自动删文、封号、通知他人。受理回执的 reportId 用于 `aidesk_goal_network_report_status`；网络中断先用原 helper 生成 `aidesk_goal_network_report_operation` 查询，不换号重复举报。原号回执只证明当时受理，当前 received／reviewing／closed 和 no_action／follow_up_required 以 status 为准；closed 仅表示本次分流记录结束，follow_up_required 表示仍需后续处理，不能称内容问题已经解决。本人状态查询不重新开放来源正文。

撤回自己的帖子或回应用`aidesk_goal_network_withdraw`核准确对象和版本，实际成功才称已撤回。到期不关闭撤回和必要本人历史。已合法采用的本人副本用read的adoption视图读取，按sourceStatus说明来源撤下／失效；不承诺收回别人已取得的副本。共享引用不授作者私有目标、完整对话或修改权，原号恢复不能重新开放已撤下内容。

## 旧网络写入的业务字段

网络写入按工具schema提供准确action、范围、版本和本次所选内容；新发表用expectedVersion=0并省略postId，新回应省略responseId，新采用省略adoptionId，由同次prepare生成；已有实体更新必须保留准确ID。旧邀请范围仅保留leave必要退出写入，由此helper准备，版本沿实际read结果，不生成或猜测；不prepare新的invite／request／accept。scope_read／scope_operation、discover和本人adoption副本读不prepare。

## 共享全文与原号回执

共享全文read可能写首用／受理回执，按写入保留原件，不能因名称是read就盲目重试。网络operation只返回metadata_only受理回执，不返回共享正文；其request是投影，不能用投影摘要替代原完整请求摘要，也不能从它重建丢失正文。读取结果缺失时先核原号，再以同一准确read在当前权限下取原定版本；来源撤下或成员撤权就接受拒绝，不能从原号恢复正文。本人全文读取可能没有新受理回执，只说明实际读取，不伪造正式受理。
