const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtInt = (n) => Number(n).toLocaleString();
let limits = null;   // from /api/meta: the server owns the numbers
const q = $("q");
const turns = [];     // one object per question: its state, data and nodes
let controller = null, seq = 0;
const queued = [];   // questions asked while an answer is still being written; they run in order afterwards
const MAX_QUEUED = 3;

/* ---------- Markdown (escape first, so model text can't inject HTML) ---------- */
const CITE = /\((visits?|forms?) (\d+(?:, \d+)*)\)/gi;  // ids only; the prompt asks for exactly this
let namesRe = null;  // the people in the data, from /api/meta: the only source of "who is a person here"
const inlineBase = (s) => s
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(CITE, (_, word, ids) => {
    const kind = word.toLowerCase().startsWith("form") ? "form" : "visit";
    const links = ids.split(", ").map((n) => `<button type="button" class="cite" data-kind="${kind}" data-id="${n}">${n}</button>`);
    return `<span class="cites">${word} ${links.join(", ")}</span>`;
  });
// Full names from the roster become buttons, so "who is a person" never depends on how the model formatted the answer.
const inline = (s) => {
  const html = inlineBase(s);
  return namesRe ? html.replace(namesRe, '<button type="button" class="person" title="Ask about $1">$1</button>') : html;
};
function markdown(text) {
  let html = "", list = null, unknowns = false;
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const line of text.split("\n")) {
    // Match on the original text, output escaped text.
    const plain = line.replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "").trim();
    const raw = esc(line);
    if (!unknowns && /^what i couldn['’]?t determine/i.test(plain)) {
      closeList(); unknowns = true;
      const rest = esc(plain.replace(/^what i couldn['’]?t determine:?\s*/i, ""));
      html += `<div class="unknowns"><span class="label">What the records can't show</span>`;
      if (rest) html += `<p>${inline(rest)}</p>`;
      continue;
    }
    const h = raw.match(/^#{1,6}\s+(.*)/), ul = raw.match(/^\s*[-*•]\s+(.*)/), ol = raw.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul || ol) {
      const tag = ul ? "ul" : "ol";
      if (list !== tag) { closeList(); html += `<${tag}>`; list = tag; }
      html += `<li>${inline((ul || ol)[1])}</li>`;
    } else {
      closeList();
      if (h) html += `<h4>${inline(h[1])}</h4>`;
      else if (raw.trim()) html += `<p>${inline(raw)}</p>`;
    }
  }
  closeList();
  if (unknowns) html += "</div>";
  return html;
}
const snippet = (text) => text.replace(/[#*`]/g, "").replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, "").replace(/\s+/g, " ").trim().slice(0, 220);

/* ---------- Header ---------- */
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const day = (s) => DATE.format(new Date(s.replace(" ", "T")));
fetch("/api/meta").then((r) => r.json()).then((m) => {
  limits = m.limits; q.maxLength = limits.question_chars;
  if (m.names?.length) namesRe = new RegExp(`(?<![\\w])(${m.names.map((n) => esc(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\w])`, "g");
  $("facts").textContent = `${m.people} people, visits from ${day(m.from)} to ${day(m.to)}.`;
  $("asof").textContent = ` · Today is ${day(m.to)}`;
  for (const example of m.examples || []) $("suggestions").append(suggestion(example));
}).catch(() => { $("facts").textContent = "Couldn't reach the server."; });

/* ---------- Scrolling: follow new text until the reader scrolls up, and again once they're back at the bottom ---------- */
const atBottom = (slack) => innerHeight + scrollY >= document.body.scrollHeight - slack;
let follow = true, lastY = 0;
const unfollow = () => { follow = false; };
addEventListener("wheel", (e) => { if (e.deltaY < 0) unfollow(); }, { passive: true });
addEventListener("touchmove", unfollow, { passive: true });
addEventListener("keydown", (e) => { if (["ArrowUp", "PageUp", "Home"].includes(e.key) && e.target === document.body) unfollow(); });
addEventListener("scroll", () => {
  if (scrollY < lastY - 1) unfollow();            // we only ever scroll down by ourselves, so up means the reader
  else if (atBottom(24)) follow = true;
  lastY = scrollY;
  $("jump").classList.toggle("show", !atBottom(240));
}, { passive: true });
const keepUp = () => {
  if (follow) scrollTo({ top: document.body.scrollHeight });
  $("jump").classList.toggle("show", !atBottom(240));  // the page can grow under a reader who isn't scrolling
};
$("jump").addEventListener("click", () => { follow = true; scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); });

/* ---------- Composer ---------- */
const grow = () => { q.style.height = "auto"; q.style.height = Math.min(q.scrollHeight, 176) + "px"; };
q.addEventListener("input", () => { grow(); sendState(); });
q.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("form").requestSubmit(); }
});
$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = q.value.trim();
  if (text) { q.value = ""; grow(); submit(text); }
  else if (controller) { queued.length = 0; showQueued(); controller.abort(); }  // an empty send while busy is Stop
  sendState();
});
// While an answer is running the button queues what is typed, and stops when nothing is typed.
function sendState() {
  const b = $("send"), typed = !!q.value.trim(), stop = !!controller && !typed;
  b.setAttribute("aria-label", stop ? "Stop" : controller ? "Queue" : "Ask");
  b.classList.toggle("stop", stop);
  b.disabled = !controller && !typed;
}
function showQueued() {
  $("queued").replaceChildren(...queued.map((text, i) => {
    const chip = el("div", "queued-item", `<span>Next: ${esc(text)}</span>`);
    const x = el("button", "link-btn", "Remove"); x.type = "button";
    x.addEventListener("click", () => { queued.splice(i, 1); showQueued(); });
    chip.append(x);
    return chip;
  }));
}
function setBusy(busy) {
  sendState();
  $("jump").classList.toggle("busy", busy);  // a pulsing dot on the arrow: the answer is still being written below
  $("jump").title = busy ? "Scroll to latest (still working)" : "Scroll to latest";
}

