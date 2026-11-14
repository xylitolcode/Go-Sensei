import type { KatagoStatus } from '../../app/utils/katago'
import { edgeRuntimeBlock, getKatagoEngine } from '../utils/katagoEngine'
import { readKatagoConfig, type KatagoConfig } from '../utils/katagoConfig'

/**
 * Honest health check. Not configured -> say so; configured but broken ->
 * say why. Probing `query_version` also warms up the engine (model load).
 */
export default defineEventHandler(async (event): Promise<KatagoStatus> => {
  const config: KatagoConfig = readKatagoConfig(useRuntimeConfig(event))
  const isConfigured = Boolean(config.binary && config.config && config.model)

  // Edge runtimes (Cloudflare Workers) cannot start a subprocess at all. Report
  // that reason instead of the misleading "missing-files" that the stubbed
  // `existsSync` would produce.
  const blocked = edgeRuntimeBlock()
  if (blocked) {
    return { configured: isConfigured, available: false, reason: blocked }
  }

  const engine = getKatagoEngine(config)
  if (!engine) {
    return { configured: false, available: false, reason: 'not-configured' }
  }

  const result = await engine.probe()
  if (!result.ok) {
    return {
      configured: true,
      available: false,
      model: config.model.split(/[\\/]/).pop(),
      humanModel: engine.humanModelActive,
      reason: engine.describeFailure(result.reason)
    }
  }
  return {
    configured: true,
    available: true,
    version: result.value.version ?? 'unknown',
    model: config.model.split(/[\\/]/).pop(),
    humanModel: engine.humanModelActive
  }
})
