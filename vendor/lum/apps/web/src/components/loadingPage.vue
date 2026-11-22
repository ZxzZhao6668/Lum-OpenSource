<template>
  <teleport to="body">
    <div v-if="visible" class="loadingPage" role="status" aria-label="Lum 正在加载项目">
      <div class="logoWrap" :class="{ drawn, filling }" @animationend="finishAnimation">
        <img class="brandLogo" src="/brand/lumLogo.png" alt="Lum 影纪" />
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{ active: boolean }>();
const visible = defineModel<boolean>("visible", { default: false });
const drawn = defineModel<boolean>("drawn", { default: false });
const filling = ref(false);
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const reducedMotion = ref(motionPreference.matches);

function updateMotionPreference(event: MediaQueryListEvent) {
  reducedMotion.value = event.matches;
}
motionPreference.addEventListener("change", updateMotionPreference);
onBeforeUnmount(() => motionPreference.removeEventListener("change", updateMotionPreference));

watch([() => props.active, reducedMotion], ([active, reducedMotion]) => {
  if (active) {
    if (!visible.value) {
      drawn.value = false;
      visible.value = true;
    }
    filling.value = false;
  }
  if (reducedMotion) {
    drawn.value = true;
    if (!active) visible.value = false;
  } else if (!active && drawn.value && visible.value) {
    filling.value = true;
  }
}, { immediate: true });

function finishAnimation(event: AnimationEvent) {
  if (event.target !== event.currentTarget) return;
  if (filling.value) {
    if (!props.active) visible.value = false;
    return;
  }
  drawn.value = true;
  if (!props.active) filling.value = true;
}
</script>

<style lang="scss" scoped>
.loadingPage {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  background: var(--el-bg-color);

  .logoWrap {
    width: min(280px, 65vw);
    line-height: 0;
    animation: brandEnter 0.24s ease both;

    .brandLogo {
      display: block;
      width: 100%;
      height: auto;
      border-radius: 18px;
    }

    &.drawn .brandLogo { animation: brandPulse 1.4s ease-in-out infinite; }
    &.filling { animation: brandLeave 0.18s ease both; }

    @media (prefers-reduced-motion: reduce) {
      &, &.drawn .brandLogo, &.filling { animation: none; }
    }
  }
}

@keyframes brandEnter { from { opacity: 0; } to { opacity: 1; } }
@keyframes brandLeave { from { opacity: 1; } to { opacity: 0; } }
@keyframes brandPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.65; } }
</style>
