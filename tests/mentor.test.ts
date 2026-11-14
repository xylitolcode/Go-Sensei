import { describe, expect, it } from 'vitest'
import {
  createEmptyBoard,
  labelToPoint,
  type Board,
  type StoneColor
} from '../app/utils/goRules'
import { evaluateMove, generateFeedback } from '../app/utils/mentor'

function boardWith(stones: [string, StoneColor][]): Board {
  const board = createEmptyBoard()
  for (const [label, color] of stones) {
    const point = labelToPoint(label)
    if (!point) throw new Error(`bad label ${label}`)
    board[point.y][point.x] = color
  }
  return board
}

describe('evaluateMove', () => {
  it('rates a capture as excellent', () => {
    const board = boardWith([
      ['B12', 'white'],
      ['A12', 'black'],
      ['C12', 'black'],
      ['B13', 'black']
    ])
    const evaluation = evaluateMove(labelToPoint('B11')!, board, 'black')
    expect(evaluation.quality).toBe('excellent')
    expect(evaluation.reason).toBe('capture')
    expect(evaluation.impact.captures).toBe(1)
    expect(evaluation.bestAlternative).toBeUndefined()
  })

  it('rates self-atari as a mistake and finds a better move', () => {
    const board = boardWith([
      ['F8', 'white'],
      ['H8', 'white'],
      ['G9', 'white']
    ])
    const evaluation = evaluateMove(labelToPoint('G8')!, board, 'black')
    expect(evaluation.quality).toBe('mistake')
    expect(evaluation.reason).toBe('self-atari')
    expect(evaluation.liberties).toBe(1)
    expect(evaluation.bestAlternative).toBeDefined()
  })

  it('rates a solid connection as good', () => {
    const board = boardWith([['G8', 'black']])
    const evaluation = evaluateMove(labelToPoint('G7')!, board, 'black')
    expect(evaluation.quality).toBe('good')
    expect(evaluation.liberties).toBeGreaterThanOrEqual(3)
    expect(evaluation.connected).toBe(true)
  })

  it('does not mutate the board while evaluating', () => {
    const board = boardWith([['B12', 'white']])
    const before = JSON.stringify(board)
    evaluateMove(labelToPoint('B11')!, board, 'black')
    expect(JSON.stringify(board)).toBe(before)
  })
})

describe('generateFeedback', () => {
  it('celebrates a capture with an excited tone and no shadow move', () => {
    const board = boardWith([
      ['B12', 'white'],
      ['A12', 'black'],
      ['C12', 'black'],
      ['B13', 'black']
    ])
    const feedback = generateFeedback(labelToPoint('B11')!, board, {
      color: 'black',
      phase: 'free-play',
      moveNumber: 4
    })

    expect(feedback.tone).toBe('excited')
    expect(feedback.conceptTag).toBe('capture')
    expect(feedback.highlights.some((h) => h.point === 'B12' && h.type === 'good')).toBe(true)
    expect(feedback.demoMove).toBeUndefined()
    expect(feedback.scoreDelta).toBeGreaterThan(0)
  })

  it('corrects self-atari gently and demos a stronger alternative', () => {
    const board = boardWith([
      ['F8', 'white'],
      ['H8', 'white'],
      ['G9', 'white']
    ])
    const feedback = generateFeedback(labelToPoint('G8')!, board, {
      color: 'black',
      phase: 'free-play',
      moveNumber: 3
    })

    expect(feedback.tone).toBe('gentle-correct')
    expect(feedback.highlights.some((h) => h.type === 'danger')).toBe(true)
    expect(feedback.highlights.some((h) => h.type === 'comparison')).toBe(true)
    expect(feedback.demoMove).toBeDefined()
    expect(feedback.demoMove?.point).toBe(
      feedback.highlights.find((h) => h.type === 'comparison')?.point
    )
    expect(feedback.annotations.some((a) => a.style === 'number')).toBe(true)
  })

  it('praises a solid move with a green highlight', () => {
    const board = boardWith([['G8', 'black']])
    const feedback = generateFeedback(labelToPoint('G7')!, board, {
      color: 'black',
      phase: 'free-play',
      moveNumber: 2
    })

    expect(feedback.tone).toBe('praise')
    expect(feedback.highlights[0]).toMatchObject({ point: 'G7', type: 'good' })
    expect(feedback.demoMove).toBeUndefined()
  })

  it('intercepts suicide and explains the rule', () => {
    const board = boardWith([
      ['A12', 'white'],
      ['C12', 'white'],
      ['B13', 'white'],
      ['B11', 'white']
    ])
    const feedback = generateFeedback(labelToPoint('B12')!, board, {
      color: 'black',
      phase: 'free-play',
      moveNumber: 1
    })

    expect(feedback.tone).toBe('gentle-correct')
    expect(feedback.conceptTag).toBe('rules')
    expect(feedback.highlights[0]).toMatchObject({ point: 'B12', type: 'bad' })
    expect(feedback.message).toContain('B12')
    expect(feedback.demoMove).toBeUndefined()
  })

  it('keeps every message reference to the actual move', () => {
    const board = boardWith([['G8', 'black']])
    const feedback = generateFeedback(labelToPoint('G7')!, board, {
      color: 'black',
      phase: 'teaching-liberty',
      moveNumber: 2
    })

    expect(feedback.message.length).toBeGreaterThan(0)
    expect(feedback.highlights[0].point).toBe('G7')
  })
})
