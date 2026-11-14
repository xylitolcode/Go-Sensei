import type { MentorApiRequest } from '../../app/utils/mentorPrompt'
import { requestMentorMessage } from '../utils/mentorLlm'

export default defineEventHandler(async (event) => {
  const payload = await readBody<MentorApiRequest>(event)

  if (!payload?.moveLabel || !payload?.templateMessage) {
    throw createError({
      statusCode: 400,
      statusMessage: 'moveLabel and templateMessage are required'
    })
  }

  // Template fast path: ordinary moves do not need a model round-trip.
  if (!payload.needsDeepExplanation) {
    return { message: payload.templateMessage, source: 'template' as const }
  }

  const config = useRuntimeConfig(event)
  const result = await requestMentorMessage(payload, {
    baseUrl: String(config.llm.baseUrl),
    apiKey: String(config.llm.apiKey),
    model: String(config.llm.model),
    timeoutMs: Number(config.llm.timeoutMs) || 12000
  })

  if (!result.ok) {
    return { message: payload.templateMessage, source: 'fallback' as const, reason: result.reason }
  }

  return {
    message: result.message,
    source: 'llm' as const,
    insight: result.insight,
    boardFocus: result.boardFocus,
    profileUpdate: result.profileUpdate
  }
})