/* ---------- One question: its state is data; the page is derived from it ----------
   starting → querying → writing → done, or failed / stopped from anywhere. */
const history = () => turns
  .filter((t) => t.state === "done")
  .flatMap((t) => [{ role: "user", content: t.question }, { role: "assistant", content: t.text }])
  .slice(-(limits?.history_messages ?? 0));

function apply(t, ev) {
  switch (ev.type) {
    case "start": t.requestId = ev.request_id; break;
    case "query": t.queries.push({ sql: ev.sql, params: ev.params, result: null }); t.state = "querying"; break;
    case "result": t.queries.at(-1).result = ev; break;
    case "discard": t.text = ""; t.revealed = 0; break;
    case "delta": t.text += ev.text; t.state = "writing"; break;
    case "done": t.done = ev; t.text = ev.answer; t.state = "done"; break;
    case "suggestions": t.suggestions = ev.questions; break;
    case "error": t.requestId = ev.request_id || t.requestId; t.error = ev.detail; t.state = "failed"; break;
  }
}

const suggestion = (text) => {  // a question that asks itself when tapped
  const b = el("button", "suggestion"); b.type = "button"; b.textContent = text;
  b.addEventListener("click", () => submit(text));
  return b;
};
const firstSqlLine = (sql) => (sql.trim().split("\n").find((l) => !/^\s*(--|$)/.test(l)) || sql).trim();
const turnPreview = (t) => snippet(t.text) || (t.state === "failed" ? "Failed" : t.state === "stopped" ? "Stopped" : "Answering…");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const queriesOf = (n) => (n === 1 ? "1 query" : `${n} queries`);
const KIND = { v: "visit", f: "form" };
const citedRecords = (text) => [...new Set([...text.matchAll(CITE)].flatMap((m) => m[2].split(", ").map((n) => `${m[1][0]}${n}`.toLowerCase())))].map((k) => ({ kind: KIND[k[0]], id: k.slice(1) }));

