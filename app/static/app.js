const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtInt = (n) => Number(n).toLocaleString();
let limits = { question_chars: 2000, history_messages: 6 };  // replaced by /api/meta
const turns = [];     // one object per question: its state, data and nodes
let controller = null, seq = 0;

/* ---------- Markdown (escape first, so model text can't inject HTML) ---------- */
const CITE = /\((visits?|forms?) (\d+(?:, \d+)*)\)/gi;  // ids only; the prompt asks for exactly this
const inline = (s) => s
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(CITE, (_, word, ids) => {
    const kind = word.toLowerCase().startsWith("form") ? "form" : "visit";
    const links = ids.split(", ").map((n) => `<button type="button" class="cite" data-kind="${kind}" data-id="${n}">${n}</button>`);
    return `<span class="cites">${word} ${links.join(", ")}</span>`;
  });
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
  $("facts").textContent = `${m.people} people, visits from ${day(m.from)} to ${day(m.to)}.`;
  for (const q of m.examples || []) {
    const b = el("button", "suggestion"); b.type = "button"; b.textContent = q;
    b.addEventListener("click", () => submit(q));
    $("suggestions").append(b);
  }
}).catch(() => { $("facts").textContent = "Couldn't reach the server."; });

/* ---------- Scrolling: follow new text only if the reader is already at the bottom ---------- */
const nearBottom = () => innerHeight + scrollY >= document.body.scrollHeight - 160;
let follow = true;
addEventListener("scroll", () => { follow = nearBottom(); $("jump").classList.toggle("show", !follow && !!controller); }, { passive: true });
const keepUp = () => { if (follow) scrollTo({ top: document.body.scrollHeight }); };
$("jump").addEventListener("click", () => { follow = true; scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); });

/* ---------- Composer ---------- */
const q = $("q");
const grow = () => { q.style.height = "auto"; q.style.height = Math.min(q.scrollHeight, 176) + "px"; };
q.addEventListener("input", () => { grow(); if (!controller) $("send").disabled = !q.value.trim(); });
q.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("form").requestSubmit(); }
});
$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (controller) { controller.abort(); return; }
  if (q.value.trim()) submit(q.value.trim());
});
function setBusy(busy) {
  const b = $("send");
  b.setAttribute("aria-label", busy ? "Stop" : "Ask");
  b.classList.toggle("stop", busy);
  b.disabled = !busy && !q.value.trim();
}

/* ---------- One question: its state is data; the page is derived from it ----------
   starting → querying → writing → done, or failed / stopped from anywhere. */
const history = () => turns
  .filter((t) => t.state === "done")
  .flatMap((t) => [{ role: "user", content: t.question }, { role: "assistant", content: t.text }])
  .slice(-limits.history_messages);

