# ChatGPT 套餐授权与模型接口边界

## Background

小说工作台的拆书、规划、写作、审校共享统一模型路由。ChatGPT Plus/Pro 套餐授权与 OpenAI 按量 API Key 是不同的模型调用资格，不能互相假定或复用凭据。官方开源客户端接入使用 Sign in with ChatGPT 动态注册和 OAuth，调用公开 Responses API，而不是 ChatGPT 网页私有接口。

官方资料：
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations

## Decision

1. 用独立的 \`chatgpt_plan\` 模型供应商承载套餐调用，保留原有 \`openai\` API Key 供应商。不要把订阅套餐假装成通用 API Key。
2. 用户必须从本机发起 OAuth PKCE 授权。授权回调监听 \`127.0.0.1\` 随机端口，路径固定为 \`/auth/callback\`；验证 state、nonce、服务端签名、issuer、audience 和 subject。客户端首次以 \`dynamic_agent_client\` 动态注册，后续复用已颁发的 client ID。
3. 原始 access/refresh/id token 只能由服务器进程读取，保存在本机应用数据目录；不可发给浏览器、写入常规厂商 Key 数据表、日志、Git 或 URL。刷新令牌采用串行轮换；切换账号前完成身份验证。
4. 套餐调用向 \`https://api.openai.com/v1/responses\` 发起请求，每次使用 \`store:false\`、\`stream:true\`，读取至 \`response.completed\` 才算成功。明确失败或中断不得伪造完成结果。
5. 软件现有的 LangChain Chat Completions 路由通过独立本地转换适配器接入 Responses。转换器必须去除当前预览不支持的参数；显式 \`system\` 消息转为 \`developer\` 消息；工具消息若不受支持必须明确失败，不能静默删去。
6. 结构化规划先采用提示词 JSON 与原有结构化验收/修复机制，不宣称套餐接口支持与 API Key 相同的原生 JSON Schema 能力。
7. 套餐可用模型须来自当前授权账号的模型列表。模型名称不表示该账号一定有权限；只有 \`response.completed\` 才可视作本次真实调用成功。
8. 登录、退出和模型选择入口与正文音乐缩谱解耦。拆书、自动导演、小说管理和普通 API 供应商不应因连接 ChatGPT 套餐而改变原有行为。

## Runtime boundary

\`\`\`text
本机授权 -> 官方 OAuth -> 受保护的本机凭据
                                    |
模型路由选择 chatgpt_plan -> LangChain 兼容适配 -> 官方 Responses 流
                                    |
                            文本 / JSON 检查 / 保存
\`\`\`

使用套餐模型前先核查服务端仅监听本机地址：局域网监听开启时拒绝调用，防止其他设备通过软件现有未受认证的生成接口消耗已授权的套餐。桌面托管服务固定绑定 127.0.0.1 且关闭 ALLOW_LAN；源码版需要同等配置。\n\n套餐配额与独立 API 账单互不等同。Plus 五小时用量与其他使用套餐的应用共享。连接失败时应展示错误，允许使用原有供应商，不自动把普通 API 请求改成套餐请求。

## Failure Modes / Verification

- 浏览器或 Electron 渲染进程不得获取 OAuth access/refresh token。
- 服务端设置路由目前的通用认证中间件不提供身份保护，所以 OAuth 管理端点必须额外限制本机来源；不得通过局域网公开令牌管理。
- 便携版、桌面版和网页开发版有不同的页面来源（尤其 Electron \`file://\`），在确认身份边界之前不得为了让界面通过而放宽跨站来源限制。
- 持久化需要用户目录访问控制，Windows 上还需核查目录 ACL 与实际桌面打包后的路径权限。
- 必须分别核查浏览器 PKCE 回调、再次登录、令牌过期轮换、异常注销、模型列表、普通文本、JSON 结构化输出、流式中断，以及真实完整的拆书与导演任务。仅静态源码审阅不算运行验收。
- 不允许因为套餐额度受限而偷偷回退到付费 API Key，以免在用户不知情时产生计费。

## Related modules

- \`server/src/platform/llm/siwc/\`：授权、受保护凭据、Responses 适配。
- \`server/src/llm/factory.ts\`：统一模型创建入口。
- \`server/src/llm/structuredOutput.ts\`：结构化输出能力边界。
- \`client/src/pages/settings/components/ChatGPTPlanConnection.tsx\`：授权 UI。
