import { describe, expect, it } from 'vitest'
import {
  BOARD_SIZE,
  createEmptyBoard,
  labelToPoint,
  type Board,
  type StoneColor
} from '../app/utils/goRules'
import { analyzeBoard, collectGroups, describeCandidate } from '../app/utils/boardInsight'
import { scoreMove } from '../app/utils/ai'
import { boardHintFor, getPhaseContext } from '../app/utils/teaching'
import { parseBoardReview, parseMentorReply } from '../server/utils/mentorLlm'

function boardWith(stones: [string, StoneColor][]): Board {
  const board = createEmptyBoard()
  for (const [label, color] of stones) {
    const point = labelToPoint(label)
    if (!point) throw new Error(`bad label ${label}`)
    board[point.y][point.x] = color
  }
  return board
}

describe('collectGroups', () => {
  it('returns nothing for an empty board', () => {
    expect(collectGroups(createEmptyBoard())).toEqual([])
  })

  it('counts liberties of a centre stone, a corner stone and a connected group', () => {
    const single = collectGroups(boardWith([['G7', 'black']]))
    expect(single).toHaveLength(1)
    expect(single[0].liberties).toBe(4)
    expect(single[0].urgency).toBe('safe')

    const corner = collectGroups(boardWith([['A13', 'black']]))
    expect(corner[0].liberties).toBe(2)
    expect(corner[0].urgency).toBe('warning')

    const connected = collectGroups(
      boardWith([
        ['G7', 'black'],
        ['G8', 'black']
      ])
    )
    expect(connected).toHaveLength(1)
    expect(connected[0].size).toBe(2)
    expect(connected[0].liberties).toBe(6)
  })

  it('marks a one-liberty group as critical and records the escape point', () => {
    const board = boardWith([
      ['B12', 'white'],
      ['A12', 'black'],
      ['C12', 'black'],
      ['B13', 'black']
    ])
    const groups = collectGroups(board)
    const trapped = groups.find((group) => group.color === 'white')
    expect(trapped?.liberties).toBe(1)
    expect(trapped?.urgency).toBe('critical')
    expect(trapped?.escapeLabel).toBe('B11')
    expect(groups.filter((group) => group.color === 'black')).toHaveLength(3)
  })
})

describe('analyzeBoard', () => {
  it('ranks three legal candidates on an empty board', () => {
    const insight = analyzeBoard(createEmptyBoard(), 'black')
    expect(insight.candidates).toHaveLength(3)
    for (let i = 1; i < insight.candidates.length; i++) {
      expect(insight.candidates[i - 1].score).toBeGreaterThanOrEqual(insight.candidates[i].score)
    }
    expect(insight.territory).toEqual([])
    // Empty board: white leads by the 3.25-point komi, as Chinese rules require.
    expect(insight.lead.color).toBe('white')
    expect(insight.lead.points).toBeCloseTo(3.3, 1)
  })

  it('surfaces a capture chance and gives actionable advice', () => {
    const board = boardWith([
      ['B12', 'white'],
      ['A12', 'black'],
      ['C12', 'black'],
      ['B13', 'black']
    ])
    const insight = analyzeBoard(board, 'black', 'black')

    expect(insight.critical.some((group) => group.label === 'B12')).toBe(true)
    expect(insight.captureChances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: 'white', label: 'B12', at: 'B11', size: 1 })
      ])
    )
    expect(insight.advice).toContain('B11')
    expect(insight.candidates[0].label).toBe('B11')
  })

  it('claims empty points near stones for the influence overlay', () => {
    const board = boardWith([['G7', 'black']])
    const insight = analyzeBoard(board, 'white')
    expect(insight.territory.length).toBeGreaterThan(0)
    expect(insight.territory.every((cell) => cell.color === 'black')).toBe(true)
    expect(insight.influence.black).toBeGreaterThan(0)
  })

  it('honours the board size everywhere', () => {
    expect(BOARD_SIZE).toBe(13)
    const insight = analyzeBoard(createEmptyBoard(), 'black')
    expect(insight.groups).toHaveLength(0)
    expect(insight.captureChances).toHaveLength(0)
  })

  it('describes a capturing candidate in plain language', () => {
    const board = boardWith([
      ['B12', 'white'],
      ['A12', 'black'],
      ['C12', 'black'],
      ['B13', 'black']
    ])
    const candidate = scoreMove(board, 'black', labelToPoint('B11')!)
    expect(candidate?.captures).toBe(1)
    expect(describeCandidate(candidate!).reason).toContain('提掉')
  })
})

describe('teaching phases actually read the board', () => {
  const board = boardWith([
    ['B12', 'white'],
    ['A12', 'black'],
    ['C12', 'black'],
    ['B13', 'black']
  ])

  it('points at the weakest own group when learning liberties', () => {
    expect(boardHintFor('teaching-liberty', board)).toContain('2 口气')
  })

  it('names the exact capture point when learning captures', () => {
    const hint = boardHintFor('teaching-capture', board)
    expect(hint).toContain('B12')
    expect(hint).toContain('B11')
  })

  it('only produces a hint when a board was supplied', () => {
    expect(getPhaseContext('teaching-capture', board).boardHint).toBeDefined()
    expect(getPhaseContext('teaching-capture').boardHint).toBeUndefined()
    expect(boardHintFor('free-play', board)).toBeUndefined()
  })

  it('gives a starter hint on an empty board', () => {
    expect(boardHintFor('teaching-liberty', createEmptyBoard())).toContain('先落一子')
  })
})

describe('structured model output', () => {
  it('keeps only whitelisted boardFocus points and a clean insight', () => {
    const reply = parseMentorReply(
      JSON.stringify({
        message: 'G7 连上了。',
        insight: '右下气紧，先补一手。',
        boardFocus: ['G7', 'Q4', 'G7', 'C3']
      }),
      ['G7', 'C3']
    )
    expect(reply?.insight).toBe('右下气紧，先补一手。')
    expect(reply?.boardFocus).toEqual(['G7', 'C3'])
  })

  it('drops an insight that invents a coordinate', () => {
    const reply = parseMentorReply(
      JSON.stringify({ message: '稳。', insight: '快看 Z9 那块棋' }),
      ['G7']
    )
    expect(reply?.insight).toBeUndefined()
  })

  it('still rejects a message with a hallucinated coordinate', () => {
    expect(parseMentorReply('{"message":"下在 Q4 很好。"}', ['G7'])).toBeNull()
  })

  it('validates board reviews and filters invented focus points', () => {
    const review = parseBoardReview(
      JSON.stringify({
        summary: '黑棋右上有空地可占，白棋左边一块气紧。先站稳再进攻。',
        focusPoints: ['G7', 'Z9'],
        lesson: '先数清每块棋的气'
      }),
      ['G7', 'C3']
    )
    expect(review?.focusPoints).toEqual(['G7'])
    expect(review?.lesson).toBe('先数清每块棋的气')

    expect(
      parseBoardReview(
        JSON.stringify({ summary: '去 Q4 占个大场。', focusPoints: [], lesson: '练气' }),
        ['G7']
      )
    ).toBeNull()
  })
})
