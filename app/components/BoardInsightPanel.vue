<script setup lang="ts">
import type { BoardInsight } from '~/utils/boardInsight'
import type { ModelStatus } from '~/utils/mentorPrompt'
import type { KatagoAnalysis, KatagoStatus } from '~/utils/katago'

const props = defineProps<{
  insight: BoardInsight
  modelStatus: ModelStatus | null
  latestInsight: string
  modelReview: { summary: string; lesson: string } | null
  isReviewing: boolean
  katagoStatus: KatagoStatus | null
  katagoAnalysis: KatagoAnalysis | null
  isAnalyzing: boolean
  showEngine: boolean
}>()

const emit = defineEmits<{
  review: []
  analyze: []
  toggleEngine: []
}>()

const blackShare = computed(() => {
  const black = props.insight.stones.black + props.insight.influence.black
  const white = props.insight.stones.white + props.insight.influence.white + 3.25
  return Math.round((black / Math.max(1, black + white)) * 100)
})

const statusLabel = computed(() => {
  if (!props.modelStatus) return '检测中…'
  if (!props.modelStatus.configured) return '模板模式 · 未配置密钥'
  if (!props.modelStatus.online) return `模型离线 · ${props.modelStatus.reason ?? '网关不可达'}`
  return `模型在线 · ${props.modelStatus.model}`
})

const statusOnline = computed(() => Boolean(props.modelStatus?.online))
</script>

