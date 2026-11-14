import { pointToLabel, type Board, type Point, type StoneColor } from './goRules'
import type { MentorFeedback, MentorTone, MoveEvaluation } from './mentor'
import type { TeachingPhase } from './teaching'
import type { SessionTracker } from './sessionTracker'
import type { ProfileDigest, ProfileUpdate } from './profile'

export type MentorSource = 'template' | 'llm' | 'fallback'

export interface MentorApiEvaluation {
  quality: MoveEvaluation['quality']
  reason: string
  liberties: number
  captures: number
  atariGroups: number
  territory: number
  capturedLabels: string[]
  bestAlternative?: string
  connected: boolean
  edge: boolean
  isolated: boolean
}

/** Cross-move behaviour, so the model can talk about patterns, not single moves. */
export interface MentorApiTracker {
  chaseChainLength: number
  chaseChainStart: number | null
  atariPositions: string[]
  detections: {
    isRepeatingAtari: boolean
    isChasingTooLong: boolean
    isIgnoringDanger: boolean
    ignoredDangerCount: number
    isAlwaysDefending: boolean
    isAlwaysAttacking: boolean
    sameAreaPersistence: number
    tenukiWhenInAtari: boolean
  }
  awareness: {
    sawTheCapture: boolean
    sawTheDanger: boolean
    choseOptimal: boolean
  }
  dangerLabels: string[]
}

/** What the tutor remembers about this student. */
export interface MentorApiProfile {
  totalGames: number
  totalMoves: number
  overallLevel: number
  levelLabel: string
  skills: Record<string, number>
  tendencies: string[]
  weaknesses: string[]
  recentImprovements: string[]
  conceptsMastered: string[]
  conceptsStruggling: string[]
  currentFocusArea: string
  mentorNotes: string
}

/** Payload sent to `POST /api/mentor`. */
export interface MentorApiRequest {
  moveLabel: string
  color: StoneColor
  phase: TeachingPhase
  moveNumber: number
  tone: MentorTone
  conceptTag?: string
  templateMessage: string
  needsDeepExplanation: boolean
  evaluation: MentorApiEvaluation
  boardSummary: string
  allowedPoints: string[]
  /** Present when the tutor stopped to teach a pattern. */
  teachingMoment?: { type: string; title: string }
  tracker?: MentorApiTracker
  profile?: MentorApiProfile
}

export interface MentorApiResponse {
  message: string
  source: MentorSource
  /** Only set when `source` is `fallback`, useful for debugging the gateway. */
  reason?: string
  /** Optional, sanitised profile nudge proposed by the model. */
  profileUpdate?: ProfileUpdate
  /** One-line tactical read from the model, shown on the insight panel. */
  insight?: string
  /** Model-selected board points (already checked against the coordinate whitelist). */
  boardFocus?: string[]
}

/** GET /api/model-status — makes "is the model actually being called?" visible. */
export interface ModelStatus {
  configured: boolean
  online: boolean
  model: string
  /** Gateway host only; the API key never leaves the server. */
  gateway: string
  reason?: string
}

/** POST /api/board-review — an on-demand, model-driven read of the whole board. */
export interface BoardReviewRequest {
  boardSummary: string
  allowedPoints: string[]
  moveNumber: number
  candidates: { label: string; reason: string }[]
  advice: string
  lead: string
  dangerLabels: string[]
  /** Real KataGo search verdict, when the engine is installed. Facts, not guesses. */
  engineAnalysis?: string
}

export interface BoardReview {
  summary: string
  focusPoints: string[]
  lesson: string
}

export interface BoardReviewResponse {
  source: MentorSource
  reason?: string
  review?: BoardReview
}

/**
 * Only the interesting moments are worth a model call. Ordinary "okay" moves are
 * fully covered by the templates, so we skip the round-trip there.
 */
export function needsLlmExplanation(
  evaluation: MoveEvaluation,
  options: { teachingMoment?: boolean } = {}
): boolean {
  if (options.teachingMoment) return true
  if (evaluation.captured.length > 0) return true
  if (evaluation.atariGroups > 0) return true
  return (
    evaluation.quality === 'excellent' ||
    evaluation.quality === 'mistake' ||
    evaluation.quality === 'suboptimal'
  )
}

