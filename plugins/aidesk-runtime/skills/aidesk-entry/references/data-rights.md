# 本人数据导出、删除与取消

本说明与同包入口`SKILL.md`共同使用，不是独立Skill。脚本路径均以 `SKILL.md` 所在目录为基准；其中`../../scripts/…`相对入口目录解析，不以本文件所在目录为基准。转入其他场景或出现未知／恢复分支时，按入口路由补读对应同包说明。

## 本人记录导出

用户要求导出本人某个目标时，核当前账号及准确goalId，用`aidesk_goal_data_export`读取；不为导出启动新试用或受理。按本次目录支持选合同：支持v5时用`contract:aidesk-goal-data-export-v5`，还包含本人在该目标准确公开映射下的评论和原操作（含已擦除薄记录），不含他人评论或本人在别处的评论；仅支持v4时用`contract:aidesk-goal-data-export-v4`，另含本人目的目标的社区来源关联与采用原操作；仅支持v3时用`contract:aidesk-goal-data-export-v3`，包含本人目标关联的公开映射、全部公开修订及原操作；仅支持v2时用v2，包含定稿、分享预览及原操作；旧目录用v1。收到`version_conflict`不降级为不完整导出；该错误码本身不说明冲突根因，没有进一步回执时只说明导出冲突、原因待核，不推定为Plugin或连接版本故障。首段传所选contract、`snapshot:null`、`offset:0`、`chunkBytes:8192`及当前`expectedAccountSubject`，后续沿实际返回的同一snapshot和nextOffset取到null。账号不符、来源变化、超限或缺段就停止本次组装，不能拼接不同快照或把部分返回称完整导出。

保存每次真实调用的`{input,response}`：input仅剥除传输预条件`expectedAccountSubject`，保留该次contract、goalId、snapshot、offset、chunkBytes五个实际业务参数原值；response保留完整MCP结果。按顺序作为JSON数组传给同包`../../scripts/goal-data-export.mjs export --subject <当前账号> --goal-id <准确ID> --output <新目录绝对路径>`的标准输入；response使用实际完整MCP结果，不手造业务回执。拿到Post Hook实际观察的恢复根时增加`--data-root <该绝对路径>`，让helper核同账号同目标的本机原件并复制；没有实际根则省略，不猜路径或扫描其他账号。输出目录必须是不存在的新叶目录，其父目录已存在；helper不覆盖源件或旧导出。

交付实际生成的manifest和service.json，按manifest说明本机副本是否完整及缺项。此切片只含该本人目标的历史修订、明确关联记录和可核的本机原件；v2另含私有定稿、分享预览与原操作，它们不证明已公开；v3同时包含与本人目标准确关联的公开状态、修订和原操作，历史记录不代表当前仍可见；v4另含自己的准确采用引用及原操作，不含源作者正文；v5另含本人在该目标公开映射下的评论和薄原操作，删除状态不恢复正文。独立赞藏、发表／回应、订单及账号其他数据、旧命名空间、其他设备和宿主历史、引用文件本体均不在其中。单目标导出不等于全账号导出、原子备份、删除或恢复演练；未知／损坏原件保留并如实列未完整，不为通过校验删除原件。

用户要导出本人选定的帖子或回应时，沿legacy-network说明的本人历史目录查找、核当前账号并读取所选准确版本。每条保存`{discovery:{input,response},read:{input,response}}`，两种input均保留实际`expectedAccountSubject`及全部参数，response保留完整真实MCP结果；不要为导出重造回执或取回应所指他人原文。将本次明确选定的1至16条作为JSON数组，送入同包`../../scripts/goal-data-export.mjs export-network --subject <本人账号> --output <新目录绝对路径>`标准输入；更多记录可分批，不能把单批上限当用户数据配额。此命令只消费已有结果，不联网或扫描Hook，目录要求沿上段。

交付实际`network.json`和`manifest.json`，说明所选版本、正文摘要、本人撤回状态与来源状态。helper核同账号、本人目录及全文的准确引用／版本／正文SHA；目录与全文状态已经变化时，重新读取所选记录后再导出，不拼接冲突结果。未选摘要、他人正文、全部修订和其他账号资料均不包含；保留读取时间，不称当前完整账号或原子快照。导出新增的独立副本不会随服务撤回或目标删除自动消失，按本人明确用途保管和清理。

