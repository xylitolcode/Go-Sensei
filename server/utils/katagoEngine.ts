import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import type { Board } from '../../app/utils/goRules'
import {
  normalizeAnalysis,
  type KatagoAnalysis,
  type KatagoFailure,
  type KatagoRawResponse
} from '../../app/utils/katago'
import type { KatagoConfig } from './katagoConfig'

/**
 * A long-lived KataGo "analysis" subprocess. KataGo loads a ~100-400 MB
 * network at startup, so we keep ONE process alive and multiplex queries by
 * `id` over its stdin/stdout instead of spawning per request.
 *
 * Protocol: `katago analysis -config <cfg> -model <net>`, one JSON object per
 * line on stdin, one JSON object per line on stdout. See docs/Analysis_Engine.md.
 */

type EngineResult<T> = { ok: true; value: T } | { ok: false; reason: KatagoFailure; detail?: string }

interface Pending {
  resolve: (value: KatagoRawResponse) => void
  reject: (error: { reason: KatagoFailure; detail?: string }) => void
  timer: ReturnType<typeof setTimeout>
}

const GLOBAL_KEY = '__goSenseiKatagoEngine'
type GlobalWithEngine = Record<string, unknown> & {
  [GLOBAL_KEY]?: { key: string; engine: KatagoEngine }
}

export class KatagoEngine {
  private child: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<EngineResult<null>> | null = null
  private pending = new Map<string, Pending>()
  private stderrLines: string[] = []
  private lastError: string | null = null
  /**
   * A configured-but-missing human SL net is NOT an error: the engine simply
   * starts without `-human-model` and rank play degrades to visit-limited
   * search instead of true human-policy imitation.
   */
  readonly humanModelActive: boolean

  constructor(private readonly config: KatagoConfig) {
    this.humanModelActive = Boolean(config.humanModel) && existsSync(config.humanModel)
  }

  private get key() {
    const { binary, config, model, humanModel } = this.config
    return `${binary}|${config}|${model}|${humanModel}`
  }

  private missingFiles(): string[] {
    return [
      ['binary', this.config.binary],
      ['config', this.config.config],
      ['model', this.config.model]
    ]
      .filter(([, path]) => !path || !existsSync(String(path)))
      .map(([name]) => String(name))
  }

  private async ensureStarted(): Promise<EngineResult<null>> {
    if (this.child && !this.child.killed && this.child.exitCode === null) {
      return { ok: true, value: null }
    }
    if (this.starting) return this.starting

    this.starting = (async (): Promise<EngineResult<null>> => {
      const missing = this.missingFiles()
      if (missing.length > 0) {
        return { ok: false, reason: 'missing-files', detail: missing.join(', ') }
      }

      try {
        const args = ['analysis', '-config', this.config.config, '-model', this.config.model]
        if (this.humanModelActive) {
          args.push('-human-model', this.config.humanModel)
        }
        const child = spawn(this.config.binary, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        })
        this.child = child
        this.lastError = null

        createInterface({ input: child.stdout }).on('line', (line) => this.onLine(line))
        child.stderr?.on('data', (chunk: Buffer | string) => {
          const text = String(chunk).trim()
          if (!text) return
          this.stderrLines.push(text)
          if (this.stderrLines.length > 20) this.stderrLines.shift()
        })
        child.on('error', (error) => {
          this.lastError = error.message
          this.rejectAll('spawn-failed')
        })
        child.on('exit', (code) => {
          this.lastError = this.stderrLines.slice(-3).join(' | ') || `exit ${code}`
          this.rejectAll('exited')
          this.child = null
          this.starting = null
          const holder = globalThis as unknown as GlobalWithEngine
          if (holder[GLOBAL_KEY]?.engine === this) delete holder[GLOBAL_KEY]
        })

        // Wait until the engine answers query_version = model is loaded & ready.
        const version = await this.query(
          { id: 'probe-version', action: 'query_version' },
          Math.max(this.config.timeoutMs, 45000)
        )
        if (!version.ok) {
          // A half-started engine is useless: kill it so the next request retries
          // from scratch (e.g. after the user finally installs the weights).
          this.shutdown()
          return { ok: false, reason: version.reason, detail: version.detail }
        }

        // ONNX/DirectML builds compile their execution graph on the FIRST
        // neural-net evaluation. Measured on a 4060 laptop: first analysis
        // exceeded 25s while the next one took 4s. Pay that cost while the
        // app is idle instead of failing the student's first click.
        // Fire-and-forget: it must not slow down /api/katago-status.
        void this.query(
          {
            id: 'probe-warmup',
            rules: 'chinese',
            komi: 6.5,
            boardXSize: 13,
            boardYSize: 13,
            moves: [],
            maxVisits: 8,
            includeOwnership: false
          },
          Math.max(this.config.timeoutMs, 90000)
        )
        return { ok: true, value: null }
      } catch (error) {
        this.shutdown()
        return {
          ok: false,
          reason: 'spawn-failed',
          detail: error instanceof Error ? error.message : String(error)
        }
      } finally {
        this.starting = null
      }
    })()

