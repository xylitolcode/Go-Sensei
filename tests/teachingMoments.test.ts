import { describe, expect, it } from 'vitest'
import {
  createEmptyBoard,
  labelToPoint,
  type Board,
  type StoneColor
} from '../app/utils/goRules'
import { generateFeedback } from '../app/utils/mentor'
import { Tracker, type SessionTracker } from '../app/utils/sessionTracker'
import { createDefaultProfile, digestProfile } from '../app/utils/profile'

function boardWith(stones: [string, StoneColor][]): Board {
  const board = createEmptyBoard()
  for (const [label, color] of stones) {
    const point = labelToPoint(label)!
    board[point.y][point.x] = color
  }
  return board
}

/** A tracker that already knows the student walked away from a group in atari. */
function trackerWithDanger(): SessionTracker {
  const tracker = new Tracker()
  tracker.detections.tenukiWhenInAtari = true
  tracker.detections.isIgnoringDanger = true
  tracker.detections.ignoredDangerCount = 1
  tracker.dangerGroups = [[labelToPoint('G7')!]]
  return tracker.snapshot()
}

describe('teaching moments', () => {
  it('teaches the pattern instead of judging the single move', () => {
    const board = boardWith([
      ['G7', 'black'],
      ['F7', 'white'],
      ['G6', 'white'],
      ['G8', 'white']
    ])

    const feedback = generateFeedback(labelToPoint('D10')!, board, {
      color: 'black',
      phase: 'free-play',
      moveNumber: 6,
      tracker: trackerWithDanger()
    })

    expect(feedback.teachingMoment).toBeDefined()
    expect(feedback.teachingMoment?.type).toBe('tenuki-when-in-atari')
    expect(feedback.tone).toBe('concerned')
    expect(feedback.message).toContain('叫吃')
    expect(feedback.message).toContain('先救自己的棋')
    expect(feedback.conceptTag).toBe('liberty')
    expect(feedback.highlights.some((h) => h.point === 'G7' && h.type === 'danger')).toBe(true)
  })

  it('does not interrupt a great move with a lecture', () => {
    const board = boardWith([
      ['B12', 'white'],
      ['A12', 'black'],
      ['C12', 'black'],
      ['B13', 'black']
    ])

    const feedback = generateFeedback(labelToPoint('B11')!, board, {
      color: 'black',
      phase: 'free-play',
      moveNumber: 4,
      tracker: trackerWithDanger()
    })

    expect(feedback.teachingMoment).toBeUndefined()
    expect(feedback.tone).toBe('excited')
  })

  it('reminds the student about a weakness we already know about', () => {
    const profile = createDefaultProfile()
    profile.habits.weaknesses = ['经常忽略自己的气']

    const board = boardWith([
      ['F8', 'white'],
      ['H8', 'white'],
      ['G9', 'white']
    ])

    const feedback = generateFeedback(labelToPoint('G8')!, board, {
      color: 'black',
      phase: 'free-play',
      moveNumber: 3,
      profile: digestProfile(profile)
    })

    expect(feedback.message).toContain('经常忽略自己的气')
    expect(feedback.message).toContain('咱们之前聊过')
  })

  it('stays quiet about concepts the student has already mastered', () => {
    const profile = createDefaultProfile()
    profile.teachingProgress.conceptsMastered = ['connection']

    const board = boardWith([['G8', 'black']])
    const feedback = generateFeedback(labelToPoint('G7')!, board, {
      color: 'black',
      phase: 'free-play',
      moveNumber: 2,
      profile: digestProfile(profile)
    })

    expect(feedback.message).toContain('你已经掌握了')
  })
})
