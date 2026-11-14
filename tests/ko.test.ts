import { describe, expect, it } from 'vitest'
import {
  createEmptyBoard,
  detectKoPoint,
  getLegalMoves,
  labelToPoint,
  playMove,
  type Board,
  type StoneColor
} from '../app/utils/goRules'

function boardWith(stones: [string, StoneColor][]): Board {
  const board = createEmptyBoard()
  for (const [label, color] of stones) {
    const point = labelToPoint(label)!
    board[point.y][point.x] = color
  }
  return board
}

/**
 * White D4 has exactly one liberty (D5). Black plays D5, captures it, and the
 * new black stone is left with exactly one liberty (D4) — the classic ko shape.
 */
const KO_BOARD = boardWith([
  ['C4', 'black'],
  ['E4', 'black'],
  ['D3', 'black'],
  ['D4', 'white'],
  ['C5', 'white'],
  ['E5', 'white'],
  ['D6', 'white']
])

describe('ko rule', () => {
  it('lets the capturing move happen', () => {
    const result = playMove(KO_BOARD, labelToPoint('D5')!, 'black')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.captured.map((point) => point.x)).toHaveLength(1)
    expect(result.captured[0].x).toBe(3)
    expect(result.liberties).toBe(1)
  })

  it('derives the ko point from the capturing move', () => {
    const result = playMove(KO_BOARD, labelToPoint('D5')!, 'black')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const koPoint = detectKoPoint(result.board, labelToPoint('D5')!, result.captured)
    expect(koPoint).toEqual(labelToPoint('D4'))
  })

  it('forbids the immediate recapture', () => {
    const capture = playMove(KO_BOARD, labelToPoint('D5')!, 'black')
    expect(capture.ok).toBe(true)
    if (!capture.ok) return

    const koPoint = detectKoPoint(capture.board, labelToPoint('D5')!, capture.captured)
    const recapture = playMove(capture.board, labelToPoint('D4')!, 'white', { koPoint })

    expect(recapture).toEqual({ ok: false, reason: 'ko' })
  })

  it('allows the recapture once the ban has expired', () => {
    const capture = playMove(KO_BOARD, labelToPoint('D5')!, 'black')
    expect(capture.ok).toBe(true)
    if (!capture.ok) return

    // Black plays somewhere else — the ko ban is over.
    const elsewhere = playMove(capture.board, labelToPoint('A1')!, 'black')
    expect(elsewhere.ok).toBe(true)
    if (!elsewhere.ok) return

    const recapture = playMove(elsewhere.board, labelToPoint('D4')!, 'white')
    expect(recapture.ok).toBe(true)
  })

  it('keeps the ko point out of the legal move list', () => {
    const capture = playMove(KO_BOARD, labelToPoint('D5')!, 'black')
    expect(capture.ok).toBe(true)
    if (!capture.ok) return

    const koPoint = detectKoPoint(capture.board, labelToPoint('D5')!, capture.captured)
    const legal = getLegalMoves(capture.board, 'white', { koPoint })

    expect(legal.some((point) => point.x === 3 && point.y === 9)).toBe(false)
  })

  it('does not create a ko for an ordinary multi-stone capture', () => {
    const board = boardWith([
      ['B12', 'white'],
      ['A12', 'black'],
      ['C12', 'black'],
      ['B13', 'black']
    ])
    const result = playMove(board, labelToPoint('B11')!, 'black')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(detectKoPoint(result.board, labelToPoint('B11')!, result.captured)).toBeNull()
  })
})
