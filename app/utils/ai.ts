import {
  BOARD_SIZE,
  emptyRegionSize,
  getGroup,
  getNeighbors,
  opponent,
  playMove,
  samePoint,
  type Board,
  type PlayOptions,
  type Point,
  type StoneColor
} from './goRules'

export interface MoveCandidate {
  point: Point
  score: number
  captures: number
  liberties: number
  savesGroup: boolean
  atariGroups: number
}

export interface AiOptions {
  /** Teaching phases may ask the mentor to hold back. */
  suboptimal?: boolean
  random?: () => number
  /** Point the AI may not play because of an active ko ban. */
  koPoint?: Point | null
}

const edgeDistance = (point: Point) =>
  Math.min(point.x, point.y, BOARD_SIZE - 1 - point.x, BOARD_SIZE - 1 - point.y)

/** Deterministic score for a single legal move. */
export function scoreMove(
  board: Board,
  color: StoneColor,
  point: Point,
  options: PlayOptions = {}
): MoveCandidate | null {
  const outcome = playMove(board, point, color, options)
  if (!outcome.ok) return null

  const enemy = opponent(color)
  const liberties = outcome.liberties
  let score = 0

  score += outcome.captured.length * 120

  if (liberties === 1) score -= 130
  else if (liberties === 2) score -= 6
  else score += Math.min(liberties, 6) * 2

  let ownNeighbors = 0
  let savesGroup = false
  for (const neighbor of getNeighbors(point)) {
    const value = board[neighbor.y][neighbor.x]
    if (value === color) {
      ownNeighbors++
      const before = getGroup(board, neighbor)
      if (before.liberties.length === 1 && liberties >= 2) savesGroup = true
    }
  }
  if (savesGroup) score += 68
  score += ownNeighbors * 5

  const atariSeen = new Set<string>()
  let atariGroups = 0
  for (const neighbor of getNeighbors(point)) {
    if (outcome.board[neighbor.y][neighbor.x] !== enemy) continue
    const group = getGroup(outcome.board, neighbor)
    if (group.liberties.length !== 1) continue
    const key = group.stones
      .map((stone) => `${stone.x},${stone.y}`)
      .sort()
      .join('|')
    if (atariSeen.has(key)) continue
    atariSeen.add(key)
    atariGroups++
  }
  score += atariGroups * 34

  const edge = edgeDistance(point)
  if (edge === 0) score -= 18
  else if (edge === 1) score -= 5

  const openArea = emptyRegionSize(board, point)
  score += Math.min(openArea, 40) * 0.35

  let nearestOwn = Infinity
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== color) continue
      nearestOwn = Math.min(nearestOwn, Math.abs(x - point.x) + Math.abs(y - point.y))
    }
  }
  if (ownNeighbors === 0 && nearestOwn >= 4) score -= 6

  return {
    point,
    score,
    captures: outcome.captured.length,
    liberties,
    savesGroup,
    atariGroups
  }
}

export function rankMoves(
  board: Board,
  color: StoneColor,
  options: PlayOptions = {}
): MoveCandidate[] {
  const candidates: MoveCandidate[] = []

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== null) continue
      const candidate = scoreMove(board, color, { x, y }, options)
      if (candidate) candidates.push(candidate)
    }
  }

  return candidates.sort((a, b) => b.score - a.score)
}

/**
 * Simple opponent AI: capture, save weak groups, otherwise extend / take open space.
 * Adds slight randomness among near-best moves so games differ.
 */
export function chooseAiMove(board: Board, color: StoneColor, options: AiOptions = {}): Point | null {
  const { koPoint, ...rest } = options
  const ranked = rankMoves(board, color, { koPoint })
  if (ranked.length === 0) return null

  const random = rest.random ?? Math.random

  if (rest.suboptimal) {
    const pool = ranked.slice(1, 4)
    if (pool.length > 0) return pool[Math.floor(random() * pool.length)].point
  }

  const best = ranked[0].score
  const nearBest = ranked.filter((candidate) => best - candidate.score <= 6).slice(0, 3)
  return nearBest[Math.floor(random() * nearBest.length)].point
}

/** Best move with the actual move excluded — used for the "stronger idea" comparison. */
export function bestAlternative(
  board: Board,
  color: StoneColor,
  played: Point,
  minGain = 12,
  options: PlayOptions = {}
): Point | undefined {
  const actual = scoreMove(board, color, played, options)
  const ranked = rankMoves(board, color, options)
  const alternative = ranked.find((candidate) => !samePoint(candidate.point, played))
  if (!alternative) return undefined
  if (actual && alternative.score - actual.score < minGain) return undefined
  return alternative.point
}
