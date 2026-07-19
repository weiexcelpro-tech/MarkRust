// E2E Test Runner — discovers T*.mjs files, runs them in priority order, generates report
// Usage: node tools/e2e/run-all.mjs [--priority P0] [--test T001,T002] [--no-restart]

import { writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureApp, killApp, createCtx, formatReport,
  evaluate, getStore, getCurrentFile, sleep, screenshot,
  clickElement, clickAt, rightClickElement, rightClickAt,
  pressKey, typeText, insertText,
  waitForElement, waitForCondition, waitForCurrentFile,
  ensureProjectTreeExpanded,
  createTestFile, readTestFile, deleteTestFile, readFileAbs,
  tauriInvoke, probeTauriGlobals, cdp,
  invokeStoreAction, sendIpc,
  EXE_PATH, TEST_DATA_DIR,
} from './setup.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PRIORITY_ORDER = { 'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3 };

// ─── Parse CLI args ─────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    priorityFilter: null,   // e.g. 'P0'
    testFilter: null,       // e.g. ['T001','T002']
    forceRestart: false,
    stopOnFail: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--priority' && args[i+1]) { opts.priorityFilter = args[i+1]; i++; }
    else if (a === '--test' && args[i+1]) { opts.testFilter = args[i+1].split(',').map(s=>s.trim()); i++; }
    else if (a === '--restart') { opts.forceRestart = true; }
    else if (a === '--stop-on-fail') { opts.stopOnFail = true; }
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node run-all.mjs [options]

Options:
  --priority P0      Run only tests with this priority (P0/P1/P2/P3)
  --test T001,T002   Run only these test IDs (comma-separated)
  --restart          Force restart the app before running (fresh state)
  --stop-on-fail     Stop after first failure
  --help             Show this help
`);
      process.exit(0);
    }
  }
  return opts;
}

// ─── Discover test files ────────────────────────────────────────

async function discoverTests() {
  // Find all T*.mjs files in the e2e directory (not in lib/ or integration/)
  const files = [];
  const dir = __dirname;
  for (const f of readdirSync(dir)) {
    if (/^T\d+.*\.mjs$/.test(f) && !f.startsWith('lib')) {
      files.push(join(dir, f));
    }
  }
  return files.sort();
}

// ─── Load test module ───────────────────────────────────────────

async function loadTest(filepath) {
  const mod = await import(`file://${filepath.replace(/\\/g, '/')}`);
  const meta = mod.meta || {};
  const run = mod.default;
  if (typeof run !== 'function') {
    throw new Error(`Test file ${filepath} has no default export function.`);
  }
  return { meta, run, filepath };
}

// ─── Run a single test ──────────────────────────────────────────

async function runTest(ws, testInfo) {
  const { meta, run, filepath } = testInfo;
  const testId = meta.id || basename(filepath, '.mjs');
  const testName = meta.name || testId;
  const priority = meta.priority || 'P3';

  const ctx = createCtx(testId, testName, priority);

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`▶ ${testId} [${priority}] ${testName}`);

  try {
    await run(ws, ctx, {
      evaluate, getStore, getCurrentFile, sleep, screenshot,
      clickElement, clickAt, rightClickElement, rightClickAt,
      pressKey, typeText, insertText,
      waitForElement, waitForCondition, waitForCurrentFile,
      ensureProjectTreeExpanded,
      createTestFile, readTestFile, deleteTestFile, readFileAbs,
      tauriInvoke, probeTauriGlobals, cdp,
      invokeStoreAction, sendIpc,
      TEST_DATA_DIR, EXE_PATH,
    });
    ctx.done();
  } catch (e) {
    ctx.error_msg(`Unhandled exception: ${e.message}`, e.stack || '');
    ctx.done();
  }

  const emoji = ctx.status === 'PASS' ? '✅' : ctx.status === 'FAIL' ? '❌' :
                ctx.status === 'ERROR' ? '💥' : '⏭️';
  console.log(`${emoji} ${testId} → ${ctx.status} (${ctx.duration}ms)`);

  // Print step details if not PASS
  if (ctx.status !== 'PASS') {
    for (const step of ctx.steps) {
      if (step.status !== 'PASS') {
        console.log(`   ${step.status}: ${step.message}`);
        if (step.detail) console.log(`     ${step.detail}`);
      }
    }
  }

  return ctx;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         MarkRust E2E Test Runner                         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // 1. Discover test files
  const testFiles = await discoverTests();
  if (testFiles.length === 0) {
    console.log('\n⚠ No test files found (expected T*.mjs files).');
    process.exit(0);
  }

  // 2. Load and filter tests
  let tests = [];
  for (const f of testFiles) {
    try {
      const info = await loadTest(f);
      if (opts.priorityFilter && info.meta.priority !== opts.priorityFilter) continue;
      if (opts.testFilter && !opts.testFilter.includes(info.meta.id || basename(f, '.mjs'))) continue;
      tests.push(info);
    } catch (e) {
      console.error(`Error loading ${f}: ${e.message}`);
    }
  }

  // Sort by priority
  tests.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.meta.priority] ?? 9;
    const pb = PRIORITY_ORDER[b.meta.priority] ?? 9;
    return pa - pb;
  });

  console.log(`\nFound ${tests.length} test(s) to run.`);
  tests.forEach(t => console.log(`  ${t.meta.id} [${t.meta.priority}] ${t.meta.name}`));

  // 3. Ensure app is running with CDP
  console.log('\n' + '─'.repeat(60));
  console.log('Ensuring app is running...');
  let ws;
  try {
    ws = await ensureApp({ forceRestart: opts.forceRestart });
  } catch (e) {
    console.error(`❌ Failed to start/connect app: ${e.message}`);
    console.error(`  EXE path: ${EXE_PATH}`);
    console.error(`  Build if missing: cargo build --release --features embed-frontend`);
    process.exit(2);
  }

  // 4. Run tests
  console.log('\n' + '═'.repeat(60));
  console.log('Running tests...\n');

  const results = [];
  let stopped = false;
  for (const test of tests) {
    if (stopped) {
      // Mark remaining as skipped
      const ctx = createCtx(test.meta.id, test.meta.name, test.meta.priority);
      ctx.skip('Skipped due to --stop-on-fail');
      ctx.done();
      results.push(ctx);
      continue;
    }
    const result = await runTest(ws, test);
    results.push(result);
    if (opts.stopOnFail && (result.status === 'FAIL' || result.status === 'ERROR')) {
      console.log('\n⏹ Stopping: --stop-on-fail triggered.');
      stopped = true;
    }
  }

  // 5. Generate report
  console.log('\n' + '═'.repeat(60));
  console.log('\nGenerating report...');

  const reportMd = formatReport(results);
  const reportPath = join(__dirname, 'e2e-report.md');
  writeFileSync(reportPath, reportMd);
  console.log(`Report saved to: ${reportPath}`);

  // 6. Console summary
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const errors = results.filter(r => r.status === 'ERROR').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;
  const total = results.length;

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  Summary: ${passed} PASS / ${failed} FAIL / ${errors} ERROR / ${skipped} SKIP / ${total} TOTAL`.padEnd(60) + '║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // 7. Exit code
  const exitCode = (failed + errors) > 0 ? 1 : 0;
  process.exit(exitCode);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(3);
});