export function summarizeBoard(
  board: Board,
  color: StoneColor,
  moveLabel: string
): string {
  const labels: Record<StoneColor, string[]> = { black: [], white: [] }

  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      const stone = board[y][x]
      if (stone) labels[stone].push(pointToLabel({ x, y }))
    }
  }

  const yours = labels[color]
  const theirs = labels[color === 'black' ? 'white' : 'black']

  return [
    `棋盘：13×13，你执${color === 'black' ? '黑' : '白'}`,
    `你的棋：${yours.length > 0 ? yours.join(' ') : '（无）'}`,
    `AI 的棋：${theirs.length > 0 ? theirs.join(' ') : '（无）'}`,
    `这一手：${moveLabel}`
  ].join('\n')
}

export function toApiTracker(tracker: SessionTracker): MentorApiTracker {
  return {
    chaseChainLength: tracker.chaseChainLength,
    chaseChainStart: tracker.chaseChainStart,
    atariPositions: [...tracker.detections.atariPositions],
    detections: { ...tracker.detections },
    awareness: { ...tracker.awareness },
    dangerLabels: [...tracker.dangerLabels]
  }
}

export function toApiProfile(digest: ProfileDigest): MentorApiProfile {
  return {
    totalGames: digest.totalGames,
    totalMoves: digest.totalMoves,
    overallLevel: digest.overallLevel,
    levelLabel: digest.levelLabel,
    skills: { ...digest.skills },
    tendencies: [...digest.tendencies],
    weaknesses: [...digest.weaknesses],
    recentImprovements: [...digest.recentImprovements],
    conceptsMastered: [...digest.conceptsMastered],
    conceptsStruggling: [...digest.conceptsStruggling],
    currentFocusArea: digest.currentFocusArea,
    mentorNotes: digest.mentorNotes
  }
}

export function buildMentorRequest(args: {
  move: Point
  boardAfter: Board
  color: StoneColor
  phase: TeachingPhase
  moveNumber: number
  evaluation: MoveEvaluation
  feedback: MentorFeedback
  tracker?: SessionTracker
  profile?: ProfileDigest
}): MentorApiRequest {
  const moveLabel = pointToLabel(args.move)
  const { evaluation, feedback } = args

  const allowed = new Set<string>([moveLabel])
  for (let y = 0; y < args.boardAfter.length; y++) {
    for (let x = 0; x < args.boardAfter[y].length; x++) {
      if (args.boardAfter[y][x]) allowed.add(pointToLabel({ x, y }))
    }
  }
  const bestAlternative = evaluation.bestAlternative
    ? pointToLabel(evaluation.bestAlternative)
    : undefined
  if (bestAlternative) allowed.add(bestAlternative)
  for (const stone of evaluation.captured) allowed.add(pointToLabel(stone))
  for (const stone of args.feedback.teachingMoment?.highlights ?? []) allowed.add(stone.point)

  return {
    moveLabel,
    color: args.color,
    phase: args.phase,
    moveNumber: args.moveNumber,
    tone: feedback.tone,
    conceptTag: feedback.conceptTag,
    templateMessage: feedback.message,
    needsDeepExplanation: needsLlmExplanation(evaluation, {
      teachingMoment: Boolean(feedback.teachingMoment)
    }),
    evaluation: {
      quality: evaluation.quality,
      reason: evaluation.reason,
      liberties: evaluation.liberties,
      captures: evaluation.captured.length,
      atariGroups: evaluation.atariGroups,
      territory: evaluation.impact.territory,
      capturedLabels: evaluation.captured.map((stone) => pointToLabel(stone)),
      bestAlternative,
      connected: evaluation.connected,
      edge: evaluation.edge,
      isolated: evaluation.isolated
    },
    boardSummary: summarizeBoard(args.boardAfter, args.color, moveLabel),
    allowedPoints: [...allowed],
    teachingMoment: feedback.teachingMoment
      ? { type: feedback.teachingMoment.type, title: feedback.teachingMoment.title }
      : undefined,
    tracker: args.tracker ? toApiTracker(args.tracker) : undefined,
    profile: args.profile ? toApiProfile(args.profile) : undefined
  }
}
