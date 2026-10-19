# 音乐缩谱07—17｜独立正文生产与提示词工作台接入

**当前状态：已注册11份可编辑提示词、已接入统一提示词执行器（代码层）；未接入自动导演的正式章节生产，未执行Windows/TypeScript端到端验收。**

## 目标与分工

- 原软件继续负责拆书、剧情规划、章节任务、人物世界资料和小说管理；绝不以音乐缩谱替代现有自动导演。
- 音乐缩谱只负责：在已经确定的B当前章节与场景任务之后，参考已选定A原著实际正文与B现状，制作正文。
- 当前不做武戏技能开发、二级/三级蒸馏，也不合并未验收的OAuth草稿PR #1。
- A原著始终是高分辨率参考；拆书报告、缩谱、写法标签不能冒充原著；B Reality和作者裁决有否决权。

## Library来源与具体版本

目前未能检索到可核实的v0.4完整文件，采用最新可取得的《第三代音乐工业提示词-OhStory工程化-v0.3-完整合集.md》作为当前官方默认底本。

- 11份完整阶段提示词逐份原文保存于 musicScoreOfficialSources.ts，保留原始version: 0.3.0-draft。
- 00—06调度、版本、交接、隔离资料保存于 musicScoreDispatcherReferences.ts。
- 原形成史《重要：音乐转写-音乐缩谱.md》继续作为争议时的高分辨率研究来源。
- 此版本是设计稿，不等于已经通过A→B正文文学验收；不得改名冒充v0.4。

## 在现有提示词工作台里修改，不用改代码

实现方式：不覆盖原有 novel.chapter.writer。新增11个原生注册提示词，ID为thirdgen.music.07至thirdgen.music.17。

已更新 promptAssetLoaderEntries、officialTemplates、templateTypes、promptCatalog、PromptWorkbenchService及templateCompiler，使它们在原生目录可见、支持完整高级模板与中文搜索，并使用现有 PromptTemplateOverrideService 保存数据库版本。

**在软件编译部署本分支后：**

1. 进入“提示词工作台”的普通模式（不是锁定章节writer的写作实验室）。
2. 搜索“音乐缩谱”，打开某个07—17工序。
3. 选择对应小说，进入“完整高级模板”。
4. 编辑系统提示词及用户输入模板，保存自定义版本。
5. 后续可启用历史版本或恢复官方底本；修改单本小说，不影响其他小说。

音乐缩谱阶段执行器 musicScoreStageRunner.ts 使用软件原有 runTextPrompt。它会按 novelId 读取当前激活的高级模板，而不是在软件逻辑里写死演奏内容。后续修改提示词无需修改仓库代码。

当前原有高级模板只支持按小说编辑，没有实现“一个全局版本自动覆盖所有小说”。要不要全局共享，待实际有需求再考虑，不为了预想需求扩展大量上游数据库代码。

## 工作流本体（与提示词内容分离）

拆书/章节剧情规划（软件原有）
→ A原著具体片段与B现有正文/人物/Reader历史
→ 07短谱→08试听→09场景总谱→08试听
→ 10按人分谱→11排练→[12局部演员包→13纯正文]×小节
→ 14修演→15分轨→16混音→作者验收→17写回提案
→ 原软件正式受控提交。

10可多角色运行、12/13可分小节运行；11份提示词不等于11次模型调用。13只接12的小节演员包与已验收正文接缝，不能加载调度者信息、其他人物秘密或未来事实。

阶段执行边界不可用提示词编辑绕过：来源锚点、BASE章节版本、阶段顺序、回退和作者验收均由状态机管理。输出只是候选，不能直接写入正文或推进A指针。

## 当前已提交代码

- musicScoreContract.ts：状态机、RETURN、10/12多次、作者16验收、17写回提案。
- musicScorePromptBundle.ts：可选的独立文件导入工具，默认版本为真实v0.3，版本不符即阻断。
- musicScoreOfficialSources.ts：真实Library 11份提示词原文。
- musicScoreDispatcherReferences.ts：原文00—06调度资料。
- musicScore.prompts.ts：11份原生可管理的PromptAsset。
- musicScoreStageRunner.ts：通过软件的统一模型路由调用，并继承当前小说激活的自定义提示词；不持久化也不自动签收。
- musicScoreWorkbench.test.js、musicScoreContract.test.js、musicScorePromptBundle.test.js：代码测试文件，尚无运行成功证据。

## 真正可用之前还需完成

1. 音乐正文模式入口：原writer保持不变，音乐模式独立、默认关闭。
2. 章节状态与A原文定点载入，07至16逐阶段合法材料包的自动组装；特别注意13演员信息隔离。
3. 每阶段产物持久化、提示词版本与指纹、输入证据、错误回返、变更后下游失效传播和断点恢复。
4. 音乐成品不得自动经过通用开篇改写、相似度重写、硬凑字数等旧writer的自由修改。
5. 作者确认的16正文，经过原软件真实章节事务写回；Pointer只在成功提交后推进。
6. 运行TypeScript构建、服务端测试、Windows桌面、真实A→B片段验收。未验证前PR保持草稿。

## 两项改造隔离

音乐分支 feat/music-score-prose 基于beta，与OAuth PR #1互不依赖、均不合并到beta或main。