<template>
  <section
    class="flex flex-col gap-3 rounded-2xl bg-white/85 px-4 py-3.5 shadow-lg shadow-stone-900/5 ring-1 ring-stone-900/5"
  >
    <header class="flex items-center justify-between gap-2">
      <div>
        <h2 class="text-sm font-semibold text-stone-900">局面分析</h2>
        <p class="text-[11px] text-stone-500">每一步实时重算 · 规则引擎 + 模型</p>
      </div>
      <span
        class="flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold"
        :class="statusOnline ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'"
        :title="modelStatus ? `网关 ${modelStatus.gateway}` : ''"
      >
        <span
          class="size-1.5 rounded-full"
          :class="statusOnline ? 'bg-emerald-500' : 'bg-stone-400'"
        />
        {{ statusLabel }}
      </span>
    </header>

    <!-- Position bar -->
    <div>
      <div class="mb-1 flex items-center justify-between text-[11px] font-medium text-stone-600">
        <span>黑 {{ insight.stones.black + insight.influence.black }} 点</span>
        <span class="text-stone-800">{{ insight.lead.label }}</span>
        <span>白 {{ (insight.stones.white + insight.influence.white + 3.25).toFixed(1) }} 点</span>
      </div>
      <div class="flex h-2 overflow-hidden rounded-full bg-stone-200">
        <div class="bg-stone-800 transition-all duration-500" :style="{ width: `${blackShare}%` }" />
        <div class="flex-1 bg-stone-100" />
      </div>
    </div>

    <!-- Top candidate moves -->
    <div>
      <h3 class="mb-1.5 text-[11px] font-semibold text-stone-700">
        AI 候选落点
        <span class="font-normal text-stone-400">· 本地引擎打分</span>
      </h3>
      <ol class="space-y-1">
        <li
          v-for="(candidate, index) in insight.candidates"
          :key="candidate.label"
          class="flex items-start gap-2 rounded-lg bg-stone-50 px-2 py-1.5"
        >
          <span
            class="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white"
            :class="index === 0 ? 'bg-blue-600' : index === 1 ? 'bg-violet-600' : 'bg-stone-400'"
          >
            {{ index + 1 }}
          </span>
          <div class="min-w-0">
            <p class="text-[11.5px] font-semibold text-stone-800">
              {{ candidate.label }}
              <span class="ml-1 font-normal text-stone-500">{{ candidate.score }} 分</span>
              <span
                v-for="tag in candidate.tags"
                :key="tag"
                class="ml-1 rounded bg-white px-1 py-0.5 text-[9px] text-stone-500 ring-1 ring-stone-200"
              >
                {{ tag }}
              </span>
            </p>
            <p class="text-[10.5px] leading-relaxed text-stone-500">{{ candidate.reason }}</p>
          </div>
        </li>
        <li v-if="insight.candidates.length === 0" class="text-[11px] text-stone-400">
          没有可下的点了
        </li>
      </ol>
    </div>

    <!-- Threats -->
    <div v-if="insight.captureChances.length > 0">
      <h3 class="mb-1.5 text-[11px] font-semibold text-stone-700">只剩 1 气的棋块</h3>
      <ul class="space-y-1">
        <li
          v-for="chance in insight.captureChances.slice(0, 4)"
          :key="`${chance.color}-${chance.label}`"
          class="flex items-center gap-2 rounded-lg px-2 py-1 text-[11px]"
          :class="chance.forHuman ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'"
        >
          <span class="size-2 shrink-0 rounded-full" :class="chance.forHuman ? 'bg-rose-500' : 'bg-amber-500'" />
          <span class="truncate">
            {{ chance.color === 'black' ? '黑' : '白' }} {{ chance.label }}（{{ chance.size }} 子）
            · {{ chance.forHuman ? '补在' : '可提在' }} {{ chance.at }}
          </span>
        </li>
      </ul>
    </div>

    <!-- Local advice -->
    <p class="rounded-xl bg-stone-900/90 px-3 py-2 text-[11px] leading-relaxed text-amber-50">
      {{ insight.advice }}
    </p>

    <!-- Model-driven insight / review -->
    <div
      v-if="modelReview || latestInsight"
      class="rounded-xl border border-violet-200 bg-violet-50/80 px-3 py-2"
    >
      <p class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
        {{ modelReview ? '模型复盘' : '模型洞察' }}
      </p>
      <p class="text-[11.5px] leading-relaxed text-violet-900">
        {{ modelReview?.summary ?? latestInsight }}
      </p>
      <p v-if="modelReview" class="mt-1 text-[11px] font-medium text-violet-700">
        接下来练：{{ modelReview.lesson }}
      </p>
    </div>

    <!-- Optional native engine: real MCTS, not a heuristic score -->
    <div class="rounded-xl border border-teal-200 bg-teal-50/70 px-3 py-2.5">
      <div class="mb-1.5 flex items-center justify-between gap-2">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-teal-700">
          KataGo 深度搜索
        </p>
        <span
          class="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
          :class="katagoStatus?.available ? 'bg-teal-600 text-white' : 'bg-white/80 text-teal-800'"
          :title="katagoStatus?.reason ?? ''"
        >
          <span
            class="size-1.5 rounded-full"
            :class="katagoStatus?.available ? 'bg-amber-300' : 'bg-stone-400'"
          />
          {{
            katagoStatus?.available
              ? `引擎就绪 ${katagoStatus.version ?? ''}`
              : katagoStatus?.configured
                ? '引擎未就绪'
                : '未安装（可选）'
          }}
        </span>
      </div>

      <p v-if="!katagoStatus?.configured" class="text-[10.5px] leading-relaxed text-teal-900/75">
        未配置原生引擎。当前气数、势力、候选点全部由本地规则算法算出，语言模型负责讲解。
        按 README 装好 KataGo 后，这里会给出真实 MCTS 胜率与目差。
      </p>
      <template v-else-if="katagoAnalysis">
        <p class="text-[11.5px] font-semibold text-teal-900">
          黑胜率 {{ Math.round(katagoAnalysis.blackWinrate * 100) }}% ·
          {{ katagoAnalysis.blackLead >= 0 ? '黑' : '白' }}领先
          {{ Math.abs(katagoAnalysis.blackLead).toFixed(1) }} 目
        </p>
        <p class="mt-0.5 text-[10.5px] text-teal-800">
          最佳 {{ katagoAnalysis.bestMove }} · 搜索 {{ katagoAnalysis.visits }} 次 ·
          黑方归属以蓝色方格显示
        </p>
        <label class="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[10.5px] text-teal-800">
          <input
            type="checkbox"
            :checked="showEngine"
            class="accent-teal-700"
            @change="emit('toggleEngine')"
          />
          在棋盘上显示归属热力与 KataGo 候选点
        </label>
      </template>
      <p v-else class="text-[10.5px] text-teal-900/75">
        引擎已配置。点下方按钮做一次真实搜索，结果会同时喂给语言模型做复盘。
      </p>

      <button
        type="button"
        class="mt-2 w-full rounded-xl bg-teal-700 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="isAnalyzing"
        @click="emit('analyze')"
      >
        {{ isAnalyzing ? '正在搜索…' : '跑一次 KataGo 深度分析' }}
      </button>
    </div>

    <button
      type="button"
      class="w-full rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="isReviewing"
      @click="emit('review')"
    >
      {{ isReviewing ? '正在读盘…' : '让 AI 讲讲这盘' }}
    </button>
  </section>
</template>
