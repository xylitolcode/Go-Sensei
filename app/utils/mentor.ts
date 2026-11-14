import {
  BOARD_SIZE,
  getGroup,
  getNeighbors,
  inBounds,
  playMove,
  pointToLabel,
  type Board,
  type PlayOptions,
  type Point,
  type StoneColor
} from './goRules'
import { bestAlternative, rankMoves } from './ai'
import { estimateInfluence } from './scoring'
import { getPhaseContext, type TeachingPhase } from './teaching'
import { illegalMoveMessage, pickMessage, type ScriptContext } from './mentorScript'
import { detectTeachingMoment, type TeachingMoment, type TeachingMomentType } from './teachingMoments'
import type { SessionTracker } from './sessionTracker'
import { CONCEPT_LABELS, WEAKNESS_LABELS, type ProfileDigest } from './profile'

export type MentorTone =
  | 'encourage'
  | 'praise'
  | 'gentle-correct'
  | 'neutral'
  | 'excited'
  | 'concerned'
  | 'teaching-moment'

export type HighlightType =
  | 'good'
  | 'bad'
  | 'neutral'
  | 'danger'
  | 'opportunity'
  | 'comparison'
  | 'insight'

export interface BoardHighlight {
  point: string
  type: HighlightType
  label?: string
}

export interface BoardAnnotation {
  point: string
  text: string
  style: 'arrow' | 'circle' | 'cross' | 'number' | 'text-only'
  /** Optional target for `arrow` annotations. */
  to?: string
}

export interface DemoMove {
  point: string
  color: StoneColor
  opacity: number
  label: string
}

export interface MentorFeedback {
  message: string
  tone: MentorTone
  highlights: BoardHighlight[]
  annotations: BoardAnnotation[]
  demoMove?: DemoMove
  conceptTag?: string
  scoreDelta?: number
  /** Present when the mentor stopped to teach a pattern instead of judging one move. */
  teachingMoment?: TeachingMoment
  /** One-line tactical read supplied by the model (not the template engine). */
  insight?: string
}

export type MoveQuality = 'excellent' | 'good' | 'okay' | 'suboptimal' | 'mistake'

export interface MoveImpact {
  captures: number
  liberties: number
  territory: number
}

export interface MoveEvaluation {
  quality: MoveQuality
  reason: string
  bestAlternative?: Point
  impact: MoveImpact
  captured: Point[]
  liberties: number
  atariGroups: number
  atariTargets: Point[]
  adjacency: boolean
  connected: boolean
  edge: boolean
  isolated: boolean
}

export interface MentorContext {
  color: StoneColor
  phase: TeachingPhase
  moveNumber: number
  /** Active ko ban, so the mentor judges the move with the same rules the board uses. */
  koPoint?: Point | null
  /** Cross-move behaviour of the current game. */
  tracker?: SessionTracker
  /** What the tutor knows about this student from previous games. */
  profile?: ProfileDigest
}

const edgeDistance = (point: Point) =>
  Math.min(point.x, point.y, BOARD_SIZE - 1 - point.x, BOARD_SIZE - 1 - point.y)

function nearestOwnStone(board: Board, point: Point, color: StoneColor) {
  let distance = Infinity
  let found = false
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== color) continue
      found = true
      distance = Math.min(distance, Math.abs(x - point.x) + Math.abs(y - point.y))
    }
  }
  return { distance, found }
}

function findAtariTargets(board: Board, point: Point, enemy: StoneColor): Point[] {
  const seen = new Set<string>()
  const targets: Point[] = []

  for (const neighbor of getNeighbors(point)) {
    if (board[neighbor.y][neighbor.x] !== enemy) continue
    const group = getGroup(board, neighbor)
    if (group.liberties.length !== 1) continue
    const key = group.stones
      .map((stone) => `${stone.x},${stone.y}`)
      .sort()
      .join('|')
    if (seen.has(key)) continue
    seen.add(key)
    targets.push(group.stones[0])
  }

  return targets
}

/**
 * Heuristic quality check for a single move. Not an engine evaluation — it looks at
 * captures, liberties, atari, connection, edge play and loneliness.
 */
