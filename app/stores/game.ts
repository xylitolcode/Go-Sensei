import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  cloneBoard,
  createEmptyBoard,
  detectKoPoint,
  opponent,
  playMove,
  pointToLabel,
  type Board,
  type Point,
  type StoneColor
} from '~/utils/goRules'
import { chooseAiMove, rankMoves } from '~/utils/ai'
import {
  buildFeedbackFromEvaluation,
  evaluateMove,
  type MentorFeedback,
  type MentorTone
} from '~/utils/mentor'
import {
  buildMentorRequest,
  needsLlmExplanation,
  summarizeBoard,
  type BoardReviewRequest,
  type BoardReviewResponse,
  type MentorApiResponse,
  type MentorSource,
  type ModelStatus
} from '~/utils/mentorPrompt'
import { analyzeBoard, type BoardInsight } from '~/utils/boardInsight'
import { getPhaseContext, type TeachingPhase } from '~/utils/teaching'
import { passMessage, pickMessage } from '~/utils/mentorScript'
import { countScore, DEFAULT_KOMI, type ScoreResult } from '~/utils/scoring'
import {
  DEFAULT_OPPONENT_RANK,
  describeForMentor,
  normalizeOpponentRank,
  rankProfile,
  type KatagoAnalysis,
  type KatagoAnalyzeResponse,
  type KatagoPlayResponse,
  type KatagoStatus,
  type OpponentRank
} from '~/utils/katago'
import { emptyTrackerSnapshot, Tracker, type SessionTracker, type TrackerInput } from '~/utils/sessionTracker'
import { useProfileStore } from '~/stores/profile'

export interface ChatMessage {
  id: number
  tone: MentorTone
  text: string
  conceptTag?: string
  source?: MentorSource
}

export interface GameResult {
  winner: 'black' | 'white' | 'draw'
  studentResult: 'win' | 'lose' | 'draw'
  score: ScoreResult
  moves: number
  removedStones: number
}

interface HistoryEntry {
  color: StoneColor
  point: Point | null
  captures: Point[]
  boardBefore: Board
  capturedBefore: Record<StoneColor, number>
  lastMoveBefore: Point | null
  /** Chat bubbles produced by this move — removed again when the move is undone. */
  messageIds: number[]
  /** Enough state to replay the behaviour tracker after an undo. */
  trackerInput?: TrackerInput
}

const WELCOME =
  '欢迎来到 13×13 围棋。你执黑先行，我是你的陪练兼导师。目标是围出更多地盘，同时别让自己的棋没气。点任意交叉点落子吧，我会把每一步的想法标在棋盘上。'

