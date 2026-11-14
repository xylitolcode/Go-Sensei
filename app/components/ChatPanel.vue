<script setup lang="ts">
import { nextTick } from 'vue'
import type { ChatMessage } from '~/stores/game'
import type { MentorTone } from '~/utils/mentor'

const props = defineProps<{
  messages: ChatMessage[]
  awaitingAck: boolean
  thinking: boolean
}>()

const emit = defineEmits<{
  acknowledge: []
}>()

const TONE_META: Record<MentorTone, { label: string; wrap: string; badge: string }> = {
  praise: {
    label: '表扬',
    wrap: 'border-emerald-200 bg-emerald-50/90',
    badge: 'bg-emerald-600 text-white'
  },
  excited: {
    label: '高光',
    wrap: 'border-amber-200 bg-amber-50/95',
    badge: 'bg-amber-500 text-white'
  },
  encourage: {
    label: '建议',
    wrap: 'border-sky-200 bg-sky-50/90',
    badge: 'bg-sky-600 text-white'
  },
  'gentle-correct': {
    label: '纠正',
    wrap: 'border-rose-200 bg-rose-50/90',
    badge: 'bg-rose-500 text-white'
  },
  neutral: {
    label: '讲解',
    wrap: 'border-stone-200 bg-white/90',
    badge: 'bg-stone-700 text-white'
  },
  concerned: {
    label: '提醒',
    wrap: 'border-orange-200 bg-orange-50/95',
    badge: 'bg-orange-600 text-white'
  },
  'teaching-moment': {
    label: '教学时刻',
    wrap: 'border-violet-200 bg-violet-50/95',
    badge: 'bg-violet-600 text-white'
  }
}

const CONCEPTS: Record<string, string> = {
  liberty: '气',
  capture: '提子',
  atari: '叫吃',
  territory: '围地',
  connection: '连接',
  shape: '棋形',
  rules: '规则',
  basics: '入门',
  pass: '停一手'
}

const listRef = ref<HTMLElement | null>(null)
const typedId = ref<number | null>(null)
const typedLength = ref(0)
let typeTimer: ReturnType<typeof setInterval> | null = null

const typingMessage = computed(() => {
  const last = props.messages[props.messages.length - 1]
  if (!last || typedId.value !== last.id) return null
  return typedLength.value < last.text.length ? last : null
})

function clearTypeTimer() {
  if (typeTimer) {
    clearInterval(typeTimer)
    typeTimer = null
  }
}

function scrollToBottom() {
  nextTick(() => {
    const el = listRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function startTyping(message: ChatMessage) {
  clearTypeTimer()
  typedId.value = message.id
  typedLength.value = 0
  scrollToBottom()

  typeTimer = setInterval(() => {
    typedLength.value = Math.min(message.text.length, typedLength.value + 2)
    if (typedLength.value >= message.text.length) clearTypeTimer()
    if (typedLength.value % 10 === 0) scrollToBottom()
  }, 22)
}

watch(
  () => props.messages.length,
  () => {
    const last = props.messages[props.messages.length - 1]
    if (last) startTyping(last)
  }
)

const lastMessage = computed(() => props.messages[props.messages.length - 1])

// The mentor API may rewrite the latest bubble; replay the typewriter on change.
watch(
  () => lastMessage.value?.text,
  (next, previous) => {
    const last = lastMessage.value
    if (!last || !next || previous === undefined || next === previous) return
    startTyping(last)
  }
)

watch(
  () => props.awaitingAck,
  (value) => {
    if (value) scrollToBottom()
  }
)

onBeforeUnmount(clearTypeTimer)

function textFor(message: ChatMessage) {
  if (typedId.value === message.id) return message.text.slice(0, typedLength.value)
  return message.text
}

function skipTyping(message: ChatMessage) {
  if (typedId.value !== message.id) return
  clearTypeTimer()
  typedLength.value = message.text.length
}

function confirm() {
  const last = props.messages[props.messages.length - 1]
  if (last) skipTyping(last)
  emit('acknowledge')
}
</script>

<template>
  <section
    class="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white/80 shadow-lg shadow-stone-900/5 ring-1 ring-stone-900/5"
  >
    <header class="flex items-center gap-3 border-b border-stone-200/80 px-4 py-3">
      <div class="relative grid size-9 place-items-center rounded-full bg-stone-900">
        <span class="size-4 rounded-full bg-gradient-to-br from-stone-100 to-stone-400" />
        <span
          class="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-white"
          :class="thinking ? 'bg-amber-400' : 'bg-emerald-500'"
        />
      </div>
      <div class="min-w-0">
        <h2 class="text-sm font-semibold text-stone-900">AI 导师</h2>
        <p class="text-xs text-stone-500">
          {{ thinking ? '正在思考下一手…' : '每一步都会标在棋盘上' }}
        </p>
      </div>
    </header>

    <div
      ref="listRef"
      class="flex-1 space-y-3 overflow-y-auto px-3.5 py-3.5"
      aria-live="polite"
    >
      <article
        v-for="message in messages"
        :key="message.id"
        class="rounded-xl border px-3.5 py-3 shadow-sm"
        :class="TONE_META[message.tone].wrap"
      >
        <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span
            class="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide"
            :class="TONE_META[message.tone].badge"
          >
            {{ TONE_META[message.tone].label }}
          </span>
          <span
            v-if="message.conceptTag"
            class="rounded-full border border-stone-300/70 bg-white/70 px-2 py-0.5 text-[10px] font-medium text-stone-500"
          >
            {{ CONCEPTS[message.conceptTag] ?? message.conceptTag }}
          </span>
          <span
            v-if="message.source === 'llm'"
            class="rounded-full bg-stone-900/85 px-2 py-0.5 text-[10px] font-semibold text-amber-50"
            title="这条点评由大模型现场生成，并可能圈出棋盘重点"
          >
            模型
          </span>
        </div>

        <p
          class="cursor-default whitespace-pre-wrap text-[13.5px] leading-relaxed text-stone-800"
          @click="skipTyping(message)"
        >
          {{ textFor(message) }}
          <span
            v-if="typingMessage && typingMessage.id === message.id"
            class="ml-0.5 inline-block size-1.5 animate-pulse rounded-full bg-stone-400 align-middle"
          />
        </p>
      </article>
    </div>

    <footer class="border-t border-stone-200/80 px-3.5 py-3">
      <div v-if="thinking" class="flex items-center justify-center gap-2 text-xs text-stone-500">
        <span class="flex gap-1">
          <span class="size-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:-0.2s]" />
          <span class="size-1.5 animate-bounce rounded-full bg-stone-400 [animation-delay:-0.1s]" />
          <span class="size-1.5 animate-bounce rounded-full bg-stone-400" />
        </span>
        AI 正在思考
      </div>
      <button
        v-else-if="awaitingAck"
        type="button"
        class="w-full rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-amber-50 shadow-sm transition hover:bg-stone-800"
        @click="confirm"
      >
        知道了
      </button>
      <p v-else class="text-center text-xs text-stone-500">
        在棋盘上落子，我会立刻给你反馈
      </p>
    </footer>
  </section>
</template>
