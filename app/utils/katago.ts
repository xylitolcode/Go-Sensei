import {
  BOARD_SIZE,
  playMove,
  pointToLabel,
  type Board,
  type Point,
  type StoneColor
} from './goRules'

/**
 * Bridge between this app's coordinate system and KataGo's Analysis Engine.
 *
 * TWO COORDINATE SYSTEMS COEXIST HERE — this is the #1 integration trap:
 *   - This app labels 13 columns A..M, INCLUDING the letter I (see goRules.ts).
 *   - GTP / KataGo skips I: A B C D E F G H J K L M N.
 * So column 9 is "I7" locally but "J7" for KataGo. Array indices, however,
 * line up 1:1 — only the *label strings* need translating. Ownership maps are
 * row-major from top-left (A13) to bottom-right (N1), while board[y][x] has
 * y=0 at the top, so `ownership[y * 13 + x]` maps directly to board[y][x].
 */

export const GTP_COLUMNS = 'ABCDEFGHJKLMN'.split('')

/** App point -> GTP label (skips I). */
export function toGtpLabel(point: Point): string {
  const letter = GTP_COLUMNS[point.x]
  if (!letter) return ''
  return `${letter}${BOARD_SIZE - point.y}`
}

/** GTP label -> app point. Returns null for "pass" and anything malformed. */
export function fromGtpLabel(label: string): Point | null {
  const text = label.trim().toUpperCase()
  if (!text || text === 'PASS') return null
  const match = /^([A-HJ-N])(1[0-3]|[1-9])$/.exec(text)
  if (!match) return null
  const x = GTP_COLUMNS.indexOf(match[1])
  const y = BOARD_SIZE - Number(match[2])
  if (x < 0 || y < 0 || y >= BOARD_SIZE) return null
  return { x, y }
}

/** GTP label -> this app's label (with I), so board markers land on the right spot. */
export function gtpToAppLabel(label: string): string {
  if (label.trim().toUpperCase() === 'PASS') return 'pass'
  const point = fromGtpLabel(label)
  return point ? pointToLabel(point) : label
}

/**
 * The app uses Chinese area counting with a 3¼-stone komi (DEFAULT_KOMI).
 * KataGo expects komi in points and only accepts integers or half-integers,
 * so 3.25 stones == 6.5 points.
 */
export function stonesToGtpKomi(komiStones = 3.25): number {
  const points = komiStones * 2
  return Math.round(points * 2) / 2
}

export interface KatagoQueryMove {
  color: StoneColor
  /** null == pass */
  point: Point | null
}

export interface AnalysisQueryArgs {
  id: string
  board: Board
  /** Real move history, preferred: it preserves ko and gives the net history features. */
  moves: KatagoQueryMove[]
  nextColor: StoneColor
  komiStones?: number
  maxVisits?: number
  includeOwnership?: boolean
  /** Asks KataGo for the raw policy / humanPolicy arrays (needed for rank play). */
  includePolicy?: boolean
}

/** One-line JSON query for KataGo's stdin (multi-line JSON is NOT supported). */
export function buildAnalysisQuery(args: AnalysisQueryArgs): Record<string, unknown> {
  const history = args.moves.map((move) => [
    move.color === 'black' ? 'B' : 'W',
    move.point ? toGtpLabel(move.point) : 'pass'
  ])

  const query: Record<string, unknown> = {
    id: args.id,
    rules: 'chinese',
    komi: stonesToGtpKomi(args.komiStones),
    boardXSize: BOARD_SIZE,
    boardYSize: BOARD_SIZE,
    maxVisits: Math.max(1, Math.min(5000, args.maxVisits ?? 200)),
    analysisPVLen: 8,
    includeOwnership: args.includeOwnership ?? true,
    includePolicy: args.includePolicy ?? false
  }

  if (history.length > 0) {
    query.moves = history
  } else {
    // Position with no history (e.g. restored board): place stones directly.
    query.moves = []
    query.initialStones = boardToInitialStones(args.board)
    query.initialPlayer = args.nextColor === 'black' ? 'B' : 'W'
  }
  return query
}

function boardToInitialStones(board: Board): [string, string][] {
  const stones: [string, string][] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = board[y]?.[x]
      if (cell) stones.push([cell === 'black' ? 'B' : 'W', toGtpLabel({ x, y })])
    }
  }
  return stones
}

/* ------------------------------------------------------------------ */
/* Response types + normalisation                                      */
/* ------------------------------------------------------------------ */

export interface KatagoRawMove {
  move: string
  visits?: number
  winrate?: number
  scoreLead?: number
  prior?: number
  /** Human SL policy for this move, when a -human-model is loaded. */
  humanPrior?: number
  order?: number
  pv?: string[]
}