用户要找回或导出本人的旧合成范围举报记录、但没有reportId时，先核实际工具目录是否提供`aidesk_goal_network_report_export`；未提供时说明当前连接不支持这项导出，不猜工具或改用运营接口。实际提供时，用该工具读取本人完整举报快照，不调用运营queue，也不要求当前共享范围、订阅或来源正文。首段传`contract:aidesk-goal-network-report-v1`、`snapshot:null`、`offset:0`、`chunkBytes:8192`及当前`expectedAccountSubject`；后续沿同一snapshot及实际nextOffset取到null。来源或状态变化、账号不符、超限或缺页时停止组装并从首页重取，不能拼接不同快照或把部分页称完整。快照只含本人举报的当前薄状态、准确来源指针及所有本人举报原号回执，不含运营身份、运营review原件、他人举报或来源正文；当前状态与原受理回执分别解释，不把closed或follow_up_required称问题已解决。

每段保存真实`{input,response}`，input保留`expectedAccountSubject`和全部实际参数，response保留完整MCP结果。按序作为JSON数组送入同包`../../scripts/goal-data-export.mjs export-reports --subject <当前账号> --output <新目录绝对路径>`标准输入。拿到Hook实际观察的恢复根时可加`--data-root <该绝对路径>`，复制本账号report_submit原件；没有实际根则省略，不猜路径。交付实际service.json与manifest.json，分别报告服务完整性和本机原件完整性：缺失、未知、损坏，以及本机存在但未进入服务快照的举报原号都保留并标未完整，不重派举报。目标／帖子删除标记不能替代举报原件；此导出不删除记录、不制定举报保留期限，也不是跨设备原子备份。

## 本人单条评论数据

用户明确要求导出本人一条评论时，取准确`target:{kind:community_comment,publicId,commentId}`，使用`aidesk_goal_data_export`的`contract:aidesk-goal-community-comment-export-v1`及同快照分段流程。将实际`{input,response}`数组（input仅剥除expectedAccountSubject）交给`../../scripts/goal-data-export.mjs export-comments --subject <本人账号> --public-id <准确publicId> --comment-id <准确commentId> --output <新目录绝对路径>`；可加Hook实际观察的data-root。服务中取消前未发表的操作只有元数据，可能仅本机有原输入，分别报告完整性。不将本人导出当公开权限或他人回复导出。

用户明确要求删除这一条评论内容时，用`aidesk_goal_network_delete_preview`的`contract:aidesk-goal-network-delete-v3`与该target核准确快照，再由原helper为`aidesk_goal_network_delete`准备同合同的`{contract,target,expectedSnapshot}`。删除清本人这一条正文及原操作内容，保留结构及他人的独立回复；不删除来源目标或独立导出。服务成功后沿`cleanup-network`与真实回执核本机清理；薄erased查询不能代替删除回执授权本机unlink。删除未知／取消沿同一network_delete原号办理，不能改成comment_cancel。已知删除后不导出旧正文快照；新的整目标导出可保留薄删除事实，残留本机正文只报告待清，不再复制。

## 本人消息与提醒设置数据

本人明确导出一条消息或本代全部提醒设置时，分别选`target:{kind:community_notification,notificationId}`或`{kind:community_notification_settings,generation}`，用data_export的`contract:aidesk-goal-community-notification-export-v1`取得同快照分段。将真实`{input,response}`数组交给`../../scripts/goal-data-export.mjs export-notification --subject <本人账号> --notification-id <准确ID> --output <新目录绝对路径>`，设置用`export-notification-settings --subject <本人账号> --generation <准确代> --output <新目录绝对路径>`；可传Hook实际观察的data-root。只导出本人薄记录和对应原件，不含源正文或他人收件箱。

删除沿本人对准确范围和不可恢复影响的明确要求，用network_delete_preview的`contract:aidesk-goal-network-delete-v4`及上述target核快照，再由helper准备同合同删除。删除消息不删原评论或他人的消息；删除设置清本人该代全部目标静音／主动开关并推进generation，新代初值关闭，不自动续开。成功后沿真实deleted回执和cleanup-network清本机准确范围，erased业务查询不能独自授权unlink；旧代围栏不清新代原件或独立导出。未知／停止删除沿原network_delete_operation／cancel，不换号重做，已删除不从旧导出恢复。

## 本人社区举报数据