    return this.starting
  }

  private onLine(line: string) {
    let data: KatagoRawResponse
    try {
      data = JSON.parse(line) as KatagoRawResponse
    } catch {
      return // KataGo prints non-JSON startup banners on stdout sometimes.
    }
    if (typeof data?.id !== 'string') return
    // Partial reports and bare warnings are not final answers.
    if (data.isDuringSearch === true) return
    const isFinal =
      Boolean(data.error) ||
      Boolean(data.version) ||
      Array.isArray(data.moveInfos) ||
      Boolean(data.rootInfo) ||
      Boolean(data.noResults)
    if (!isFinal && data.warning) return

    const entry = this.pending.get(data.id)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(data.id)
    if (data.error) {
      entry.reject({ reason: 'engine-error', detail: String(data.error) })
    } else {
      entry.resolve(data)
    }
  }

  private query(
    payload: Record<string, unknown>,
    timeoutMs = this.config.timeoutMs
  ): Promise<EngineResult<KatagoRawResponse>> {
    const child = this.child
    if (!child) return Promise.resolve({ ok: false, reason: 'exited' })
    const id = String(payload.id)

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ ok: false, reason: 'timeout' })
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (value) => resolve({ ok: true, value }),
        reject: (error) => resolve({ ok: false, ...error }),
        timer
      })
      try {
        // Analysis Engine requires a SINGLE LINE of JSON per query.
        child.stdin.write(`${JSON.stringify(payload)}\n`)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve({
          ok: false,
          reason: 'spawn-failed',
          detail: error instanceof Error ? error.message : String(error)
        })
      }
    })
  }

  private rejectAll(reason: KatagoFailure) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject({ reason, detail: this.lastError ?? undefined })
    }
    this.pending.clear()
  }

  async probe(): Promise<EngineResult<KatagoRawResponse>> {
    const started = await this.ensureStarted()
    if (!started.ok) return started
    const result = await this.query(
      { id: `version-${Date.now()}`, action: 'query_version' },
      Math.min(this.config.timeoutMs, 15000)
    )
    return result
  }

  async analyze(
    query: Record<string, unknown>,
    board: Board
  ): Promise<EngineResult<KatagoAnalysis>> {
    const started = await this.ensureStarted()
    if (!started.ok) return started

    // If the background warmup hasn't finished yet, this request may queue
    // behind the engine's one-shot graph compilation. Give it headroom.
    const result = await this.query(query, Math.max(this.config.timeoutMs, 60000))
    if (!result.ok) return result
    const analysis = normalizeAnalysis(result.value, board, {
      winrateAsBlack: this.config.winrateAsBlack,
      ...(this.config.ownershipSign !== 0
        ? { ownershipSign: this.config.ownershipSign as 1 | -1 }
        : {})
    })
    if (!analysis) {
      return { ok: false, reason: 'invalid-reply', detail: JSON.stringify(result.value).slice(0, 200) }
    }
    return { ok: true, value: analysis }
  }

  /** Raw one-shot query for the opponent-move endpoint (ranking needs policy). */
  async play(query: Record<string, unknown>): Promise<EngineResult<KatagoRawResponse>> {
    const started = await this.ensureStarted()
    if (!started.ok) return started
    // High-visit ranks (pro = 800 visits) can take ~40s on DirectML plus
    // first-query compilation; 90s keeps them from silently degrading to the
    // local heuristic engine.
    return this.query(query, Math.max(this.config.timeoutMs, 90000))
  }

  describeFailure(reason: KatagoFailure): string {
    const extras = [this.lastError, ...this.stderrLines.slice(-2)].filter(Boolean).join(' | ')
    return extras ? `${reason}: ${extras.slice(0, 240)}` : reason
  }

  shutdown() {
    this.rejectAll('exited')
    if (this.child) {
      try {
        this.child.stdin.end()
      } catch {
        // already closed
      }
      this.child.kill()
      this.child = null
    }
    this.starting = null
  }
}

/**
 * Returns null on a normal Node runtime, or a human-readable reason on an edge
 * runtime (Cloudflare Workers and friends).
 *
 * Why this exists: workerd has neither child processes nor a real filesystem.
 * `node:child_process` and `node:fs` get replaced with stubs at build time, and
 * the stub for `existsSync` always returns FALSE — which made `missingFiles()`
 * report "binary, config, model" even when all three paths were configured.
 * That is a lie the status endpoint would happily show to the student, so we
 * detect the runtime and say what is actually going on.
 */
export function edgeRuntimeBlock(): string | null {
  const ua = (globalThis as { navigator?: { userAgent?: unknown } }).navigator?.userAgent
  if (typeof ua === 'string' && ua.includes('Cloudflare-Workers')) {
    return 'unsupported-runtime: 边缘运行时没有子进程和文件系统，KataGo 只能在本地 Node 环境运行'
  }
  return null
}

/** Returns null when KataGo is not configured at all (the default). */
export function getKatagoEngine(config: KatagoConfig): KatagoEngine | null {
  if (!config.binary || !config.config || !config.model) return null
  // Never build an engine we cannot possibly start on this runtime.
  if (edgeRuntimeBlock()) return null
  const holder = globalThis as unknown as GlobalWithEngine
  const existing = holder[GLOBAL_KEY]
  const key = `${config.binary}|${config.config}|${config.model}|${config.humanModel}`
  if (existing && existing.key === key) return existing.engine
  existing?.engine.shutdown()
  const engine = new KatagoEngine(config)
  holder[GLOBAL_KEY] = { key, engine }
  return engine
}