export interface KatagoRawResponse {
  id?: string
  isDuringSearch?: boolean
  turnNumber?: number
  error?: string
  warning?: string
  moveInfos?: KatagoRawMove[]
  ownership?: number[]
  /**
   * Length boardXSize*boardYSize + 1, row-major from top-left. -1 marks an
   * illegal move, the last entry is "pass". Only present with includePolicy
   * AND a -human-model loaded with a humanSLProfile override.
   */
  humanPolicy?: number[]
  rootInfo?: {
    winrate?: number
    scoreLead?: number
    visits?: number
    currentPlayer?: string
  }
  /** query_version echo */
  version?: string
  git_hash?: string
  noResults?: boolean
}

export interface KatagoMove {
  /** App label (with I), ready for labelToPoint(). */
  label: string
  /** Black's win probability, 0..1. */
  winrate: number
  /** Black's lead in points after this move. */
  scoreLead: number
  visits: number
  prior: number
  order: number
  pv: string[]
}

export interface KatagoAnalysis {
  bestMove: string
  topMoves: KatagoMove[]
  /** Black's win probability at the root. */
  blackWinrate: number
  /** Black's lead in points at the root. */
  blackLead: number
  currentPlayer: StoneColor
  /** 169 values, index y*13+x, positive == black territory. */
  ownership: number[]
  visits: number
}

export interface KatagoStatus {
  configured: boolean
  available: boolean
  version?: string
  model?: string
  /** True when the human SL net is loaded, i.e. ranks are genuine. */
  humanModel?: boolean
  reason?: string
}

export interface KatagoAnalyzeResponse {
  source: 'katago' | 'unavailable'
  reason?: string
  analysis?: KatagoAnalysis
}

export type KatagoFailure =
  | 'not-configured'
  | 'missing-files'
  | 'spawn-failed'
  | 'timeout'
  | 'engine-error'
  | 'invalid-reply'
  | 'exited'

/**
 * KataGo's docs do not state whether +1 ownership means black or the side to
 * move, so we calibrate against stones already on the board: black stones
 * should, on average, be more black-owned than white stones. This is robust
 * on any real midgame position and avoids hard-coding an undocumented sign.
 */
export function calibrateOwnership(ownership: number[], board: Board): 1 | -1 {
  let blackSum = 0
  let blackCount = 0
  let whiteSum = 0
  let whiteCount = 0
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const value = ownership[y * BOARD_SIZE + x]
      if (typeof value !== 'number') continue
      const cell = board[y]?.[x]
      if (cell === 'black') {
        blackSum += value
        blackCount++
      } else if (cell === 'white') {
        whiteSum += value
        whiteCount++
      }
    }
  }
  if (!blackCount || !whiteCount) return 1
  return blackSum / blackCount >= whiteSum / whiteCount ? 1 : -1
}

/**
 * The generated analysis.cfg fixes `reportAnalysisWinratesAs = BLACK`, so
 * winrate/scoreLead arrive already in black's perspective. `winrateAsBlack`
 * can be set to false for a hand-written config using SIDETOMOVE.
 */
export function normalizeAnalysis(
  raw: KatagoRawResponse,
  board: Board,
  options: { winrateAsBlack?: boolean; ownershipSign?: 1 | -1 } = {}
): KatagoAnalysis | null {
  if (!raw || raw.error || raw.isDuringSearch === true) return null
  if (!Array.isArray(raw.moveInfos) || !raw.rootInfo) return null

  const currentPlayer: StoneColor = raw.rootInfo.currentPlayer === 'W' ? 'white' : 'black'
  const asBlack = options.winrateAsBlack ?? true
  const flip = !asBlack && currentPlayer === 'white'
  const toBlackWinrate = (value: number) => (flip ? 1 - value : value)
  const toBlackLead = (value: number) => (flip ? -value : value)

  const topMoves: KatagoMove[] = raw.moveInfos
    .filter((move) => typeof move.move === 'string' && move.move.toUpperCase() !== 'PASS')
    .slice(0, 8)
    .map((move, index) => ({
      label: gtpToAppLabel(move.move),
      winrate: toBlackWinrate(move.winrate ?? 0),
      scoreLead: toBlackLead(move.scoreLead ?? 0),
      visits: move.visits ?? 0,
      prior: move.prior ?? 0,
      order: move.order ?? index,
      pv: (move.pv ?? []).slice(0, 6).map(gtpToAppLabel)
    }))

  const ownershipRaw = Array.isArray(raw.ownership) ? raw.ownership : []
  const sign = options.ownershipSign ?? calibrateOwnership(ownershipRaw, board)
  const ownership = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) =>
    Math.max(-1, Math.min(1, (ownershipRaw[index] ?? 0) * sign))
  )

  return {
    bestMove: topMoves[0]?.label ?? '',
    topMoves,
    blackWinrate: toBlackWinrate(raw.rootInfo.winrate ?? 0.5),
    blackLead: toBlackLead(raw.rootInfo.scoreLead ?? 0),
    currentPlayer,
    ownership,
    visits: raw.rootInfo.visits ?? 0
  }
}

