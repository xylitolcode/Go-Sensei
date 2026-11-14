import type {
  BoardReviewRequest,
  BoardReviewResponse
} from '../../app/utils/mentorPrompt'
import { requestBoardReview } from '../utils/mentorLlm'

/**
 * A deliberate, student-triggered model call: "explain this whole position".
 * The local engine still supplies every fact; the model only writes the words
 * and picks which of the whitelisted coordinates to circle on the board.
 */
export default defineEventHandler(async (event): Promise<BoardReviewResponse> => {
  const payload = await readBody<BoardReviewRequest>(event)

  if (!payload?.boardSummary || !Array.isArray(payload?.allowedPoints)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'boardSummary and allowedPoints are required'
    })
  }

  const config = useRuntimeConfig(event)
  const result = await requestBoardReview(payload, {
    baseUrl: String(config.llm.baseUrl),
    apiKey: String(config.llm.apiKey),
    model: String(config.llm.model),
    timeoutMs: Number(config.llm.timeoutMs) || 12000
  })

  if (!result.ok) {
    return { source: 'fallback', reason: result.reason }
  }

  return { source: 'llm', review: result.review }
})