export function evaluateMove(
  move: Point,
  board: Board,
  color: StoneColor,
  options: PlayOptions = {}
): MoveEvaluation {
  const outcome = playMove(board, move, color, options)

  if (!outcome.ok) {
    return {
      quality: 'mistake',
      reason: outcome.reason,
      bestAlternative: rankMoves(board, color, options)[0]?.point,
      impact: { captures: 0, liberties: 0, territory: 0 },
      captured: [],
      liberties: 0,
      atariGroups: 0,
      atariTargets: [],
      adjacency: false,
      connected: false,
      edge: false,
      isolated: false
    }
  }

  const enemy = color === 'black' ? 'white' : 'black'
  const group = getGroup(outcome.board, move)
  const liberties = group.liberties.length
  const captured = outcome.captured

  let adjacency = false
  let weakBefore = false
  for (const neighbor of getNeighbors(move)) {
    if (board[neighbor.y][neighbor.x] === color) {
      adjacency = true
      if (getGroup(board, neighbor).liberties.length === 1) weakBefore = true
    }
  }

  const atariTargets = findAtariTargets(outcome.board, move, enemy)
  const atariGroups = atariTargets.length
  const edge = edgeDistance(move) === 0
  const nearestOwn = nearestOwnStone(board, move, color)
  const isolated = adjacency === false && nearestOwn.found && nearestOwn.distance >= 4

  let quality: MoveQuality
  let reason: string

  if (captured.length > 0) {
    quality = 'excellent'
    reason = 'capture'
  } else if (liberties === 1) {
    quality = 'mistake'
    reason = 'self-atari'
  } else if (atariGroups > 0) {
    quality = 'excellent'
    reason = 'atari'
  } else if (weakBefore && liberties >= 2) {
    quality = 'good'
    reason = 'rescue'
  } else if (adjacency && liberties >= 3) {
    quality = 'good'
    reason = 'connection'
  } else if (edge && !adjacency) {
    quality = 'suboptimal'
    reason = 'edge'
  } else if (isolated && liberties <= 2) {
    quality = 'suboptimal'
    reason = 'isolated'
  } else if (adjacency) {
    quality = 'good'
    reason = 'extension'
  } else {
    quality = 'okay'
    reason = 'neutral'
  }

  const territoryBefore = estimateInfluence(board)[color]
  const territoryAfter = estimateInfluence(outcome.board)[color]
  const territory = Math.max(0, territoryAfter - territoryBefore)

  const needsAlternative =
    quality === 'okay' || quality === 'suboptimal' || quality === 'mistake'
  const alternative = needsAlternative
    ? bestAlternative(board, color, move, 12, options)
    : undefined

  return {
    quality,
    reason,
    bestAlternative: alternative,
    impact: { captures: captured.length, liberties, territory },
    captured,
    liberties,
    atariGroups,
    atariTargets,
    adjacency,
    connected: adjacency,
    edge,
    isolated
  }
}

function toneFor(evaluation: MoveEvaluation): MentorTone {
  if (evaluation.captured.length > 0) return 'excited'
  switch (evaluation.quality) {
    case 'excellent':
    case 'good':
      return 'praise'
    case 'okay':
    case 'suboptimal':
      return 'encourage'
    default:
      return 'gentle-correct'
  }
}

const ILLEGAL_REASONS = new Set(['occupied', 'suicide', 'out-of-bounds', 'ko'])

export function generateFeedback(
  move: Point,
  board: Board,
  context: MentorContext
): MentorFeedback {
  return generateFeedbackAndEvaluation(move, board, context).feedback
}

/** Same as `generateFeedback`, but also exposes the evaluation used to build it. */
export function generateFeedbackAndEvaluation(
  move: Point,
  board: Board,
  context: MentorContext
): { feedback: MentorFeedback; evaluation: MoveEvaluation } {
  const options: PlayOptions = { koPoint: context.koPoint ?? null }
  const evaluation = evaluateMove(move, board, context.color, options)
  const feedback = buildFeedbackFromEvaluation(move, board, context, evaluation)
  return { feedback, evaluation }
}

/**
 * Builds the mentor's words from an already computed evaluation. Splitting this
 * out lets the game store evaluate a move once and reuse the result for both the
 * behaviour tracker and the feedback.
 */