/**
 * Facts, not prose. Fed into the mentor prompt so the LLM explains a real
 * engine verdict instead of being asked to invent winrates or count liberties.
 */
export function describeForMentor(analysis: KatagoAnalysis): string {
  const percent = Math.round(analysis.blackWinrate * 100)
  const leader = analysis.blackLead >= 0 ? '黑' : '白'
  const moves = analysis.topMoves
    .slice(0, 3)
    .map(
      (move, index) =>
        `${index + 1}. ${move.label}（黑胜率 ${Math.round(move.winrate * 100)}%，黑目差 ${move.scoreLead.toFixed(1)}）`
    )
    .join('；')
  const pv = analysis.topMoves[0]?.pv?.length
    ? ` · 主变化 ${analysis.topMoves[0].pv.slice(0, 5).join(' → ')}`
    : ''
  return [
    `【引擎实测 · KataGo 搜索 ${analysis.visits} 次】`,
    `当前黑方胜率 ${percent}%，${leader}领先约 ${Math.abs(analysis.blackLead).toFixed(1)} 目。`,
    `最佳落点 ${analysis.bestMove}；候选：${moves}${pv}。`,
    `轮到${analysis.currentPlayer === 'black' ? '黑' : '白'}走。`
  ].join('\n')
}

/* ------------------------------------------------------------------ */
/* Opponent rank: KataGo actually plays white, at a chosen strength     */
/* ------------------------------------------------------------------ */

export type OpponentRank = '15k' | '10k' | '5k' | '1k' | '1d' | '3d' | '5d' | 'pro'

export interface RankProfile {
  rank: OpponentRank
  label: string
  /** null = skip the human SL net and play the engine's best move. */
  humanSLProfile: string | null
  /** <1 sharpens the human policy distribution (stronger, less varied). */
  temperature: number
  /** Search budget when the human SL model is not installed. */
  visits: number
  /** How many engine candidates that fallback may sample from. */
  topK: number
}

/**
 * `rank_20k`..`rank_9d` are KataGo's official human-SL profiles (modern
 * opening style). Strength is NOT faked by lowering visits: with the human
 * model loaded we sample `humanPolicy` at a rank-dependent temperature,
 * which is exactly the recipe in docs/Analysis_Engine.md#human-like-play.
 */
export const RANK_PROFILES: RankProfile[] = [
  { rank: '15k', label: '15 级', humanSLProfile: 'rank_15k', temperature: 1, visits: 8, topK: 8 },
  { rank: '10k', label: '10 级', humanSLProfile: 'rank_10k', temperature: 0.95, visits: 16, topK: 7 },
  { rank: '5k', label: '5 级', humanSLProfile: 'rank_5k', temperature: 0.85, visits: 32, topK: 6 },
  { rank: '1k', label: '1 级', humanSLProfile: 'rank_1k', temperature: 0.7, visits: 64, topK: 5 },
  { rank: '1d', label: '1 段', humanSLProfile: 'rank_1d', temperature: 0.55, visits: 128, topK: 4 },
  { rank: '3d', label: '3 段', humanSLProfile: 'rank_3d', temperature: 0.4, visits: 256, topK: 3 },
  { rank: '5d', label: '5 段', humanSLProfile: 'rank_5d', temperature: 0.3, visits: 500, topK: 2 },
  { rank: 'pro', label: '引擎全力', humanSLProfile: null, temperature: 0, visits: 800, topK: 1 }
]

export const DEFAULT_OPPONENT_RANK: OpponentRank = '5k'

export function normalizeOpponentRank(value: unknown): OpponentRank {
  const text = typeof value === 'string' ? value.trim() : ''
  return RANK_PROFILES.find((profile) => profile.rank === text)?.rank ?? DEFAULT_OPPONENT_RANK
}

export function rankProfile(value: unknown): RankProfile {
  const rank = normalizeOpponentRank(value)
  return RANK_PROFILES.find((profile) => profile.rank === rank) ?? RANK_PROFILES[2]
}

export interface PlayQueryArgs extends AnalysisQueryArgs {
  profile: RankProfile
  /** True when the engine was started with `-human-model`. */
  humanModel: boolean
}

/**
 * A play query differs from an analysis query: it needs the raw human policy
 * (not ownership), and `humanSLProfile` MUST live inside `overrideSettings` —
 * as a top-level key KataGo silently ignores it and may warn.
 */
