import { describe, expect, it } from 'vitest'
import {
  createEmptyBoard,
  getGroup,
  labelToPoint,
  playMove,
  pointToLabel,
  type Board,
  type StoneColor
} from '../app/utils/goRules'

function boardWith(stones: [string, StoneColor][]): Board {
  const board = createEmptyBoard()
  for (const [label, color] of stones) {
    const point = labelToPoint(label)
    if (!point) throw new Error(`bad label ${label}`)
    board[point.y][point.x] = color
  }
  return board
}

describe('coordinates', () => {
  it('maps labels with row 13 at the top', () => {
    expect(pointToLabel({ x: 0, y: 0 })).toBe('A13')
    expect(pointToLabel({ x: 12, y: 12 })).toBe('M1')
    expect(pointToLabel({ x: 3, y: 9 })).toBe('D4')
    expect(labelToPoint('D4')).toEqual({ x: 3, y: 9 })
    expect(labelToPoint('M1')).toEqual({ x: 12, y: 12 })
    expect(labelToPoint('N1')).toBeNull()
  })
})

describe('playMove', () => {
  it('rejects an occupied intersection', () => {
    const board = boardWith([['D4', 'black']])
    const result = playMove(board, labelToPoint('D4')!, 'white')
    expect(result).toEqual({ ok: false, reason: 'occupied' })
  })

  it('rejects suicide when the new group would have no liberties', () => {
    const board = boardWith([
      ['A12', 'white'],
      ['C12', 'white'],
      ['B13', 'white'],
      ['B11', 'white']
    ])
    const result = playMove(board, labelToPoint('B12')!, 'black')
    expect(result).toEqual({ ok: false, reason: 'suicide' })
  })

  it('allows a move that looks suicidal but captures first', () => {
    const board = boardWith([
      ['B13', 'white'],
      ['A12', 'white'],
      ['C13', 'black'],
      ['B12', 'black'],
      ['A11', 'black']
    ])
    const result = playMove(board, labelToPoint('A13')!, 'black')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.captured).toHaveLength(2)
    expect(result.board[0][0]).toBe('black')
    expect(result.board[0][1]).toBeNull()
    expect(result.board[1][0]).toBeNull()
    expect(result.liberties).toBeGreaterThan(0)
  })

  it('removes a captured group with one liberty filled', () => {
    const board = boardWith([
      ['B12', 'white'],
      ['A12', 'black'],
      ['C12', 'black'],
      ['B13', 'black']
    ])
    const result = playMove(board, labelToPoint('B11')!, 'black')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.captured).toHaveLength(1)
    expect(result.board[1][1]).toBeNull()
    expect(result.board[2][1]).toBe('black')
  })

  it('counts liberties for a connected group', () => {
    const board = boardWith([
      ['D4', 'black'],
      ['D5', 'black']
    ])
    const group = getGroup(board, labelToPoint('D4')!)
    expect(group.stones).toHaveLength(2)
    expect(group.liberties).toHaveLength(6)
  })

  it('does not mutate the input board', () => {
    const board = boardWith([['B12', 'white']])
    const before = JSON.stringify(board)
    playMove(board, labelToPoint('B11')!, 'black')
    expect(JSON.stringify(board)).toBe(before)
  })
})
