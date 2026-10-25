// Balance check: runs the balance bot on the last commit and on your working copy, with the same seeds, and prints
// the average contracts cleared and the wins before and after. Run it after any change to numbers or rules in sim.js
// (mods, targets, prices, coins, Difficulty) and paste the table into your reply and into docs/design-notes.md.
//
//   npm run balance                         3 seeds x 60 runs at Difficulty 0 and 6, last commit vs working copy (~3 min)
//   npm run balance -- --base=HEAD~1        compare against another commit (for example after committing)
//   npm run balance -- --runs=100 --seeds=1,2,3,4 --levels=0,4,8
//
// Runs are noisy: differences under about 0.3 contracts are noise. The bot buys mods it can use (MOD_VALUE in
// tools/bot.js, coin mods included) but plays one style, so niche mods are judged in play, not here.
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join } from 'node:path';

const opt = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : d; };
const RUNS = +opt('runs', 60), SEEDS = opt('seeds', '1,2,3').split(',').map(Number), LEVELS = opt('levels', '0,6').split(',').map(Number);
const BASE = opt('base', 'HEAD');

const root = execSync('git rev-parse --show-toplevel').toString().trim();
const files = ['client/src', 'tools'];
const changed = execSync(`git diff --stat ${BASE} -- ${files.join(' ')}`, { cwd: root }).toString().trim();
if (!changed) { console.log(`No changes in client/src or tools since ${BASE}: nothing to compare.`); process.exit(0); }

// the two versions side by side in a temporary folder: "before" from git, "after" copied from the working copy
const tmp = mkdtempSync(join(tmpdir(), 'balance-'));
const dirs = { before: join(tmp, 'before'), after: join(tmp, 'after') };
execSync(`mkdir -p "${dirs.before}" && git archive ${BASE} ${files.join(' ')} | tar -x -C "${dirs.before}"`, { cwd: root });
for (const f of files) cpSync(join(root, f), join(dirs.after, f), { recursive: true });

const jobs = [];
for (const side of ['before', 'after']) for (const lvl of LEVELS) for (const seed of SEEDS) jobs.push({ side, lvl, seed });
const runJob = j => new Promise((res, rej) => {
  const p = spawn(process.execPath, ['tools/bot.js', String(RUNS), 'climb', `--seed=${j.seed}`, `--ceiling=${j.lvl}`], { cwd: dirs[j.side] });
  let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  p.on('close', code => {
    const avg = out.match(/avg cleared ([\d.]+)/), won = out.match(/^contract 8 quota \d+ cleared (\d+)\//m);
    if (code || !avg) return rej(new Error(`bot failed (${j.side}, Difficulty ${j.lvl}, seed ${j.seed}):\n${out.slice(-800)}`));
    res({ ...j, avg: +avg[1], wins: won ? +won[1] : 0 });
  });
});
console.log(`Balance bot: ${BASE} vs working copy, ${SEEDS.length} seeds x ${RUNS} runs, Difficulty ${LEVELS.join(', ')} (${jobs.length} jobs)…`);
const t0 = Date.now(), results = [];
try {
  const queue = jobs.slice(), lanes = Math.max(1, Math.min(cpus().length - 1, jobs.length));
  await Promise.all(Array.from({ length: lanes }, async () => { while (queue.length) results.push(await runJob(queue.shift())); }));
} finally { rmSync(tmp, { recursive: true, force: true }); }

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const pick = (side, lvl) => results.filter(r => r.side === side && r.lvl === lvl);
console.log(`\n| Difficulty | contracts before | after | change | wins before | after (of ${SEEDS.length * RUNS}) |`);
console.log('| --- | --- | --- | --- | --- | --- |');
for (const lvl of LEVELS) {
  const b = pick('before', lvl), a = pick('after', lvl), mb = mean(b.map(r => r.avg)), ma = mean(a.map(r => r.avg));
  const sum = x => x.reduce((s, r) => s + r.wins, 0), d = ma - mb;
  console.log(`| ${lvl} | ${mb.toFixed(2)} | ${ma.toFixed(2)} | ${d >= 0 ? '+' : ''}${d.toFixed(2)}${Math.abs(d) < .3 ? ' (noise)' : ''} | ${sum(b)} | ${sum(a)} |`);
}
console.log(`\n(${Math.round((Date.now() - t0) / 1000)} s; per seed: ${LEVELS.map(l => `D${l} ` + ['before', 'after'].map(s => pick(s, l).sort((x, y) => x.seed - y.seed).map(r => r.avg.toFixed(2)).join('/')).join(' → ')).join(', ')})`);
