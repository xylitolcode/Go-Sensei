import type {
  BoardReview,
  BoardReviewRequest,
  MentorApiRequest
} from '../../app/utils/mentorPrompt'
import type { ProfileUpdate, SkillKey } from '../../app/utils/profile'

export interface LlmRuntimeConfig {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
}

const PHASE_LABEL: Record<string, string> = {
  'free-play': '自由对局',
  'teaching-liberty': '学「气」',
  'teaching-capture': '学提子',
  'teaching-territory': '学围地'
}

const CONCEPT_LABEL: Record<string, string> = {
  liberty: '气',
  capture: '提子',
  atari: '叫吃',
  territory: '围地',
  connection: '连接',
  shape: '棋形',
  rules: '规则'
}

const QUALITY_LABEL: Record<string, string> = {
  excellent: '好棋',
  good: '扎实',
  okay: '还行',
  suboptimal: '次优',
  mistake: '有问题'
}

const TONE_HINT: Record<string, string> = {
  praise: '表扬，但必须具体说出为什么好',
  excited: '兴奋、有感染力，像看到学生下出妙手',
  encourage: '先肯定这步，再展示更好的选择，不要变成说教',
  'gentle-correct': '温和指出问题，给出补救方向，别打击信心',
  neutral: '平静讲解，给出下一步可以观察的点',
  concerned: '学生有危险却被忽略了，要提醒但别吓唬他',
  'teaching-moment': '停下来讲一个模式，让学生理解背后的道理'
}

const SKILL_KEYS: SkillKey[] = [
  'libertyAwareness',
  'captureInstinct',
  'connectionSense',
  'territoryConcept',
  'dangerDetection',
  'patienceLevel',
  'tenukiFrequency'
]

const CONCEPT_KEYS = ['气', '提子', '叫吃', '围地', '连接', '棋形']

const SYSTEM_PROMPT = `你是「Go Sensei」，一个热心到有点可爱的围棋导师，教零基础成年人下 13×13 围棋。
学生刚下完一手，你要给出像朋友一样的即时点评。

## 你的性格
- 极度热心，真心希望学生学会围棋
- 像那种会拍桌子说"对对对就是这样！"的朋友
- 学生犯错时第一反应是"哎呀这个我之前没教清楚"，而不是"你怎么又错了"
- 学生连续犯同类错误时，你要意识到"哦他这个习惯得专门纠正一下"
- 偶尔会用"咱们"而不是"你"，制造师徒一体的感觉

## 你的教学原则
1. 永远先肯定再纠正——即使这步很烂，也要找到能说的好话
2. 错误是教材——学生犯了错，你兴奋，因为"正好教这个"
3. 不一次塞太多——一次只聚焦一个概念
4. 用学生自己的棋举例——不说抽象规则，说"你看你第 7 手那个"
5. 跨步关联——【行为追踪】里出现模式时要点出来，别只盯着这一手
6. 水平自适应——根据【学生画像】调整讲解深度，纯新手用比喻，有进步了用术语

## 你收到的输入
- 学生刚下的棋（位置 + 规则引擎评估）
- 【行为追踪】：这盘棋学生的行为模式（是否连续征子、是否忽略危险等）
- 【学生画像】：历史水平、习惯、已掌握概念
- 棋盘状态摘要

## 你需要输出的格式
只输出 JSON：
{
  "message": "文本（1-3 句）",
  "insight": "一句战术判断（≤40 字），会显示在局面分析面板上",
  "boardFocus": ["G7"],
  "profileUpdate": { }
}

boardFocus 是这一手最该盯的棋盘位置，最多 3 个，只能从【可用坐标】里选；
它会变成棋盘上的紫色光圈，所以不要放无关的点。没有值得圈的点就省略这个字段。
insight 要讲「接下来会发生什么」，不要重复 message 里的表扬。

profileUpdate 是可选的，只能包含这些字段：
  "addTendency": "字符串，≤10 字，例如「喜欢征子」"
  "addWeakness": "字符串，≤12 字，例如「经常忽略自己的气」"
  "addImprovement": "字符串，≤12 字，例如「开始敢提子了」"
  "addConcept": "气|提子|叫吃|围地|连接|棋形"
  "addConceptMastered": "气|提子|叫吃|围地|连接|棋形"
  "mentorNotes": "一句话总结，≤40 字"
没有任何值得记的变化时，就不要输出 profileUpdate。

## 硬性要求
- 不要 markdown 代码块，不要额外文字
- message 用 1-3 句中文，最多 70 个字
- 必须具体：说出学生这一手带来了什么（气、连接、提子、围地、危险等）
- 只能引用【可用坐标】里出现的坐标，严禁编造其他坐标
- 不要照抄【模板示例】，用你自己的话，但保持同样的教学重点
- 不要用"作为一个 AI"这类措辞，也不要列点
- insight 和 message 里提到的坐标都必须出现在【可用坐标】里`

