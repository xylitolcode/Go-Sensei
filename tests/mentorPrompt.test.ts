import { describe, expect, it } from 'vitest'
import {
  createEmptyBoard,
  labelToPoint,
  playMove,
  type Board,
  type StoneColor
} from '../app/utils/goRules'
import { evaluateMove, generateFeedback } from '../app/utils/mentor'
import {
  buildMentorRequest,
  needsLlmExplanation,
  summarizeBoard
} from '../app/utils/mentorPrompt'
import { parseMentorReply } from '../server/utils/mentorLlm'

function boardWith(stones: [string, StoneColor][]): Board {
  const board = createEmptyBoard()
  for (const [label, color] of stones) {
    const point = labelToPoint(label)
    if (!point) throw new Error(`bad label ${label}`)
    board[point.y][point.x] = color
  }
  return board
}

const CAPTURE_BOARD = boardWith([
  ['B12', 'white'],
  ['A12', 'black'],
  ['C12', 'black'],
  ['B13', 'black']
])

describe('needsLlmExplanation', () => {
  it('skips the model for an ordinary neutral move', () => {
    const board = boardWith([['G8', 'black']])
    const evaluation = evaluateMove(labelToPoint('D4')!, board, 'black')
    expect(evaluation.quality).toBe('okay')
    expect(needsLlmExplanation(evaluation)).toBe(false)
  })

  it('asks the model for captures and problematic moves', () => {
    const capture = evaluateMove(labelToPoint('B11')!, CAPTURE_BOARD, 'black')
    expect(needsLlmExplanation(capture)).toBe(true)

    const selfAtari = evaluateMove(
      labelToPoint('G8')!,
      boardWith([
        ['F8', 'white'],
        ['H8', 'white'],
        ['G9', 'white']
      ]),
      'black'
    )
    expect(selfAtari.quality).toBe('mistake')
    expect(needsLlmExplanation(selfAtari)).toBe(true)
  })
})

describe('buildMentorRequest', () => {
  it('packages the evaluation, board summary and legal coordinates', () => {
    const board = boardWith([['G8', 'black']])
    const move = labelToPoint('G7')!
    const evaluation = evaluateMove(move, board, 'black')
    const feedback = generateFeedback(move, board, {
      color: 'black',
      phase: 'free-play',
      moveNumber: 2
    })

    const request = buildMentorRequest({
      move,
      boardAfter: playMove(board, move, 'black').board,
      color: 'black',
      phase: 'free-play',
      moveNumber: 2,
      evaluation,
      feedback
    })

    expect(request.moveLabel).toBe('G7')
    expect(request.evaluation.quality).toBe('good')
    expect(request.allowedPoints).toEqual(expect.arrayContaining(['G7', 'G8']))
    expect(request.boardSummary).toContain('你的棋：')
    expect(request.boardSummary).toContain('G8')
    expect(request.templateMessage).toBe(feedback.message)
    expect(request.needsDeepExplanation).toBe(false)
  })

  it('marks a capture as worth a model explanation and keeps captured points', () => {
    const move = labelToPoint('B11')!
    const evaluation = evaluateMove(move, CAPTURE_BOARD, 'black')
    const feedback = generateFeedback(move, CAPTURE_BOARD, {
      color: 'black',
      phase: 'teaching-capture',
      moveNumber: 4
    })

    const request = buildMentorRequest({
      move,
      boardAfter: playMove(CAPTURE_BOARD, move, 'black').board,
      color: 'black',
      phase: 'teaching-capture',
      moveNumber: 4,
      evaluation,
      feedback
    })

    expect(request.needsDeepExplanation).toBe(true)
    expect(request.evaluation.capturedLabels).toEqual(['B12'])
    expect(request.allowedPoints).toEqual(expect.arrayContaining(['B11', 'B12']))
    expect(request.conceptTag).toBe('capture')
  })
})

describe('summarizeBoard', () => {
  it('lists both sides and the move just played', () => {
    const summary = summarizeBoard(boardWith([['G8', 'black'], ['F7', 'white']]), 'black', 'G7')
    expect(summary).toContain('你的棋：G8')
    expect(summary).toContain('AI 的棋：F7')
    expect(summary).toContain('这一手：G7')
  })
})

describe('parseMentorReply', () => {
  it('accepts a JSON reply that only cites real coordinates', () => {
    const reply = parseMentorReply('{"message":"G7 和 G8 连上了，这块棋有 3 口气，舒服。"}', [
      'G7',
      'G8'
    ])
    expect(reply?.message).toBe('G7 和 G8 连上了，这块棋有 3 口气，舒服。')
  })

  it('accepts fenced JSON and collapses whitespace', () => {
    const reply = parseMentorReply(
      '```json\n{"message":"漂亮！这一手\\n直接提子。"}\n```',
      ['B11']
    )
    expect(reply?.message).toBe('漂亮！这一手 直接提子。')
  })

  it('rejects coordinates that are not on the board snapshot', () => {
    expect(parseMentorReply('{"message":"你下在 Q4，很好。"}', ['G7'])).toBeNull()
    expect(parseMentorReply('{"message":"你下在 H9，很好。"}', ['G7'])).toBeNull()
  })

  it('rejects replies without a usable message', () => {
    expect(parseMentorReply('抱歉，我无法回答。', ['G7'])).toBeNull()
    expect(parseMentorReply('{"message":""}', ['G7'])).toBeNull()
    expect(parseMentorReply('{"text":"没有 message 字段"}', ['G7'])).toBeNull()
  })

  it('keeps a sanitised profile update and drops unknown fields', () => {
    const reply = parseMentorReply(
      JSON.stringify({
        message: '这手不错。',
        profileUpdate: {
          addTendency: '喜欢征子',
          addWeakness: '经常忽略自己的气',
          addConcept: '气',
          addConceptMastered: '提子',
          mentorNotes: '这盘比上一盘稳。',
          skills: { captureInstinct: 99, nonsense: 5 },
          evil: 'rm -rf /'
        }
      }),
      ['G7']
    )

    expect(reply?.profileUpdate).toEqual({
      addTendency: '喜欢征子',
      addWeakness: '经常忽略自己的气',
      addConcept: '气',
      addConceptMastered: '提子',
      mentorNotes: '这盘比上一盘稳。',
      skills: { captureInstinct: 3 }
    })
  })

  it('drops a profile update that names an unknown concept', () => {
    const reply = parseMentorReply(
      '{"message":"好。","profileUpdate":{"addConcept":"飞刀"}}',
      ['G7']
    )
    expect(reply?.profileUpdate).toBeUndefined()
  })
})