export function buildPlayQuery(args: PlayQueryArgs): Record<string, unknown> {
  const humanMode = args.humanModel && args.profile.humanSLProfile !== null
  const query = buildAnalysisQuery({
    ...args,
    // >50 visits so the main engine can reliably detect when to pass; the
    // human model on its own is known to pass too early at weak ranks.
    maxVisits: humanMode ? 64 : args.profile.visits,
    includeOwnership: false,
    includePolicy: humanMode
  })
  if (humanMode) {
    query.overrideSettings = {
      humanSLProfile: args.profile.humanSLProfile,
      ignorePreRootHistory: false
    }
  }
  return query
}

export interface KatagoPlayChoice {
  point: Point | null
  /** App label (with I); null when passing. */
  label: string | null
  decision: 'move' | 'pass'
  mode: 'human-sl' | 'search'
  candidates: number
}

export interface KatagoPlayResponse {
  source: 'katago' | 'unavailable'
  reason?: string
  point?: Point | null
  label?: string | null
  decision?: 'move' | 'pass'
  rank?: OpponentRank
  mode?: 'human-sl' | 'search'
}

function weightedPick<T>(
  items: { value: T; weight: number }[],
  random: () => number
): T | null {
  const usable = items.filter((item) => Number.isFinite(item.weight) && item.weight > 0)
  if (usable.length === 0) return null
  const total = usable.reduce((sum, item) => sum + item.weight, 0)
  let roll = random() * total
  for (const item of usable) {
    roll -= item.weight
    if (roll <= 0) return item.value
  }
  return usable[usable.length - 1].value
}

/**
 * Picks a LEGAL move for `color`. All candidates are re-checked against the
 * local rule engine (ko / suicide / occupied) — never trust a neural net to
 * know the position. Deterministic when `random` is injected (unit tests).
 */
export function chooseKatagoMove(
  raw: KatagoRawResponse,
  options: {
    board: Board
    color: StoneColor
    koPoint: Point | null
    profile: RankProfile
    humanMode: boolean
    random?: () => number
  }
): KatagoPlayChoice | null {
  if (!raw || raw.error || !Array.isArray(raw.moveInfos)) return null
  const random = options.random ?? Math.random
  const legal = (point: Point) =>
    playMove(options.board, point, options.color, { koPoint: options.koPoint }).ok

  const top = raw.moveInfos.find((move) => move.order === 0) ?? raw.moveInfos[0]
  const searchedEnough = (raw.rootInfo?.visits ?? 0) >= 50
  if (top && top.move.toUpperCase() === 'PASS' && searchedEnough) {
    return {
      point: null,
      label: null,
      decision: 'pass',
      mode: options.humanMode ? 'human-sl' : 'search',
      candidates: 0
    }
  }

  if (options.humanMode && Array.isArray(raw.humanPolicy)) {
    const exponent = options.profile.temperature > 0 ? 1 / options.profile.temperature : 1
    const candidates: { value: Point; weight: number }[] = []
    for (let index = 0; index < BOARD_SIZE * BOARD_SIZE; index++) {
      const probability = raw.humanPolicy[index]
      // -1 marks illegal moves in KataGo's policy arrays.
      if (typeof probability !== 'number' || probability <= 0) continue
      const point = { x: index % BOARD_SIZE, y: Math.floor(index / BOARD_SIZE) }
      if (!legal(point)) continue
      candidates.push({ value: point, weight: Math.pow(probability, exponent) })
    }
    const picked = weightedPick(candidates, random)
    if (picked) {
      return {
        point: picked,
        label: pointToLabel(picked),
        decision: 'move',
        mode: 'human-sl',
        candidates: candidates.length
      }
    }
  }

  // No human model: approximate the rank with a bounded search + a softmax
  // over the mover's winrate. The cfg reports everything from BLACK's side.
  const engineMoves = raw.moveInfos
    .filter((move) => typeof move.move === 'string' && move.move.toUpperCase() !== 'PASS')
    .slice(0, Math.max(1, options.profile.topK))
    .map((move) => ({
      point: fromGtpLabel(move.move),
      score:
        options.color === 'black' ? (move.winrate ?? 0.5) : 1 - (move.winrate ?? 0.5)
    }))
    .filter(
      (candidate): candidate is { point: Point; score: number } =>
        candidate.point !== null && legal(candidate.point)
    )
  if (engineMoves.length === 0) return null

  const best = Math.max(...engineMoves.map((candidate) => candidate.score))
  const spread = 0.02 + 0.08 * options.profile.temperature
  const picked = weightedPick(
    engineMoves.map((candidate) => ({
      value: candidate.point,
      weight: Math.exp((candidate.score - best) / spread)
    })),
    random
  )
  if (!picked) return null
  return {
    point: picked,
    label: pointToLabel(picked),
    decision: 'move',
    mode: 'search',
    candidates: engineMoves.length
  }
}