export const useGameStore = defineStore('game', () => {
  const profile = useProfileStore()

  const board = ref<Board>(createEmptyBoard())
  const currentPlayer = ref<StoneColor>('black')
  const humanColor = ref<StoneColor>('black')
  const moveHistory = ref<HistoryEntry[]>([])
  const capturedStones = ref<Record<StoneColor, number>>({ black: 0, white: 0 })
  const lastMove = ref<Point | null>(null)

  const messages = ref<ChatMessage[]>([])
  const activeFeedback = ref<MentorFeedback | null>(null)
  const awaitingAck = ref(false)
  const isAiThinking = ref(false)
  const phase = ref<TeachingPhase>('free-play')

  /** Whole-position read, recomputed from the rules engine on every board change. */
  const boardInsight = computed<BoardInsight>(() =>
    analyzeBoard(board.value, currentPlayer.value, humanColor.value, activeKoFor(currentPlayer.value))
  )

  /** Model wiring visible to the UI, plus the model's structured board output. */
  const modelStatus = ref<ModelStatus | null>(null)
  const modelFocus = ref<string[]>([])
  const latestInsight = ref('')
  const modelReview = ref<{ summary: string; lesson: string } | null>(null)
  const isReviewing = ref(false)
  let reviewSeq = 0

  /** Optional KataGo MCTS engine — absent by default, degrades silently. */
  const katagoStatus = ref<KatagoStatus | null>(null)
  const katagoAnalysis = ref<KatagoAnalysis | null>(null)
  const isAnalyzing = ref(false)
  /** Off: only interesting moves call the LLM. On: every move calls it. */
  const alwaysAskModel = ref(false)
  /** Opponent strength. With the human SL net this is a genuine rank profile. */
  const opponentRank = ref<OpponentRank>(DEFAULT_OPPONENT_RANK)
  /** When off (or when KataGo is down) the local heuristic plays instead. */
  const useKatagoOpponent = ref(true)
  /** Who actually played the last AI move — shown in the header. */
  const lastOpponent = ref<{
    source: 'katago' | 'local'
    mode?: 'human-sl' | 'search'
    rank?: OpponentRank
  } | null>(null)

  /** Cross-move behaviour of the current game. */
  const tracker = new Tracker()
  const trackerSnapshot = ref<SessionTracker>(emptyTrackerSnapshot())

  /** Set once both sides passed — the game is scored and finished. */
  const gameResult = ref<GameResult | null>(null)
  const consecutivePasses = ref(0)

  const aiColor = computed<StoneColor>(() => opponent(humanColor.value))
  const isHumanTurn = computed(() => currentPlayer.value === humanColor.value)
  const canPlay = computed(
    () => isHumanTurn.value && !isAiThinking.value && !gameResult.value
  )
  const canPass = computed(() => canPlay.value && !awaitingAck.value)
  const canUndo = computed(() => moveHistory.value.length > 0 && !isAiThinking.value)

  const stones = computed(() => {
    const list: { x: number; y: number; color: StoneColor }[] = []
    for (let y = 0; y < board.value.length; y++) {
      for (let x = 0; x < board.value[y].length; x++) {
        const color = board.value[y][x]
        if (color) list.push({ x, y, color })
      }
    }
    return list
  })

  const statusLabel = computed(() => {
    if (gameResult.value) {
      return gameResult.value.studentResult === 'win'
        ? '你赢了，这盘结束了'
        : gameResult.value.studentResult === 'lose'
          ? '这盘你输了，结算完毕'
          : '和棋，结算完毕'
    }
    if (isAiThinking.value) return 'AI 正在思考…'
    if (awaitingAck.value) return '看完讲解，点「知道了」继续'
    return isHumanTurn.value ? '轮到你（黑棋）' : '轮到 AI（白棋）'
  })

  let messageId = 0
  let aiTimer: ReturnType<typeof setTimeout> | null = null
  let demoTimer: ReturnType<typeof setTimeout> | null = null
  /** Invalidates an in-flight KataGo play request after undo / new game. */
  let aiSeq = 0
  /** Invalidates in-flight mentor API replies when the game moves on. */
  let feedbackSeq = 0

  /** The ko ban that applies to the given colour, if any. */
  let koPoint: Point | null = null
  let koOwner: StoneColor | null = null

  function nextMessageId() {
    messageId += 1
    return messageId
  }

  function pushMessage(
    tone: MentorTone,
    text: string,
    conceptTag?: string,
    source: MentorSource = 'template'
  ) {
    const id = nextMessageId()
    messages.value.push({ id, tone, text, conceptTag, source })
    return id
  }

  function removeMessages(ids: number[]) {
    if (ids.length === 0) return
    const doomed = new Set(ids)
    messages.value = messages.value.filter((message) => !doomed.has(message.id))
  }

  function clearAiTimer() {
    aiSeq += 1
    if (aiTimer) {
      clearTimeout(aiTimer)
      aiTimer = null
    }
  }

  const OPPONENT_STORAGE_KEY = 'go-sensei-opponent'

  /** Client-only persistence; the server always renders the default rank. */
  function loadOpponentSettings() {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(OPPONENT_STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as { rank?: unknown; useKatagoOpponent?: unknown }
      opponentRank.value = normalizeOpponentRank(saved.rank)
      if (typeof saved.useKatagoOpponent === 'boolean') {
        useKatagoOpponent.value = saved.useKatagoOpponent
      }
    } catch {
      // Corrupt/blocked storage: keep the defaults.
    }
  }

  function persistOpponentSettings() {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(
        OPPONENT_STORAGE_KEY,
        JSON.stringify({ rank: opponentRank.value, useKatagoOpponent: useKatagoOpponent.value })
      )
    } catch {
      // Private mode / quota: not worth breaking the game over.
    }
  }

  function setOpponentRank(next: string) {
    opponentRank.value = normalizeOpponentRank(next)
    persistOpponentSettings()
  }

  function setUseKatagoOpponent(next: boolean) {
    useKatagoOpponent.value = next
    persistOpponentSettings()
  }

  function clearDemoTimer() {
    if (demoTimer) {
      clearTimeout(demoTimer)
      demoTimer = null
    }
  }

  function applyFeedback(feedback: MentorFeedback) {
    activeFeedback.value = feedback
    clearDemoTimer()

    if (feedback.demoMove) {
      demoTimer = setTimeout(() => {
        if (activeFeedback.value === feedback) {
          activeFeedback.value = { ...feedback, demoMove: undefined }
        }
      }, 3400)
    }
  }

  function pushWelcome() {
    pushMessage('neutral', WELCOME, 'basics')
  }

  pushWelcome()

  function acknowledge() {
    const shouldReply = awaitingAck.value
    activeFeedback.value = null
    awaitingAck.value = false
    clearDemoTimer()

    if (
      shouldReply &&
      currentPlayer.value === aiColor.value &&
      !isAiThinking.value &&
      !gameResult.value
    ) {
      scheduleAiMove()
    }
  }

  /** The ko point the given colour may not play right now. */
  function activeKoFor(color: StoneColor): Point | null {
    if (!koPoint || !koOwner) return null
    return koOwner === opponent(color) ? koPoint : null
  }

  /** Records the ko created by a move (if any) and drops any previous ban. */
  function applyKoAfterMove(
    color: StoneColor,
    move: Point,
    boardAfter: Board,
    captured: Point[]
  ) {
    const detected = detectKoPoint(boardAfter, move, captured)
    koPoint = detected
    koOwner = detected ? color : null
  }

  function clearKo() {
    koPoint = null
    koOwner = null
  }

  /** Whether the student passed up an available capture. */
  function missedCaptureOn(board: Board, color: StoneColor, ko: Point | null): boolean {
    const best = rankMoves(board, color, { koPoint: ko })[0]
    return Boolean(best && best.captures > 0)
  }

  /** Ask the mentor API for a richer rewrite; the template text is shown meanwhile. */
  function requestMentorInsight(args: {
    move: Point
    boardAfter: Board
    evaluation: ReturnType<typeof evaluateMove>
    feedback: MentorFeedback
    messageId: number
    moveNumber: number
  }) {
    const wantsExplanation = needsLlmExplanation(args.evaluation, {
      teachingMoment: Boolean(args.feedback.teachingMoment)
    })
    if (!wantsExplanation && !alwaysAskModel.value) return

    const payload = buildMentorRequest({
      move: args.move,
      boardAfter: args.boardAfter,
      color: humanColor.value,
      phase: phase.value,
      moveNumber: args.moveNumber,
      evaluation: args.evaluation,
      feedback: args.feedback,
      tracker: trackerSnapshot.value,
      profile: profile.digest
    })
    // The server has its own template fast path; override it too when the
    // student explicitly wants a model verdict on every single move.
    if (alwaysAskModel.value) payload.needsDeepExplanation = true

    const seq = ++feedbackSeq
    try {
      $fetch<MentorApiResponse>('/api/mentor', { method: 'POST', body: payload })
        .then((response) => {
          if (seq !== feedbackSeq) return
          if (response?.source === 'fallback') {
            if (import.meta.dev) console.warn('[mentor] 模型不可用，已回退模板：', response.reason)
            return
          }
          if (response?.source !== 'llm') return
          const target = messages.value.find((message) => message.id === args.messageId)
          if (target && target.text !== response.message) {
            target.text = response.message
            target.source = 'llm'
          }
          if (response.profileUpdate) profile.applyModelUpdate(response.profileUpdate)

          // The model does more than rewrite a sentence: its structured read is
          // rendered as board highlights and on the insight panel.
          if (response.insight) latestInsight.value = response.insight
          if (response.boardFocus?.length) modelFocus.value = response.boardFocus
          if (activeFeedback.value && (response.insight || response.boardFocus?.length)) {
            activeFeedback.value = {
              ...activeFeedback.value,
              ...(response.insight ? { insight: response.insight } : {}),
              highlights: [
                ...activeFeedback.value.highlights,
                ...(response.boardFocus ?? []).map((point) => ({
                  point,
                  type: 'insight' as const,
                  label: 'AI 重点'
                }))
              ]
            }
          }
        })
        .catch(() => {
          // Template text already on screen; nothing else to do.
        })
    } catch {
      // No fetch available (e.g. unit tests) — the template text stands on its own.
    }
  }

  /** Cheap GET so the header can tell the truth about the model connection. */
  async function probeModel() {
    try {
      modelStatus.value = await $fetch<ModelStatus>('/api/model-status')
    } catch {
      modelStatus.value = {
        configured: false,
        online: false,
        model: '—',
        gateway: '—',
        reason: 'probe-failed'
      }
    }
  }

  /** Cheap GET that tells the truth about whether KataGo is reachable. */
  async function probeKatago() {
    try {
      katagoStatus.value = await $fetch<KatagoStatus>('/api/katago-status')
    } catch {
      katagoStatus.value = { configured: false, available: false, reason: 'probe-failed' }
    }
  }

  /**
   * A genuine search: KataGo reads the real move history and returns winrate,
   * score lead, top candidates and a 169-cell ownership map. The verdict is
   * also handed to the LLM as hard facts for the next whole-board review, so
   * the language model explains instead of being asked to do arithmetic.
   */
  async function analyzeWithKatago() {
    if (isAnalyzing.value) return
    isAnalyzing.value = true
    try {
      const response = await $fetch<KatagoAnalyzeResponse>('/api/katago-analyze', {
        method: 'POST',
        body: {
          board: board.value,
          moves: moveHistory.value.map((entry) => ({
            color: entry.color,
            point: entry.point
          })),
          nextColor: currentPlayer.value,
          komiStones: DEFAULT_KOMI
        }
      })
      if (response?.source === 'katago' && response.analysis) {
        katagoAnalysis.value = response.analysis
        katagoStatus.value = {
          configured: true,
          available: true,
          model: katagoStatus.value?.model,
          version: katagoStatus.value?.version,
          humanModel: katagoStatus.value?.humanModel
        }
        pushMessage('teaching-moment', `【KataGo 深度分析】\n${describeForMentor(response.analysis)}`, 'shape')
      } else {
        katagoAnalysis.value = null
        katagoStatus.value = {
          configured: katagoStatus.value?.configured ?? false,
          available: false,
          reason: response?.reason ?? 'unavailable'
        }
        pushMessage(
          'neutral',
          `KataGo 暂不可用（${response?.reason ?? '未配置'}）。本地规则引擎的分析照常可用，点「让 AI 讲讲这盘」仍会调用语言模型。`,
          'shape'
        )
      }
    } catch {
      katagoStatus.value = { configured: false, available: false, reason: 'gateway-failed' }
      pushMessage('neutral', 'KataGo 服务未连通，已保留本地规则引擎分析。', 'shape')
    } finally {
      isAnalyzing.value = false
    }
  }

  /**
   * Student-triggered whole-board review. This is the one path that always
   * calls the model when configured, instead of gating on a single move.
   * If the gateway is down the local engine still produces a useful answer.
   */
  async function askForReview() {
    if (isReviewing.value) return
    isReviewing.value = true
    const seq = ++reviewSeq
    const insight = boardInsight.value
    const lastLabel = lastMove.value ? pointToLabel(lastMove.value) : '—'

    const allowed = new Set<string>()
    for (let y = 0; y < board.value.length; y++) {
      for (let x = 0; x < board.value[y].length; x++) {
        if (board.value[y][x]) allowed.add(pointToLabel({ x, y }))
      }
    }
    if (lastMove.value) allowed.add(lastLabel)
    for (const candidate of insight.candidates) allowed.add(candidate.label)
    for (const chance of insight.captureChances) {
      allowed.add(chance.label)
      allowed.add(chance.at)
    }

    const payload: BoardReviewRequest = {
      boardSummary: summarizeBoard(board.value, humanColor.value, lastLabel),
      allowedPoints: [...allowed],
      moveNumber: moveHistory.value.length,
      candidates: insight.candidates.map((item) => ({ label: item.label, reason: item.reason })),
      advice: insight.advice,
      lead: insight.lead.label,
      dangerLabels: insight.critical.map(
        (group) =>
          `${group.color === 'black' ? '黑' : '白'} ${group.label}（${group.size} 子，唯一气点 ${group.escapeLabel ?? '?'}）`
      ),
      ...(katagoAnalysis.value
        ? { engineAnalysis: describeForMentor(katagoAnalysis.value) }
        : {})
    }

    const localReview = (reason: string) => {
      modelReview.value = null
      modelFocus.value = insight.candidates.slice(0, 2).map((item) => item.label)
      pushMessage(
        'neutral',
        `【局面速读 · 本地引擎】\n${insight.lead.label}。${insight.advice}\n（模型不可用：${reason}，这份分析由规则引擎给出。）`,
        'shape'
      )
    }

    try {
      const response = await $fetch<BoardReviewResponse>('/api/board-review', {
        method: 'POST',
        body: payload
      })
      if (seq !== reviewSeq) return
      if (response?.source === 'llm' && response.review) {
        modelReview.value = {
          summary: response.review.summary,
          lesson: response.review.lesson
        }
        modelFocus.value = response.review.focusPoints
        pushMessage(
          'teaching-moment',
          `【AI 局面复盘】\n${response.review.summary}\n接下来练：${response.review.lesson}`,
          'shape',
          'llm'
        )
      } else {
        localReview(response?.reason ?? 'fallback')
      }
    } catch {
      if (seq === reviewSeq) localReview('网关未连通')
    } finally {
      if (seq === reviewSeq) isReviewing.value = false
    }
  }

  function play(point: Point) {
    if (awaitingAck.value) {
      acknowledge()
      return
    }
    if (!canPlay.value) return

    const boardBefore = cloneBoard(board.value)
    const ko = activeKoFor(humanColor.value)
    const outcome = playMove(boardBefore, point, humanColor.value, { koPoint: ko })
    const moveNumber = moveHistory.value.length + 1

    const evaluation = evaluateMove(point, boardBefore, humanColor.value, { koPoint: ko })

    // The tracker runs on the move the student just played, so the mentor can
    // react to patterns that include this very move.
    let trackerInput: TrackerInput | undefined
    if (outcome.ok) {
      trackerInput = {
        moveNumber,
        point,
        color: humanColor.value,
        boardBefore,
        boardAfter: outcome.board,
        captured: outcome.captured,
        atariTargets: evaluation.atariTargets,
        liberties: outcome.liberties,
        missedCapture:
          outcome.captured.length === 0 && missedCaptureOn(boardBefore, humanColor.value, ko),
        quality: evaluation.quality
      }
      tracker.record(trackerInput)
      trackerSnapshot.value = tracker.snapshot()
    }

    const feedback = buildFeedbackFromEvaluation(
      point,
      boardBefore,
      {
        color: humanColor.value,
        phase: phase.value,
        moveNumber,
        koPoint: ko,
        tracker: trackerSnapshot.value,
        profile: profile.digest
      },
      evaluation
    )

    const messageId = pushMessage(feedback.tone, feedback.message, feedback.conceptTag)
    applyFeedback(feedback)

    if (!outcome.ok) {
      awaitingAck.value = true
      return
    }

    moveHistory.value.push({
      color: humanColor.value,
      point,
      captures: outcome.captured,
      boardBefore,
      capturedBefore: { ...capturedStones.value },
      lastMoveBefore: lastMove.value,
      messageIds: [messageId],
      trackerInput
    })

    board.value = outcome.board
    capturedStones.value[humanColor.value] += outcome.captured.length
    lastMove.value = point
    currentPlayer.value = aiColor.value
    awaitingAck.value = true
    consecutivePasses.value = 0

    applyKoAfterMove(humanColor.value, point, outcome.board, outcome.captured)

    profile.recordMove({
      reason: evaluation.reason,
      quality: evaluation.quality,
      moveLabel: pointToLabel(point),
      tracker: trackerSnapshot.value
    })

    requestMentorInsight({
      move: point,
      boardAfter: board.value,
      evaluation,
      feedback,
      messageId,
      moveNumber
    })
  }

  function scheduleAiMove() {
    clearAiTimer()
    isAiThinking.value = true
    const seq = aiSeq
    const delay = 500 + Math.random() * 700
    aiTimer = setTimeout(() => runAiMove(seq), delay)
  }

  /**
   * KataGo plays white when available. Any failure (not installed, gateway
   * down, illegal suggestion) falls back to the local heuristic so a game is
   * never stuck. `seq` invalidates requests surviving an undo or a new game.
   */
  async function runAiMove(seq: number) {
    aiTimer = null
    const stillValid = () =>
      seq === aiSeq && !gameResult.value && currentPlayer.value === aiColor.value
    if (!stillValid()) {
      isAiThinking.value = false
      return
    }

    const phaseContext = getPhaseContext(phase.value, board.value)
    const ko = activeKoFor(aiColor.value)
    let point: Point | null = null
    let enginePass = false
    let engineTag = ''

    if (useKatagoOpponent.value) {
      try {
        const response = await $fetch<KatagoPlayResponse>('/api/katago-play', {
          method: 'POST',
          body: {
            board: board.value,
            moves: moveHistory.value.map((entry) => ({
              color: entry.color,
              point: entry.point
            })),
            nextColor: aiColor.value,
            rank: opponentRank.value,
            komiStones: DEFAULT_KOMI,
            koPoint: ko
          }
        })
        if (response?.source === 'katago' && stillValid()) {
          if (response.decision === 'pass') enginePass = true
          else if (response.point) point = response.point
          lastOpponent.value = {
            source: 'katago',
            mode: response.mode,
            rank: response.rank ?? opponentRank.value
          }
          const profile = rankProfile(opponentRank.value)
          engineTag = `\n【对手】KataGo · ${profile.label}${
            response.mode === 'human-sl' ? '（真人棋风）' : '（搜索近似）'
          }`
        }
      } catch {
        // Engine down / SSR: the local heuristic takes over silently.
      }
    }

    if (!stillValid()) {
      isAiThinking.value = false
      return
    }

    if (!point && !enginePass) {
      point = chooseAiMove(board.value, aiColor.value, {
        suboptimal: phaseContext.aiPlaysSuboptimally,
        koPoint: ko
      })
      lastOpponent.value = { source: 'local' }
    }

    isAiThinking.value = false
    if (!point || enginePass) {
      // No legal move left (every remaining point is banned by a ko) — pass.
      const id = pushMessage('neutral', passMessage('white'), 'pass')
      moveHistory.value.push({
        color: aiColor.value,
        point: null,
        captures: [],
        boardBefore: cloneBoard(board.value),
        capturedBefore: { ...capturedStones.value },
        lastMoveBefore: lastMove.value,
        messageIds: [id]
      })
      currentPlayer.value = humanColor.value
      consecutivePasses.value += 1
      clearKo()
      if (consecutivePasses.value >= 2) endGame()
      return
    }

    const boardBefore = cloneBoard(board.value)
    const outcome = playMove(boardBefore, point, aiColor.value, { koPoint: ko })
    if (!outcome.ok) {
      currentPlayer.value = humanColor.value
      return
    }

    const label = pointToLabel(point)
    const captured = outcome.captured.length
    const text =
      captured > 0
        ? `我提掉你 ${captured} 颗子（${pointToLabel(outcome.captured[0])} 附近）。别急，回想一下刚才哪口气没堵住。`
        : pickMessage('neutral', {
            color: aiColor.value,
            moveLabel: label,
            turn: moveHistory.value.length,
            liberties: outcome.liberties,
            capturedCount: 0,
            capturedLabel: '',
            atariGroups: 0,
            bestLabel: undefined,
            phase: phase.value,
            connected: false,
            edge: false,
            isolated: false,
            lowLiberties: outcome.liberties <= 2
          })
    const textWithSource = text + engineTag

    const highlights = [
      { point: label, type: 'neutral' as const, label: 'AI 落子' },
      ...outcome.captured.map((stone) => ({
        point: pointToLabel(stone),
        type: 'bad' as const,
        label: '被提'
      }))
    ]

    activeFeedback.value = {
      message: textWithSource,
      tone: 'neutral',
      highlights,
      annotations: [],
      conceptTag: captured > 0 ? 'capture' : undefined
    }
    const id = pushMessage('neutral', textWithSource, captured > 0 ? 'capture' : undefined)

    moveHistory.value.push({
      color: aiColor.value,
      point,
      captures: outcome.captured,
      boardBefore,
      capturedBefore: { ...capturedStones.value },
      lastMoveBefore: lastMove.value,
      messageIds: [id]
    })

    board.value = outcome.board
    capturedStones.value[aiColor.value] += outcome.captured.length
    lastMove.value = point
    currentPlayer.value = humanColor.value
    consecutivePasses.value = 0

    applyKoAfterMove(aiColor.value, point, outcome.board, outcome.captured)
  }

  function pass() {
    if (!canPass.value) return

    const id = pushMessage('neutral', passMessage(humanColor.value), 'pass')
    moveHistory.value.push({
      color: humanColor.value,
      point: null,
      captures: [],
      boardBefore: cloneBoard(board.value),
      capturedBefore: { ...capturedStones.value },
      lastMoveBefore: lastMove.value,
      messageIds: [id]
    })
    currentPlayer.value = aiColor.value
    consecutivePasses.value += 1
    clearKo()
    scheduleAiMove()
  }

  function restore(entry: HistoryEntry) {
    board.value = cloneBoard(entry.boardBefore)
    capturedStones.value = { ...entry.capturedBefore }
    lastMove.value = entry.lastMoveBefore
    currentPlayer.value = entry.color
  }

  /** Replays the tracker over the moves that are still on the board. */
  function rebuildTracker() {
    tracker.reset()
    for (const entry of moveHistory.value) {
      if (entry.trackerInput) tracker.record(entry.trackerInput)
    }
    trackerSnapshot.value = tracker.snapshot()
  }

  function undo() {
    feedbackSeq += 1
    clearAiTimer()
    clearDemoTimer()
    isAiThinking.value = false
    awaitingAck.value = false
    activeFeedback.value = null

    if (moveHistory.value.length === 0) return

    let entry = moveHistory.value.pop()!
    const undoneAi = entry.color === aiColor.value
    restore(entry)
    removeMessages(entry.messageIds)

    if (undoneAi && moveHistory.value.length > 0) {
      entry = moveHistory.value.pop()!
      restore(entry)
      removeMessages(entry.messageIds)
    }

    currentPlayer.value = humanColor.value
    consecutivePasses.value = 0
    gameResult.value = null
    rebuildTracker()
  }

  /** Scores the finished game and folds it into the student profile. */
  function endGame() {
    if (gameResult.value) return

    const score = countScore(board.value)
    const studentResult =
      score.winner === 'black' ? 'win' : score.winner === 'white' ? 'lose' : 'draw'

    gameResult.value = {
      winner: score.winner,
      studentResult,
      score,
      moves: moveHistory.value.length,
      removedStones: score.removedStones.length
    }

    profile.finishGame(
      studentResult === 'draw' ? 'unfinished' : studentResult,
      buildGameNotes(score, studentResult)
    )

    pushMessage(
      studentResult === 'win' ? 'excited' : studentResult === 'lose' ? 'encourage' : 'neutral',
      formatGameResult(score, studentResult),
      'rules'
    )
  }

  function newGame() {
    feedbackSeq += 1
    clearAiTimer()
    clearDemoTimer()
    board.value = createEmptyBoard()
    currentPlayer.value = 'black'
    moveHistory.value = []
    capturedStones.value = { black: 0, white: 0 }
    lastMove.value = null
    activeFeedback.value = null
    awaitingAck.value = false
    isAiThinking.value = false
    messages.value = []
    messageId = 0
    phase.value = 'free-play'
    gameResult.value = null
    consecutivePasses.value = 0
    modelFocus.value = []
    latestInsight.value = ''
    modelReview.value = null
    isReviewing.value = false
    katagoAnalysis.value = null
    isAnalyzing.value = false
    lastOpponent.value = null
    reviewSeq += 1
    clearKo()
    tracker.reset()
    trackerSnapshot.value = tracker.snapshot()
    profile.resetGameCounters()
    pushWelcome()
  }

  function setPhase(next: TeachingPhase) {
    feedbackSeq += 1
    const shouldReply = awaitingAck.value && currentPlayer.value === aiColor.value
    phase.value = next
    activeFeedback.value = null
    awaitingAck.value = false
    clearDemoTimer()
    const context = getPhaseContext(next, board.value, humanColor.value)
    const intro = context.intro || '回到自由对局。随意落子，我会在旁边提示你每一步的得失。'
    pushMessage(
      'neutral',
      context.boardHint ? `${intro}\n【看当前棋盘】${context.boardHint}` : intro,
      context.focusConcept
    )
    if (shouldReply && !isAiThinking.value && !gameResult.value) scheduleAiMove()
  }

  return {
    board,
    currentPlayer,
    humanColor,
    aiColor,
    moveHistory,
    capturedStones,
    lastMove,
    messages,
    activeFeedback,
    awaitingAck,
    isAiThinking,
    phase,
    tracker: trackerSnapshot,
    gameResult,
    boardInsight,
    modelStatus,
    modelFocus,
    latestInsight,
    modelReview,
    isReviewing,
    katagoStatus,
    katagoAnalysis,
    isAnalyzing,
    alwaysAskModel,
    opponentRank,
    useKatagoOpponent,
    lastOpponent,
    stones,
    isHumanTurn,
    canPlay,
    canPass,
    canUndo,
    statusLabel,
    play,
    pass,
    undo,
    newGame,
    acknowledge,
    setPhase,
    setOpponentRank,
    setUseKatagoOpponent,
    loadOpponentSettings,
    probeModel,
    probeKatago,
    askForReview,
    analyzeWithKatago,
    finishGame: endGame
  }
})

