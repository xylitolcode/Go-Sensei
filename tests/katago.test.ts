import { describe, expect, it } from 'vitest'
import {
  BOARD_SIZE,
  createEmptyBoard,
  pointToLabel,
  type Point
} from '../app/utils/goRules'
import {
  buildAnalysisQuery,
  buildPlayQuery,
  calibrateOwnership,
  chooseKatagoMove,
  describeForMentor,
  fromGtpLabel,
  gtpToAppLabel,
  normalizeAnalysis,
  normalizeOpponentRank,
  RANK_PROFILES,
  rankProfile,
  stonesToGtpKomi,
  toGtpLabel,
  type KatagoRawResponse
} from '../app/utils/katago'

describe('GTP coordinate bridge (the I-letter trap)', () => {
  it('skips I in column labels while keeping array indices aligned', () => {
    expect(pointToLabel({ x: 8, y: 6 })).toBe('I7') // app column 9
    expect(toGtpLabel({ x: 8, y: 6 })).toBe('J7') // KataGo column 9
    expect(toGtpLabel({ x: 12, y: 0 })).toBe('N13')
    expect(toGtpLabel({ x: 0, y: 12 })).toBe('A1')
  })

  it('round-trips GTP labels back into app points', () => {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const point: Point = { x, y: 5 }
      const gtp = toGtpLabel(point)
      expect(fromGtpLabel(gtp)).toEqual(point)
      expect(gtpToAppLabel(gtp)).toBe(pointToLabel(point))
    }
    expect(fromGtpLabel('I7')).toBeNull() // I is not a valid GTP column
    expect(fromGtpLabel('pass')).toBeNull()
  })

  it('converts Chinese 3¼-stone komi into a half-integer point komi', () => {
    expect(stonesToGtpKomi()).toBe(6.5)
    expect(stonesToGtpKomi(3.75)).toBe(7.5)
    expect(stonesToGtpKomi(3.25) * 2 % 1).toBe(0)
  })
})

describe('analysis query', () => {
  const board = createEmptyBoard()
  board[6][6] = 'black'

  it('uses real move history when available', () => {
    const query = buildAnalysisQuery({
      id: 'q1',
      board,
      moves: [
        { color: 'black', point: { x: 6, y: 6 } },
        { color: 'white', point: { x: 7, y: 6 } },
        { color: 'black', point: null }
      ],
      nextColor: 'white'
    })
    expect(query.id).toBe('q1')
    expect(query.rules).toBe('chinese')
    expect(query.komi).toBe(6.5)
    expect(query.boardXSize).toBe(13)
    expect(query.boardYSize).toBe(13)
    expect(query.moves).toEqual([['B', 'G7'], ['W', 'H7'], ['B', 'pass']])
    expect(query.initialStones).toBeUndefined()
    // Analysis Engine accepts ONE line of JSON only.
    expect(JSON.stringify(query)).not.toContain('\n')
  })

  it('falls back to initialStones with no history', () => {
    const query = buildAnalysisQuery({
      id: 'q2',
      board,
      moves: [],
      nextColor: 'white'
    })
    expect(query.moves).toEqual([])
    expect(query.initialStones).toEqual([['B', 'G7']])
    expect(query.initialPlayer).toBe('W')
  })
})

