<template>
  <section
    class="pref-switch-item"
    :class="{ 'ag-underdevelop': disable }"
  >
    <div
      class="description"
      style="display: flex; align-items: center"
    >
      <span>{{ description }}:</span>
      <LinkIcon
        v-if="more"
        :size="14"
        class="link-icon"
        @click="handleMoreClick"
      />
      <el-tooltip
        v-else-if="detailedDescription"
        :content="detailedDescription"
        class="item"
        effect="dark"
        placement="top-start"
      >
        <InfoFilled
          width="16"
          height="16"
        />
      </el-tooltip>
      <span
        v-if="notes"
        class="notes"
      >
        {{ notes }}
      </span>
    </div>
    <el-switch
      v-model="status"
      :validate-event="false"
      @change="handleSwitchChange"
    />
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { InfoFilled } from '@element-plus/icons-vue'
import LinkIcon from '@/components/icons/LinkIcon.vue'
import type { PrefControlBaseProps } from '../types'

interface BoolProps extends PrefControlBaseProps {
  notes?: string
  bool: boolean
  onChange: (value: boolean) => void
  detailedDescription?: string
}

const props = withDefaults(defineProps<BoolProps>(), {
  description: '',
  notes: '',
  more: '',
  detailedDescription: '',
  disable: false
})

const status = ref(props.bool)

watch(
  () => props.bool,
  (value, oldValue) => {
    if (value !== oldValue) {
      status.value = value
    }
  }
)

const handleMoreClick = () => {
  if (typeof props.more === 'string') {
    window.electron.shell.openExternal(props.more)
  }
}

const handleSwitchChange = (value: boolean | string | number) => {
  props.onChange(Boolean(value))
}
</script>

<style>
.pref-switch-item {
  font-size: 14px;
  user-select: none;
  margin: 12px 0;
  color: var(--editorColor);
  display: flex;
  align-items: center;
  justify-content: space-between;

  & .description {
    & svg {
      margin-left: 4px;
      cursor: pointer;
      opacity: 0.7;
      color: var(--iconColor);
    }
    & svg:hover {
      color: var(--themeColor);
    }
    & > .notes {
      display: inline;
      margin: 0 0 0 8px;
    }
  }
}

/*
 * Element Plus 2.x el-switch structure:
 *   .el-switch > .el-switch__core > .el-switch__action (slider dot)
 * The old CSS targeted `::after` pseudo-element (Element Plus 1.x), which is
 * a no-op in 2.x and left the switch with default styling. Below we target
 * the real 2.x elements and use `transform` instead of `left` for the slide
 * animation to avoid layout reflow on every toggle.
 */
.el-switch .el-switch__core {
  border: 2px solid var(--iconColor);
  background: transparent;
  box-sizing: border-box;
}

span.el-switch__label {
  color: var(--editorColor50);
}

/* Slider dot: use transform for GPU-accelerated animation (no reflow) */
.el-switch:not(.is-checked) .el-switch__core .el-switch__action {
  left: 1px;
  transform: none;
  background-color: var(--iconColor);
}

.el-switch.is-checked .el-switch__core {
  border-color: var(--themeColor);
  background-color: var(--themeColor);
}

.el-switch.is-checked .el-switch__core .el-switch__action {
  /* Override EP2 `left: calc(100% - 17px)` with transform for perf */
  left: 1px;
  transform: translateX(calc(100% - 2px));
  background-color: #fff;
}

/* Suppress the expensive `transition: all` from EP2 default; only animate
 * background-color and border-color on the track, and transform on the dot. */
.el-switch .el-switch__core {
  transition: border-color 0.2s ease, background-color 0.2s ease;
}
.el-switch .el-switch__core .el-switch__action {
  transition: transform 0.2s ease, background-color 0.2s ease;
}
</style>