/** Rejects any letter+number coordinate that is not on the supplied board. */
function hasForeignCoordinate(text: string, allowedPoints: string[]): boolean {
  const allowed = new Set(allowedPoints.map((point) => point.toUpperCase()))
  const mentioned = text.toUpperCase().match(/\b[A-Z](?:1[0-3]|[1-9])\b/g) ?? []
  return mentioned.some((point) => !allowed.has(point))
}

function describeTracker(request: MentorApiRequest): string[] {
  const tracker = request.tracker
  if (!tracker) return []

  const lines: string[] = ['【行为追踪】']
  const { detections } = tracker

  if (detections.isRepeatingAtari) {
    lines.push(
      `学生从第 ${tracker.chaseChainStart ?? '?'} 手开始连续 ${tracker.chaseChainLength} 手打吃同一块棋（征子链：${tracker.atariPositions.join(' ') || '无'}）。`
    )
  }
  if (detections.isChasingTooLong) {
    lines.push(`学生已经追了 ${tracker.chaseChainLength} 手还没提掉，追征过深。`)
  }
  if (detections.tenukiWhenInAtari) {
    lines.push(`学生自己的棋被叫吃（${tracker.dangerLabels.join('、')}），却下到了别处，属于脱先。`)
  } else if (detections.isIgnoringDanger) {
    lines.push(
      `学生自己的危险棋（${tracker.dangerLabels.join('、')}）没被处理，危险感知累计 ${detections.ignoredDangerCount} 次。`
    )
  }
  if (detections.isAlwaysDefending) {
    lines.push('学生最近 5 手全是防守，没有进攻。')
  }
  if (detections.isAlwaysAttacking) {
    lines.push('学生最近 5 手全是进攻，没有防守自己的棋。')
  }
  if (detections.sameAreaPersistence >= 3) {
    lines.push(`学生最近 ${detections.sameAreaPersistence} 手都下在同一个 2×2 小区域里。`)
  }
  if (tracker.awareness.sawTheCapture) {
    lines.push('面前明明有子可提，学生却没提。')
  }
  if (tracker.awareness.sawTheDanger && !detections.isIgnoringDanger) {
    lines.push('这一次学生注意到了自己的危险并做出了回应。')
  }

  if (lines.length === 1) lines.push('暂时没有发现明显的行为模式。')
  return lines
}

function describeProfile(request: MentorApiRequest): string[] {
  const profile = request.profile
  if (!profile) return []

  const lines: string[] = ['【学生画像】']
  lines.push(
    `水平：${profile.levelLabel}（${profile.overallLevel}/100），已下 ${profile.totalGames} 盘、共 ${profile.totalMoves} 手。`
  )

  const strong = Object.entries(profile.skills)
    .filter(([, value]) => value >= 45)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  if (strong.length > 0) {
    lines.push(`已经不错的方面：${strong.map(([key, value]) => `${key}(${value})`).join('、')}。`)
  }
  if (profile.conceptsMastered.length > 0) {
    lines.push(`已掌握的概念：${profile.conceptsMastered.join('、')}——这些别再从头讲。`)
  }
  if (profile.conceptsStruggling.length > 0) {
    lines.push(`还在挣扎的概念：${profile.conceptsStruggling.join('、')}——这是教学重点。`)
  }
  if (profile.weaknesses.length > 0) {
    lines.push(`老毛病：${profile.weaknesses.join('、')}。可以顺带提一嘴，但别翻旧账。`)
  }
  if (profile.recentImprovements.length > 0) {
    lines.push(`最近的进步：${profile.recentImprovements.join('、')}——值得点名表扬。`)
  }
  if (profile.tendencies.length > 0) {
    lines.push(`习惯：${profile.tendencies.join('、')}。`)
  }
  if (profile.mentorNotes) {
    lines.push(`上次的导师评语：${profile.mentorNotes}`)
  }
  lines.push(`当前教学重点：${profile.currentFocusArea}。`)

  return lines
}