/** Human readable summary of the finished game, shown in the chat. */
function formatGameResult(score: ScoreResult, studentResult: 'win' | 'lose' | 'draw'): string {
  const lines = [
    '这盘结束了，按中国规则数子法结算（黑贴白 3¼ 子）：',
    `黑方 ${score.blackCount} 子（棋 ${score.blackStones} + 空 ${score.blackTerritory}）`,
    `白方 ${score.whiteCount} 子（棋 ${score.whiteStones} + 空 ${score.whiteTerritory} + 贴目 ${score.komi}）`
  ]

  if (score.removedStones.length > 0) {
    lines.push(`结算前自动提掉了 ${score.removedStones.length} 颗死子。`)
  }

  if (studentResult === 'win') {
    lines.push(`黑胜 ${Math.abs(score.margin)} 子 —— 这一盘你赢了！`)
  } else if (studentResult === 'lose') {
    lines.push(`白胜 ${Math.abs(score.margin)} 子 —— 这盘输了，不过棋盘上的每一手都算数，再来一盘？`)
  } else {
    lines.push('双方数目相同，和棋。')
  }

  return lines.join('\n')
}

/** A short, deterministic summary of the game for the student profile. */
function buildGameNotes(score: ScoreResult, studentResult: 'win' | 'lose' | 'draw'): string {
  const outcome =
    studentResult === 'win' ? '赢了' : studentResult === 'lose' ? '输了' : '战成和棋'
  const margin = Math.abs(score.margin)
  return `这盘${outcome}（相差 ${margin} 子）。继续练「气」和「连接」，下一盘争取把危险棋先处理掉。`
}
