import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useGameStore } from '../app/stores/game'
import { useProfileStore } from '../app/stores/profile'
import { labelToPoint } from '../app/utils/goRules'

describe('game store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  it('places a stone, explains it and waits for the student', () => {
    const game = useGameStore()

    game.play(labelToPoint('D4')!)

    expect(game.board[9][3]).toBe('black')
    expect(game.currentPlayer).toBe('white')
    expect(game.awaitingAck).toBe(true)
    expect(game.messages.length).toBe(2)
    expect(game.moveHistory.length).toBe(1)
  })

  it('lets the AI answer once the student acknowledges', () => {
    const game = useGameStore()

    game.play(labelToPoint('D4')!)
    game.acknowledge()
    vi.advanceTimersByTime(2000)

    expect(game.moveHistory.length).toBe(2)
    expect(game.currentPlayer).toBe('black')
    expect(game.isAiThinking).toBe(false)
  })

  it('rolls the chat back together with the board when undoing', () => {
    const game = useGameStore()

    game.play(labelToPoint('D4')!)
    game.acknowledge()
    vi.advanceTimersByTime(2000)
    expect(game.messages.length).toBe(3)

    game.undo()

    expect(game.moveHistory.length).toBe(0)
    expect(game.board[9][3]).toBeNull()
    expect(game.messages.length).toBe(1)
    expect(game.messages[0].text).toContain('欢迎')
  })

  it('rejects an illegal move without changing the board', () => {
    const game = useGameStore()

    game.play(labelToPoint('D4')!)
    game.acknowledge()
    vi.advanceTimersByTime(2000)

    const stonesBefore = JSON.stringify(game.board)
    game.play(labelToPoint('D4')!)

    expect(game.board).toEqual(JSON.parse(stonesBefore))
    expect(game.moveHistory.length).toBe(2)
    expect(game.messages[game.messages.length - 1].text).toContain('已经有子')
  })

  it('scores the game and records it in the student profile', () => {
    const game = useGameStore()
    const profile = useProfileStore()

    game.play(labelToPoint('D4')!)
    game.acknowledge()
    vi.advanceTimersByTime(2000)

    game.finishGame()

    expect(game.gameResult).not.toBeNull()
    expect(game.gameResult?.score.komi).toBe(3.25)
    expect(game.statusLabel).toContain('结算')
    expect(profile.profile.totalGames).toBe(1)
    expect(profile.profile.recentGames.length).toBe(1)
    expect(profile.profile.mentorNotes.length).toBeGreaterThan(0)
  })

  it('tracks the behaviour of the student across moves', () => {
    const game = useGameStore()

    game.play(labelToPoint('D4')!)
    game.acknowledge()
    vi.advanceTimersByTime(2000)
    game.play(labelToPoint('J10')!)

    expect(game.tracker.totalMoves).toBe(2)
    expect(game.tracker.consecutiveActions.lastMoveType).not.toBe('none')
  })

  it('starts a fresh game without leftovers', () => {
    const game = useGameStore()

    game.play(labelToPoint('D4')!)
    game.acknowledge()
    vi.advanceTimersByTime(2000)
    game.newGame()

    expect(game.moveHistory.length).toBe(0)
    expect(game.gameResult).toBeNull()
    expect(game.phase).toBe('free-play')
    expect(game.tracker.totalMoves).toBe(0)
    expect(game.messages.length).toBe(1)
    expect(game.board.flat().every((cell) => cell === null)).toBe(true)
  })
})
