export type StoneColor = 'black' | 'white'
export type Cell = StoneColor | null
export type Board = Cell[][]

export const BOARD_SIZE = 13
export const COLUMN_LETTERS = 'ABCDEFGHIJKLM'.split('')

export interface Point {
  x: number
  y: number
}

export interface Group {
  color: StoneColor
  stones: Point[]
  liberties: Point[]
}

export type IllegalReason = 'occupied' | 'out-of-bounds' | 'suicide' | 'ko'

export interface PlayOptions {
  /**
   * The single point the current player is forbidden to play because the opponent
   * just captured one stone and created a ko. `null` means no ko is active.
   */
  koPoint?: Point | null
}

export type MoveOutcome =
  | { ok: true; board: Board; captured: Point[]; liberties: number }
  | { ok: false; reason: IllegalReason }

export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => Array<Cell>(BOARD_SIZE).fill(null))
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row])
}

export function inBounds(point: Point): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < BOARD_SIZE && point.y < BOARD_SIZE
}

export function opponent(color: StoneColor): StoneColor {
  return color === 'black' ? 'white' : 'black'
}

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y
}

export function getNeighbors(point: Point): Point[] {
  const candidates: Point[] = [
    { x: point.x - 1, y: point.y },
    { x: point.x + 1, y: point.y },
    { x: point.x, y: point.y - 1 },
    { x: point.x, y: point.y + 1 }
  ]
  return candidates.filter(inBounds)
}

export function getGroup(board: Board, start: Point): Group {
  const color = board[start.y][start.x]
  if (!color) return { color: 'black', stones: [], liberties: [] }

  const stones: Point[] = []
  const libertyMap = new Map<string, Point>()
  const visited = new Set<string>([`${start.x},${start.y}`])
  const queue: Point[] = [start]

  while (queue.length > 0) {
    const current = queue.shift()!
    stones.push(current)

    for (const neighbor of getNeighbors(current)) {
      const value = board[neighbor.y][neighbor.x]
      if (value === null) {
        libertyMap.set(`${neighbor.x},${neighbor.y}`, neighbor)
      } else if (value === color) {
        const key = `${neighbor.x},${neighbor.y}`
        if (!visited.has(key)) {
          visited.add(key)
          queue.push(neighbor)
        }
      }
    }
  }

  return { color, stones, liberties: [...libertyMap.values()] }
}

export function countLiberties(board: Board, point: Point): number {
  if (!board[point.y]?.[point.x]) return 0
  return getGroup(board, point).liberties.length
}

/**
 * Places a stone and resolves captures. Suicide is rejected; the ko ban is
 * enforced through `options.koPoint` (see `detectKoPoint`).
 */
export function playMove(
  board: Board,
  point: Point,
  color: StoneColor,
  options: PlayOptions = {}
): MoveOutcome {
  if (!inBounds(point)) return { ok: false, reason: 'out-of-bounds' }
  if (board[point.y][point.x] !== null) return { ok: false, reason: 'occupied' }
  if (options.koPoint && samePoint(options.koPoint, point)) {
    return { ok: false, reason: 'ko' }
  }

  const next = cloneBoard(board)
  next[point.y][point.x] = color

  const enemy = opponent(color)
  const captured: Point[] = []
  const handled = new Set<string>()

  for (const neighbor of getNeighbors(point)) {
    if (next[neighbor.y][neighbor.x] !== enemy) continue
    const key = `${neighbor.x},${neighbor.y}`
    if (handled.has(key)) continue

    const group = getGroup(next, neighbor)
    for (const stone of group.stones) handled.add(`${stone.x},${stone.y}`)

    if (group.liberties.length === 0) {
      for (const stone of group.stones) {
        next[stone.y][stone.x] = null
        captured.push(stone)
      }
    }
  }

  const ownGroup = getGroup(next, point)
  if (ownGroup.liberties.length === 0) {
    return { ok: false, reason: 'suicide' }
  }

  return { ok: true, board: next, captured, liberties: ownGroup.liberties.length }
}

export function isLegalMove(
  board: Board,
  point: Point,
  color: StoneColor,
  options: PlayOptions = {}
): boolean {
  return playMove(board, point, color, options).ok
}

export function getLegalMoves(
  board: Board,
  color: StoneColor,
  options: PlayOptions = {}
): Point[] {
  const moves: Point[] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== null) continue
      if (playMove(board, { x, y }, color, options).ok) moves.push({ x, y })
    }
  }
  return moves
}

/**
 * Derives the ko ban created by a move.
 *
 * A ko exists when the move captured exactly one enemy stone and the stone that
 * was just placed is a lone stone whose only liberty is the point that was
 * captured. The opponent may not immediately recapture there; after they play
 * anywhere else the ban expires (simple ko — positional superko is not tracked).
 */
export function detectKoPoint(
  boardAfter: Board,
  move: Point,
  captured: Point[]
): Point | null {
  if (captured.length !== 1) return null

  const group = getGroup(boardAfter, move)
  if (group.stones.length !== 1) return null
  if (group.liberties.length !== 1) return null
  if (!samePoint(group.liberties[0], captured[0])) return null

  return captured[0]
}

export function getAtariGroups(board: Board, color: StoneColor): Group[] {
  const seen = new Set<string>()
  const groups: Group[] = []

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== color) continue
      const key = `${x},${y}`
      if (seen.has(key)) continue

      const group = getGroup(board, { x, y })
      for (const stone of group.stones) seen.add(`${stone.x},${stone.y}`)
      if (group.liberties.length === 1) groups.push(group)
    }
  }

  return groups
}

export function pointToLabel(point: Point): string {
  const letter = COLUMN_LETTERS[point.x]
  if (!letter) return ''
  return `${letter}${BOARD_SIZE - point.y}`
}

export function labelToPoint(label: string): Point | null {
  const match = /^([A-M])(1[0-3]|[1-9])$/i.exec(label.trim())
  if (!match) return null
  const x = COLUMN_LETTERS.indexOf(match[1].toUpperCase())
  const y = BOARD_SIZE - Number(match[2])
  if (x < 0 || y < 0 || y >= BOARD_SIZE) return null
  return { x, y }
}

export function countStones(board: Board): Record<StoneColor, number> {
  const counts: Record<StoneColor, number> = { black: 0, white: 0 }
  for (const row of board) {
    for (const cell of row) {
      if (cell) counts[cell]++
    }
  }
  return counts
}

/** Size of the connected empty area containing the given empty point. */
export function emptyRegionSize(board: Board, start: Point): number {
  if (board[start.y]?.[start.x] !== null) return 0

  const visited = new Set<string>([`${start.x},${start.y}`])
  const queue: Point[] = [start]
  let size = 0

  while (queue.length > 0) {
    const current = queue.shift()!
    size++
    for (const neighbor of getNeighbors(current)) {
      if (board[neighbor.y][neighbor.x] !== null) continue
      const key = `${neighbor.x},${neighbor.y}`
      if (visited.has(key)) continue
      visited.add(key)
      queue.push(neighbor)
    }
  }

  return size
}
