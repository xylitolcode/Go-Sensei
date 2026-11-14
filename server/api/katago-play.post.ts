import type { Point, StoneColor } from '../../app/utils/goRules'
import {
  buildPlayQuery,
  chooseKatagoMove,
  normalizeOpponentRank,
  rankProfile,
  type KatagoPlayResponse,
  type KatagoQueryMove
} from '../../app/utils/katago'
import { getKatagoEngine } from '../utils/katagoEngine'
import { readKatagoConfig } from '../utils/katagoConfig'

interface PlayBody {
  board: ('black' | 'white' | null)[][]
  moves: { color: StoneColor; point: Point | null }[]
  nextColor: StoneColor
  rank?: string
  komiStones?: number
  /** Ko ban that applies to `nextColor`, from the client's rule engine. */
  koPoint?: Point | null
}

/**
 * KataGo plays the opponent's move at a chosen rank. Anything that fails
 * returns `source: 'unavailable'` (never a 500) so the client can fall back
 * to the local heuristic engine without breaking the game.
 */
export default defineEventHandler(async (event): Promise<KatagoPlayResponse> => {
  const body = await readBody<PlayBody>(event)
  if (!Array.isArray(body?.board) || !Array.isArray(body?.moves) || !body?.nextColor) {
    return { source: 'unavailable', reason: 'bad-request' }
  }

  const config = readKatagoConfig(useRuntimeConfig(event))
  const engine = getKatagoEngine(config)
  if (!engine) return { source: 'unavailable', reason: 'not-configured' }

  const rank = normalizeOpponentRank(body.rank)
  const profile = rankProfile(rank)
  const humanMode = engine.humanModelActive && profile.humanSLProfile !== null

  const moves: KatagoQueryMove[] = body.moves
    .filter((move) => move && (move.color === 'black' || move.color === 'white'))
    .map((move) => ({
      color: move.color,
      point:
        move.point &&
        Number.isInteger(move.point.x) &&
        Number.isInteger(move.point.y)
          ? { x: move.point.x, y: move.point.y }
          : null
    }))

  const query = buildPlayQuery({
    id: `play-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    board: body.board,
    moves,
    nextColor: body.nextColor,
    komiStones: body.komiStones,
    profile,
    humanModel: engine.humanModelActive
  })

  const result = await engine.play(query)
  if (!result.ok) {
    return { source: 'unavailable', reason: engine.describeFailure(result.reason) }
  }

  const koPoint =
    body.koPoint &&
    Number.isInteger(body.koPoint.x) &&
    Number.isInteger(body.koPoint.y)
      ? { x: body.koPoint.x, y: body.koPoint.y }
      : null

  const choice = chooseKatagoMove(result.value, {
    board: body.board,
    color: body.nextColor,
    koPoint,
    profile,
    humanMode
  })
  if (!choice) return { source: 'unavailable', reason: 'no-legal-move' }

  return {
    source: 'katago',
    point: choice.point,
    label: choice.label,
    decision: choice.decision,
    mode: choice.mode,
    rank
  }
})