// The answer as HTML. While writing, the unfinished tail streams word by word, minus anything half-formed
// (an open citation, an unclosed **) so no broken piece flashes in.
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
// Text arrives from the network in bursts. Reveal it at our own pace so it ramps up and settles instead of jumping:
// quick when far behind, gentle when close.
const revealing = (t) => t.state === "writing" || t.revealed < t.text.length;
function advance(t) {
  const lag = t.text.length - t.revealed;
  if (still || t.state === "failed" || t.state === "stopped") t.revealed = t.text.length;
  else if (lag > 0) t.revealed += Math.min(lag, Math.max(2, Math.ceil(lag / 8)));
}
function answerHtml(t) {
  if (!t.text) return "";
  const writing = revealing(t);
  let text = writing ? t.text.slice(0, t.revealed) : t.text;
  if (writing) {
    text = text.replace(/\((?:v|f)[a-z]*(?: [\d, ]*)?$/i, "");
    // Hold back a tail that is about to change shape: a bare list marker, or the start of the "can't show" heading.
    const tail = text.slice(text.lastIndexOf("\n") + 1).replace(/[#*\s]/g, "").toLowerCase();
    if (/^(\d+[.)]?|[-•])?$/.test(tail) || (tail.length > 1 && "whaticouldn'tdetermine:".startsWith(tail.replace(/’/g, "'")))) text = text.slice(0, text.lastIndexOf("\n") + 1);
    if ((text.match(/\*\*/g) || []).length % 2) text += "**";
  }
  const html = markdown(text);
  return writing ? html.replace(/(<\/(?:p|li|h4)>)(?![\s\S]*<\/(?:p|li|h4)>)/, '<span class="caret"></span>$1') : html;
}

// Update the DOM to match html, touching only what changed: finished blocks stay put, new ones fade in.
function patch(dst, html) {
  const src = document.createElement("div"); src.innerHTML = html;
  sync(dst, src);
}
function sync(to, from) {
  const have = [...to.children], want = [...from.children];
  want.forEach((n, i) => {
    const o = have[i];
    if (!o) { n.classList.add("enter"); to.append(n); }
    else if (o.outerHTML !== n.outerHTML) {
      if (o.tagName === n.tagName && /^(UL|OL|DIV)$/.test(n.tagName)) sync(o, n); else o.replaceWith(n);
    }
  });
  have.slice(want.length).forEach((o) => o.remove());
}

function render(t) {
  const n = t.queries.length, running = t.state === "starting" || t.state === "querying";
  const label = { starting: "Starting…", querying: `Running query ${n}`, writing: queriesOf(n),
    done: `${queriesOf(n)} · ${t.done?.seconds}s`, failed: `${queriesOf(n)} · failed`, stopped: "Stopped" }[t.state];
  t.ui.label.textContent = label;
  t.ui.activity.hidden = n === 0 && !running && t.state !== "stopped";  // nothing ran, so nothing to expand
  if (t.ui.shown !== t.state) { t.ui.activity.open = running; t.ui.shown = t.state; }  // open while working, fold when writing starts
  t.ui.status.hidden = !running;
  if (running) {
    const secs = Math.floor((performance.now() - t.startedAt) / 1000);
    const doing = t.state === "starting" ? "Reading the schema" : "Working";
    t.ui.status.txt.textContent = `${doing} · ${n ? queriesOf(n) + " · " : ""}${secs}s`;
    const last = t.queries.at(-1);
    t.ui.status.last.textContent = last ? firstSqlLine(last.sql) : "";
  }
  t.queries.forEach((qy, i) => stepNode(t, qy, i));
  advance(t);
  patch(t.ui.answer, answerHtml(t));
  const bad = t.state === "failed" || t.state === "stopped";
  t.ui.error.hidden = !bad;
  if (bad) {
    const stopped = t.state === "stopped";
    t.ui.error.querySelector("strong").textContent = stopped ? "Stopped" : "This answer failed";
    t.ui.error.querySelector("span").textContent = stopped ? "You stopped this answer. Ask again to retry." : t.error;
    t.ui.error.querySelector("small").textContent = t.requestId ? `Request ${t.requestId}` : "";
  }
  t.ui.foot.hidden = t.state !== "done";
  if (t.state === "done" && !revealing(t) && !t.ui.foot.firstChild) t.ui.foot.append(...footer(t));
  t.ui.follow.hidden = !(t.state === "done" && !revealing(t) && t.suggestions?.length);
  if (!t.ui.follow.hidden && !t.ui.follow.querySelector("button")) {
    for (const text of t.suggestions) {
      t.ui.follow.append(suggestion(text));
    }
  }
}

function build(question) {
  const node = el("article", "turn");
  node.id = `t${++seq}`;
  node.append(el("h2", null, esc(question)));
  const activity = el("details", "activity");
  const summary = el("summary", null, `<span class="label"></span><span class="chev" aria-hidden="true">›</span>`);
  const steps = el("ol", "steps");
  activity.append(summary, steps);
  const status = el("div", "status");
  status.txt = el("span", "txt"); status.last = el("code", "last");
  status.append(el("span", "spin"), status.txt, status.last);
  const answer = el("div", "answer");
  const error = el("div", "error"); error.hidden = true;
  error.innerHTML = "<strong></strong><span></span><small></small>";
  const foot = el("div", "foot"); foot.hidden = true;
  const next = el("div", "follow"); next.hidden = true;
  next.append(el("span", "label", "Ask next"));
  node.append(activity, status, answer, error, foot, next);
  return { node, ui: { activity, label: summary.querySelector(".label"), steps, status, answer, error, foot, follow: next, shown: null } };
}

function submit(question) {
  if (!controller) return run(question);
  if (queued.length < MAX_QUEUED) { queued.push(question); showQueued(); }
}
async function run(question) {
  $("intro")?.remove();
  const prior = history();
  const turn = { question, state: "starting", startedAt: performance.now(), queries: [], text: "", revealed: 0, done: null, error: null, requestId: null, suggestions: [], ...build(question) };
  turn.ui.error.append(retryButton(turn));
  $("thread").append(turn.node);
  turns.push(turn); renderNav();
  const ctl = controller = new AbortController();
  setBusy(true); follow = true;

  let raf = 0;
  const paint = () => { raf = 0; render(turn); keepUp(); if (revealing(turn)) schedule(); };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
  paint();
  const tick = setInterval(schedule, 1000);  // keeps the elapsed time moving between events
  try {
    const res = await fetch("/api/ask/stream", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
      body: JSON.stringify({ question, history: prior }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(Array.isArray(body.detail) ? body.detail.map((d) => d.msg).join("; ") : body.detail || res.statusText);
    }
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
        if (line.trim()) { apply(turn, JSON.parse(line)); schedule(); }
      }
    }
    if (turn.state !== "done" && turn.state !== "failed") { turn.error = "The connection closed before the answer finished."; turn.state = "failed"; }
  } catch (err) {
    if (err.name === "AbortError") turn.state = "stopped";
    else {
      turn.state = "failed";
      turn.error = err instanceof TypeError ? "Couldn't reach the server. Check that it is still running, then ask again." : err.message;
    }
  } finally {
    clearInterval(tick); cancelAnimationFrame(raf); paint(); renderNav();
    controller = null; setBusy(false);
    if (window.matchMedia("(pointer: fine)").matches) q.focus();
    const next = queued.shift(); showQueued();
    if (next) submit(next);
  }
}

function retryButton(turn) {  // replace the failed turn rather than stacking another under it
  const b = el("button", "link-btn", "Ask again"); b.type = "button";
  b.addEventListener("click", () => { turn.node.remove(); turns.splice(turns.indexOf(turn), 1); renderNav(); submit(turn.question); });
  return b;
}

function stepNode(t, qy, i) {
  let li = t.ui.steps.children[i];
  if (!li) {
    li = el("li", "step");
    li.innerHTML = `<details><summary><span class="dot"></span><span class="sql-line">${esc(firstSqlLine(qy.sql))}</span><span class="step-meta"></span></summary>
      <pre>${esc(qy.sql.trim())}${qy.params?.length ? "\n-- params: " + esc(JSON.stringify(qy.params)) : ""}</pre></details>`;
    t.ui.steps.append(li);
  }
  const r = qy.result, dot = li.querySelector(".dot"), meta = li.querySelector(".step-meta");
  const over = t.state === "stopped" || t.state === "failed";
  const state = r ? (r.error ? "danger" : r.truncated || r.cells_truncated ? "caution" : "ok") : over ? "danger" : "running";
  dot.className = `dot ${state}`; meta.className = `step-meta ${state === "danger" || state === "caution" ? state : ""}`;
  if (!r) meta.textContent = over ? (t.state === "stopped" ? "stopped" : "no result") : "running";
  else if (r.error) meta.textContent = "error";
  else meta.textContent = `${fmtInt(r.row_count)} ${r.row_count === 1 ? "row" : "rows"}${r.truncated ? ", cut off" : r.cells_truncated ? ", text cut" : ""} · ${r.chars ? (r.chars / 1000).toFixed(1) + "k chars · " : ""}${r.ms} ms`;
  if (r?.error && !li.querySelector("pre").textContent.includes("-- error")) li.querySelector("pre").append(`\n-- error: ${r.error}`);
}

function footer(t) {
  const d = t.done, tokens = (d.usage?.prompt_tokens || 0) + (d.usage?.completion_tokens || 0), cited = citedRecords(t.text);
  const parts = [d.replay ? `Recorded answer written by ${d.replay.model} on ${d.replay.recorded}` : `Written by ${d.model}`, `${d.seconds}s`];
  if (tokens) parts.push(`${fmtInt(tokens)} tokens`);
  if (t.requestId) parts.push(`request ${t.requestId}`);
  const copy = el("button", "link-btn", "Copy answer"); copy.type = "button";
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(t.text); copy.textContent = "Copied"; }
    catch { copy.textContent = "Couldn't copy"; }
    setTimeout(() => (copy.textContent = "Copy answer"), 1600);
  });
  const spans = parts.map((p) => Object.assign(el("span"), { textContent: p }));
  if (cited.length) {
    const all = el("button", "link-btn", plural(cited.length, "record") + " cited"); all.type = "button";
    all.addEventListener("click", () => showCited(cited, t.ui.answer));
    spans.splice(2, 0, all);
  }
  return [...spans, copy];
}

