import {
  BOARD_SIZE,
  getGroup,
  getNeighbors,
  type Board,
  type Point,
  type StoneColor
} from './goRules'

export interface InfluenceEstimate {
  black: number
  white: number
  owner: (StoneColor | null)[][]
}

/**
 * 13 路中国规则（数子法）贴目：黑方贴白 3¼ 子（6.5 目）。
 * 参考《中国围棋竞赛规则》2002 年修订版的数子法贴子惯例。
 */
export const DEFAULT_KOMI = 3.25

export interface ScoreResult {
  blackStones: number
  whiteStones: number
  blackTerritory: number
  whiteTerritory: number
  neutralPoints: number
  /** 数子法结果：黑子数 + 黑空。 */
  blackCount: number
  /** 数子法结果：白子数 + 白空 + 贴目。 */
  whiteCount: number
  komi: number
  margin: number
  winner: 'black' | 'white' | 'draw'
  /** Dead stones that were taken off the board before counting. */
  removedStones: Point[]
}

/**
 * Cheap influence estimate: each empty point is claimed by the color whose stone is
 * strictly closer (Manhattan), as long as it is within `radius`. Used for mentor
 * commentary about "territory", not for final scoring.
 */
export function estimateInfluence(board: Board, radius = 2): InfluenceEstimate {
  const stones: Record<StoneColor, Point[]> = { black: [], white: [] }

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const cell = board[y][x]
      if (cell) stones[cell].push({ x, y })
    }
  }

  const owner: (StoneColor | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
    Array<StoneColor | null>(BOARD_SIZE).fill(null)
  )
  let black = 0
  let white = 0

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== null) continue

      let nearestBlack = Infinity
      for (const stone of stones.black) {
        nearestBlack = Math.min(nearestBlack, Math.abs(stone.x - x) + Math.abs(stone.y - y))
      }
      let nearestWhite = Infinity
      for (const stone of stones.white) {
        nearestWhite = Math.min(nearestWhite, Math.abs(stone.x - x) + Math.abs(stone.y - y))
      }

      let claimed: StoneColor | null = null
      if (nearestBlack <= radius && nearestWhite <= radius) {
        if (nearestBlack < nearestWhite) claimed = 'black'
        else if (nearestWhite < nearestBlack) claimed = 'white'
      } else if (nearestBlack <= radius) {
        claimed = 'black'
      } else if (nearestWhite <= radius) {
        claimed = 'white'
      }

      owner[y][x] = claimed
      if (claimed === 'black') black++
      else if (claimed === 'white') white++
    }
  }

  return { black, white, owner }
}

/** One connected area of empty points, with the colors that surround it. */
export interface EmptyRegion {
  points: Point[]
  borders: StoneColor[]
}

/** Splits the board into connected empty regions and records their bordering colors. */
export function getEmptyRegions(board: Board): EmptyRegion[] {
  const visited = new Set<string>()
  const regions: EmptyRegion[] = []

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[y][x] !== null) continue
      const key = `${x},${y}`
      if (visited.has(key)) continue

      const points: Point[] = []
      const borders = new Set<StoneColor>()
      const queue: Point[] = [{ x, y }]
      visited.add(key)

      while (queue.length > 0) {
        const current = queue.shift()!
        points.push(current)
        for (const neighbor of getNeighbors(current)) {
          const value = board[neighbor.y][neighbor.x]
          if (value === null) {
            const neighborKey = `${neighbor.x},${neighbor.y}`
            if (visited.has(neighborKey)) continue
            visited.add(neighborKey)
            queue.push(neighbor)
          } else {
            borders.add(value)
          }
        }
      }

      regions.push({ points, borders: [...borders] })
    }
  }

  return regions
}

/**
 * Territory owned by each color. A region belongs to a color when every stone
 * bordering it is that color; regions touching both colors stay neutral (单官).
 */
export function countTerritory(board: Board): {
  black: number
  white: number
  neutral: number
} {
  let black = 0
  let white = 0
  let neutral = 0

  for (const region of getEmptyRegions(board)) {
    const only = region.borders.length === 1 ? region.borders[0] : null
    if (only === 'black') black += region.points.length
    else if (only === 'white') white += region.points.length
    else neutral += region.points.length
  }

  return { black, white, neutral }
}

/**
 * Removes stones that can no longer live.
 *
 * A group is dead when every empty area touching it is enclosed by the opponent
 * as well — it has no eye space of its own, so it can never make two eyes. Those
 * stones come off the board before counting, the way dead stones are removed
 * during the closing phase of a real game.
 */
export function removeDeadStones(board: Board): { board: Board; removed: Point[] } {
  const removed: Point[] = []
  const next = board.map((row) => [...row])

  const seen = new Set<string>()
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const color = next[y][x]
      if (!color) continue
      const key = `${x},${y}`
      if (seen.has(key)) continue

      const group = getGroup(next, { x, y })
      for (const stone of group.stones) seen.add(`${stone.x},${stone.y}`)

      // Empty areas this group touches (recomputed, earlier groups may be gone).
      const regions = getEmptyRegions(next)
      const touched = new Set<string>()
      for (const stone of group.stones) {
        for (const neighbor of getNeighbors(stone)) {
          if (next[neighbor.y][neighbor.x] === null) {
            touched.add(`${neighbor.x},${neighbor.y}`)
          }
        }
      }
      if (touched.size === 0) continue

      const enemy = color === 'black' ? 'white' : 'black'
      const adjacentRegions = regions.filter((region) =>
        region.points.some((point) => touched.has(`${point.x},${point.y}`))
      )
      // An eye is an empty area enclosed by this group's own colour only.
      const hasEye = adjacentRegions.some((region) => !region.borders.includes(enemy))
      if (hasEye) continue

      // Only a group the opponent is actually pressing can be dead: it has to
      // touch enemy stones and be down to its last couple of liberties.
      const touchesEnemy = group.stones.some((stone) =>
        getNeighbors(stone).some((neighbor) => next[neighbor.y][neighbor.x] === enemy)
      )
      if (!touchesEnemy) continue

      const liberties = getGroup(next, group.stones[0]).liberties.length
      if (liberties > 2) continue

      for (const stone of group.stones) {
        next[stone.y][stone.x] = null
        removed.push(stone)
      }
    }
  }

  return { board: next, removed }
}

/**
 * Chinese rules scoring (数子法): a side's score is its stones plus the empty
 * points it surrounds. Black pays the komi, so white receives it.
 */
export function countScore(board: Board, komi = DEFAULT_KOMI): ScoreResult {
  const { board: cleaned, removed } = removeDeadStones(board)
  const stones = { black: 0, white: 0 }
  for (const row of cleaned) {
    for (const cell of row) {
      if (cell) stones[cell]++
    }
  }

  const territory = countTerritory(cleaned)
  const blackCount = stones.black + territory.black
  const whiteCount = stones.white + territory.white + komi
  const margin = blackCount - whiteCount

  return {
    blackStones: stones.black,
    whiteStones: stones.white,
    blackTerritory: territory.black,
    whiteTerritory: territory.white,
    neutralPoints: territory.neutral,
    blackCount,
    whiteCount,
    komi,
    margin,
    winner: margin > 0 ? 'black' : margin < 0 ? 'white' : 'draw',
    removedStones: removed
  }
}
