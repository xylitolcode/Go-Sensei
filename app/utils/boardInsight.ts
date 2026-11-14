import {
  BOARD_SIZE,
  getAtariGroups,
  getGroup,
  opponent,
  pointToLabel,
  type Board,
  type Point,
  type StoneColor
} from './goRules'
import { rankMoves, type MoveCandidate } from './ai'
import { estimateInfluence } from './scoring'

/**
 * A deterministic, local read of the whole position. This is the layer that
 * powers the "smart board": liberties of every group, influence, the top
 * candidate moves and the urgent threats. It never guesses — everything here
 * is derived from the rules engine, so the board can show it on every turn
 * without waiting for a model round-trip.
 */

export type Urgency = 'critical' | 'warning' | 'safe'

export interface GroupInsight {
  /** Label of the anchor stone — where the liberty badge is drawn. */
  label: string
  color: StoneColor
  size: number
  liberties: number
  libertyLabels: string[]
  urgency: Urgency
  stones: Point[]
  anchor: Point
  /** The single liberty of an atari group: the capture / escape point. */
  escapeLabel?: string
}

export interface CandidateInsight {
  label: string
  score: number
  reason: string
  tags: string[]
  risky: boolean
}

export interface TerritoryCell {
  x: number
  y: number
  color: StoneColor
}

export interface CaptureChance {
  /** Colour of the group in atari. */
  color: StoneColor
  label: string
  /** Point that would capture it (or let it escape). */
  at: string
  size: number
  forHuman: boolean
}

export interface BoardInsight {
  groups: GroupInsight[]
  critical: GroupInsight[]
  warnings: GroupInsight[]
  candidates: CandidateInsight[]
  territory: TerritoryCell[]
  influence: { black: number; white: number }
  stones: { black: number; white: number }
  lead: { color: StoneColor | 'even'; points: number; label: string }
  captureChances: CaptureChance[]
  advice: string
}

const urgencyOf = (liberties: number): Urgency =>
  liberties <= 1 ? 'critical' : liberties === 2 ? 'warning' : 'safe'

/** Walks every stone exactly once and collects the connected groups. */
export function collectGroups(board: Board): GroupInsight[] {
  const seen = new Set<string>()
  const groups: GroupInsight[] = []

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const color = board[y][x]
      if (!color) continue
      const key = `${x},${y}`
      if (seen.has(key)) continue

      const group = getGroup(board, { x, y })
      for (const stone of group.stones) seen.add(`${stone.x},${stone.y}`)

      const anchor = group.stones[0]
      const escapeLabel =
        group.liberties.length === 1 ? pointToLabel(group.liberties[0]) : undefined

      groups.push({
        label: pointToLabel(anchor),
        color,
        size: group.stones.length,
        liberties: group.liberties.length,
        libertyLabels: group.liberties.map(pointToLabel),
        urgency: urgencyOf(group.liberties.length),
        stones: group.stones,
        anchor,
        escapeLabel
      })
    }
  }

  return groups
}

/** Human-readable reason for a candidate move, derived from its score parts. */
export function describeCandidate(candidate: MoveCandidate): {
  reason: string
  tags: string[]
  risky: boolean
} {
  const tags: string[] = []
  const parts: string[] = []

  if (candidate.captures > 0) {
    tags.push(`提${candidate.captures}`)
    parts.push(`可提掉对方 ${candidate.captures} 子`)
  }
  if (candidate.savesGroup) {
    tags.push('救棋')
    parts.push('把自己快没气的棋长出来')
  }
  if (candidate.atariGroups > 0) {
    tags.push(`叫吃${candidate.atariGroups}`)
    parts.push(`让对方 ${candidate.atariGroups} 块棋只剩 1 气`)
  }

  if (parts.length === 0) {
    if (candidate.liberties >= 4) parts.push('落在这里气很宽，容易做活')
    else parts.push('往外扩张，顺手占住空点')
    tags.push(candidate.liberties >= 4 ? '厚实' : '扩张')
  }

  return {
    reason: parts.join('，'),
    tags,
    risky: candidate.liberties <= 1
  }
}

export function analyzeBoard(
  board: Board,
  nextColor: StoneColor,
  humanColor: StoneColor = 'black',
  koPoint: Point | null = null
): BoardInsight {
  const groups = collectGroups(board)
  const critical = groups.filter((group) => group.urgency === 'critical')
  const warnings = groups.filter((group) => group.urgency === 'warning')

  const candidates: CandidateInsight[] = rankMoves(board, nextColor, { koPoint })
    .slice(0, 3)
    .map((candidate) => ({
      label: pointToLabel(candidate.point),
      score: Math.round(candidate.score),
      ...describeCandidate(candidate)
    }))

  const influenceEstimate = estimateInfluence(board, 3)
  const territory: TerritoryCell[] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const owner = influenceEstimate.owner[y][x]
      if (owner) territory.push({ x, y, color: owner })
    }
  }

  const stones = { black: 0, white: 0 }
  for (const row of board) {
    for (const cell of row) if (cell) stones[cell]++
  }

  const blackPoints = stones.black + influenceEstimate.black
  // 13×13 Chinese rules: black compensates white for moving first.
  const whitePoints = stones.white + influenceEstimate.white + 3.25
  const margin = blackPoints - whitePoints
  const lead: BoardInsight['lead'] = {
    color: Math.abs(margin) < 3 ? 'even' : margin > 0 ? 'black' : 'white',
    points: Math.round(Math.abs(margin) * 10) / 10,
    label:
      Math.abs(margin) < 3
        ? '势均力敌'
        : margin > 0
          ? `黑棋局面略优 ${Math.abs(margin).toFixed(1)} 点`
          : `白棋局面略优 ${Math.abs(margin).toFixed(1)} 点`
  }

  const captureChances: CaptureChance[] = []
  for (const color of ['black', 'white'] as StoneColor[]) {
    for (const group of getAtariGroups(board, color)) {
      const liberty = group.liberties[0]
      if (!liberty) continue
      captureChances.push({
        color,
        label: pointToLabel(group.stones[0]),
        at: pointToLabel(liberty),
        size: group.stones.length,
        forHuman: color === humanColor
      })
    }
  }

  const ownCritical = critical.filter((group) => group.color === humanColor)
  const enemyCritical = critical.filter((group) => group.color === opponent(humanColor))
  let advice: string
  if (ownCritical.length > 0) {
    const group = ownCritical[0]
    advice = `你 ${group.label} 这块只剩 1 气，优先处理：补在 ${group.escapeLabel ?? '它唯一的空点'} 就能长气。`
  } else if (enemyCritical.length > 0) {
    const group = enemyCritical[0]
    advice = `机会来了：白棋 ${group.label} 只剩 1 气，下在 ${group.escapeLabel ?? '它的气点'} 就能提 ${group.size} 子。`
  } else if (warnings.some((group) => group.color === humanColor)) {
    const group = warnings.find((group) => group.color === humanColor)!
    advice = `你 ${group.label} 只剩 2 气，还没到危险，但先记住这口气在哪。`
  } else if (candidates.length > 0) {
    advice = `局面没有紧急危险。看看棋盘上标出的 AI 前 3 选点，首选 ${candidates[0].label}：${candidates[0].reason}。`
  } else {
    advice = '棋盘还很空，先占角、再占边，别急着贴身打架。'
  }

  return {
    groups,
    critical,
    warnings,
    candidates,
    territory,
    influence: { black: influenceEstimate.black, white: influenceEstimate.white },
    stones,
    lead,
    captureChances,
    advice
  }
}
