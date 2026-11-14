import { describe, expect, it } from 'vitest'
import {
  countScore,
  countTerritory,
  DEFAULT_KOMI,
  removeDeadStones
} from '../app/utils/scoring'
import { createEmptyBoard, labelToPoint, type Board, type StoneColor } from '../app/utils/goRules'

function boardWith(stones: [string, StoneColor][]): Board {
  const board = createEmptyBoard()
  for (const [label, color] of stones) {
    const point = labelToPoint(label)!
    board[point.y][point.x] = color
  }
  return board
}

/** Black walls on the A and G files, white walls on the H and M files. */
function walledBoard(): Board {
  const board = createEmptyBoard()
  for (let y = 0; y < 13; y++) {
    board[y][0] = 'black'
    board[y][6] = 'black'
    board[y][7] = 'white'
    board[y][12] = 'white'
  }
  return board
}

describe('countTerritory', () => {
  it('gives each side the area it encloses', () => {
    const territory = countTerritory(walledBoard())
    // Columns B-F belong to black (5 files), I-L belong to white (4 files).
    expect(territory.black).toBe(5 * 13)
    expect(territory.white).toBe(4 * 13)
    expect(territory.neutral).toBe(0)
  })

  it('leaves a shared area neutral', () => {
    const board = boardWith([
      ['A1', 'black'],
      ['C1', 'black'],
      ['B2', 'white']
    ])
    const territory = countTerritory(board)
    expect(territory.black).toBe(0)
    expect(territory.white).toBe(0)
    expect(territory.neutral).toBeGreaterThan(0)
  })
})

describe('countScore', () => {
  it('counts stones plus surrounded area and applies the Chinese komi', () => {
    const score = countScore(walledBoard())

    expect(score.blackStones).toBe(26)
    expect(score.whiteStones).toBe(26)
    expect(score.blackTerritory).toBe(65)
    expect(score.whiteTerritory).toBe(52)
    expect(score.blackCount).toBe(91)
    expect(score.whiteCount).toBe(81.25)
    expect(score.komi).toBe(DEFAULT_KOMI)
    expect(score.margin).toBeCloseTo(9.75, 5)
    expect(score.winner).toBe('black')
  })

  it('gives white the komi, so an even board is a white win', () => {
    const board = createEmptyBoard()
    board[6][6] = 'black'
    board[6][7] = 'white'
    const score = countScore(board)

    expect(score.blackCount).toBe(1)
    expect(score.whiteCount).toBe(1 + DEFAULT_KOMI)
    expect(score.winner).toBe('white')
  })

  it('removes dead stones before counting', () => {
    // White G7 is surrounded by black and has a single liberty at F7.
    const board = boardWith([
      ['E7', 'black'],
      ['F6', 'black'],
      ['F8', 'black'],
      ['G6', 'black'],
      ['G8', 'black'],
      ['H7', 'black'],
      ['G7', 'white']
    ])

    const cleaned = removeDeadStones(board)
    expect(cleaned.removed).toHaveLength(1)
    expect(cleaned.removed[0].x).toBe(6)
    expect(cleaned.removed[0].y).toBe(6)
    expect(cleaned.board[6][6]).toBeNull()

    const score = countScore(board)
    expect(score.removedStones).toHaveLength(1)
    expect(score.whiteStones).toBe(0)
  })

  it('keeps a group that owns an eye', () => {
    // White surrounds G7 with its own stones: G7 is a real eye.
    const board = boardWith([
      ['F6', 'white'],
      ['G6', 'white'],
      ['H6', 'white'],
      ['F7', 'white'],
      ['H7', 'white'],
      ['G8', 'white']
    ])

    const cleaned = removeDeadStones(board)
    expect(cleaned.removed).toHaveLength(0)
  })
})
