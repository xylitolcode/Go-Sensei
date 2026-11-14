# Go Sensei · 13×13 围棋教学

[![CI](https://github.com/xylitolcode/Go-Sensei/actions/workflows/ci.yml/badge.svg)](https://github.com/xylitolcode/Go-Sensei/actions/workflows/ci.yml)
[![PR review: CodeRabbit](https://img.shields.io/badge/PR%20review-CodeRabbit-FF570A)](https://coderabbit.ai)

一个带 AI 导师的 13 路围棋教学应用。你执黑，AI 执白，每落一子都会得到即时讲解，
并在棋盘上标出气数、提子、叫吃目标与危险棋块。导师会跨手追踪你的行为模式
（连续征子、忽略危险、攻守失衡……），并把你的水平画像存在本地，越下越懂你。

棋盘本身是「活」的：每手都会由本地规则引擎重算全盘气数、势力归属、危险棋块和
AI 候选落点；配置模型后，模型的结构化判断也会圈到棋盘上。

## 技术栈

- **Nuxt 4**（Vue 3 + Nitro）+ **Pinia**
- **Tailwind CSS v4**、**Vitest**
- 规则引擎、评估器、行为追踪、画像、局面分析全部是纯 TypeScript，可单测
- 导师点评：本地模板即时出稿 → 关键时刻由模型改写并补充结构化洞察
- 主动复盘：点「让 AI 讲讲这盘」，模型读整盘并圈出重点坐标

## 快速开始

```bash
npm install
cp .env.example .env   # 填入你的模型网关配置（可选）
npm run dev            # http://localhost:4000
```

> 端口约定：**3000 是本地模型网关，4000 是本应用**。两者必须分开，
> 否则 `NUXT_LLM_BASE_URL` 会把请求打回应用自己。`devServer.port` 与
> `npm run dev -- --port` 都固定为 4000。

不配置模型也能完整使用：规则引擎、智能棋盘、模板点评、画像、复盘速读全部可用。
配置模型后，关键一手会额外获得模型生成的个性化点评、战术洞察和棋盘圈点。

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NUXT_LLM_BASE_URL` | OpenAI 兼容网关地址（需以 `/v1` 结尾） | `https://api.deepseek.com/v1` |
| `NUXT_LLM_API_KEY` | 网关密钥 | 空（留空则只走模板） |
| `NUXT_LLM_MODEL` | 模型名 | `deepseek-flash` |
| `NUXT_LLM_TIMEOUT_MS` | 请求超时（毫秒） | `20000` |

KataGo 相关变量见 `.env.example` 与下面的「接 KataGo」章节，全部留空即关闭。

## 模型到底调没调？

调用链是真实代码，不是 mock：

```
落子 → game.ts $fetch('/api/mentor') → server/api/mentor.post.ts
     → server/utils/mentorLlm.ts → POST {baseUrl}/chat/completions
```

但有三道门控，别被「AI 导师」四个字骗了：

1. **默认只有关键时刻才发请求**。`needsLlmExplanation` 只在提子、叫吃、教学时刻、
   `excellent` / `mistake` / `suboptimal` 时为真；普通手直接走模板，服务端也会
   短路返回 `source: 'template'`。这是为了省钱和延迟——一盘几十手没必要每手都问。
   页面右上角的 **「每手都问模型」** 开关可以解除这道门控（同时覆盖服务端的
   `needsDeepExplanation` 快路径），打开后每一手都会真实请求一次网关。
2. **回复必须过校验**。只接受 JSON、`message` ≤ 120 字，且正文里出现的任何坐标
   都必须在【可用坐标】白名单里；不合规就回退模板。
3. **网关必须可达**。`/api/model-status` 会 GET 一次 `/models` 探测连通性，
   页面右上角的状态灯会显示「模型已接通 / 模型离线 / 模板模式」，不会静默降级。

因此「有没有真的调模型」在界面上是可验证的：状态灯 + 聊天气泡上的「模型」徽标
（只有 `source === 'llm'` 才出现）。另外提供一条**必定发请求**的路径：
「让 AI 讲讲这盘」→ `POST /api/board-review`，模型输出整盘综述、`focusPoints`
和训练建议，坐标同样走白名单校验，圈点会直接落在棋盘上。

服务端只把网关 host 和模型名返回给前端，API Key 不出服务端。

## 智能棋盘

棋盘上方的「智能视图」可自由叠加三层实时标注（全部由本地引擎计算，不依赖模型）：

| 视图 | 内容 |
|------|------|
| 气数热力 | 每块棋右上角徽标显示气数：1 气红（脉冲环）、2 气橙、3+ 气青 |
| 势力范围 | 空点按最近棋子染色，直观看到双方围到的地 |
| AI 候选点 | 本地引擎打分 Top 3，标号 + 分数 + 中文理由（提子 / 救棋 / 叫吃 / 扩张） |
| KataGo 热力 | 装了原生引擎后才有：169 格真实归属预测（方形色块）+ Top 3 搜索选点与黑方胜率 |

右侧「局面分析」页签还有形势条、只剩 1 气的棋块清单、当前建议，以及模型复盘结果。
紫色虚线圈是**模型自己选出来的重点**（`boardFocus` / `focusPoints`，服务端已校验坐标）。

**分工原则**：气数、提子、合法性这类必须精确的东西交给规则引擎；棋力判断（胜率、
目差、归属、算路）交给 KataGo；把结果翻译成人话、组织教学语言交给大语言模型。
三者各干各的，别让大模型去数气。

## 规则与教学

- 13×13 棋盘，黑先。实现提子、自杀禁着、**打劫禁着**（简单劫，劫点由
  `detectKoPoint` 推导）。
- 终局：双方连续停一手，或点击「结束本局」后按**中国规则数子法**结算
  （黑贴白 3¼ 子 = 6.5 目），结算前自动清理死子。
- 教学阶段可切换：自由对局 / 学「气」/ 学提子 / 学围地。
- 对手落子是启发式打分（提子、救棋、叫吃、连接、空地），**不是** MCTS 引擎；
  它负责陪练，局面判断交给规则引擎和模型。

## 接 KataGo（可选，接入层已写好）

### 为什么要接

现在这套是**专家系统**：规则引擎保证不犯错，`ai.ts` 用加权打分选点，
LLM 负责措辞。强在教学逻辑，弱在棋力——它不会真的「算路」，也没有胜率、
目差、归属预测。KataGo 补的正是这块：MCTS 搜索 + 神经网络，给的是可量化的
局面结论。接上之后 LLM 就不用假装会数气了，改为解释引擎给出的真实数字。

接入层**已经落在代码里，默认关闭**。本机目前没有装 KataGo，所以：

```
GET  /api/katago-status   → {"configured":false,"available":false,"reason":"not-configured"}
POST /api/katago-analyze  → {"source":"unavailable","reason":"not-configured"}
```

页面会显示「未安装（可选）」，其余功能完全不受影响。

### 选哪个包（本机实测）

本机：RTX 4060 Laptop / 驱动 591.74（支持到 CUDA 13.1）。但系统只有
CUDA Toolkit v12.8 的 `include` + `lib`，**没有 `bin`、也没装 cuDNN**。
v1.18.2 的 CUDA 包我实跑过，直接 `0xC0000135`（缺 `cublas64_12.dll`、
`cudnn64_9.dll`、`nvrtc64_120_0.dll`）。所以别被「有 N 卡就该选 CUDA」骗了。

| 路线 | 下载 | 额外依赖 |
| --- | --- | --- |
| **零配置（推荐，本机已装好）** | v1.18.1 `katago-v1.18.1-onnx1.24.4-directml-windows-x64.zip`（22.5 MB） | 无。包内自带 `DirectML.dll` / `onnxruntime.dll`，走 DX12，4060 直接可用 |
| 满速 N 卡 | v1.18.2 `katago-v1.18.2-cuda12.8-cudnn9.8.0-windows-x64.zip`（9.7 MB） | 必须另装 CUDA Toolkit 12.8 + cuDNN 9.8，把 DLL 放进 PATH |
| 无 N 卡兜底 | v1.18.1 `katago-v1.18.1-eigenavx2-windows-x64.zip` | 无，纯 CPU，很慢 |

**文件名怎么看**：`linux-x64` 不要；`+bs50` 是给 50×50 大棋盘玩的，更慢更吃
显存，13 路用不上；`cudnn8.9.7` 跑 transformer 权重明显更慢；`cuda13.2` 需要
比 591.74 更新的驱动。另外 **v1.18.2 只发 CUDA 包**，CPU / OpenCL / ONNX
都在 v1.18.1（点 "Show all 25 assets" 之外的那个版本页）。

本机已经放好（两个 exe 都试跑过）：

```
C:/katago/directml/katago.exe    KataGo v1.18.1 / ONNX Runtime backend  ✓ 可跑
C:/katago/cuda/katago.exe        KataGo v1.18.2 / CUDA  ✗ 缺 DLL，装好 CUDA/cuDNN 再启用
C:/katago/analysis-directml.cfg  onnxProvider = directml
C:/katago/analysis-cuda.cfg      原生 CUDA 版配置
```

两份配置都已设好 `reportAnalysisWinratesAs = BLACK`（代码按黑方视角解析，
官方示例里本来就是这个值）、`numAnalysisThreads = 1`、
`numSearchThreadsPerAnalysisThread = 4`、`nnCacheSizePowerOfTwo = 19`。

### 配置（本机已完成，换机器照抄）

**权重**选的是 98 MB 的
`kata1-b18c384nbt-s9996604416-d4316597426.bin.gz`（[下载](https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz)）。
最新的 transformer 权重 `kata1-tf3-b11c768-s12382M-d6533M.bin.gz` 有 262 MB，
DirectML 上明显更吃力，教学场景没必要。官方网络训练覆盖 7×7~19×19，
**13 路直接用同一个权重**，不用另找小棋盘模型。

段位模仿另需官方 human SL 网络 `b18c384nbt-humanv0.bin.gz`（95 MB，
[v1.15.0 发布资源](https://github.com/lightvector/KataGo/releases/tag/v1.15.0)），
已放在 `C:/katago/`。**没有它也能跑**，只是段位变成搜索预算近似。

`.env` 里已经填好（绝对路径、正斜杠）：

```dotenv
NUXT_KATAGO_BINARY=C:/katago/directml/katago.exe
NUXT_KATAGO_CONFIG=C:/katago/analysis-directml.cfg
NUXT_KATAGO_MODEL=C:/katago/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz
NUXT_KATAGO_HUMAN_MODEL=C:/katago/b18c384nbt-humanv0.bin.gz
NUXT_KATAGO_MAX_VISITS=200
NUXT_KATAGO_TIMEOUT_MS=25000
NUXT_KATAGO_OWNERSHIP_SIGN=0
NUXT_KATAGO_WINRATE_AS_BLACK=true
```

想改用 CUDA 满速版，装好 CUDA Toolkit 12.8 + cuDNN 9.8 后把前两行换成
`C:/katago/cuda/katago.exe` 与 `C:/katago/analysis-cuda.cfg` 即可。

### 实机验证结果

```
GET  /api/katago-status   → configured:true, available:true, version:"1.18.1"
POST /api/katago-analyze  → source:"katago", visits:203, ownership:169 格
                            blackWinrate 0.59, bestMove J3
```

归属符号**实测正确**：黑子所在点 +0.81 / +0.83，白子所在点 −0.78 / −0.74，
所以 `NUXT_KATAGO_OWNERSHIP_SIGN=0`（自动校准）不用改。
`reportAnalysisWinratesAs = BLACK` 也与代码解析一致。

DirectML 有个特性：**进程起来后第一次神经网络推理要编译计算图**，约 30 秒，
之后单次分析约 4 秒。接入层在探活后会自动发一个 `maxVisits: 8` 的预热查询
（不阻塞状态接口），并把首次分析超时放宽到 60 秒，避免「第一次点击必失败」。

手工排查用：

```bash
C:/katago/directml/katago.exe version
# → KataGo v1.18.1 / Using ONNX Runtime backend

curl http://localhost:4000/api/katago-status   # available: true 就通了
```

之后在「局面分析」页签点 **「跑一次 KataGo 深度分析」**，棋盘会出现 169 格
归属热力与 Top 3 搜索选点。

### 让 KataGo 执白 + 段位配置

页面右上角新增 **「KataGo 执白」开关** 与 **「对手段位」下拉**
（15 级 / 10 级 / 5 级 / 1 级 / 1 段 / 3 段 / 5 段 / 引擎全力），
设置存在浏览器本地。关掉开关、或引擎没装好/没响应，会自动回退原来的
本地加权打分，对局不会卡住。头部状态灯会写明当前是「真人棋风」还是
「搜索近似」。

段位**不是**靠"少算几步"假装的。加载 human SL 网络后，引擎启动时多带
一个 `-human-model`，白棋每回合按官方
[Human-like play](https://github.com/lightvector/KataGo/blob/master/docs/Analysis_Engine.md#human-like-play)
配方走 `POST /api/katago-play`：

- query 里 `includePolicy: true`，且
  `overrideSettings: { humanSLProfile: "rank_5k", ignorePreRootHistory: false }`。
  **必须放在 `overrideSettings` 内**，放外层 KataGo 会直接忽略并告警。
- 读 `humanPolicy`（169 格 + pass，`-1` = 不合法），按 `p^(1/温度)` 加权
  随机选点；温度随段位升高而降低，落点更收敛、棋力更强。
- `maxVisits: 64` 让主引擎判断何时停一手。人模在低段位容易过早 pass，
  所以**不采信人模的 pass**，只信搜索结果。
- 所有候选点再过一遍本地规则引擎（占用 / 自杀 / 打劫），非法点剔除。
- 没装人模时自动降级为「档位 visits + TopK softmax 采样」近似强度。

档位表集中在 `app/utils/katago.ts` 的 `RANK_PROFILES`，改一个数字即可调。
后端 `server/api/katago-play.post.ts` 任何失败都返回
`source: 'unavailable'` 而不是 500；`game.ts` 的 AI 回合改成异步并带
序号防竞态，悔棋/新对局时会自动丢弃在途请求。

```
POST /api/katago-play
  → { "source":"katago", "point":{"x":9,"y":6}, "label":"K7",
      "decision":"move", "mode":"human-sl", "rank":"5k" }
```

### 数据流

```
index.vue → game.analyzeWithKatago() → POST /api/katago-analyze
          → server/utils/katagoEngine.ts（常驻单个进程，按 id 复用 stdin/stdout）
          → katago analysis -config ... -model ...
    stdin  {"id":...,"moves":[["B","G7"],["W","H7"]],"rules":"chinese",
            "komi":6.5,"boardXSize":13,"boardYSize":13,
            "maxVisits":200,"includeOwnership":true}
    stdout {"id":...,"moveInfos":[...],"rootInfo":{...},"ownership":[169 个 -1..1]}
          → normalizeAnalysis()：169 格归属 / Top 选点 / 黑胜率 / 黑目差
          → 棋盘方形热力层 + 青色 K 标记
          → describeForMentor() 作为【KataGo 引擎实测】喂给 /api/board-review，
            LLM 只负责解释，禁止改写或编造数字
```

进程是**常驻复用**的：权重加载一次要几秒到几十秒，绝不每手 spawn。
未配置 / 文件缺失 / 超时 / 引擎报错，API 都返回 200 + `source: 'unavailable'`
而不是抛异常，前端自动退回本地规则引擎。

### 五个容易翻车的点

| 坑 | 处理方式 |
|----|----------|
| **GTP 跳过字母 I** | 本项目 13 列是 `A..M`（含 I），KataGo 是 `A..H,J..N`。`app/utils/katago.ts` 负责双向转换，别自己拼坐标字符串 |
| **贴目单位** | 项目用数子法 3¼ **子**，KataGo 要 **目** 且只收整数/半整数 → `6.5`（`stonesToGtpKomi()`） |
| **胜率视角** | cfg 必须设 `reportAnalysisWinratesAs = BLACK`；若沿用 `SIDETOMOVE`，把 `NUXT_KATAGO_WINRATE_AS_BLACK=false` |
| **ownership 正负号** | 官方文档没写清 +1 是谁，代码用棋盘上已有黑白子自动校准；若热力图颜色反了，设 `NUXT_KATAGO_OWNERSHIP_SIGN=-1` |
| **数组顺序** | ownership / `humanPolicy` 都是 row-major，从左上（A13）到右下（N1），对应 `board[y][x]`（y=0 在顶），**不要翻转行**；`humanPolicy` 最后一项是 pass，`-1` 表示不合法 |
| **humanSLProfile 的位置** | 必须写在 query 的 `overrideSettings` 对象里，作为外层字段会被 KataGo 静默忽略 |

协议细节见 [Analysis Engine 文档](https://github.com/lightvector/KataGo/blob/master/docs/Analysis_Engine.md)。
用 Docker 也可以，但引擎走 stdio，得写一个 wrapper 脚本让 `NUXT_KATAGO_BINARY`
指向 `docker run -i ...`，比直接装二进制麻烦。

### 对手与导师的分工

**KataGo 现在真的执白**（见上节），本地 `ai.ts` 退为兜底。
大语言模型仍然不参与落子：它只把 KataGo 的实测结论翻译成教学语言。
三者各司其职——规则引擎保证不犯错、KataGo 负责算路、LLM 负责讲解。
教学阶段里的「AI 故意下弱手」只在 KataGo 不可用时生效；开启 KataGo 执白后，
强度统一由「对手段位」控制。

## 目录结构

```
app/
  components/     GoBoard / ChatPanel / BoardInsightPanel / GameControls / ProfilePanel
  pages/          index.vue（棋盘 + 右侧「导师对话 / 局面分析 / 成长档案」三栏）
  stores/
    game.ts       对局状态、回合流转、打劫、终局结算、行为追踪、模型状态与复盘
    profile.ts    学生画像（localStorage 持久化，key: go-mentor-profile）
  utils/
    goRules.ts    棋盘规则、提子、打劫
    ai.ts         AI 选点启发式 + 教学阶段的「放水」开关
    boardInsight.ts 全盘气数 / 势力 / 候选点 / 危险块 / 形势判断（纯函数）
    katago.ts     GTP 坐标桥接 / komi / 查询构造 / 响应归一化 / 段位档位与选点（纯函数）
    scoring.ts    地/目估算、中国规则数子、死子清理
    mentor.ts     单手评估与点评生成（规则引擎 + 画像 + 教学时刻）
    mentorScript.ts  点评模板库
    mentorPrompt.ts  发给模型的请求体与共享类型
    sessionTracker.ts 对局内行为追踪（征子链、脱先、攻守失衡……）
    teachingMoments.ts 教学时刻的讲解文案与棋盘联动
    profile.ts    画像数据结构与纯函数
server/
  api/mentor.post.ts      单手点评网关
  api/model-status.get.ts 网关连通性探测（不返回密钥）
  api/board-review.post.ts 整盘复盘
  api/katago-status.get.ts   引擎探活（缺依赖优雅降级）
  api/katago-analyze.post.ts 整盘 MCTS 搜索
  api/katago-play.post.ts    KataGo 执白 + 段位（humanPolicy 采样）
  utils/mentorLlm.ts      提示词、通用网关调用、回复解析、坐标幻觉校验
  utils/katagoConfig.ts   NUXT_KATAGO_* 运行时配置
  utils/katagoEngine.ts   常驻子进程、单行 JSON、按 id 分发、超时与退出处理
tests/                     规则 / 数子 / 追踪 / 画像 / store / 局面分析 / KataGo 协议
```

## 常用命令

```bash
npm run dev        # 开发服务器（4000）
npm run build      # 生产构建
npm run preview    # 预览生产构建（同样可用 --port 4000）
npm test           # 运行测试
```

## 部署到 Cloudflare Workers

线上地址：<https://go-sensei.1294482766.workers.dev/>

部署目标由仓库里的 `wrangler.jsonc` 决定（`main` / `assets` / `nodejs_compat`），
不再依赖控制台里的勾选项。

```bash
# bash / Git Bash
NITRO_PRESET=cloudflare_module npm run build && npx wrangler deploy

# PowerShell（注意：构建失败就不该继续部署，所以用 $? 判断）
$env:NITRO_PRESET="cloudflare_module"; npm run build; if ($?) { npx wrangler deploy }
```

模型密钥不要写进仓库，用 Worker 密钥：

```bash
npx wrangler secret put NUXT_LLM_API_KEY
npx wrangler secret put NUXT_LLM_BASE_URL   # 可选，默认走 deepseek
```

如果改用 Cloudflare 的 Git 构建（Workers Builds），记得在构建设置里加
`NITRO_PRESET=cloudflare_module`，否则会产出 Node 服务端，Workers 起不来。

### Workers 上会踩的三个坑

| 现象 | 原因 | 处理 |
|------|------|------|
| Error 1102 `Worker exceeded resource limits` | 免费版 CPU 上限 **10 ms**，而官方文档说 SSR 典型消耗 **10-20 ms** | 只有升级 Workers Paid 才能提高上限（默认 30 s）；免费版设 `limits.cpu_ms` 无效 |
| KataGo 一直显示不可用 | Workers 没有子进程和文件系统，`spawn` / `existsSync` 在构建时被替换成 stub | 正常降级；`/api/katago-status` 会返回 `unsupported-runtime` 说明原因 |
| AI 点评全是模板 | `.env` 不会被上传，`NUXT_LLM_API_KEY` 缺失时静默 fallback | 用 `wrangler secret put` 补齐 |

KataGo 是原生二进制 + 神经网络权重，**只能在本地 Node 环境跑**。
线上想要真引擎分析，得换成远程推理服务，或者把引擎单独部署成一台常驻机器。

## 协作流程

`main` 是受保护分支，改动一律走 PR，不直接推。

1. 从 `main` 切分支：`git checkout -b feat/xxx`
2. 提交并推送：`git push -u origin feat/xxx`
3. 开 PR：`gh pr create`（交互式，会自动带出 PR 模板；
   不要加 `--fill`，那会用 commit 信息当正文并把模板顶掉）
4. CI 会跑测试、Node 构建和 Workers 构建；CodeRabbit 会在 PR 里做一轮自动审查
5. 本地改完继续 `git push`，CI 和 CodeRabbit 都会增量再审一次
6. 全绿后 squash 合并

自动审查的规则写在 `.coderabbit.yaml`：默认中文、`chill` 强度、跳过锁文件和构建产物，
并对规则引擎、Nitro 接口、KataGo 子进程、Vue 组件分别给了针对性要求。

## 隐私

学生画像（水平、习惯、弱点、成长轨迹）只存在浏览器 localStorage 里，
不会上传到任何服务器。只有发给模型的点评 / 复盘请求会带上画像摘要或局面坐标。