/* ---------- Navigation: minimap rail (wide) and bottom sheet (narrow) ---------- */
const rail = $("rail"), peek = $("peek");
function go(i) { closeSheet(); turns[i].node.scrollIntoView({ behavior: "smooth", block: "start" }); }
function renderNav() {
  const many = turns.length >= 2;
  rail.classList.toggle("has-items", many);
  $("openSheet").classList.toggle("has-items", many);
  $("openSheet").textContent = `Questions · ${turns.length}`;
  rail.replaceChildren(...turns.map((t, i) => {
    const b = el("button", "tick"); b.type = "button"; b.setAttribute("aria-label", t.question);
    b.addEventListener("click", () => go(i));
    for (const ev of ["mouseenter", "focus"]) b.addEventListener(ev, () => showPeek(b, t));
    for (const ev of ["mouseleave", "blur"]) b.addEventListener(ev, () => peek.classList.remove("show"));
    return b;
  }));
  $("sheetList").replaceChildren(...turns.map((t, i) => {
    const b = el("button", null, `<strong>${esc(t.question)}</strong><span>${esc(turnPreview(t))}</span>`);
    b.type = "button"; b.addEventListener("click", () => go(i));
    return b;
  }));
  observe();
}
function showPeek(tick, t) {
  peek.querySelector("strong").textContent = t.question;
  peek.querySelector("span").textContent = turnPreview(t);
  const r = tick.getBoundingClientRect();
  peek.style.left = `${r.right + 18}px`;
  peek.style.top = `${Math.max(12, Math.min(innerHeight - 140, r.top - 28))}px`;
  peek.classList.add("show");
}
let io = null;
function observe() {
  io?.disconnect();
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const i = turns.findIndex((t) => t.node === e.target);
      rail.querySelectorAll(".tick").forEach((n, j) => n.classList.toggle("active", j === i));
      $("sheetList").querySelectorAll("button").forEach((n, j) => n.classList.toggle("active", j === i));
    }
  }, { rootMargin: "-30% 0px -60% 0px" });
  turns.forEach((t) => io.observe(t.node));
}
const openSheet = () => document.body.classList.add("sheet-open");
const closeSheet = () => document.body.classList.remove("sheet-open");
$("openSheet").addEventListener("click", openSheet);
$("scrim").addEventListener("click", closeSheet);
addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