function apply(t, ev) {
  switch (ev.type) {
    case "start": t.requestId = ev.request_id; break;
    case "query": t.queries.push({ sql: ev.sql, params: ev.params, result: null }); t.state = "querying"; break;
    case "result": t.queries.at(-1).result = ev; break;
    case "discard": t.text = ""; break;
    case "delta": t.text += ev.text; t.state = "writing"; break;
    case "done": t.done = ev; t.text = ev.answer; t.state = "done"; break;
    case "suggestions": t.suggestions = ev.questions; break;
    case "error": t.requestId = ev.request_id || t.requestId; t.error = ev.detail; t.state = "failed"; break;
  }
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const queriesOf = (n) => (n === 1 ? "1 query" : `${n} queries`);
const KIND = { v: "visit", f: "form" };
const citedRecords = (text) => [...new Set([...text.matchAll(CITE)].flatMap((m) => m[2].split(", ").map((n) => `${m[1][0]}${n}`.toLowerCase())))].map((k) => ({ kind: KIND[k[0]], id: k.slice(1) }));

// The answer as HTML. While writing, the unfinished tail streams word by word, minus anything half-formed
// (an open citation, an unclosed **) so no broken piece flashes in.
function answerHtml(t) {
  if (!t.text) return "";
  const writing = t.state === "writing";
  let text = t.text;
  if (writing) {
    text = text.replace(/\((?:v|f)[a-z]*(?: [\d, ]*)?$/i, "");
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
  if (t.ui.shown !== t.state) { t.ui.activity.open = running; t.ui.shown = t.state; }  // open while working, fold when writing starts
  t.ui.status.hidden = !running;
  if (running) {
    const secs = Math.floor((performance.now() - t.startedAt) / 1000);
    const doing = t.state === "starting" ? "Reading the schema" : "Working";
    t.ui.status.txt.textContent = `${doing} · ${n ? queriesOf(n) + " · " : ""}${secs}s`;
    const last = t.queries.at(-1);
    t.ui.status.last.textContent = last ? (last.sql.trim().split("\n").find((l) => !/^\s*(--|$)/.test(l)) || last.sql).trim() : "";
  }
  t.queries.forEach((qy, i) => stepNode(t, qy, i));
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
  if (t.state === "done" && !t.ui.foot.firstChild) t.ui.foot.append(...footer(t));
  t.ui.follow.hidden = !(t.state === "done" && t.suggestions?.length);
  if (!t.ui.follow.hidden && !t.ui.follow.querySelector("button")) {
    for (const text of t.suggestions) {
      const b = el("button", "suggestion"); b.type = "button"; b.textContent = text;
      b.addEventListener("click", () => submit(text));
      t.ui.follow.append(b);
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

async function submit(question) {
  $("intro")?.remove();
  q.value = ""; grow();
  const prior = history();
  const turn = { question, state: "starting", startedAt: performance.now(), queries: [], text: "", done: null, error: null, requestId: null, suggestions: [], ...build(question) };
  turn.ui.error.append(retryButton(turn));
  $("thread").append(turn.node);
  turns.push(turn); renderNav();
  controller = new AbortController();
  setBusy(true); follow = true;

  let raf = 0;
  const paint = () => { raf = 0; render(turn); keepUp(); };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
  paint();
  const tick = setInterval(schedule, 1000);  // keeps the elapsed time moving between events
  try {
    const res = await fetch("/api/ask/stream", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
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
    controller = null; setBusy(false); $("jump").classList.remove("show");
    if (window.matchMedia("(pointer: fine)").matches) q.focus();
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
    const first = qy.sql.trim().split("\n").find((l) => !/^\s*(--|$)/.test(l)) || qy.sql;
    li.innerHTML = `<details><summary><span class="dot"></span><span class="sql-line">${esc(first.trim())}</span><span class="step-meta"></span></summary>
      <pre>${esc(qy.sql.trim())}${qy.params?.length ? "\n-- params: " + esc(JSON.stringify(qy.params)) : ""}</pre></details>`;
    t.ui.steps.append(li);
  }
  const r = qy.result, dot = li.querySelector(".dot"), meta = li.querySelector(".step-meta");
  const over = t.state === "stopped" || t.state === "failed";
  const state = r ? (r.error ? "danger" : r.truncated || r.cells_truncated ? "caution" : "ok") : over ? "danger" : "running";
  dot.className = `dot ${state}`; meta.className = `step-meta ${state === "danger" || state === "caution" ? state : ""}`;
  if (!r) meta.textContent = over ? (t.state === "stopped" ? "stopped" : "no result") : "running";
  else if (r.error) meta.textContent = "error";
  else meta.textContent = `${fmtInt(r.row_count)} ${r.row_count === 1 ? "row" : "rows"}${r.truncated ? ", cut off" : r.cells_truncated ? ", text cut" : ""} · ${r.ms} ms`;
  if (r?.error && !li.querySelector("pre").textContent.includes("-- error")) li.querySelector("pre").append(`\n-- error: ${r.error}`);
}

function footer(t) {
  const d = t.done, tokens = (d.usage?.prompt_tokens || 0) + (d.usage?.completion_tokens || 0), cited = citedRecords(t.text);
  const parts = [d.replay ? `Recorded answer from ${d.replay.model} on ${d.replay.recorded}` : d.model, `${d.seconds}s`];
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
    const b = el("button", null, `<strong>${esc(t.question)}</strong><span>${esc(snippet(t.text) || (t.state === "failed" ? "Failed" : t.state === "stopped" ? "Stopped" : "Answering…"))}</span>`);
    b.type = "button"; b.addEventListener("click", () => go(i));
    return b;
  }));
  observe();
}
function showPeek(tick, t) {
  peek.querySelector("strong").textContent = t.question;
  peek.querySelector("span").textContent = snippet(t.text) || (t.state === "failed" ? "Failed" : t.state === "stopped" ? "Stopped" : "Answering…");
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
async function openRecord(kind, id, back) {
  dlg.innerHTML = `<div class="rec-body"><p>Loading…</p></div>`;
  if (!dlg.open) dlg.showModal();
  try {
    const r = await fetch(`/api/records/${kind}/${id}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
    dlg.innerHTML = renderRecord(await r.json());
  } catch (err) {
    dlg.innerHTML = `<div class="rec-body"><p>Couldn't load this record: ${esc(err.message)}</p><form method="dialog"><button class="link-btn">Close</button></form></div>`;
  }
  if (back) {
    const b = el("button", "link-btn", "Back to list"); b.type = "button"; b.addEventListener("click", back);
    dlg.querySelector("form").prepend(b);
  }
}
function showCited(cited, answer) {
  const list = el("div", "rec-body");
  list.innerHTML = `<h3>${plural(cited.length, "record")} cited</h3><p class="rec-meta">Open a record, or jump to the line that cites it.</p>`;
  for (const { kind, id } of cited) {
    const at = answer.querySelector(`.cite[data-kind="${kind}"][data-id="${id}"]`);
    const line = (at?.closest("li, p")?.textContent || "").replace(/\s+/g, " ").trim();
    const row = el("div", "rec-row");
    const open = el("button", "link-btn", `${kind === "visit" ? "Visit" : "Form"} ${id}`); open.type = "button";
    open.addEventListener("click", () => openRecord(kind, id, () => showCited(cited, answer)));
    row.append(open);
    if (at) {
      const jump = el("button", "link-btn jump-to", "Show in answer"); jump.type = "button";
      jump.addEventListener("click", () => {
        dlg.close(); at.scrollIntoView({ block: "center", behavior: "smooth" });
        at.closest("li, p").classList.add("flash"); setTimeout(() => at.closest("li, p")?.classList.remove("flash"), 2200);
      });
      row.append(jump, Object.assign(el("div", "rec-line"), { textContent: line.length > 110 ? line.slice(0, 107) + "…" : line }));
    }
    list.append(row);
  }
  list.insertAdjacentHTML("beforeend", `<form method="dialog"><button class="link-btn">Close</button></form>`);
  dlg.replaceChildren(list);
  if (!dlg.open) dlg.showModal();
}
$("thread").addEventListener("click", (e) => {
  const c = e.target.closest(".cite");
  if (c) openRecord(c.dataset.kind, c.dataset.id);
});
function renderRecord(r) {
  const head = r.kind === "visit"
    ? `<h3>Visit ${r.id} · ${esc(r.person || "")}</h3><div class="rec-meta">${esc(r.start_time)} to ${esc(r.end_time)} · carer ${esc(r.carer || "unknown")} · ${esc(r.status)}</div>`
    : `<h3>${esc(r.form || "Form")} ${r.id}</h3><div class="rec-meta">${esc(r.title || "")} · created ${esc(r.created_at)}${r.person ? " · " + esc(r.person) : ""}</div>`;
  let body = "";
  if (r.kind === "visit") {
    body += `<h4>Note</h4><p>${esc(r.note || "No note")}</p>`;
    body += (r.activities || []).map((a) => `<div class="rec-item"><strong>${esc(a.name)}</strong> <span>${esc(a.status)}</span>${a.comment ? `<p>${esc(a.comment)}</p>` : ""}</div>`).join("");
  } else {
    body += (r.sections || []).map((sec) => `<h4>${esc(sec.section)}</h4>` + (sec.items || []).map((i) => `<div class="rec-item"><strong>${esc(i.question)}</strong><p>${esc(i.answer ?? "")}</p></div>`).join("")).join("");
  }
  return `<div class="rec-body">${head}${body}<form method="dialog"><button class="link-btn">Close</button></form></div>`;
}
