import type { Point, StoneColor } from '../../app/utils/goRules'
import {
  buildAnalysisQuery,
  type KatagoAnalyzeResponse,
  type KatagoQueryMove
} from '../../app/utils/katago'
import { edgeRuntimeBlock, getKatagoEngine } from '../utils/katagoEngine'
import { readKatagoConfig } from '../utils/katagoConfig'

interface AnalyzeBody {
  board: ('black' | 'white' | null)[][]
  moves: { color: StoneColor; point: Point | null }[]
  nextColor: StoneColor
  komiStones?: number
}

/**
 * Whole-position search. Returns 200 with `source: 'unavailable'` instead of
 * throwing when KataGo is not installed, so the UI can degrade to the local
 * rule engine without a scary error.
 */
export default defineEventHandler(async (event): Promise<KatagoAnalyzeResponse> => {
  const body = await readBody<AnalyzeBody>(event)
  if (!Array.isArray(body?.board) || !Array.isArray(body?.moves) || !body?.nextColor) {
    throw createError({
      statusCode: 400,
      statusMessage: 'board, moves and nextColor are required'
    })
  }

  const config = readKatagoConfig(useRuntimeConfig(event))
  const engine = getKatagoEngine(config)
  if (!engine) return { source: 'unavailable', reason: edgeRuntimeBlock() ?? 'not-configured' }

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

  const query = buildAnalysisQuery({
    id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    board: body.board,
    moves,
    nextColor: body.nextColor,
    komiStones: body.komiStones,
    maxVisits: config.maxVisits
  })

  const result = await engine.analyze(query, body.board)
  if (!result.ok) {
    return { source: 'unavailable', reason: engine.describeFailure(result.reason) }
  }
  return { source: 'katago', analysis: result.value }
})
