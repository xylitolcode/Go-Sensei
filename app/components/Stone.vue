<script setup lang="ts">
withDefaults(
  defineProps<{
    cx: number
    cy: number
    color: 'black' | 'white'
    r?: number
  }>(),
  { r: 18 }
)
</script>

<template>
  <g class="stone" :class="`stone--${color}`">
    <circle :cx="cx" :cy="cy + r * 0.12" :r="r" fill="rgba(45, 32, 12, 0.28)" />
    <circle
      :cx="cx"
      :cy="cy"
      :r="r"
      :fill="color === 'black' ? 'url(#stone-black)' : 'url(#stone-white)'"
      :stroke="color === 'black' ? 'rgba(0, 0, 0, 0.85)' : 'rgba(120, 110, 92, 0.55)'"
      stroke-width="0.9"
    />
    <ellipse
      :cx="cx - r * 0.28"
      :cy="cy - r * 0.34"
      :rx="r * 0.34"
      :ry="r * 0.2"
      :fill="color === 'black' ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.95)'"
    />
  </g>
</template>

<style scoped>
.stone {
  pointer-events: none;
}
</style>