/* ---------- Citations open the source record ---------- */
const dlg = el("dialog", "record");
document.body.append(dlg);
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
// Content is swapped in one step: while the dialog is open the old record stays until the new one is ready,
// so moving between records never flashes an empty or "Loading" state.
function swap(content) {
  if (typeof content === "string") dlg.innerHTML = content; else dlg.replaceChildren(content);
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}
const fetched = new Map();  // one fetch per record, shared by the hover preview and the dialog
async function getRecord(kind, id) {
  const key = `${kind}/${id}`;
  if (!fetched.has(key)) {
    fetched.set(key, fetch(`/api/records/${key}`).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
      return r.json();
    }).catch((err) => { fetched.delete(key); throw err; }));
  }
  return fetched.get(key);
}
async function openRecord(kind, id, back, claim) {
  const slow = setTimeout(() => { if (!dlg.open) swap(`<div class="rec-body"><p>Loading…</p></div>`); }, 250);
  let html;
  try {
    html = renderRecord(await getRecord(kind, id), claim);
  } catch (err) {
    html = `<div class="rec-body"><p>Couldn't load this record: ${esc(err.message)}</p><form method="dialog"><button class="link-btn">Close</button></form></div>`;
  }
  clearTimeout(slow);
  swap(html);
  if (back) {  // breadcrumb: a record reached from the citations list can always return to it
    const b = el("button", "crumb", `‹ ${back.label}`); b.type = "button"; b.addEventListener("click", back.go);
    dlg.querySelector(".rec-body").prepend(b);
  }
}
const citedBack = (cited, answer) => ({ label: plural(cited.length, "record") + " cited", go: () => showCited(cited, answer) });

