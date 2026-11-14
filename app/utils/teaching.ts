import { BOARD_SIZE, getGroup, pointToLabel, type Board, type StoneColor } from './goRules'
import { getEmptyRegions } from './scoring'

export type TeachingPhase =
  | 'free-play'
  | 'teaching-liberty'
  | 'teaching-capture'
  | 'teaching-territory'

export interface PhaseContext {
  focusConcept: 'liberty' | 'capture' | 'territory' | 'shape'
  shouldHighlightLiberties: boolean
  shouldDemoGoodMove: boolean
  aiPlaysSuboptimally: boolean
  praiseCapture: boolean
  intro: string
  /** Read from the actual board, not a canned sentence. */
  boardHint?: string
}

export const TEACHING_PHASES: { value: TeachingPhase; label: string }[] = [
  { value: 'free-play', label: '自由对局' },
  { value: 'teaching-liberty', label: '学「气」' },
  { value: 'teaching-capture', label: '学提子' },
  { value: 'teaching-territory', label: '学围地' }
]

interface WeakGroup {
  label: string
  liberties: number
  escape?: string
}

/** The student's (black) or the opponent's group with the fewest liberties. */
function weakestGroup(board: Board, color: StoneColor): WeakGroup | null {
  const seen = new Set<string>()
  let weakest: WeakGroup | null = null

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== color) continue
      const key = `${x},${y}`
      if (seen.has(key)) continue

      const group = getGroup(board, { x, y })
      for (const stone of group.stones) seen.add(`${stone.x},${stone.y}`)
      if (!weakest || group.liberties.length < weakest.liberties) {
        weakest = {
          label: pointToLabel(group.stones[0]),
          liberties: group.liberties.length,
          escape: group.liberties.length === 1 ? pointToLabel(group.liberties[0]) : undefined
        }
      }
    }
  }
  return weakest
}

function largestOpenArea(board: Board): { label: string; size: number } | null {
  let largest: { label: string; size: number } | null = null
  for (const region of getEmptyRegions(board)) {
    if (region.borders.length > 1) continue // contested area — not a lesson for beginners
    const anchor = region.points[0]
    if (!anchor) continue
    if (!largest || region.points.length > largest.size) {
      largest = { label: pointToLabel(anchor), size: region.points.length }
    }
  }
  return largest
}

/**
 * Phase settings are static, but the hint is derived from the current board:
 * the teaching phase now actually looks at the position instead of ignoring it.
 */
export function boardHintFor(phase: TeachingPhase, board: Board, humanColor: StoneColor = 'black'): string | undefined {
  if (phase === 'teaching-liberty') {
    const own = weakestGroup(board, humanColor)
    if (!own) return '棋盘还空着，先落一子，咱们再一起数它的气。'
    return `现在盘上最该数的是 ${own.label} 这块：只剩 ${own.liberties} 口气${own.escape ? `，气点在 ${own.escape}` : ''}。`
  }

  if (phase === 'teaching-capture') {
    const enemy = weakestGroup(board, humanColor === 'black' ? 'white' : 'black')
    if (!enemy) return '对方还没落子，先自己摆一块，等它靠近再练提子。'
    if (enemy.liberties === 1 && enemy.escape) {
      return `机会就在眼前：对方 ${enemy.label} 只剩 1 气，落在 ${enemy.escape} 就能提掉。`
    }
    return `对方 ${enemy.label} 还有 ${enemy.liberties} 口气，先把它的气一个个堵掉。`
  }

  if (phase === 'teaching-territory') {
    const open = largestOpenArea(board)
    if (!open || open.size < 4) return '先去角上落子，用棋子把一小块空地围起来。'
    return `${open.label} 附近有一片约 ${open.size} 点的空地，先看谁能把它围住。`
  }

  return undefined
}

export function getPhaseContext(phase: TeachingPhase, board?: Board, humanColor: StoneColor = 'black'): PhaseContext {
  const base: PhaseContext = (() => {
    switch (phase) {
      case 'teaching-liberty':
        return {
          focusConcept: 'liberty',
          shouldHighlightLiberties: true,
          shouldDemoGoodMove: true,
          aiPlaysSuboptimally: true,
          praiseCapture: false,
          intro: '这一阶段我们只盯一件事：数「气」。每颗子上下左右连着的空点，就是它的气。气没了，子就被提走。'
        }
      case 'teaching-capture':
        return {
          focusConcept: 'capture',
          shouldHighlightLiberties: true,
          shouldDemoGoodMove: false,
          aiPlaysSuboptimally: true,
          praiseCapture: true,
          intro: '现在练习提子：把对方一块棋的最后一口气堵住，就能把它整块拿走。找找看哪里能提。'
        }
      case 'teaching-territory':
        return {
          focusConcept: 'territory',
          shouldHighlightLiberties: false,
          shouldDemoGoodMove: true,
          aiPlaysSuboptimally: false,
          praiseCapture: false,
          intro: '这一阶段看「地」：空点被一种颜色完全围住，就算那方的目。别急着打架，先圈出最大的空地。'
        }
      default:
        return {
          focusConcept: 'shape',
          shouldHighlightLiberties: true,
          shouldDemoGoodMove: true,
          aiPlaysSuboptimally: false,
          praiseCapture: true,
          intro: ''
        }
    }
  })()

  return board ? { ...base, boardHint: boardHintFor(phase, board, humanColor) } : base
}
