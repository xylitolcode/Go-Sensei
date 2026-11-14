<script setup lang="ts">
import { useProfileStore } from '~/stores/profile'
import { CONCEPT_LABELS, SKILL_LABELS, levelLabel, type ConceptKey, type SkillKey } from '~/utils/profile'

const profileStore = useProfileStore()

const profile = computed(() => profileStore.profile)

const skills = computed(() =>
  (Object.keys(SKILL_LABELS) as SkillKey[]).map((key) => ({
    key,
    label: SKILL_LABELS[key],
    value: profile.value.skills[key] ?? 0
  }))
)

const mastered = computed(() => profile.value.teachingProgress.conceptsMastered)
const struggling = computed(() => profile.value.teachingProgress.conceptsStruggling)
const introduced = computed(() =>
  profile.value.teachingProgress.conceptsIntroduced.filter(
    (concept) => !mastered.value.includes(concept) && !struggling.value.includes(concept)
  )
)

function conceptText(concept: string): string {
  return CONCEPT_LABELS[concept as ConceptKey] ?? concept
}

function barColor(value: number): string {
  if (value >= 60) return 'bg-emerald-500'
  if (value >= 35) return 'bg-sky-500'
  if (value >= 15) return 'bg-amber-500'
  return 'bg-stone-300'
}

function resultText(result: 'win' | 'lose' | 'unfinished'): string {
  if (result === 'win') return '胜'
  if (result === 'lose') return '负'
  return '未完'
}

function resultClass(result: 'win' | 'lose' | 'unfinished'): string {
  if (result === 'win') return 'bg-emerald-100 text-emerald-700'
  if (result === 'lose') return 'bg-rose-100 text-rose-700'
  return 'bg-stone-100 text-stone-500'
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}/${date.getDate()}`
}
</script>

<template>
  <section
    class="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white/80 shadow-lg shadow-stone-900/5 ring-1 ring-stone-900/5"
  >
    <header class="border-b border-stone-200/80 px-4 py-3">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-sm font-semibold text-stone-900">成长档案</h2>
        <span class="rounded-full bg-stone-900 px-2.5 py-0.5 text-[10px] font-semibold text-amber-50">
          {{ levelLabel(profile.overallLevel) }}
        </span>
      </div>
      <p class="mt-1 text-xs text-stone-500">
        已下 {{ profile.totalGames }} 盘 · 共 {{ profile.totalMoves }} 手 · 水平 {{ profile.overallLevel }}/100
      </p>
    </header>

    <div class="flex-1 space-y-4 overflow-y-auto px-4 py-4">
      <section>
        <h3 class="mb-2 text-[11px] font-semibold tracking-wide text-stone-500">能力评估</h3>
        <ul class="space-y-1.5">
          <li v-for="skill in skills" :key="skill.key">
            <div class="flex items-center justify-between text-[11px] text-stone-600">
              <span>{{ skill.label }}</span>
              <span class="tabular-nums text-stone-400">{{ skill.value }}</span>
            </div>
            <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
              <div
                class="h-full rounded-full transition-[width] duration-500"
                :class="barColor(skill.value)"
                :style="{ width: `${Math.max(3, skill.value)}%` }"
              />
            </div>
          </li>
        </ul>
      </section>

      <section>
        <h3 class="mb-2 text-[11px] font-semibold tracking-wide text-stone-500">概念进度</h3>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="concept in mastered"
            :key="`m-${concept}`"
            class="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200"
          >
            ✅ {{ conceptText(concept) }}
          </span>
          <span
            v-for="concept in introduced"
            :key="`i-${concept}`"
            class="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-sky-200"
          >
            {{ conceptText(concept) }}
          </span>
          <span
            v-for="concept in struggling"
            :key="`s-${concept}`"
            class="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-rose-200"
          >
            {{ conceptText(concept) }} · 要练
          </span>
          <p v-if="mastered.length + introduced.length + struggling.length === 0" class="text-[11px] text-stone-400">
            下几手棋，这里就会记录你学会的概念。
          </p>
        </div>
        <p v-if="profile.teachingProgress.currentFocusArea" class="mt-2 text-[11px] text-stone-500">
          当前教学重点：<span class="font-medium text-stone-700">{{ profile.teachingProgress.currentFocusArea }}</span>
        </p>
      </section>

      <section v-if="profile.habits.tendsTo.length || profile.habits.weaknesses.length || profile.habits.recentImprovements.length">
        <h3 class="mb-2 text-[11px] font-semibold tracking-wide text-stone-500">习惯标签</h3>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="habit in profile.habits.tendsTo"
            :key="`t-${habit}`"
            class="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600"
          >
            {{ habit }}
          </span>
          <span
            v-for="habit in profile.habits.weaknesses"
            :key="`w-${habit}`"
            class="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600 ring-1 ring-rose-200"
          >
            {{ habit }}
          </span>
          <span
            v-for="habit in profile.habits.recentImprovements"
            :key="`p-${habit}`"
            class="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600 ring-1 ring-emerald-200"
          >
            {{ habit }}
          </span>
        </div>
      </section>

      <section v-if="profile.recentGames.length">
        <h3 class="mb-2 text-[11px] font-semibold tracking-wide text-stone-500">最近对局</h3>
        <ul class="space-y-1.5">
          <li
            v-for="game in profile.recentGames"
            :key="game.date"
            class="flex items-center justify-between rounded-lg bg-stone-50 px-2.5 py-1.5 text-[11px]"
          >
            <span class="text-stone-500">{{ formatDate(game.date) }} · {{ game.moves }} 手</span>
            <span class="flex items-center gap-1.5">
              <span v-if="game.conceptsPracticed.length" class="text-stone-400">
                {{ game.conceptsPracticed.map(conceptText).join('/') }}
              </span>
              <span
                class="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                :class="resultClass(game.result)"
              >
                {{ resultText(game.result) }}
              </span>
            </span>
          </li>
        </ul>
      </section>

      <section v-if="profile.mentorNotes">
        <h3 class="mb-2 text-[11px] font-semibold tracking-wide text-stone-500">导师评语</h3>
        <p class="rounded-lg bg-stone-900/90 px-3 py-2.5 text-[11px] leading-relaxed text-stone-200">
          {{ profile.mentorNotes }}
        </p>
      </section>

      <button
        type="button"
        class="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-[11px] font-medium text-stone-400 transition hover:border-stone-300 hover:text-stone-600"
        @click="profileStore.resetProfile()"
      >
        清空档案，重新开始
      </button>
    </div>
  </section>
</template>