const lineText = (l) => sentenceAround(l.node.querySelector(".cite"));
// Records that rest on the same lines of the answer share one row, so a line is never repeated.
function showCited(cited, answer) {
  const lines = [...answer.querySelectorAll("li, p")]
    .map((node) => ({ node, keys: new Set([...node.querySelectorAll(".cite[data-id]")].map((k) => `${k.dataset.kind}:${k.dataset.id}`)) }))
    .filter((l) => l.keys.size);
  const back = citedBack(cited, answer);
  const rows = new Map();
  for (const c of cited) {
    const at = lines.filter((l) => l.keys.has(`${c.kind}:${c.id}`)), key = at.map((l) => lines.indexOf(l)).join();
    if (!rows.has(key)) rows.set(key, { at, records: [] });
    rows.get(key).records.push(c);
  }
  if (cited.length === 1) { const [{ at }] = rows.values(); return openRecord(cited[0].kind, cited[0].id, null, at.map(lineText)); }
  const list = el("div", "rec-body");
  list.innerHTML = `<h3>${plural(cited.length, "record")} cited</h3><p class="rec-meta">Tap a record to read it, or a line to find it in the answer.</p>`;
  for (const { at, records } of rows.values()) {
    const group = el("div", "rec-group"), chips = el("div", "rec-chips");
    for (const c of records) {
      const chip = el("button", `rec-chip ${c.kind}`, `${c.kind === "visit" ? "Visit" : "Form"} ${c.id}`); chip.type = "button";
      chip.addEventListener("click", () => openRecord(c.kind, c.id, back, at.map(lineText)));
      chips.append(chip);
    }
    group.append(chips);
    for (const l of at) {
      const line = el("button", "rec-line"); line.type = "button"; line.textContent = lineText(l);
      line.addEventListener("click", () => {
        dlg.close(); l.node.scrollIntoView({ block: "center", behavior: "smooth" });
        l.node.classList.add("flash"); setTimeout(() => l.node.classList.remove("flash"), 2200);
      });
      group.append(line);
    }
    list.append(group);
  }
  list.insertAdjacentHTML("beforeend", `<form method="dialog"><button class="link-btn">Close</button></form>`);
  swap(list);
}
$("thread").addEventListener("click", (e) => {
  const p = e.target.closest(".person");
  if (p) { showPersonMenu(p); return; }
  const c = e.target.closest(".cite");
  if (c) {
    const t = turns.find((x) => x.ui.answer.contains(c)), cited = t ? citedRecords(t.text) : [];
    openRecord(c.dataset.kind, c.dataset.id, cited.length > 1 ? citedBack(cited, t.ui.answer) : null, [sentenceAround(c)]);
  }
});
// The line of the answer a citation belongs to, so the record can say what it is being checked against.
const sentenceAround = (cite) => {
  const line = cite.closest("li, p")?.cloneNode(true);
  line?.querySelectorAll(".cites").forEach((c) => c.remove());
  return (line?.textContent || "").replace(/\s+([.,;])/g, "$1").replace(/\s+/g, " ").trim();
};
const hm = (x) => x.toTimeString().slice(0, 5);
const carerLine = (r) => `<span class="carer"><span>Carer</span> ${esc(r.carer || "unknown")}</span>`;
const when = (a, b) => {
  const d = new Date(a.replace(" ", "T"));
  const e = b && new Date(b.replace(" ", "T"));
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${hm(d)}${e ? "–" + hm(e) : ""}`;
};
// Who, when and by whom: the facts at the top of a record, shared by the dialog and the hover preview.
function recordHead(r) {
  if (r.kind === "visit") {
    return { kind: `Visit ${r.id}`, title: esc(r.person || ""), meta: when(r.start_time, r.end_time) + (r.status === "Completed" ? "" : " · " + esc(r.status)), carer: carerLine(r) };
  }
  return { kind: `${esc(r.form || "Form")} ${r.id}`, title: esc(r.title || r.form || "Form"), meta: (r.person ? esc(r.person) + " · " : "") + "created " + when(r.created_at), carer: "" };
}
function renderRecord(r, claim) {
  const isVisit = r.kind === "visit";
  const h = recordHead(r);
  const head = `<div class="rec-kind">${h.kind}</div><h3>${h.title}</h3><div class="rec-meta">${h.meta}</div>${h.carer}`;
  let body = claim?.length ? `<div class="rec-claim"><span>The answer says</span>${claim.map((c) => `<p>${esc(c)}</p>`).join("")}</div>` : "";
  if (isVisit) {
    body += `<h4>Visit note, as recorded</h4><blockquote>${esc(r.note || "No note")}</blockquote>`;
    const acts = r.activities || [];
    body += `<h4>Activities</h4>` + acts.map((a) => `<p class="rec-act"><strong>${esc(a.name)}</strong>${a.status !== "Completed" ? ` <span class="pill">${esc(a.status)}</span>` : ""} ${esc(a.comment || "")}</p>`).join("");
  } else {
    body += (r.sections || []).map((sec) => `<h4>${esc(sec.section)}</h4>` + (sec.items || []).map((i) => `<div class="rec-item"><strong>${esc(i.question)}</strong><p>${esc(i.answer ?? "")}</p></div>`).join("")).join("");
  }
  return `<div class="rec-body">${head}${body}<form method="dialog"><button class="link-btn">Close</button></form></div>`;
}

/* ---------- Theme: system, light or dark ---------- */
const THEMES = ["light dark", "light", "dark"], ICONS = {
  "light dark": '<path d="M3 5h18v11H3zM8 20h8M12 16v4"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
};
const NAMES = { "light dark": "System", light: "Light", dark: "Dark" };
const themeBtn = $("theme");
function showTheme() {
  const cur = document.documentElement.style.colorScheme || "light dark";
  themeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[cur]}</svg>`;
  themeBtn.title = themeBtn.ariaLabel = `Theme: ${NAMES[cur]}. Tap to change.`;
}
themeBtn.addEventListener("click", () => {
  const cur = document.documentElement.style.colorScheme || "light dark";
  const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
  document.documentElement.style.colorScheme = next;
  try { if (next === "light dark") localStorage.removeItem("theme"); else localStorage.setItem("theme", next); } catch { /* private mode: it just won't be remembered */ }
  showTheme();
});
showTheme();

