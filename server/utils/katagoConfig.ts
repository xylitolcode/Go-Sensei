export interface KatagoConfig {
  binary: string
  config: string
  model: string
  /** Optional b18c384nbt-humanv0.bin.gz — enables real rank imitation. */
  humanModel: string
  maxVisits: number
  timeoutMs: number
  ownershipSign: -1 | 0 | 1
  winrateAsBlack: boolean
}

/** Single place that maps NUXT_KATAGO_* runtime config into engine options. */
export function readKatagoConfig(rc: Record<string, any>): KatagoConfig {
  const katago = (rc?.katago ?? {}) as Record<string, unknown>
  const sign = Number(katago.ownershipSign ?? 0)
  return {
    binary: String(katago.binary ?? '').trim(),
    config: String(katago.config ?? '').trim(),
    model: String(katago.model ?? '').trim(),
    humanModel: String(katago.humanModel ?? '').trim(),
    maxVisits: Number(katago.maxVisits) || 200,
    timeoutMs: Number(katago.timeoutMs) || 25000,
    ownershipSign: sign === -1 ? -1 : sign === 1 ? 1 : 0,
    winrateAsBlack: String(katago.winrateAsBlack ?? 'true') !== 'false'
  }
}
