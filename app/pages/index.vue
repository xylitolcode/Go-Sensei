<script setup lang="ts">
import { useGameStore } from '~/stores/game'
import { TEACHING_PHASES, type TeachingPhase } from '~/utils/teaching'
import { RANK_PROFILES, rankProfile } from '~/utils/katago'

useHead({ title: 'Go Sensei · 13×13 围棋入门' })

const game = useGameStore()

const sideTab = ref<'chat' | 'insight' | 'profile'>('chat')

/** Live board overlays — first three are local, the fourth needs KataGo. */
const overlays = ref({ liberties: true, territory: false, candidates: true, engine: false })
const VIEW_OPTIONS = [
  { key: 'liberties', label: '气数热力' },
  { key: 'territory', label: '势力范围' },
  { key: 'candidates', label: 'AI 候选点' },
  { key: 'engine', label: 'KataGo 热力' }
] as const

function toggleView(key: (typeof VIEW_OPTIONS)[number]['key']) {
  overlays.value[key] = !overlays.value[key]
}

function toggleEngineOverlay() {
  overlays.value.engine = !overlays.value.engine
}

async function analyzeWithKatago() {
  await game.analyzeWithKatago()
  if (game.katagoAnalysis) overlays.value.engine = true
}

onMounted(() => {
  game.loadOpponentSettings()
  game.probeModel()
  game.probeKatago()
})

function onPhaseChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as TeachingPhase
  game.setPhase(value)
}

function onRankChange(event: Event) {
  game.setOpponentRank((event.target as HTMLSelectElement).value)
}

function onOpponentToggle(event: Event) {
  game.setUseKatagoOpponent((event.target as HTMLInputElement).checked)
}

/** Honest header label: says when ranks are real and when they are approximated. */
const opponentChip = computed(() => {
  const rank = rankProfile(game.opponentRank).label
  if (!game.useKatagoOpponent) {
    return {
      text: '本地 AI 执白',
      tone: 'muted' as const,
      title: '已关闭 KataGo 执白，对手使用本地加权打分'
    }
  }
  if (!game.katagoStatus?.available) {
    return {
      text: `KataGo 未就绪 · ${rank}`,
      tone: 'muted' as const,
      title: '引擎不可用时会自动回退到本地 AI，对局不会卡住'
    }
  }
  const genuine = game.katagoStatus?.humanModel
  return {
    text: `KataGo 执白 · ${rank}`,
    tone: 'active' as const,
    title: genuine
      ? '已加载 human SL 网络，段位按官方 humanSLProfile 真人棋风模拟'
      : '未加载 human SL 网络：段位由搜索预算 + 候选采样近似，不是真人棋风'
  }
})

const resultSummary = computed(() => {
  const result = game.gameResult
  if (!result) return null
  const score = result.score
  const label =
    result.studentResult === 'win'
      ? '你赢了'
      : result.studentResult === 'lose'
        ? '这盘你输了'
        : '和棋'
  return {
    label,
    black: score.blackCount,
    white: score.whiteCount,
    margin: Math.abs(score.margin),
    removed: result.removedStones,
    moves: result.moves
  }
})
</script>