export function buildFeedbackFromEvaluation(
  move: Point,
  board: Board,
  context: MentorContext,
  evaluation: MoveEvaluation
): MentorFeedback {
  const color = context.color
  const moveLabel = inBounds(move) ? pointToLabel(move) : `${move.x},${move.y}`

  if (ILLEGAL_REASONS.has(evaluation.reason)) {
    const alternativeLabel = evaluation.bestAlternative
      ? pointToLabel(evaluation.bestAlternative)
      : undefined
    const feedback: MentorFeedback = {
      message: illegalMoveMessage(
        moveLabel,
        evaluation.reason as 'occupied' | 'suicide' | 'out-of-bounds' | 'ko'
      ),
      tone: 'gentle-correct',
      highlights: [
        { point: moveLabel, type: 'bad', label: '不能下这里' },
        ...(alternativeLabel
          ? [
              {
                point: alternativeLabel,
                type: 'comparison' as const,
                label: '试试这里'
              }
            ]
          : [])
      ],
      annotations: [],
      conceptTag: 'rules'
    }
    return feedback
  }

  // A pattern spotted across several moves outranks the single-move judgement,
  // unless the student just played a great move — then we let the praise land.
  if (context.tracker && evaluation.quality !== 'excellent') {
    const moment = detectTeachingMoment({
      board,
      tracker: context.tracker,
      color,
      moveLabel,
      profile: context.profile
    })
    if (moment) {
      const concerned =
        moment.type === 'tenuki-when-in-atari' || moment.type === 'ignoring-danger'
      const feedback: MentorFeedback = {
        message: `${moment.title}。${moment.explanation}\n${moment.suggestion}`,
        tone: concerned ? 'concerned' : 'teaching-moment',
        highlights: moment.highlights,
        annotations: [
          ...moment.annotations,
          { point: moveLabel, text: `气=${evaluation.liberties}`, style: 'number' }
        ],
        conceptTag: conceptTagForMoment(moment.type),
        teachingMoment: moment
      }
      return feedback
    }
  }

  const alternativeLabel = evaluation.bestAlternative
    ? pointToLabel(evaluation.bestAlternative)
    : undefined

  const tone = toneFor(evaluation)
  const scriptContext: ScriptContext = {
    color,
    moveLabel,
    turn: context.moveNumber,
    liberties: evaluation.liberties,
    capturedCount: evaluation.captured.length,
    capturedLabel: evaluation.captured[0] ? pointToLabel(evaluation.captured[0]) : '',
    atariGroups: evaluation.atariGroups,
    bestLabel: alternativeLabel,
    phase: context.phase,
    connected: evaluation.connected,
    edge: evaluation.edge,
    isolated: evaluation.isolated,
    lowLiberties: evaluation.liberties <= 2
  }

  const message = personalise(pickMessage(tone, scriptContext), evaluation, context.profile)
  const phaseContext = getPhaseContext(context.phase)

  const highlights: BoardHighlight[] = []
  const annotations: BoardAnnotation[] = []

  const mainType: HighlightType =
    evaluation.quality === 'mistake'
      ? 'danger'
      : evaluation.quality === 'excellent' || evaluation.quality === 'good'
        ? 'good'
        : 'neutral'

  highlights.push({ point: moveLabel, type: mainType, label: effectLabel(evaluation) })

  for (const stone of evaluation.captured) {
    highlights.push({ point: pointToLabel(stone), type: 'good', label: '提子' })
  }

  for (const target of evaluation.atariTargets) {
    highlights.push({
      point: pointToLabel(target),
      type: 'opportunity',
      label: '目标只剩 1 气'
    })
  }

  if (alternativeLabel) {
    highlights.push({ point: alternativeLabel, type: 'comparison', label: 'AI 会下这里' })
  }

  annotations.push({
    point: moveLabel,
    text: `气=${evaluation.liberties}`,
    style: 'number'
  })

  if (evaluation.captured.length > 0) {
    annotations.push({
      point: pointToLabel(evaluation.captured[0]),
      text: `提子 +${evaluation.captured.length}`,
      style: 'text-only'
    })
  }

  const showDemo = Boolean(
    alternativeLabel &&
      (evaluation.quality === 'mistake' ||
        evaluation.quality === 'suboptimal' ||
        (phaseContext.shouldDemoGoodMove && evaluation.quality === 'okay'))
  )

  if (alternativeLabel && !showDemo) {
    annotations.push({
      point: moveLabel,
      to: alternativeLabel,
      text: '更好的方向',
      style: 'arrow'
    })
  }

  const feedback: MentorFeedback = {
    message,
    tone,
    highlights,
    annotations,
    conceptTag: conceptTagFor(evaluation),
    scoreDelta:
      evaluation.captured.length > 0
        ? evaluation.captured.length + Math.round(evaluation.impact.territory)
        : undefined
  }

  if (showDemo && alternativeLabel) {
    feedback.demoMove = {
      point: alternativeLabel,
      color,
      opacity: 0.42,
      label: '高手会下这里'
    }
  }

  return feedback
}

function effectLabel(evaluation: MoveEvaluation): string | undefined {
  if (evaluation.captured.length > 0) return '提子！'
  if (evaluation.quality === 'excellent') return '好棋'
  if (evaluation.quality === 'good') return '扎实'
  if (evaluation.quality === 'mistake') return '危险'
  return undefined
}

function conceptTagFor(evaluation: MoveEvaluation): string {
  if (evaluation.captured.length > 0) return 'capture'
  if (evaluation.atariGroups > 0) return 'atari'
  if (evaluation.liberties <= 2) return 'liberty'
  // Connecting is a more specific lesson than "this gained influence".
  if (evaluation.connected) return 'connection'
  if (evaluation.impact.territory > 0) return 'territory'
  return 'shape'
}

function conceptTagForMoment(type: TeachingMomentType): string {
  switch (type) {
    case 'tenuki-when-in-atari':
    case 'ignoring-danger':
    case 'always-attacking':
      return 'liberty'
    case 'chasing-too-long':
    case 'repeating-atari':
      return 'atari'
    case 'always-defending':
      return 'territory'
  }
}

/**
 * Adds one personalised line: either a reminder about a weakness we already know
 * about, or a short nod that this concept has already been mastered.
 */
function personalise(
  message: string,
  evaluation: MoveEvaluation,
  profile?: ProfileDigest
): string {
  if (!profile) return message

  const weakness = WEAKNESS_LABELS[evaluation.reason]
  if (weakness && profile.weaknesses.includes(weakness)) {
    return `${message}\n对了——「${weakness}」这个毛病咱们之前聊过，这次又碰上了。改掉它，你的棋会稳一大截。`
  }

  const concept = conceptTagFor(evaluation)
  if (profile.conceptsMastered.includes(concept)) {
    const label = CONCEPT_LABELS[concept as keyof typeof CONCEPT_LABELS]
    return `${message}\n（「${label}」这块你已经掌握了，我就不啰嗦了。）`
  }

  return message
}
