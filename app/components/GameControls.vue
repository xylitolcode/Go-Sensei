<script setup lang="ts">
defineProps<{
  canPass: boolean
  canUndo: boolean
  canFinish: boolean
}>()

const emit = defineEmits<{
  pass: []
  undo: []
  newGame: []
  finish: []
}>()

const confirming = ref(false)

function confirmNewGame() {
  confirming.value = false
  emit('newGame')
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <button
      type="button"
      class="rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-amber-50 shadow-sm transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
      :disabled="!canPass"
      @click="emit('pass')"
    >
      停一手
    </button>
    <button
      type="button"
      class="rounded-xl border border-stone-300 bg-white/80 px-4 py-2.5 text-sm font-semibold text-stone-700 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
      :disabled="!canUndo"
      @click="emit('undo')"
    >
      悔棋
    </button>
    <button
      type="button"
      class="rounded-xl border border-stone-300 bg-white/80 px-4 py-2.5 text-sm font-semibold text-stone-700 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
      :disabled="!canFinish"
      title="按中国规则数子，结算当前盘面"
      @click="emit('finish')"
    >
      结束本局
    </button>
    <button
      type="button"
      class="ml-auto rounded-xl border border-stone-300 bg-white/80 px-4 py-2.5 text-sm font-semibold text-stone-700 shadow-sm transition hover:bg-white"
      @click="confirming = true"
    >
      新对局
    </button>

    <Teleport to="body">
      <div
        v-if="confirming"
        class="fixed inset-0 z-50 grid place-items-center bg-stone-950/45 p-4 backdrop-blur-sm"
        @click.self="confirming = false"
      >
        <div class="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-stone-900/10">
          <h3 class="text-base font-semibold text-stone-900">开始新对局？</h3>
          <p class="mt-2 text-sm leading-relaxed text-stone-600">
            当前棋盘、提子数和导师对话都会被清空，无法恢复。
          </p>
          <div class="mt-5 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-50"
              @click="confirming = false"
            >
              取消
            </button>
            <button
              type="button"
              class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:bg-stone-800"
              @click="confirmNewGame"
            >
              开始新局
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
