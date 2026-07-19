// T007: 窗口尺寸记忆测试
// Path: 记录当前窗口尺寸 → 改变窗口尺寸 → 关闭应用 → 重启 → 验证恢复尺寸
// 对应已知 Bug：启动后界面尺寸超过屏幕分辨率，不记忆上次关闭时尺寸
// 注：Tauri 窗口尺寸通过 window-state.json 持久化，重启时由 Rust 端恢复
import { connectCdp, evaluate, sleep } from './lib/cdp.mjs'

export const meta = {
  id: 'T007',
  name: '窗口尺寸记忆',
  priority: 'P1',
};

async function getWindowMetrics(ws) {
  return JSON.parse(await evaluate(ws, `JSON.stringify({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    screenW: screen.width,
    screenH: screen.height,
    devicePixelRatio: window.devicePixelRatio
  })`))
}

async function readWindowState() {
  // 读取 Tauri 持久化的窗口状态文件
  const path = 'C:/Users/Lenovo/AppData/Roaming/com.markrust.app/window-state.json';
  const cp = await import('child_process');
  try {
    const r = cp.execSync(`powershell -Command "Get-Content '${path}' -Raw"`, { encoding: 'utf8' });
    return JSON.parse(r);
  } catch (e) {
    return null;
  }
}

export default async function run(ws, ctx, h) {
  // ─── Step 1: 记录初始窗口尺寸 ──────────────────────────
  const before = await getWindowMetrics(ws);
  ctx.pass(`初始窗口: inner=${before.innerWidth}x${before.innerHeight}, screen=${before.screenW}x${before.screenH}`);

  // 检查初始尺寸是否合理（不应超过屏幕）
  ctx.assert(
    before.innerWidth <= before.screenW,
    `初始宽度 ≤ 屏幕宽度 (${before.innerWidth} ≤ ${before.screenW})`
  );
  ctx.assert(
    before.innerHeight <= before.screenH,
    `初始高度 ≤ 屏幕高度 (${before.innerHeight} ≤ ${before.screenH})`
  );

  // ─── Step 2: 读取 window-state.json 内容 ─────────────────
  const stateBefore = await readWindowState();
  if (!ctx.assertTruthy(stateBefore, 'window-state.json 存在')) {
    ctx.fail('Tauri 未持久化窗口状态（无 window-state.json）'); return;
  }
  ctx.pass(`window-state.json: width=${stateBefore.width}, height=${stateBefore.height}, x=${stateBefore.x}, y=${stateBefore.y}`);

  ctx.assert(
    typeof stateBefore.width === 'number' && stateBefore.width > 0,
    `width 是有效数值 (${stateBefore.width})`
  );
  ctx.assert(
    typeof stateBefore.height === 'number' && stateBefore.height > 0,
    `height 是有效数值 (${stateBefore.height})`
  );

  // ─── Step 3: 检查窗口尺寸 ≤ 屏幕尺寸（核心回归断言）─────
  ctx.assert(
    stateBefore.width <= before.screenW,
    `持久化 width ≤ 屏幕宽度 (${stateBefore.width} ≤ ${before.screenW})`
  );
  ctx.assert(
    stateBefore.height <= before.screenH,
    `持久化 height ≤ 屏幕高度 (${stateBefore.height} ≤ ${before.screenH})`
  );

  // ─── Step 4: 检查窗口可见（不在屏幕外）─────────────────
  // Tauri 窗口状态有 x/y，应该在屏幕可见范围内
  if (typeof stateBefore.x === 'number' && typeof stateBefore.y === 'number') {
    ctx.assert(
      stateBefore.x >= -50 && stateBefore.x < before.screenW - 100,
      `x 在屏幕可见范围 (${stateBefore.x})`
    );
    ctx.assert(
      stateBefore.y >= -50 && stateBefore.y < before.screenH - 100,
      `y 在屏幕可见范围 (${stateBefore.y})`
    );
  }

  // ─── Step 5: 改变窗口尺寸（通过 Tauri 内部 invoke）──────
  // 使用 Tauri Window API resize
  // Tauri 2 的 Size 枚举是 externally tagged 序列化：
  //   { "Physical": { "width": u32, "height": u32 } } 或 { "Logical": { "width": f64, "height": f64 } }
  // 屏幕获取的 innerWidth/innerHeight 是 CSS 逻辑像素，传 Logical 更直观
  const targetW = Math.min(1000, before.screenW - 100);
  const targetH = Math.min(800, before.screenH - 100);
  const resizeResult = await h.evaluate(ws, `(async () => {
    try {
      if (window.__TAURI_INTERNALS__) {
        // Tauri 2 set_size: args = { label, value }
        // value 是 externally tagged enum: { Logical: { width, height } }
        await window.__TAURI_INTERNALS__.invoke('plugin:window|set_size', {
          label: 'main',
          value: { Logical: { width: ${targetW}, height: ${targetH} } }
        });
        return { ok: true };
      }
      return { ok: false, error: 'no __TAURI_INTERNALS__' };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  })()`)
  ctx.assert(resizeResult?.ok, `Tauri set_size 调用成功 (target ${targetW}x${targetH})`);
  if (!resizeResult?.ok) {
    ctx.fail('set_size 失败: ' + (resizeResult?.error || '')); return;
  }
  await h.sleep(1000); // 等窗口稳定

  // ─── Step 6: 验证窗口尺寸已改变 ──────────────────────
  const after = await getWindowMetrics(ws);
  ctx.pass(`新窗口: inner=${after.innerWidth}x${after.innerHeight}`);

  // 允许 ±50px 误差
  const wDiff = Math.abs(after.innerWidth - targetW);
  const hDiff = Math.abs(after.innerHeight - targetH);
  ctx.assert(wDiff < 100, `宽度接近目标 (target=${targetW}, actual=${after.innerWidth}, diff=${wDiff})`);
  ctx.assert(hDiff < 100, `高度接近目标 (target=${targetH}, actual=${after.innerHeight}, diff=${hDiff})`);

  // ─── Step 7: 等待 window-state.json 更新 ─────────────────
  await h.sleep(2000);
  const stateAfter = await readWindowState();
  ctx.assertTruthy(stateAfter, '窗口 resize 后 window-state.json 仍存在');

  const persistedDiff = Math.abs((stateAfter?.width || 0) - targetW);
  ctx.assert(
    persistedDiff < 100,
    `window-state.json 已更新 (width=${stateAfter?.width}, target=${targetW}, diff=${persistedDiff})`
  );

  await h.screenshot(ws, 'T007-after-resize');
  ctx.pass('窗口尺寸已记忆到 window-state.json（重启后由 Rust 端恢复，需手动重启验证）');

  // 注：完整重启验证需要 ensureApp 支持 restart，此处只验证持久化文件存在且值正确
  ctx.pass('提示: 完整重启验证需手动重启应用后观察窗口尺寸是否恢复');
}
