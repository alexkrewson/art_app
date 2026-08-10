// Sample the visible image repeatedly. All waiting happens HERE, in Node, so
// the page is only ever asked a short synchronous question — a long await
// inside a single Runtime.evaluate is exactly what made the last measurement
// ambiguous.
const targets = await (await fetch('http://localhost:9222/json')).json();
const page = targets.find(t => t.type === 'page' || t.webSocketDebuggerUrl);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const evaluate = (expression) => new Promise(res => {
  const myId = ++id;
  pending.set(myId, res);
  ws.send(JSON.stringify({ id: myId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
});

const PROBE = `(() => {
  const i = document.querySelector('#stage img[style*="opacity: 1"], #stage img');
  const vis = [...document.querySelectorAll('#stage img')]
    .map(e => ({ s: e.src.slice(-16), o: getComputedStyle(e).opacity }));
  return JSON.stringify(vis);
})()`;

const SECONDS = Number(process.argv[2] || 75);
const start = Date.now();
let last = null, changes = 0;
while ((Date.now() - start) / 1000 < SECONDS) {
  const r = await evaluate(PROBE);
  const now = r.result.value;
  const t = ((Date.now() - start) / 1000).toFixed(1);
  if (now !== last) { changes++; console.log(`t=${t}s  ${now}`); last = now; }
  await new Promise(r => setTimeout(r, 1000));
}
console.log(`\n${changes} distinct states over ${SECONDS}s`);
ws.close();