/* ---------- Floating layers: the name menu and the citation preview ---------- */
// One placement rule for both: below the anchor if it fits above the composer, else above if there is more room,
// kept GUTTER px inside the window.
const GUTTER = 8, GAP = 6;
function place(layer, anchor, { centered = false } = {}) {
  const a = anchor.getBoundingClientRect(), w = layer.offsetWidth, h = layer.offsetHeight;
  const floor = Math.min(innerHeight, $("form").getBoundingClientRect().top) - GUTTER;
  const below = floor - a.bottom - GAP, above = a.top - GAP - GUTTER;
  const up = h > below && above > below;
  const want = centered ? a.left + a.width / 2 - w / 2 : a.left;
  layer.style.left = `${Math.max(GUTTER, Math.min(want, innerWidth - w - GUTTER))}px`;
  layer.style.top = `${up ? Math.max(GUTTER, a.top - GAP - h) : a.bottom + GAP}px`;
}
const hideFloating = () => { hideMenu(); hidePop(); };
addEventListener("click", (e) => { if (!e.target.closest(".person, .person-menu")) hideMenu(); hidePop(); });
addEventListener("keydown", (e) => { if (e.key === "Escape") hideFloating(); });
addEventListener("scroll", hideFloating, { passive: true });

/* A name offers a few fixed questions. Choosing one asks it, like the "Ask next" chips. */
const DRILLS = [
  (n) => `How has ${n} been this week?`,
  (n) => `What changed for ${n} this week compared with the week before?`,
  (n) => `Is ${n}'s care plan still current given recent visit notes?`,
  (n) => `Is there an open safeguarding case for ${n}?`,
];
const menu = el("div", "person-menu"); menu.hidden = true; menu.setAttribute("role", "menu"); document.body.append(menu);
function hideMenu() { menu.hidden = true; }
function showPersonMenu(anchor) {
  const name = anchor.textContent;
  menu.replaceChildren(...DRILLS.map((ask) => {
    const text = ask(name), b = el("button", "", ""); b.type = "button"; b.textContent = text; b.setAttribute("role", "menuitem");
    b.addEventListener("click", () => { hideMenu(); submit(text); });
    return b;
  }));
  menu.hidden = false;
  place(menu, anchor);
  menu.querySelector("button").focus();
}