describe('response normalisation', () => {
  const board = createEmptyBoard()
  board[0][0] = 'black'
  board[0][1] = 'white'

  const raw: KatagoRawResponse = {
    id: 'q1',
    isDuringSearch: false,
    moveInfos: [
      { move: 'J7', winrate: 0.62, scoreLead: 3.5, visits: 120, prior: 0.4, order: 0, pv: ['J7', 'H7'] },
      { move: 'H7', winrate: 0.58, scoreLead: 2.1, visits: 60, prior: 0.2, order: 1, pv: [] }
    ],
    rootInfo: { winrate: 0.61, scoreLead: 3.2, visits: 200, currentPlayer: 'B' },
    ownership: Array(169).fill(0)
  }

  it('translates GTP move labels back to app labels', () => {
    const analysis = normalizeAnalysis(raw, board, { winrateAsBlack: true })!
    expect(analysis.bestMove).toBe('I7') // J7 in GTP == I7 on our board
    expect(analysis.topMoves[0].pv).toEqual(['I7', 'H7'])
    expect(analysis.blackWinrate).toBeCloseTo(0.61)
    expect(analysis.blackLead).toBeCloseTo(3.2)
    expect(analysis.currentPlayer).toBe('black')
    expect(analysis.ownership).toHaveLength(169)
  })

  it('flips side-to-move values into black perspective', () => {
    const sideToMove = {
      ...raw,
      rootInfo: { ...raw.rootInfo!, currentPlayer: 'W' }
    }
    const analysis = normalizeAnalysis(sideToMove, board, { winrateAsBlack: false })!
    expect(analysis.blackWinrate).toBeCloseTo(1 - 0.61)
    expect(analysis.blackLead).toBeCloseTo(-3.2)
  })

  it('calibrates the ownership sign against stones on the board', () => {
    const blackOwned = Array(169).fill(0) as number[]
    blackOwned[0] = 0.9 // board[0][0] is black
    blackOwned[1] = -0.9 // board[0][1] is white
    expect(calibrateOwnership(blackOwned, board)).toBe(1)

    const reversed = blackOwned.map((value) => -value)
    expect(calibrateOwnership(reversed, board)).toBe(-1)
    expect(calibrateOwnership(Array(169).fill(0), createEmptyBoard())).toBe(1)
  })

  it('rejects partial reports and errors', () => {
    expect(normalizeAnalysis({ ...raw, isDuringSearch: true }, board)).toBeNull()
    expect(normalizeAnalysis({ ...raw, error: 'bad query' }, board)).toBeNull()
    expect(normalizeAnalysis({ ...raw, moveInfos: undefined }, board)).toBeNull()
  })

  it('produces factual text for the mentor (not invented numbers)', () => {
    const analysis = normalizeAnalysis(raw, board)!
    const text = describeForMentor(analysis)
    expect(text).toContain('引擎实测')
    expect(text).toContain('61%')
    expect(text).toContain('I7')
    expect(text).toContain('搜索 200 次')
  })
})

describe('opponent rank profiles', () => {
  it('exposes an ordered kyu -> dan -> full-engine ladder', () => {
    expect(RANK_PROFILES).toHaveLength(8)
    expect(RANK_PROFILES[0].rank).toBe('15k')
    expect(RANK_PROFILES[RANK_PROFILES.length - 1].rank).toBe('pro')
    expect(rankProfile('5k').humanSLProfile).toBe('rank_5k')
    expect(rankProfile('pro').humanSLProfile).toBeNull()
    expect(normalizeOpponentRank('garbage')).toBe('5k')
    expect(normalizeOpponentRank(null)).toBe('5k')
    expect(rankProfile('15k').visits).toBeLessThan(rankProfile('5d').visits)
    expect(rankProfile('15k').temperature).toBeGreaterThan(rankProfile('5d').temperature)
  })
})