export function buildMentorMessages(
  payload: MentorApiRequest
): { role: 'system' | 'user'; content: string }[] {
  const { evaluation } = payload

  const sections: string[] = [
    '【局面】',
    payload.boardSummary,
    '',
    '【学生这一手】',
    `${payload.moveLabel}（${payload.color === 'black' ? '黑' : '白'}棋，第 ${payload.moveNumber} 手）`,
    '',
    '【规则引擎评估】',
    `质量：${QUALITY_LABEL[evaluation.quality] ?? evaluation.quality}（${evaluation.reason}）`,
    `这手棋的气：${evaluation.liberties}`,
    `提子数：${evaluation.captures}`,
    `叫吃对方棋块：${evaluation.atariGroups}`,
    `新增影响点数：${evaluation.territory}`,
    evaluation.bestAlternative
      ? `更强的一手：${evaluation.bestAlternative}`
      : '没有明显更强的选择',
    `教学阶段：${PHASE_LABEL[payload.phase] ?? payload.phase}（重点：${
      CONCEPT_LABEL[payload.conceptTag ?? ''] ?? '棋形'
    }）`,
    `期望语气：${TONE_HINT[payload.tone] ?? '平静讲解'}`
  ]

  if (payload.teachingMoment) {
    sections.push(
      '',
      '【教学时刻】',
      `这次要讲的主题是「${payload.teachingMoment.title}」，请围绕它展开，不要只点评这一手。`
    )
  }

  const trackerLines = describeTracker(payload)
  if (trackerLines.length > 0) {
    sections.push('', ...trackerLines)
  }

  const profileLines = describeProfile(payload)
  if (profileLines.length > 0) {
    sections.push('', ...profileLines)
  }

  sections.push(
    '',
    '【可用坐标】',
    payload.allowedPoints.join(' '),
    '',
    '【模板示例（不要照抄）】',
    payload.templateMessage,
    '',
    '请生成导师点评，只返回 JSON。'
  )

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: sections.join('\n') }
  ]
}

function extractJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.replace(/```(?:json)?/gi, '').trim()
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    // fall through to brace extraction
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1))
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
    } catch {
      return null
    }
  }
  return null
}

export interface ParsedMentorReply {
  message: string
  insight?: string
  boardFocus?: string[]
  profileUpdate?: ProfileUpdate
}

/**
 * Extracts `message` from the model reply and rejects anything that cites a
 * coordinate not present on the board (the most common LLM hallucination here).
 * The optional structured fields let the model drive the board, but every
 * coordinate it proposes is checked against the same whitelist.
 */
export function parseMentorReply(
  raw: string,
  allowedPoints: string[]
): ParsedMentorReply | null {
  const data = extractJson(raw)
  const candidate = typeof data?.message === 'string' ? data.message : null
  if (!candidate) return null

  const message = candidate.replace(/\s+/g, ' ').trim()
  if (message.length < 2 || message.length > 120) return null

  // Match any letter+number token so off-board references (e.g. Q4) are rejected too.
  if (hasForeignCoordinate(message, allowedPoints)) return null

  const allowed = new Set(allowedPoints.map((point) => point.toUpperCase()))
  const focus = Array.isArray(data?.boardFocus)
    ? [...new Set(
        (data.boardFocus as unknown[])
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim().toUpperCase())
          .filter((value) => allowed.has(value))
      )].slice(0, 3)
    : []

  const rawInsight = typeof data?.insight === 'string' ? data.insight.replace(/\s+/g, ' ').trim() : ''
  const insight =
    rawInsight.length >= 2 && rawInsight.length <= 60 && !hasForeignCoordinate(rawInsight, allowedPoints)
      ? rawInsight
      : undefined

  const profileUpdate = parseProfileUpdate(data?.profileUpdate)
  return {
    message,
    ...(insight ? { insight } : {}),
    ...(focus.length > 0 ? { boardFocus: focus } : {}),
    ...(profileUpdate ? { profileUpdate } : {})
  }
}

/** Keeps only well-formed, short strings from the model's profile suggestion. */
export function parseProfileUpdate(raw: unknown): ProfileUpdate | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const data = raw as Record<string, unknown>
  const update: ProfileUpdate = {}

  const shortString = (value: unknown, limit: number): string | undefined => {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim().slice(0, limit)
    return trimmed.length > 0 ? trimmed : undefined
  }

  const tendency = shortString(data.addTendency, 12)
  if (tendency) update.addTendency = tendency
  const weakness = shortString(data.addWeakness, 14)
  if (weakness) update.addWeakness = weakness
  const improvement = shortString(data.addImprovement, 14)
  if (improvement) update.addImprovement = improvement
  const notes = shortString(data.mentorNotes, 60)
  if (notes) update.mentorNotes = notes

  const concept = shortString(data.addConcept, 6)
  if (concept && CONCEPT_KEYS.includes(concept)) update.addConcept = concept
  const mastered = shortString(data.addConceptMastered, 6)
  if (mastered && CONCEPT_KEYS.includes(mastered)) update.addConceptMastered = mastered

  if (data.skills && typeof data.skills === 'object') {
    const skills: Partial<Record<SkillKey, number>> = {}
    for (const [key, value] of Object.entries(data.skills as Record<string, unknown>)) {
      if (!SKILL_KEYS.includes(key as SkillKey)) continue
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      skills[key as SkillKey] = Math.max(-3, Math.min(3, Math.round(value)))
    }
    if (Object.keys(skills).length > 0) update.skills = skills
  }

  return Object.keys(update).length > 0 ? update : undefined
}

export type MentorLlmFailure = 'missing-key' | 'timeout' | 'http-error' | 'invalid-reply' | 'network'

type ChatMessage = { role: 'system' | 'user'; content: string }
type ChatResult = { ok: true; raw: string } | { ok: false; reason: MentorLlmFailure }

/** One place that actually talks to the OpenAI-compatible gateway. */
async function postChatCompletion(
  messages: ChatMessage[],
  config: LlmRuntimeConfig
): Promise<ChatResult> {
  if (!config.apiKey) return { ok: false, reason: 'missing-key' }

  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.8,
        // deepseek-flash spends part of the budget on reasoning; the answer needs room too.
        max_tokens: 1600,
        stream: false
      }),
      signal: AbortSignal.timeout(config.timeoutMs)
    })

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200)
      console.warn(`[mentor] LLM ${response.status}: ${detail}`)
      return { ok: false, reason: 'http-error' }
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: unknown; reasoning_content?: unknown } }[]
    }
    const choice = data.choices?.[0]?.message
    // Reasoning models may leave `content` empty and put everything in `reasoning_content`.
    const raw =
      typeof choice?.content === 'string' && choice.content.trim()
        ? choice.content
        : choice?.reasoning_content
    if (typeof raw !== 'string') return { ok: false, reason: 'invalid-reply' }
    return { ok: true, raw }
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    console.warn('[mentor] LLM request failed:', error instanceof Error ? error.message : error)
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' }
  }
}

export type MentorLlmResult =
  | {
      ok: true
      message: string
      insight?: string
      boardFocus?: string[]
      profileUpdate?: ProfileUpdate
    }
  | { ok: false; reason: MentorLlmFailure }

export async function requestMentorMessage(
  payload: MentorApiRequest,
  config: LlmRuntimeConfig
): Promise<MentorLlmResult> {
  const completion = await postChatCompletion(buildMentorMessages(payload), config)
  if (!completion.ok) return completion

  const parsed = parseMentorReply(completion.raw, payload.allowedPoints)
  if (!parsed) {
    console.warn('[mentor] rejected LLM reply:', completion.raw.slice(0, 200))
    return { ok: false, reason: 'invalid-reply' }
  }
  return { ok: true, ...parsed }
}

/* ------------------------------------------------------------------ *
 * On-demand whole-board review. Unlike the per-move rewrite, this is a
 * deliberate model call: the student asks "explain this position" and the
 * answer comes back as structured data that the board can render.
 * ------------------------------------------------------------------ */

const REVIEW_SYSTEM_PROMPT = `你是「Go Sensei」，正在给零基础成年人复盘一盘 13×13 围棋的中盘局面。
学生主动点了「让 AI 讲讲这盘」，所以你要讲「现在整个棋盘发生了什么」，而不是点评某一手。

## 输出格式
只输出 JSON：
{
  "summary": "≤100 字的局面综述",
  "focusPoints": ["G7", "C3"],
  "lesson": "≤40 字，接下来最该练的一件事"
}

## 硬性要求
- focusPoints 最多 3 个，且只能来自【可用坐标】，它们会被圈在棋盘上
- 不要编造坐标，不要提【可用坐标】以外的点
- summary 里先说清双方哪边有危险、哪边有空地可占，再给一句判断
- lesson 要具体，不要说「继续加油」这类空话
- 用中文，1-3 句，不要 markdown、不要列点、不要额外文字
- 若提供【KataGo 引擎实测】，它代表真实搜索结果，优先级高于【规则引擎】的估算：
  胜率、目差、最佳落点必须照它说，不得自行编造或改动数字；
  你的任务是把它翻译成零基础能懂的话，解释「为什么」，而不是重新算一遍
- 没有【KataGo 引擎实测】时，不要假装做过深度搜索，也不要写具体胜率数字`

export function buildReviewMessages(payload: BoardReviewRequest): ChatMessage[] {
  const sections = [
    '【局面】',
    payload.boardSummary,
    '',
    `【已下手数】第 ${payload.moveNumber} 手`,
    `【规则引擎形势判断】${payload.lead}`,
    `【规则引擎当前建议】${payload.advice}`,
    '',
    '【本地引擎算出的候选落点】',
    ...(payload.candidates.length > 0
      ? payload.candidates.map((item, index) => `${index + 1}. ${item.label}：${item.reason}`)
      : ['（暂无）']),
    '',
    '【只剩 1 气的棋块】',
    payload.dangerLabels.length > 0 ? payload.dangerLabels.join('、') : '（暂无）',
    '',
    ...(payload.engineAnalysis
      ? ['【KataGo 引擎实测 · 以此为准】', payload.engineAnalysis, '']
      : []),
    '【可用坐标】',
    payload.allowedPoints.join(' '),
    '',
    '请生成局面复盘，只返回 JSON。'
  ]

  return [
    { role: 'system', content: REVIEW_SYSTEM_PROMPT },
    { role: 'user', content: sections.join('\n') }
  ]
}

export function parseBoardReview(raw: string, allowedPoints: string[]): BoardReview | null {
  const data = extractJson(raw)
  const summary = typeof data?.summary === 'string' ? data.summary.replace(/\s+/g, ' ').trim() : ''
  if (summary.length < 8 || summary.length > 160) return null
  if (hasForeignCoordinate(summary, allowedPoints)) return null
  if (hasForeignCoordinate(String(data?.lesson ?? ''), allowedPoints)) return null

  const lesson = typeof data?.lesson === 'string' ? data.lesson.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
  const allowed = new Set(allowedPoints.map((point) => point.toUpperCase()))
  const focusPoints = Array.isArray(data?.focusPoints)
    ? [
        ...new Set(
          (data.focusPoints as unknown[])
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim().toUpperCase())
            .filter((value) => allowed.has(value))
        )
      ].slice(0, 3)
    : []

  return {
    summary,
    focusPoints,
    lesson: lesson.length >= 2 ? lesson : '先数清每块棋有几口气，再决定攻还是守。'
  }
}

export type BoardReviewResult =
  | { ok: true; review: BoardReview }
  | { ok: false; reason: MentorLlmFailure }

export async function requestBoardReview(
  payload: BoardReviewRequest,
  config: LlmRuntimeConfig
): Promise<BoardReviewResult> {
  const completion = await postChatCompletion(buildReviewMessages(payload), config)
  if (!completion.ok) return completion

  const review = parseBoardReview(completion.raw, payload.allowedPoints)
  if (!review) {
    console.warn('[mentor] rejected board review:', completion.raw.slice(0, 200))
    return { ok: false, reason: 'invalid-reply' }
  }
  return { ok: true, review }
}
