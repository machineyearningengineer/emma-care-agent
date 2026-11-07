const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtInt = (n) => Number(n).toLocaleString();
const history = [];   // {role, content} sent back for follow-ups
const turns = [];     // {node, question, answer}
let controller = null, seq = 0;

/* ---------- Markdown (escape first, so model text can't inject HTML) ---------- */
const CITE = /\((?:visits?|forms?)\s[^()]{1,80}\)/gi;
const inline = (s) => s
  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(CITE, (m) => {
    const kind = /^\(form/i.test(m) ? "form" : "visit";
    const body = m.slice(1, -1).replace(/(?<![\d-])\d+(?![\d-])(?!\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/g, (n) => `<button type="button" class="cite" data-kind="${kind}" data-id="${n}">${n}</button>`);
    return `<span class="cites">${body}</span>`;
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
const snippet = (text) => text.replace(/[#*`]/g, "").replace(/\s+/g, " ").trim().slice(0, 220);

/* ---------- Header ---------- */
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const day = (s) => DATE.format(new Date(s.replace(" ", "T")));
fetch("/api/meta").then((r) => r.json()).then((m) => {
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

/* ---------- One question ---------- */
async function submit(question) {
  $("intro")?.remove();
  q.value = ""; grow();
  controller = new AbortController();
  setBusy(true);
  follow = true;

  const node = el("article", "turn");
  node.id = `t${++seq}`;
  node.append(el("h2", null, esc(question)));
  const activity = el("details", "activity"); activity.open = true;
  const summary = el("summary", null, `<span class="label">Starting…</span><span class="chev" aria-hidden="true">›</span>`);
  const steps = el("ol", "steps");
  activity.append(summary, steps);
  const answer = el("div", "answer");
  const status = el("div", "status", "Reading the schema…");
  node.append(activity, status, answer);
  $("thread").append(node);
  const turn = { node, question, answer: "" };
  turns.push(turn); renderNav();
  keepUp();

  let text = "", queries = 0, requestId = null, raf = 0, current = null, done = null;
  const paint = () => { raf = 0; answer.innerHTML = markdown(text) + (done ? "" : '<span class="caret"></span>'); keepUp(); };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
  const label = (s) => { summary.querySelector(".label").textContent = s; };

  try {
    const res = await fetch("/api/ask/stream", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({ question, history: history.slice(-6) }),
    });
    requestId = res.headers.get("X-Request-ID");
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(Array.isArray(body.detail) ? body.detail.map((d) => d.msg).join("; ") : body.detail || res.statusText);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === "start") { requestId = ev.request_id; label("Planning queries"); }
        else if (ev.type === "query") {
          queries += 1;
          current = addStep(steps, ev);
          label(`Running query ${queries}`); status.textContent = `Running query ${queries}…`;
          keepUp();
        } else if (ev.type === "result") { finishStep(current, ev); }
        else if (ev.type === "delta") {
          if (!text) { status.remove(); label(`${queries} ${queries === 1 ? "query" : "queries"}`); activity.open = false; }
          text += ev.text; schedule();
        } else if (ev.type === "discard") { text = ""; schedule(); }
        else if (ev.type === "done") { done = ev; text = ev.answer; }
        else if (ev.type === "suggestions") { suggest(ev.questions || []); }
        else if (ev.type === "error") { requestId = ev.request_id || requestId; throw new Error(ev.detail); }
      }
    }
    if (!done) throw new Error("The connection closed before the answer finished.");
    cancelAnimationFrame(raf); paint();
    label(`${queries} ${queries === 1 ? "query" : "queries"} · ${done.seconds}s`);
    turn.answer = done.answer; renderNav();
    history.push({ role: "user", content: question }, { role: "assistant", content: done.answer });
    node.append(footer(done, requestId));
  } catch (err) {
    cancelAnimationFrame(raf);
    status.remove();
    if (text) { done = {}; paint(); }
    const stopped = err.name === "AbortError";
    label(stopped ? "Stopped" : `${queries} ${queries === 1 ? "query" : "queries"} · failed`);
    if (current && !current.dataset.done) finishStep(current, { error: stopped ? "stopped" : "no result" });
    const box = el("div", "error");
    box.innerHTML = `<strong>${stopped ? "Stopped" : "This answer failed"}</strong>
      <span>${esc(stopped ? "You stopped this answer. Nothing was saved." : err instanceof TypeError ? "Couldn't reach the server. Check that it is still running, then ask again." : err.message)}</span>
      ${requestId ? `<small>Request ${esc(requestId)}</small>` : ""}`;
    const retry = el("button", "link-btn", "Ask again"); retry.type = "button";
    retry.addEventListener("click", () => {  // replace the failed turn rather than stacking another under it
      node.remove(); turns.splice(turns.indexOf(turn), 1); renderNav(); submit(question);
    });
    box.append(retry);
    node.append(box);
    turn.answer = stopped ? "Stopped." : "Failed."; renderNav();
  } finally {
    controller = null; setBusy(false); $("jump").classList.remove("show");
    if (window.matchMedia("(pointer: fine)").matches) q.focus();
  }
}

function addStep(list, ev) {
  const li = el("li", "step");
  const d = el("details");
  const first = ev.sql.trim().split("\n").find((l) => !/^\s*(--|$)/.test(l)) || ev.sql;
  d.innerHTML = `<summary><span class="dot running"></span><span class="sql-line">${esc(first.trim())}</span>
    <span class="step-meta">running</span></summary>
    <pre>${esc(ev.sql.trim())}${ev.params?.length ? "\n-- params: " + esc(JSON.stringify(ev.params)) : ""}</pre>`;
  li.append(d); list.append(li);
  return li;
}
function finishStep(li, ev) {
  if (!li) return;
  li.dataset.done = "1";
  const dot = li.querySelector(".dot"), meta = li.querySelector(".step-meta");
  dot.classList.remove("running");
  if (ev.error) {
    dot.classList.add("danger"); meta.classList.add("danger");
    meta.textContent = ev.error === "stopped" ? "stopped" : "error";
    if (ev.error !== "stopped" && ev.error !== "no result") li.querySelector("pre").append(`\n-- error: ${ev.error}`);
    return;
  }
  const cut = ev.truncated || ev.cells_truncated;
  dot.classList.add(cut ? "caution" : "ok");
  meta.classList.toggle("caution", cut);
  meta.textContent = `${fmtInt(ev.row_count)} ${ev.row_count === 1 ? "row" : "rows"}${ev.truncated ? ", cut off" : ev.cells_truncated ? ", text cut" : ""} · ${ev.ms} ms`;
}
function footer(done, requestId) {
  const f = el("div", "foot");
  const tokens = (done.usage?.prompt_tokens || 0) + (done.usage?.completion_tokens || 0);
  const parts = [];
  if (done.replay) parts.push(`Recorded answer from ${esc(done.replay.model)} on ${esc(done.replay.recorded)}`);
  else parts.push(esc(done.model));
  parts.push(`${done.seconds}s`);
  if (tokens) parts.push(`${fmtInt(tokens)} tokens`);
  if (requestId) parts.push(`request ${esc(requestId)}`);
  f.innerHTML = parts.map((p) => `<span>${p}</span>`).join("");
  const copy = el("button", "link-btn", "Copy answer"); copy.type = "button";
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(done.answer); copy.textContent = "Copied"; }
    catch { copy.textContent = "Couldn't copy"; }
    setTimeout(() => (copy.textContent = "Copy answer"), 1600);
  });
  f.append(copy);
  return f;
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
    const b = el("button", null, `<strong>${esc(t.question)}</strong><span>${esc(snippet(t.answer) || "Answering…")}</span>`);
    b.type = "button"; b.addEventListener("click", () => go(i));
    return b;
  }));
  observe();
}
function showPeek(tick, t) {
  peek.querySelector("strong").textContent = t.question;
  peek.querySelector("span").textContent = snippet(t.answer) || "Answering…";
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

/* ---------- Follow-up suggestions: the next likely question, shown as the placeholder and chips ---------- */
function suggest(list) {
    document.querySelectorAll(".follow").forEach((n) => n.remove());
  if (!list.length) return;
  const box = el("div", "follow");
  for (const text of list) {
    const b = el("button", "suggestion"); b.type = "button"; b.textContent = text;
    b.addEventListener("click", () => submit(text));
    box.append(b);
  }
  turns.at(-1).node.append(box); keepUp();
}

/* ---------- Citations open the source record ---------- */
const dlg = el("dialog", "record");
document.body.append(dlg);
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
$("thread").addEventListener("click", async (e) => {
  const c = e.target.closest(".cite");
  if (!c) return;
  dlg.innerHTML = `<div class="rec-body"><p>Loading…</p></div>`;
  dlg.showModal();
  try {
    const r = await fetch(`/api/records/${c.dataset.kind}/${c.dataset.id}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
    dlg.innerHTML = renderRecord(await r.json());
  } catch (err) {
    dlg.innerHTML = `<div class="rec-body"><p>Couldn't load this record: ${esc(err.message)}</p><button class="link-btn" value="x">Close</button></div>`;
  }
  dlg.querySelector("[value=x]")?.addEventListener("click", () => dlg.close());
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
