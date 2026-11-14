import type { ModelStatus } from '../../app/utils/mentorPrompt'

/**
 * Read-only probe so the UI can show whether the LLM gateway is actually wired
 * up. It never returns the API key, and it deliberately uses `/models` (a cheap
 * GET) rather than burning a completion just to light up a badge.
 */
export default defineEventHandler(async (event): Promise<ModelStatus> => {
  const config = useRuntimeConfig(event)
  const baseUrl = String(config.llm.baseUrl)
  const apiKey = String(config.llm.apiKey)
  const model = String(config.llm.model)

  let gateway = baseUrl
  try {
    gateway = new URL(baseUrl).host
  } catch {
    // Keep the raw value if a non-standard base URL was configured.
  }

  if (!apiKey) {
    return { configured: false, online: false, model, gateway, reason: 'missing-key' }
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(4000)
    })
    return {
      configured: true,
      online: response.ok,
      model,
      gateway,
      ...(response.ok ? {} : { reason: `http-${response.status}` })
    }
  } catch (error) {
    return {
      configured: true,
      online: false,
      model,
      gateway,
      reason: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unreachable'
    }
  }
})
