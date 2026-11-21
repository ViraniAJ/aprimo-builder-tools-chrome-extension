// Runs Aprimo Wisp's prompt suite against a real model and scores the replies.
//   NVIDIA_API_KEY=… npm run wisp:eval                     (Smart-routing default: Nemotron 3.5 Super VL)
//   ANTHROPIC_API_KEY=… npm run wisp:eval -- --provider anthropic [--model claude-sonnet-5-5]
//   OPENAI_API_KEY=… npm run wisp:eval -- --provider openai --base https://api.openai.com/v1 --model gpt-4o
// Text only (no screenshot): it checks the reply grammar, TOPIC, whether it pointed at the right control, and STEPS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemPrompt, userText } from '../tools-src/aprimo-wisp/src/core/prompt.ts';
import { ReplyParser } from '../tools-src/aprimo-wisp/src/core/reply-parser.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const provider = arg('provider', 'nim');
const suite = JSON.parse(fs.readFileSync(path.join(root, 'knowledge/eval/prompt_suite.json'), 'utf8'));

async function ask(system, user) {
  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: arg('model', 'claude-sonnet-5-5'), max_tokens: 700, temperature: 0.2, system, messages: [{ role: 'user', content: user }] }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j?.error?.message ?? r.status);
    return j.content.map((c) => c.text ?? '').join('');
  }
  const base = provider === 'openai' ? arg('base', 'https://api.openai.com/v1') : 'https://integrate.api.nvidia.com/v1';
  const key = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.NVIDIA_API_KEY;
  const model = arg('model', provider === 'openai' ? 'gpt-4o' : 'nvidia/nemotron-3.5-super-vl-120b-a12b');
  const extra = model.startsWith('nvidia/') ? { chat_template_kwargs: { enable_thinking: false } } : {};
  const r = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: 700, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], ...extra }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message ?? j?.detail ?? r.status);
  return j.choices[0].message.content ?? '';
}

let ok = 0, grammar = 0, pointed = 0, pointCases = 0;
for (const c of suite.cases) {
  const user = userText({ question: c.q, page: suite.page, image: null, notes: [], answerLength: 'normal', instructions: '', local: false, readControls: true, guideText: /^how do i/i.test(c.q) ? 'If this is something they want to do on this page now, … End with "STEPS: more" or "STEPS: done".' : undefined });
  let raw = '';
  try { raw = await ask(systemPrompt(false, 'pixels', false), user); } catch (e) { console.log(`✗ ${c.q}\n    error: ${e.message}`); continue; }
  const p = new ReplyParser();
  const ev = [...p.push(raw + '\n'), ...p.end()];
  const topic = ev.find((e) => e.type === 'topic')?.text;
  const says = ev.filter((e) => e.type === 'say' || e.type === 'text').length;
  const targets = ev.filter((e) => e.type === 'shape' || e.type === 'arrow').map((e) => (e.type === 'arrow' ? e.to : e.target)).filter((t) => t.kind === 'element').map((t) => t.id);
  const steps = ev.find((e) => e.type === 'steps');
  const gOk = !!topic && says > 0 && !p.degenerate;
  const pOk = c.expect.point.length ? c.expect.point.includes(targets[0]) : targets.length === 0;
  const tOk = topic === c.expect.topic;
  const sOk = c.expect.steps === undefined || (steps?.more ?? false) === c.expect.steps;
  grammar += gOk; if (c.expect.point.length) { pointCases++; pointed += c.expect.point.includes(targets[0]); }
  const pass = gOk && pOk && tOk && sOk;
  ok += pass;
  console.log(`${pass ? '✓' : '✗'} ${c.q}  [topic ${topic ?? '-'}${tOk ? '' : ` ≠ ${c.expect.topic}`}, point ${targets.join(',') || '-'}${pOk ? '' : ` ≠ ${c.expect.point.join(',') || 'none'}`}${c.expect.steps !== undefined ? `, steps ${steps ? (steps.more ? 'more' : 'done') : '-'}` : ''}]`);
  if (!pass) console.log('    ' + raw.trim().split('\n').join('\n    '));
}
console.log(`\n${ok}/${suite.cases.length} passed · grammar ${grammar}/${suite.cases.length} · pointing ${pointed}/${pointCases}`);
process.exit(grammar === suite.cases.length && pointed / Math.max(1, pointCases) >= 0.8 ? 0 : 1);