明确导出本人一条举报时，用data_export的`contract:aidesk-goal-community-report-export-v1`和`target:{kind:community_report,reportId}`取得同快照分段。将真实`{input,response}`数组（input仅剥除expectedAccountSubject）交给`../../scripts/goal-data-export.mjs export-community-report --subject <本人账号> --report-id <准确ID> --output <新目录绝对路径>`；可加Hook实际观察的data-root。只含本人该举报记录与原件，不含来源正文、他人举报或运营原件；已经擦除时只交付新的薄服务快照，残留本机原文报告待清，拒绝旧完整页和旧副本，不借导出恢复。

删除须有本人对准确举报资料及不可恢复影响的明确要求。用network_delete_preview的`contract:aidesk-goal-network-delete-v5`及上述target核快照，再用helper准备同合同删除。reportId仍取原submit号；尚未受理的原件也按准确号处理，预览零条数不解除迟到请求围栏。删除清本人理由和submit原件，保留必要来源指针、处理事实及独立内容限制；它不撤销运营处置、不删除被举报内容。成功后沿真实deleted回执与cleanup-network清本机准确范围；业务erased查询不能独自授权unlink。未知或停止尚未完成的删除沿原network_delete_operation／cancel，不能改用不存在的举报取消工具。

## 本人点赞和收藏数据

取消点赞／收藏与删除数据分开。用户要导出或删除本人对某个公开目标的赞藏数据时，先用interaction_state找回准确publicId和generation，选择`target:{kind:community_relationships,publicId,generation}`；不把publicId当goalId。范围只含本人这一代like、bookmark状态和原操作，不含采用、私人目标、评论、源正文、其他代际或他人记录。

导出用`aidesk_goal_data_export`的`contract:aidesk-goal-community-relationship-export-v1`及该target，snapshot/offset/chunkBytes和逐段校验沿本说明“本人记录导出”。保存真实`{input,response}`（input仅剥除expectedAccountSubject），将完整同快照数组送入`../../scripts/goal-data-export.mjs export-relationships --subject <本人账号> --public-id <准确publicId> --generation <实际generation> --output <新目录绝对路径>`；可加Hook实际观察的`--data-root`。交付service.json和manifest，分别说明服务准确范围与本机缺项，不称全账号导出。

删除须沿用户对该准确范围及不可恢复影响的明确要求。用`aidesk_goal_network_delete_preview`传`contract:aidesk-goal-network-delete-v2`和该target；ready列明关系数、原操作数及nextGeneration。通过原helper准备`aidesk_goal_network_delete`的`{contract,target,expectedSnapshot}`，同原号执行。它清除该代关系／原件并推进代际，不删除来源或自己的目标；新代以后只有本人明确的新赞藏意图才建立，不自动续建。旧请求与迟到回执不能恢复已删代。

服务确认后，沿本说明“本人旧合成帖子和回应删除”的同一`cleanup-network`helper处理真实回执与实际恢复根；只清所选generation，不触及新代或独立导出。未知沿同合同network_delete_operation核对，停止尚未完成删除用原helper cancel，只有cancelled回执才释放该原号意图；cancel不推进generation，已经deleted不恢复。已删代导出被拒绝时沿准确删除回执说明，不回退到旧快照或手造空导出。

## 本人目标删除与取消

用户明确要求删除本人目标内容时，先核当前账号及准确目标，读取必要的目标名称／版本，再用`aidesk_goal_data_delete_preview`取得该目标当前删除快照。目录支持v5时明确用`contract:aidesk-goal-data-delete-v5`，notifications列明本人关联消息数及元数据保留范围，源删除后不能继续读正文；仅支持v4时用v4。v4及后续的comments列明本人评论及原操作清理、保留的他人独立评论数；仅支持v3时用v3，预览的adoptions列明本人目的目标的采用引用和原操作擦除；仅有v2时用v2。v2及后续预览中的community列明关联publicId、修订数及关闭映射／擦除公开投影和原操作范围，不能漏掉这些公开副本。旧目录只用v1；遇含新公开、采用、评论或通知事实的version_conflict不降级继续旧范围删除。说明范围：清该目标的服务正文、定稿分享预览及原操作正文、任务记录正文和本人关联采用内容；有community关联时同时关闭公开映射、清全部关联公开投影和社区原操作正文，撤销该目标的家长查看；v4及后续另清本人在该公开映射下的评论及原操作，保留他人的独立评论与回复，本机只沿真实deleted回执的commentScope清准确范围。通知薄元数据保持其收件人归属，不被目标删除一起清空；本人通知另沿准确通知target删除。账号、试用、订单及防止恢复旧内容所需的原号／摘要薄记录保留。宿主任务不会因此停止；宿主历史、引用文件本体、独立导出、未关联的发表／回应和他人的已有副本另行处理。已有授权已明确覆盖这次准确目标及不可恢复影响时直接继续；目标或范围不清、发生实质变化时再核清，不把普通整理或预览当删除授权。

