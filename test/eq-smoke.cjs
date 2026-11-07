// CI smoke test (no network, no browser): loads the real background.js in a vm with a stubbed
// `browser` to prove it starts clean, then asserts the shared DSP invariants in common/eq.js
// (band count, ±12 dB clamping, master clamp, and the always-on mono matrix) against a mock
// AudioContext, and checks the manifest/icons. Run: node test/eq-smoke.cjs
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const resolved = (v) => Promise.resolve(v);
const failures = [];
const ok = (name, cond) => {
  if (cond) console.log('ok  - ' + name);
  else { failures.push(name); console.error('FAIL- ' + name); }
};

process.on('unhandledRejection', (e) => { console.error('FAIL- unhandled rejection:', e); process.exit(1); });

// ---- 1. background.js must load clean against a stubbed browser ----
const noop = () => {};
const browser = {
  storage: { local: { get: () => resolved({}), set: noop }, sync: { set: () => resolved() } },
  runtime: { onMessage: { addListener: noop }, sendMessage: () => resolved({}) },
  tabs: {
    query: () => resolved([]),
    get: () => resolved({ id: 1, url: 'https://example.com/' }),
    sendMessage: () => resolved({}),
    onUpdated: { addListener: noop }, onActivated: { addListener: noop }, onRemoved: { addListener: noop },
  },
  action: { setBadgeText: () => resolved(), setBadgeBackgroundColor: () => resolved(), setTitle: () => resolved() },
  webNavigation: { onCommitted: { addListener: noop } },
};

const ctx = vm.createContext({
  browser, console,
  crypto: { randomUUID: () => 'test-uuid' },
  setTimeout, clearTimeout, setInterval, clearInterval,
});

try {
  vm.runInContext(read('common/messages.js'), ctx, { filename: 'common/messages.js' });
  vm.runInContext(read('common/eq.js'), ctx, { filename: 'common/eq.js' });
  ok('messages.js exposes FxEQ_MSG', typeof ctx.FxEQ_MSG === 'object' && ctx.FxEQ_MSG.T);
  ok('eq.js exposes FxEQ', typeof ctx.FxEQ === 'object');
  vm.runInContext(read('background.js'), ctx, { filename: 'background.js' });
  console.log('ok  - background.js loaded clean');
} catch (e) {
  console.error('FAIL- LOAD CRASH:', e);
  process.exit(1);
}

const FxEQ = ctx.FxEQ;

// ---- 2. manifest + icons ----
try {
  const man = JSON.parse(read('manifest.json'));
  ok('manifest has semantic version', /^\d+\.\d+\.\d+/.test(man.version || ''));
  const gecko = man.browser_specific_settings && man.browser_specific_settings.gecko;
  ok('manifest has a gecko app id', !!(gecko && gecko.id && gecko.id.indexOf('@') > 0));
  ok('manifest mv3 + strict_min_version >= 128',
    man.manifest_version === 3 && parseInt(gecko.strict_min_version, 10) >= 128);
  ok('referenced icons exist',
    Object.keys(man.icons || {}).every((s) => fs.existsSync(path.join(root, man.icons[s]))));
} catch (e) {
  ok('manifest parses', false);
  console.error(e);
}

// ---- 3. shared DSP invariants via a mock AudioContext ----
const makeParam = () => ({ value: 0, setTargetAtTime(v) { this.value = v; } });
function makeCtx() {
  const gains = [];
  const filters = [];
  const ctx2 = {
    currentTime: 0,
    destination: { connect() {} },
    createGain() { const n = { gain: makeParam(), connect() {} }; gains.push(n.gain); return n; },
    createBiquadFilter() {
      const f = { type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: makeParam(), connect() {} };
      filters.push(f.gain); return f;
    },
    createChannelSplitter() { return { connect() {} }; },
    createChannelMerger() { return { connect() {} }; },
    createAnalyser() { return { fftSize: 2048, smoothingTimeConstant: 0, connect() {}, getFloatTimeDomainData() {} }; },
  };
  ctx2.__gains = gains;
  ctx2.__filters = filters;
  return ctx2;
}

const c = makeCtx();
const chain = FxEQ.buildEqChain(c, FxEQ.zeros(), c.destination, 1.0, false);
ok('buildEqChain wires 10 biquads', c.__filters.length === 10);

// gain-node creation order: input, master, then the 4 mono matrix nodes (gLL,gLR,gRL,gRR)
const matrix = () => c.__gains.slice(2, 6).map((p) => p.value);
ok('stereo default matrix = [1,0,0,1]', JSON.stringify(matrix()) === JSON.stringify([1, 0, 0, 1]));
chain.setMono(true);
ok('mono matrix = [.5,.5,.5,.5]', matrix().every((v) => Math.abs(v - 0.5) < 1e-9));
chain.setMono(false);
ok('mono off restores [1,0,0,1]', JSON.stringify(matrix()) === JSON.stringify([1, 0, 0, 1]));

chain.setGains([999, -999, 0, 0, 0, 0, 0, 0, 0, 0]);
ok('band gains clamp to ±12', c.__filters[0].value === FxEQ.GAIN_MAX && c.__filters[1].value === FxEQ.GAIN_MIN);

chain.setMaster(9);
ok('master clamps to 2', c.__gains[1].value === FxEQ.MASTER_MAX);
chain.setMaster(-1);
ok('master clamps to 0', c.__gains[1].value === FxEQ.MASTER_MIN);

// ---- 4. pure sanitizer helpers ----
const s = FxEQ.sanitizeGains([-99, 5, 20]);
ok('sanitizeGains: length 10, clamped, zero-padded',
  s.length === 10 && s[0] === -12 && s[1] === 5 && s[2] === 12 && s[9] === 0);
ok('sanitizeMaster clamps high', FxEQ.sanitizeMaster(99) === 2);
ok('sanitizeMaster passes 1', FxEQ.sanitizeMaster(1) === 1);
ok('recommended presets all have 10 gains',
  FxEQ.RECOMMENDED.length > 0 && FxEQ.RECOMMENDED.every((p) => Array.isArray(p.gains) && p.gains.length === 10));

if (failures.length) {
  console.error('\n' + failures.length + ' smoke check(s) failed');
  process.exit(1);
}
console.log('\neq-smoke: all checks passed');
