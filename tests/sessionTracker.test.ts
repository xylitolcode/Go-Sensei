import { describe, expect, it } from 'vitest'
import {
  cloneBoard,
  createEmptyBoard,
  labelToPoint,
  playMove,
  type Board,
  type StoneColor
} from '../app/utils/goRules'
import { evaluateMove } from '../app/utils/mentor'
import { Tracker, type TrackerInput } from '../app/utils/sessionTracker'

function boardWith(stones: [string, StoneColor][]): Board {
  const board = createEmptyBoard()
  for (const [label, color] of stones) {
    const point = labelToPoint(label)!
    board[point.y][point.x] = color
  }
  return board
}

/** Plays a move on `board` and feeds the tracker, returning the resulting board. */
function play(
  tracker: Tracker,
  board: Board,
  label: string,
  color: StoneColor = 'black'
): Board {
  const move = labelToPoint(label)!
  const boardBefore = cloneBoard(board)
  const outcome = playMove(boardBefore, move, color)
  expect(outcome.ok).toBe(true)
  if (!outcome.ok) return boardBefore

  const evaluation = evaluateMove(move, boardBefore, color)
  const input: TrackerInput = {
    moveNumber: tracker.events.length + 1,
    point: move,
    color,
    boardBefore,
    boardAfter: outcome.board,
    captured: outcome.captured,
    atariTargets: evaluation.atariTargets,
    liberties: outcome.liberties,
    missedCapture: false,
    quality: evaluation.quality
  }
  tracker.record(input)
  return outcome.board
}

/**
 * Five independent atari shapes. They are far enough apart that the atari moves
 * never capture each other's target, so the chain stays unbroken.
 */
const ATARI_SETUP: [string, StoneColor][] = [
  ['G7', 'white'],
  ['G6', 'black'],
  ['G8', 'black'],
  ['J7', 'white'],
  ['J6', 'black'],
  ['J8', 'black'],
  ['B7', 'white'],
  ['B6', 'black'],
  ['B8', 'black'],
  ['E10', 'white'],
  ['E11', 'black'],
  ['E9', 'black'],
  ['I10', 'white'],
  ['I11', 'black'],
  ['I9', 'black']
]

const ATARI_MOVES = ['F7', 'I7', 'A7', 'D10', 'H10']

describe('sessionTracker', () => {
  it('detects a run of atari moves as a chasing pattern', () => {
    const tracker = new Tracker()
    let board = boardWith(ATARI_SETUP)

    board = play(tracker, board, 'F7')
    board = play(tracker, board, 'I7')
    expect(tracker.detections.isRepeatingAtari).toBe(false)

    board = play(tracker, board, 'A7')
    expect(tracker.detections.isRepeatingAtari).toBe(true)
    expect(tracker.chaseChainLength).toBe(3)
    expect(tracker.chaseChainStart).toBe(1)

    board = play(tracker, board, 'D10')
    board = play(tracker, board, 'H10')
    expect(tracker.chaseChainLength).toBe(5)
    expect(tracker.detections.isChasingTooLong).toBe(true)
    expect(tracker.detections.atariPositions.length).toBe(5)
  })

  it('flags a student who walks away from a group in atari', () => {
    const tracker = new Tracker()
    const board = boardWith([
      ['G7', 'black'],
      ['F7', 'white'],
      ['G6', 'white'],
      ['G8', 'white']
    ])

    play(tracker, board, 'D10')

    expect(tracker.detections.tenukiWhenInAtari).toBe(true)
    expect(tracker.detections.isIgnoringDanger).toBe(true)
    expect(tracker.detections.ignoredDangerCount).toBe(1)
  })

  it('does not flag a student who answers the danger', () => {
    const tracker = new Tracker()
    const board = boardWith([
      ['G7', 'black'],
      ['F7', 'white'],
      ['G6', 'white'],
      ['G8', 'white']
    ])

    play(tracker, board, 'H7')

    expect(tracker.detections.tenukiWhenInAtari).toBe(false)
    expect(tracker.detections.isIgnoringDanger).toBe(false)
    expect(tracker.awareness.sawTheDanger).toBe(true)
  })

  it('detects five consecutive attacking moves', () => {
    const tracker = new Tracker()
    let board = boardWith([
      ['G7', 'white'],
      ['G8', 'white'],
      ['G9', 'white']
    ])

    board = play(tracker, board, 'F7')
    board = play(tracker, board, 'G6')
    board = play(tracker, board, 'F8')
    board = play(tracker, board, 'H7')
    board = play(tracker, board, 'G10')

    expect(tracker.detections.isAlwaysAttacking).toBe(true)
    expect(tracker.detections.isAlwaysDefending).toBe(false)
  })

  it('detects five consecutive defensive moves', () => {
    const tracker = new Tracker()
    let board = boardWith([
      ['G7', 'black'],
      ['F7', 'white'],
      ['G6', 'white'],
      ['G8', 'white'],
      ['B7', 'black'],
      ['A7', 'white'],
      ['B6', 'white'],
      ['B8', 'white'],
      ['E10', 'black'],
      ['D10', 'white'],
      ['E11', 'white'],
      ['E9', 'white'],
      ['B10', 'black'],
      ['A10', 'white'],
      ['B11', 'white'],
      ['B9', 'white'],
      ['H10', 'black'],
      ['G10', 'white'],
      ['H11', 'white'],
      ['H9', 'white']
    ])

    board = play(tracker, board, 'H7')
    board = play(tracker, board, 'C7')
    board = play(tracker, board, 'F10')
    board = play(tracker, board, 'C10')
    board = play(tracker, board, 'I10')

    expect(tracker.detections.isAlwaysDefending).toBe(true)
    expect(tracker.detections.isAlwaysAttacking).toBe(false)
  })

  it('notices when the student keeps playing in one small area', () => {
    const tracker = new Tracker()
    let board = createEmptyBoard()

    board = play(tracker, board, 'D4')
    board = play(tracker, board, 'E4')
    board = play(tracker, board, 'D5')

    expect(tracker.detections.sameAreaPersistence).toBe(3)
    expect(tracker.sameAreaCenter).not.toBeNull()
  })

  it('resets the pattern when the student changes behaviour', () => {
    const tracker = new Tracker()
    let board = boardWith(ATARI_SETUP)

    board = play(tracker, board, 'F7')
    board = play(tracker, board, 'I7')
    expect(tracker.chaseChainLength).toBe(2)

    // A quiet move in the opposite corner breaks the chain.
    board = play(tracker, board, 'M12')
    expect(tracker.chaseChainLength).toBe(0)
    expect(tracker.chaseChainStart).toBeNull()
    expect(tracker.detections.isRepeatingAtari).toBe(false)
  })

  it('produces a plain snapshot for the UI and the model payload', () => {
    const tracker = new Tracker()
    let board = boardWith(ATARI_SETUP)
    board = play(tracker, board, 'F7')

    const snapshot = tracker.snapshot()
    expect(snapshot.totalMoves).toBe(1)
    expect(snapshot.consecutiveActions.lastMoveType).toBe('atari')
    expect(Array.isArray(snapshot.dangerGroups)).toBe(true)
  })
})