describe('play query (KataGo actually moves)', () => {
  const board = createEmptyBoard()

  it('puts humanSLProfile inside overrideSettings, never at the top level', () => {
    const query = buildPlayQuery({
      id: 'p1',
      board,
      moves: [{ color: 'black', point: { x: 3, y: 3 } }],
      nextColor: 'white',
      profile: rankProfile('5k'),
      humanModel: true
    })
    expect(query.includePolicy).toBe(true)
    expect(query.includeOwnership).toBe(false)
    expect(query.maxVisits).toBe(64)
    expect(query.overrideSettings).toEqual({
      humanSLProfile: 'rank_5k',
      ignorePreRootHistory: false
    })
    expect(query.humanSLProfile).toBeUndefined()
    expect(JSON.stringify(query)).not.toContain('\n')
  })

  it('uses a bounded search when the human SL net is absent', () => {
    const query = buildPlayQuery({
      id: 'p2',
      board,
      moves: [],
      nextColor: 'white',
      profile: rankProfile('10k'),
      humanModel: false
    })
    expect(query.includePolicy).toBe(false)
    expect(query.overrideSettings).toBeUndefined()
    expect(query.maxVisits).toBe(16)
  })

  it('plays the engine at full strength for the top profile', () => {
    const query = buildPlayQuery({
      id: 'p3',
      board,
      moves: [],
      nextColor: 'white',
      profile: rankProfile('pro'),
      humanModel: true
    })
    expect(query.overrideSettings).toBeUndefined()
    expect(query.includePolicy).toBe(false)
    expect(query.maxVisits).toBe(800)
  })
})

describe('rank-aware move selection', () => {
  const baseOptions = {
    board: createEmptyBoard(),
    color: 'white' as const,
    koPoint: null,
    profile: rankProfile('5k'),
    humanMode: true,
    random: () => 0
  }

  function rawWithHumanPolicy(): KatagoRawResponse {
    const humanPolicy = Array(170).fill(-1) as number[]
    humanPolicy[3 * 13 + 3] = 1 // D10
    humanPolicy[169] = 0 // never pass from the raw human policy
    return {
      id: 'p',
      moveInfos: [{ move: 'G7', winrate: 0.5, visits: 64, order: 0 }],
      rootInfo: { winrate: 0.5, scoreLead: 0, visits: 64, currentPlayer: 'W' },
      humanPolicy
    }
  }

  it('samples the human policy instead of always taking the best move', () => {
    const choice = chooseKatagoMove(rawWithHumanPolicy(), baseOptions)!
    expect(choice.mode).toBe('human-sl')
    expect(choice.decision).toBe('move')
    expect(choice.label).toBe('D10')
    expect(choice.point).toEqual({ x: 3, y: 3 })
    expect(choice.candidates).toBe(1)
  })

  it('re-checks legality locally and falls back when the policy point is occupied', () => {
    const board = createEmptyBoard()
    board[3][3] = 'black'
    const choice = chooseKatagoMove(rawWithHumanPolicy(), { ...baseOptions, board })!
    expect(choice.mode).toBe('search')
    expect(choice.point).toEqual({ x: 6, y: 6 })
  })

  it('honours the ko ban', () => {
    const choice = chooseKatagoMove(rawWithHumanPolicy(), {
      ...baseOptions,
      koPoint: { x: 3, y: 3 }
    })!
    expect(choice.mode).toBe('search')
    expect(choice.label).not.toBe('D10')
  })

  it('passes only when the searched engine says so, not the human policy', () => {
    const raw = rawWithHumanPolicy()
    raw.moveInfos = [{ move: 'pass', winrate: 0.5, visits: 64, order: 0 }]
    const choice = chooseKatagoMove(raw, baseOptions)!
    expect(choice.decision).toBe('pass')
    expect(choice.point).toBeNull()
  })

  it('does not trust a pass suggested by an unsearched position', () => {
    const raw = rawWithHumanPolicy()
    raw.moveInfos = [{ move: 'pass', winrate: 0.5, visits: 1, order: 0 }]
    raw.rootInfo = { winrate: 0.5, scoreLead: 0, visits: 1, currentPlayer: 'W' }
    const choice = chooseKatagoMove(raw, baseOptions)!
    expect(choice.decision).toBe('move')
    expect(choice.mode).toBe('human-sl')
  })

  it('returns null on an engine error so the client can fall back', () => {
    expect(chooseKatagoMove({ ...rawWithHumanPolicy(), error: 'oops' }, baseOptions)).toBeNull()
    expect(chooseKatagoMove({ ...rawWithHumanPolicy(), moveInfos: undefined }, baseOptions)).toBeNull()
  })
})