<template>
  <main class="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:py-8">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="grid size-11 place-items-center rounded-2xl bg-stone-900 shadow-lg shadow-stone-900/20">
          <span class="size-6 rounded-full bg-gradient-to-br from-stone-100 to-stone-400 shadow-inner" />
        </div>
        <div>
          <h1 class="text-lg font-semibold tracking-tight text-stone-900 sm:text-xl">Go Sensei</h1>
          <p class="text-xs text-stone-500 sm:text-sm">13 路围棋 · 每一步都有导师陪你看</p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <span
          class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          :class="
            game.modelStatus?.online
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-stone-200/70 text-stone-600'
          "
          :title="
            game.modelStatus
              ? `模型 ${game.modelStatus.model} · 网关 ${game.modelStatus.gateway}`
              : '正在检测模型连接'
          "
        >
          <span
            class="size-1.5 rounded-full"
            :class="game.modelStatus?.online ? 'bg-emerald-500' : 'bg-stone-400'"
          />
          {{
            !game.modelStatus
              ? '检测模型中…'
              : game.modelStatus.online
                ? '模型已接通'
                : game.modelStatus.configured
                  ? '模型离线'
                  : '模板模式'
          }}
        </span>
        <label
          class="flex cursor-pointer items-center gap-1.5 rounded-xl border border-stone-300 bg-white/80 px-2.5 py-1.5 text-[11px] font-semibold text-stone-600"
          title="默认只在提子、叫吃、好坏手等关键节点调用模型；打开后每一手都会请求一次"
        >
          <input v-model="game.alwaysAskModel" type="checkbox" class="accent-violet-600" />
          每手都问模型
        </label>
        <span
          class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          :class="
            opponentChip.tone === 'active'
              ? 'bg-violet-100 text-violet-800'
              : 'bg-stone-200/70 text-stone-600'
          "
          :title="opponentChip.title"
        >
          <span
            class="size-1.5 rounded-full"
            :class="opponentChip.tone === 'active' ? 'bg-violet-500' : 'bg-stone-400'"
          />
          {{ opponentChip.text }}
        </span>
        <label
          class="flex cursor-pointer items-center gap-1.5 rounded-xl border border-stone-300 bg-white/80 px-2.5 py-1.5 text-[11px] font-semibold text-stone-600"
          title="打开后由 KataGo 搜索执白；关闭或引擎不可用时自动回退本地 AI"
        >
          <input
            type="checkbox"
            class="accent-violet-600"
            :checked="game.useKatagoOpponent"
            @change="onOpponentToggle"
          />
          KataGo 执白
        </label>
        <label class="text-xs font-medium text-stone-500" for="rank-select">对手段位</label>
        <select
          id="rank-select"
          :value="game.opponentRank"
          class="rounded-xl border border-stone-300 bg-white/85 px-3 py-2 text-xs font-semibold text-stone-700 shadow-sm outline-none transition focus:border-stone-500"
          @change="onRankChange"
        >
          <option v-for="option in RANK_PROFILES" :key="option.rank" :value="option.rank">
            {{ option.label }}
          </option>
        </select>
        <label class="text-xs font-medium text-stone-500" for="phase-select">教学重点</label>
        <select
          id="phase-select"
          :value="game.phase"
          class="rounded-xl border border-stone-300 bg-white/85 px-3 py-2 text-xs font-semibold text-stone-700 shadow-sm outline-none transition focus:border-stone-500"
          @change="onPhaseChange"
        >
          <option v-for="phase in TEACHING_PHASES" :key="phase.value" :value="phase.value">
            {{ phase.label }}
          </option>
        </select>
      </div>
    </header>

    <section class="grid flex-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div class="flex min-w-0 flex-col gap-3">
        <div
          class="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/80 px-4 py-3 shadow-sm ring-1 ring-stone-900/5"
        >
          <div class="flex items-center gap-2.5">
            <span
              class="size-4 rounded-full shadow-sm"
              :class="
                game.currentPlayer === 'black'
                  ? 'bg-gradient-to-br from-stone-600 to-black'
                  : 'border border-stone-300 bg-gradient-to-br from-white to-stone-300'
              "
            />
            <span class="text-sm font-medium text-stone-800">{{ game.statusLabel }}</span>
            <span class="text-[11px] text-stone-400">第 {{ game.moveHistory.length + 1 }} 手</span>
          </div>

          <div class="flex items-center gap-4 text-xs text-stone-600">
            <span class="flex items-center gap-1.5">
              <span class="size-3 rounded-full bg-gradient-to-br from-stone-600 to-black" />
              提子 {{ game.capturedStones.black }}
            </span>
            <span class="flex items-center gap-1.5">
              <span class="size-3 rounded-full border border-stone-300 bg-white" />
              提子 {{ game.capturedStones.white }}
            </span>
          </div>
        </div>

        <div
          class="flex flex-wrap items-center gap-2 rounded-2xl bg-white/70 px-3 py-2 shadow-sm ring-1 ring-stone-900/5"
        >
          <span class="mr-1 text-[11px] font-semibold text-stone-600">智能视图</span>
          <button
            v-for="option in VIEW_OPTIONS"
            :key="option.key"
            type="button"
            class="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition"
            :class="
              overlays[option.key]
                ? 'bg-stone-900 text-amber-50 shadow-sm'
                : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
            "
            :aria-pressed="overlays[option.key]"
            @click="toggleView(option.key)"
          >
            {{ option.label }}
          </button>
          <button
            type="button"
            class="ml-auto rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="game.isReviewing"
            @click="game.askForReview()"
          >
            {{ game.isReviewing ? 'AI 正在读盘…' : '让 AI 讲讲这盘' }}
          </button>
        </div>

        <div class="rounded-[28px] bg-white/70 p-3 shadow-xl shadow-stone-900/5 ring-1 ring-stone-900/5 sm:p-5">
          <GoBoard
            :stones="game.stones"
            :last-move="game.lastMove"
            :next-color="game.currentPlayer"
            :disabled="game.isAiThinking"
            :highlights="game.activeFeedback?.highlights ?? []"
            :annotations="game.activeFeedback?.annotations ?? []"
            :demo-move="game.activeFeedback?.demoMove ?? null"
            :insight="game.boardInsight"
            :overlays="overlays"
            :focus-points="game.modelFocus"
            :ownership="game.katagoAnalysis?.ownership ?? null"
            :engine-moves="game.katagoAnalysis?.topMoves ?? []"
            @intersect="game.play($event)"
          />
        </div>

        <div
          v-if="resultSummary"
          class="rounded-2xl bg-stone-900/90 px-4 py-3.5 text-sm text-stone-100 shadow-lg"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="font-semibold text-amber-50">
              对局结束 · {{ resultSummary.label }}
              <span class="ml-1 text-xs font-normal text-stone-300">
                差 {{ resultSummary.margin }} 子
              </span>
            </p>
            <button
              type="button"
              class="rounded-lg bg-amber-50/90 px-3 py-1.5 text-xs font-semibold text-stone-900 transition hover:bg-white"
              @click="game.newGame()"
            >
              开始新对局
            </button>
          </div>
          <p class="mt-1.5 text-[11px] leading-relaxed text-stone-300">
            中国规则数子法（黑贴白 3¼ 子）：黑 {{ resultSummary.black }} 子 · 白
            {{ resultSummary.white }} 子 · 共 {{ resultSummary.moves }} 手
            <template v-if="resultSummary.removed > 0">
              · 结算前自动提掉 {{ resultSummary.removed }} 颗死子
            </template>
          </p>
        </div>

        <GameControls
          :can-pass="game.canPass"
          :can-undo="game.canUndo"
          :can-finish="game.moveHistory.length > 0 && !game.gameResult"
          @pass="game.pass()"
          @undo="game.undo()"
          @new-game="game.newGame()"
          @finish="game.finishGame()"
        />

        <div
          class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-dashed border-stone-300 px-4 py-2.5 text-[11px] text-stone-500"
        >
          <span class="font-medium text-stone-600">棋盘标记</span>
          <span class="flex items-center gap-1.5">
            <span class="size-2.5 rounded-full border-2 border-emerald-600" />好棋
          </span>
          <span class="flex items-center gap-1.5">
            <span class="size-2.5 rounded-full border-2 border-orange-500" />危险
          </span>
          <span class="flex items-center gap-1.5">
            <span class="size-2.5 rounded-full border-2 border-dashed border-blue-600" />高手位置
          </span>
          <span class="flex items-center gap-1.5">
            <span class="size-2.5 rounded-full border-2 border-yellow-500" />机会
          </span>
          <span class="flex items-center gap-1.5">
            <span class="grid size-3.5 place-items-center rounded-full bg-teal-700 text-[8px] font-bold text-white">3</span>
            该块的气数
          </span>
          <span class="flex items-center gap-1.5">
            <span class="size-2.5 rounded-full border-2 border-blue-600" />AI 候选 1/2/3
          </span>
          <span class="flex items-center gap-1.5">
            <span class="size-2.5 rounded-full border-2 border-dashed border-violet-600" />模型圈出的重点
          </span>
        </div>
      </div>

      <aside class="flex min-h-0 flex-col gap-3 lg:sticky lg:top-6 lg:h-[calc(100dvh-6rem)]">
        <div class="flex gap-1 rounded-2xl bg-white/80 p-1 shadow-sm ring-1 ring-stone-900/5">
          <button
            type="button"
            class="flex-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition"
            :class="
              sideTab === 'chat'
                ? 'bg-stone-900 text-amber-50'
                : 'text-stone-500 hover:bg-stone-100'
            "
            @click="sideTab = 'chat'"
          >
            导师对话
          </button>
          <button
            type="button"
            class="flex-1 rounded-xl px-2 py-1.5 text-xs font-semibold transition"
            :class="
              sideTab === 'insight'
                ? 'bg-stone-900 text-amber-50'
                : 'text-stone-500 hover:bg-stone-100'
            "
            @click="sideTab = 'insight'"
          >
            局面分析
          </button>
          <button
            type="button"
            class="flex-1 rounded-xl px-2 py-1.5 text-xs font-semibold transition"
            :class="
              sideTab === 'profile'
                ? 'bg-stone-900 text-amber-50'
                : 'text-stone-500 hover:bg-stone-100'
            "
            @click="sideTab = 'profile'"
          >
            成长档案
          </button>
        </div>

        <ChatPanel
          v-if="sideTab === 'chat'"
          class="min-h-[380px] flex-1 lg:min-h-0"
          :messages="game.messages"
          :awaiting-ack="game.awaitingAck"
          :thinking="game.isAiThinking"
          @acknowledge="game.acknowledge()"
        />
        <BoardInsightPanel
          v-else-if="sideTab === 'insight'"
          class="min-h-[380px] flex-1 overflow-y-auto lg:min-h-0"
          :insight="game.boardInsight"
          :model-status="game.modelStatus"
          :latest-insight="game.activeFeedback?.insight ?? game.latestInsight"
          :model-review="game.modelReview"
          :is-reviewing="game.isReviewing"
          :katago-status="game.katagoStatus"
          :katago-analysis="game.katagoAnalysis"
          :is-analyzing="game.isAnalyzing"
          :show-engine="overlays.engine"
          @analyze="analyzeWithKatago()"
          @toggle-engine="toggleEngineOverlay()"
          @review="game.askForReview()"
        />
        <ProfilePanel v-else class="min-h-[380px] flex-1 lg:min-h-0" />

        <p class="rounded-2xl bg-stone-900/90 px-4 py-3 text-[11px] leading-relaxed text-stone-300">
          你执黑，AI 执白。落子后看棋盘标记再点「知道了」，AI 才会应手——节奏由你掌握。
          悔棋会同时撤回你和 AI 的上一手，连同导师的点评。
        </p>
      </aside>
    </section>
  </main>
</template>