/* Hover (or keyboard focus) on a citation: who, when and the first words, before anyone taps.
   Timing: open after the pointer has rested SETTLE_MS (a pointer passing over a line opens nothing), switch at once
   between neighbours while one is open or just closed, close LEAVE_MS after leaving, and never open while scrolling. */
const SETTLE_MS = 150, LEAVE_MS = 150, WARM_MS = 400, STILL_PX = 4;
const pop = el("div", "cite-pop"); pop.hidden = true; pop.setAttribute("role", "tooltip"); document.body.append(pop);
let popFor = null, settleTimer = 0, leaveTimer = 0, scrollTimer = 0, warmUntil = 0, scrolling = false, rest = null;
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);
function previewHtml(r) {
  const h = recordHead(r);
  const first = r.kind === "visit" ? r.note || "No note" : (r.sections || []).flatMap((x) => x.items || []).find((i) => i.answer)?.answer;
  return `<small>${h.kind}</small><strong>${h.title}</strong><span>${h.meta}</span>${h.carer}${first ? `<p>${esc(clip(String(first), 150))}</p>` : ""}`;
}
function hidePop() {
  clearTimeout(settleTimer); clearTimeout(leaveTimer);
  if (!pop.hidden) warmUntil = performance.now() + WARM_MS;
  popFor = null; pop.hidden = true;
}
async function showPop(c) {
  try {
    const r = await getRecord(c.dataset.kind, c.dataset.id);
    if (popFor !== c) return;
    pop.innerHTML = previewHtml(r); pop.hidden = false;
    place(pop, c, { centered: true });
  } catch { /* no preview: tapping still shows the error */ }
}
function aim(c) {  // c is what the pointer or focus is on now
  clearTimeout(settleTimer); clearTimeout(leaveTimer);
  popFor = c;
  const warm = !pop.hidden || performance.now() < warmUntil;
  if (warm || c.matches(":focus-visible")) showPop(c); else settleTimer = setTimeout(() => showPop(c), SETTLE_MS);
}
const thread = $("thread");
thread.addEventListener("mouseover", (e) => {
  const c = e.target.closest(".cite");
  if (c && !scrolling && c !== popFor) { rest = { x: e.clientX, y: e.clientY }; aim(c); }
  else if (c && c === popFor) clearTimeout(leaveTimer);
});
thread.addEventListener("mousemove", (e) => {  // still moving over the citation: the rest starts again
  if (!popFor || !pop.hidden || !rest) return;
  if (Math.hypot(e.clientX - rest.x, e.clientY - rest.y) > STILL_PX) { rest = { x: e.clientX, y: e.clientY }; aim(popFor); }
});
thread.addEventListener("mouseout", (e) => {
  if (e.target.closest(".cite") && !e.relatedTarget?.closest?.(".cite")) leaveTimer = setTimeout(hidePop, LEAVE_MS);
});
thread.addEventListener("focusin", (e) => { const c = e.target.closest(".cite"); if (c) aim(c); });
thread.addEventListener("focusout", (e) => { if (e.target.closest(".cite")) hidePop(); });
for (const type of ["wheel", "scroll"]) {  // a hover that scrolled under a still pointer is not intent
  addEventListener(type, () => {
    scrolling = true; clearTimeout(scrollTimer); scrollTimer = setTimeout(() => { scrolling = false; }, 150);
    clearTimeout(settleTimer);
  }, { passive: true, capture: true });
}