预览为`ready`时，用原请求helper的`prepare --tool aidesk_goal_data_delete --subject <当前账号>`处理`{contract:<刚取得预览的合同>,goalId,expectedSnapshot:<刚取得的snapshot>}`，按生成的同一原号调用删除。服务成功只证明服务范围已清；Hook提供本机清理结果时，按`complete`和`warnings`分别说明，不称全部设备或所有副本已删除。预览已为`deleted`时复用实际原删除回执，不另换号删除。原号查询未找到不是取消，也不证明从未执行。

本机清理使用同包`../../scripts/goal-data-delete.mjs cleanup --subject <当前账号> --data-root <Hook实际给出的根>`；标准输入为严格的`{input,response}`，其中input为该次真实preview、delete或operation业务参数（仅剥除`expectedAccountSubject`），response为完整真实MCP结果。只有已核服务删除回执才可清理；没有实际根时省略该参数并如实记录未检查，不能猜目录或扫描其他账号。同一回执和根可继续中断清理；损坏／未知原件保留并列未完成，不为得到通过结果删除不明文件。只读预览发现已删除事实可以保存薄标记以阻止旧内容恢复，没有本机删除意图时不自动清原文。

删除结果未知、快照已变或用户要停止本次未完成删除时，先沿原号对账。确需取消未完成操作，用请求helper的`cancel --subject <原账号> --data-root <实际根> --operation-id <原号>`生成`aidesk_goal_data_delete_cancel`的同一原请求；不prepare新号或改快照。服务确认`cancelled`后，迟到的原删除也不再执行，本机才可解除匹配的删除意图；取消结果仍未知时继续保留围栏和原号。若返回`deleted`，说明删除已完成，不能说已取消或恢复了正文。取消后若仍要删除，重新预览当前目标并按仍有效的准确授权建立新操作。

`goal_deleted`表示该目标内容已删除，`deletion_cancelled`表示这个删除操作已取消；二者都不能用于重放旧写入。服务只读原号、目标墓碑与本机恢复记录各自核对，不将旧业务原号的`not_found`当作解除围栏的依据。其他目标及原生Codex工作照常进行。

## 本人旧合成帖子和回应删除

撤回保留正文。用户明确要求删除自己的一篇帖子或一条回应时，先核当前账号和准确对象，用`aidesk_goal_network_delete_preview`取得快照。帖子删除包含全部历史修订；回应删除仅覆盖所选回应。保留他人已经合法采用的副本、独立回应及来源关系，不扩大为删除目标、账号、宿主历史、引用文件或独立导出。已有授权明确覆盖准确对象和不可恢复影响时直接继续；对象或范围不清时先核清。

`ready`后由原请求helper以`prepare --tool aidesk_goal_network_delete --subject <当前账号>`处理`{target,expectedSnapshot}`，沿输出同一原号调用。`target`取真实结果中的范围／帖子标识；帖子为`{kind:"post",cohortId,postId}`，回应另含`kind:"response"`、`sourceVersion`和`responseId`。不能只删当前版本却报告整帖删除。快照冲突先沿原号核对，未确认的原操作保留；不改号或换对象重试。

服务`deleted`与本机清理分别报告。Hook有实际恢复根时，可用同包`../../scripts/goal-data-delete.mjs cleanup-network --subject <当前账号> --data-root <实际根>`，标准输入仍是该次真实preview、delete或operation的`{input,response}`。只清准确匹配的本Plugin自管原件，不扫描其他账号或猜路径；损坏／未知文件保留并报未完成，其他设备和独立导出不在本机结论内。单纯预览已删除对象可保存薄标记，没有本机删除意图时不自动清原文。

未知结果按`aidesk_goal_network_delete_operation`核原号与完整摘要。确需停止尚未完成的删除，沿原helper的`cancel --subject <原账号> --data-root <实际根> --operation-id <原号>`生成同一删除原件，交给`aidesk_goal_network_delete_cancel`；只有准确`cancelled`回执才解除对应意图。已删除则接受原事实，不能称为取消或恢复；取消一个原号也不证明对象未被另一操作删除。墓碑阻止旧发表、回应及迟到回执复活正文，旧业务原号只是历史受理事实。
