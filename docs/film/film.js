// One question, end to end. Every frame is a pure function of t (seconds): window.renderAt(t).
// Motion tokens follow the brief: enter ease-out-expo, move ease-in-out-quart, exit ease-in-expo (shorter),
// pop ease-out-back; one hero per beat, everything else holds or dims to 40%; text never moves while read.
"use strict";
const cv = document.getElementById("c"), X = cv.getContext("2d");
const W = 1920, H = 1080;

// ---------- palette (one accent: coral = a record's ID, the thread through the whole film) ----------
const C = {
  paper: "#F5F1E8", panel: "#ECE6D9", line: "#D6CEBE", ink: "#1C1E24", ink2: "#4A4D57", mute: "#8E897D",
  coral: "#E4572E", blue: "#2F5D9E", ochre: "#C98A1B", teal: "#1F7F76", red: "#C62F3A", green: "#2E8650",
};
const SANS = '"Avenir Next", "Helvetica Neue", Helvetica, sans-serif';
const MONO = 'Menlo, "SF Mono", monospace';

// ---------- easing ----------
function bez(x1, y1, x2, y2) {
  const A = (a, b) => 1 - 3 * b + 3 * a, B = (a, b) => 3 * b - 6 * a, Cc = (a) => 3 * a;
  const cal = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + Cc(a)) * t;
  const slope = (t, a, b) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + Cc(a);
  return (x) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const s = slope(t, x1, x2); if (Math.abs(s) < 1e-6) break; t -= (cal(t, x1, x2) - x) / s; }
    return cal(Math.min(1, Math.max(0, t)), y1, y2);
  };
}
const E = { enter: bez(0.16, 1, 0.3, 1), move: bez(0.76, 0, 0.24, 1), exit: bez(0.7, 0, 0.84, 0), pop: bez(0.34, 1.56, 0.64, 1), lin: (x) => Math.min(1, Math.max(0, x)) };
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const P = (t, a, d = 0.6, e = E.enter) => e(clamp((t - a) / d));
function spring(t, z = 0.72, f = 1.6) {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * f, wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
}
const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------- drawing primitives ----------
function rr(x, y, w, h, r) { X.beginPath(); X.roundRect(x, y, w, h, r); }
function box(x, y, w, h, { r = 18, fill = C.paper, stroke = C.line, lw = 2, alpha = 1, dash } = {}) {
  X.save(); X.globalAlpha *= alpha; rr(x, y, w, h, r);
  if (fill) { X.fillStyle = fill; X.fill(); }
  if (stroke) { X.setLineDash(dash || []); X.strokeStyle = stroke; X.lineWidth = lw; X.stroke(); }
  X.restore();
}
function T(s, x, y, { size = 36, w = 500, color = C.ink, font = SANS, align = "left", base = "alphabetic", alpha = 1, track = 0 } = {}) {
  X.save(); X.globalAlpha *= alpha; X.font = `${w} ${size}px ${font}`; X.fillStyle = color; X.textAlign = align; X.textBaseline = base;
  if (track) X.letterSpacing = `${track}px`;
  X.fillText(s, x, y); X.restore();
}
function tw(s, size = 36, w = 500, font = SANS) { X.save(); X.font = `${w} ${size}px ${font}`; const m = X.measureText(s).width; X.restore(); return m; }
function line(pts, { color = C.ink, lw = 3, alpha = 1, dash, cap = "round" } = {}) {
  X.save(); X.globalAlpha *= alpha; X.strokeStyle = color; X.lineWidth = lw; X.lineCap = cap; X.lineJoin = "round"; X.setLineDash(dash || []);
  X.beginPath(); pts.forEach((p, i) => (i ? X.lineTo(p[0], p[1]) : X.moveTo(p[0], p[1]))); X.stroke(); X.restore();
}
function dot(x, y, r, color, alpha = 1) { X.save(); X.globalAlpha *= alpha; X.fillStyle = color; X.beginPath(); X.arc(x, y, r, 0, 7); X.fill(); X.restore(); }
function ring(x, y, r, color, lw = 3, alpha = 1, a0 = -Math.PI / 2, a1 = a0 + 2 * Math.PI) {
  X.save(); X.globalAlpha *= alpha; X.strokeStyle = color; X.lineWidth = lw; X.lineCap = "round"; X.beginPath(); X.arc(x, y, r, a0, a1); X.stroke(); X.restore();
}
// quadratic curve from a to b with bend; drawn up to progress k, with an arrowhead once k is near 1
function qpt(a, b, bend, k) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1];
  const c = [mx - dy * bend, my + dx * bend];
  const u = 1 - k; return [u * u * a[0] + 2 * u * k * c[0] + k * k * b[0], u * u * a[1] + 2 * u * k * c[1] + k * k * b[1]];
}
function arrow(a, b, k, { color = C.ink, lw = 3, bend = 0, alpha = 1, dash, head = true } = {}) {
  if (k <= 0) return;
  const n = 40, pts = [];
  for (let i = 0; i <= n; i++) pts.push(qpt(a, b, bend, (i / n) * k));
  line(pts, { color, lw, alpha, dash });
  if (head && k > 0.98) {
    const p = qpt(a, b, bend, 1), q = qpt(a, b, bend, 0.96), ang = Math.atan2(p[1] - q[1], p[0] - q[0]), L = 9 + lw * 2.2;
    X.save(); X.globalAlpha *= alpha; X.fillStyle = color; X.beginPath(); X.moveTo(p[0], p[1]);
    X.lineTo(p[0] - L * Math.cos(ang - 0.42), p[1] - L * Math.sin(ang - 0.42)); X.lineTo(p[0] - L * Math.cos(ang + 0.42), p[1] - L * Math.sin(ang + 0.42)); X.closePath(); X.fill(); X.restore();
  }
}
function tick(x, y, s, k, color = C.green, lw = 7) {
  if (k <= 0) return;
  const pts = [[x - s * 0.45, y], [x - s * 0.12, y + s * 0.32], [x + s * 0.5, y - s * 0.38]];
  const L1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), L2 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
  const d = k * (L1 + L2);
  const out = [pts[0]];
  if (d <= L1) out.push([lerp(pts[0][0], pts[1][0], d / L1), lerp(pts[0][1], pts[1][1], d / L1)]);
  else { out.push(pts[1]); const e = (d - L1) / L2; out.push([lerp(pts[1][0], pts[2][0], e), lerp(pts[1][1], pts[2][1], e)]); }
  line(out, { color, lw });
}
function cross(x, y, s, k, color = C.red, lw = 6) {
  if (k <= 0) return;
  const a = clamp(k * 2), b = clamp(k * 2 - 1);
  line([[x - s, y - s], [x - s + 2 * s * a, y - s + 2 * s * a]], { color, lw });
  if (b > 0) line([[x + s, y - s], [x + s - 2 * s * b, y - s + 2 * s * b]], { color, lw });
}
// the record ID chip: the hero motif
function chip(x, y, label, { k = 1, color = C.coral, size = 34, filled = false, alpha = 1, mono = true } = {}) {
  if (k <= 0) return;
  const f = mono ? MONO : SANS, w = tw(label, size, 600, f) + size * 0.9, h = size * 1.55;
  X.save(); X.globalAlpha *= alpha * clamp(k * 3); X.translate(x, y); X.scale(k, k);
  rr(-w / 2, -h / 2, w, h, h / 2); X.fillStyle = filled ? color : "#FBE7DF"; X.fill(); X.lineWidth = 3; X.strokeStyle = color; X.stroke();
  T(label, 0, 1, { size, w: 600, color: filled ? "#fff" : color, font: f, align: "center", base: "middle" });
  X.restore();
  return w;
}
function pill(x, y, label, { color = C.ink, size = 24, alpha = 1, fill, textColor } = {}) {
  const w = tw(label, size, 600) + size * 1.2, h = size * 1.7;
  box(x, y - h / 2, w, h, { r: h / 2, fill: fill || C.paper, stroke: color, lw: 2.5, alpha });
  T(label, x + w / 2, y + 1, { size, w: 600, color: textColor || color, align: "center", base: "middle", alpha });
  return w;
}
// icons for the four places
function icon(kind, x, y, s, color, alpha = 1) {
  X.save(); X.globalAlpha *= alpha; X.strokeStyle = color; X.fillStyle = color; X.lineWidth = Math.max(2, s * 0.09); X.lineCap = "round"; X.lineJoin = "round";
  if (kind === "page") { rr(x - s * 0.5, y - s * 0.38, s, s * 0.76, s * 0.08); X.stroke(); X.beginPath(); X.moveTo(x - s * 0.5, y - s * 0.18); X.lineTo(x + s * 0.5, y - s * 0.18); X.stroke(); }
  if (kind === "server") { for (let i = 0; i < 3; i++) { rr(x - s * 0.45, y - s * 0.42 + i * s * 0.29, s * 0.9, s * 0.22, s * 0.05); X.stroke(); X.beginPath(); X.arc(x + s * 0.3, y - s * 0.31 + i * s * 0.29, s * 0.03, 0, 7); X.fill(); } }
  if (kind === "model") { X.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; X.lineTo(x + Math.cos(a) * s * 0.46, y + Math.sin(a) * s * 0.46); } X.closePath(); X.stroke(); X.beginPath(); X.arc(x, y, s * 0.12, 0, 7); X.fill(); }
  if (kind === "db") { const rx = s * 0.42, ry = s * 0.13; X.beginPath(); X.ellipse(x, y - s * 0.3, rx, ry, 0, 0, 7); X.stroke(); X.beginPath(); X.moveTo(x - rx, y - s * 0.3); X.lineTo(x - rx, y + s * 0.3); X.ellipse(x, y + s * 0.3, rx, ry, 0, Math.PI, 0, true); X.lineTo(x + rx, y - s * 0.3); X.stroke(); X.beginPath(); X.ellipse(x, y, rx, ry, 0, 0, Math.PI); X.stroke(); }
  if (kind === "person") { X.beginPath(); X.arc(x, y - s * 0.18, s * 0.16, 0, 7); X.fill(); X.beginPath(); X.arc(x, y + s * 0.34, s * 0.3, Math.PI, 0); X.fill(); }
  if (kind === "lock") { rr(x - s * 0.3, y - s * 0.05, s * 0.6, s * 0.45, s * 0.06); X.fill(); X.beginPath(); X.arc(x, y - s * 0.05, s * 0.2, Math.PI, 0); X.stroke(); }
  X.restore();
}
const PLACES = [["page", "Page", C.ink], ["server", "Server", C.blue], ["model", "Model", C.ochre], ["db", "Database", C.teal]];
function place(i, x, y, r, { on = 1, alpha = 1, label = true, labelSize } = {}) {
  const [kind, name, col] = PLACES[i];
  X.save(); X.globalAlpha *= alpha;
  dot(x, y, r, on > 0.5 ? col : C.paper);
  ring(x, y, r, col, Math.max(2, r * 0.06));
  icon(kind, x, y, r * 1.0, on > 0.5 ? "#fff" : col);
  if (label) T(name, x, y + r + (labelSize || r * 0.45) + 10, { size: labelSize || Math.max(16, r * 0.42), w: 600, color: col, align: "center" });
  X.restore();
}
// wrap text into lines that fit width
function wrap(s, maxW, size, w = 500, font = SANS) {
  const words = s.split(" "), out = []; let cur = "";
  for (const wd of words) { const tryS = cur ? cur + " " + wd : wd; if (tw(tryS, size, w, font) > maxW && cur) { out.push(cur); cur = wd; } else cur = tryS; }
  if (cur) out.push(cur); return out;
}
function para(s, x, y, maxW, { size = 34, w = 500, color = C.ink, lh = 1.35, alpha = 1, align = "left" } = {}) {
  const ls = wrap(s, maxW, size, w); ls.forEach((l, i) => T(l, x, y + i * size * lh, { size, w, color, alpha, align })); return ls.length * size * lh;
}
function typed(s, t, a, cps = 28) { return s.slice(0, Math.max(0, Math.floor((t - a) * cps))); }

// ---------- section scaffolding ----------
const SEC = window.TL.secs;
function at(i) { return SEC[i].at; }
function mk(i, t) {
  const sec = SEC[i];
  return { t, dur: sec.dur, s: (k) => sec.starts[Math.min(k, sec.starts.length - 1)], out: 1 - P(t, sec.dur - 0.5, 0.35, E.exit) };
}
function partCard(t, n, title, color, until) {
  // big numeral + title, left aligned; exits before the next beat
  const k = P(t, 0.05, 0.9), o = 1 - P(t, until - 0.45, 0.35, E.exit);
  X.save(); X.globalAlpha = o;
  T(String(n), 230, 640 - 24 * (1 - k), { size: 300, w: 700, color, alpha: k });
  T("PART " + n, 470, 455, { size: 26, w: 700, color: C.mute, alpha: P(t, 0.3, 0.7), track: 6 });
  para(title, 470, 530, 1250, { size: 64, w: 600, alpha: P(t, 0.45, 0.8) });
  X.restore();
}
function label(s, x, y, alpha = 1, color = C.mute) { T(s.toUpperCase(), x, y, { size: 20, w: 700, color, alpha, track: 3 }); }
function fixCard(x, y, w, s, k, color = C.green, head = "FIX") {
  if (k <= 0) return 0;
  const lines = wrap(s, w - 70, 30, 500), h = 70 + lines.length * 41;
  box(x, y + 20 * (1 - k), w, h, { r: 16, fill: "#E6F0E8", stroke: color, lw: 2.5, alpha: k });
  T(head, x + 32, y + 46 + 20 * (1 - k), { size: 20, w: 700, color, alpha: k, track: 3 });
  lines.forEach((l, i) => T(l, x + 32, y + 92 + i * 41 + 20 * (1 - k), { size: 30, alpha: k }));
  return h;
}

// ---------- shots ----------
const S = [];

// 0 · intro: the whole dataset, one question, the four parts
S[0] = (t, m) => {
  const cols = 24, rows = 15, cw = 46, ch = 32, g = 10, gx = (W - (cols * (cw + g) - g)) / 2, gy = 150;
  const fade = 1 - P(t, m.s(3) - 0.6, 0.5, E.exit);
  if (fade > 0) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c; if (i >= 359) continue;
      const x = gx + c * (cw + g), y = gy + r * (ch + g), d = Math.hypot(c - cols / 2, r - rows / 2) / 14;
      const k = P(t, 0.2 + d * 1.6 + hash(i) * 0.3, 0.6);
      const form = i >= 336, hero = i === 292;
      let a = k * fade * (t > m.s(2) && !hero ? lerp(1, 0.35, P(t, m.s(2), 0.6)) : 1);
      box(x, y + 10 * (1 - k), cw, ch, { r: 6, fill: form ? "#D5E8E5" : C.panel, stroke: form ? C.teal : C.line, lw: 1.5, alpha: a });
      for (let l = 0; l < 2; l++) line([[x + 8, y + 11 + l * 9 + 10 * (1 - k)], [x + cw - 8 - (hash(i + l) * 14), y + 11 + l * 9 + 10 * (1 - k)]], { color: form ? C.teal : C.mute, lw: 2, alpha: a * 0.6 });
      if (hero && t > m.s(2) + 2.4) {
        const h = P(t, m.s(2) + 2.4, 0.5, E.pop);
        box(x - 3, y - 3, cw + 6, ch + 6, { r: 8, fill: "#FBE7DF", stroke: C.coral, lw: 3.5, alpha: h * fade });
      }
    }
    // counts
    const ck = P(t, m.s(1), 1.4, E.move);
    if (t > m.s(1) - 0.1) {
      T(`${Math.round(336 * ck)} visits`, gx, gy + rows * (ch + g) + 60, { size: 40, w: 600, alpha: P(t, m.s(1), 0.5) * fade });
      T(`${Math.round(23 * ck)} forms`, gx + 290, gy + rows * (ch + g) + 60, { size: 40, w: 600, color: C.teal, alpha: P(t, m.s(1), 0.5) * fade });
    }
    // the question and a checkable answer
    if (t > m.s(2)) {
      const k = P(t, m.s(2), 0.7);
      box(560, 420 - 16 * (1 - k), 800, 110, { r: 55, fill: C.ink, stroke: null, alpha: k * fade });
      T("Are there any medication issues I should know about?", 960, 486 - 16 * (1 - k), { size: 32, w: 500, color: "#fff", align: "center", alpha: k * fade });
      const k2 = P(t, m.s(2) + 2.6, 0.6);
      if (k2 > 0) { chip(1190, 600, "visit 293", { k: E.pop(clamp((t - m.s(2) - 2.6) / 0.5)), alpha: fade }); T("an answer you can check", 1190, 670, { size: 26, w: 600, color: C.coral, align: "center", alpha: k2 * fade }); }
    }
  }
  // agenda
  if (t > m.s(3)) {
    label("In about ten minutes", 360, 300, P(t, m.s(3), 0.6));
    const items = [["How one question becomes a checked answer", C.coral], ["What limits keep it safe, and why", C.blue], ["What is checked, and what is fragile", C.green], ["What breaks first, and how to fix it", C.red]];
    items.forEach(([s, col], i) => {
      const k = P(t, m.s(4 + i), 0.7);
      dot(390, 395 + i * 130, 34, col, k); T(String(i + 1), 390, 407 + i * 130, { size: 34, w: 700, color: "#fff", align: "center", alpha: k });
      T(s, 460, 409 + i * 130, { size: 48, w: 600, alpha: k });
    });
  }
};

// persistent rail of the four places during part one (sections 1–6)
const RAIL = { y: 92, x0: 660, dx: 200, r: 26 };
function railActive(T0) {
  const ev = [[at(1) + m1(1, 6) + 0.2, 1], [at(3), 2], [at(4), 3], [at(5), 2], [at(6), 0]];
  let cur = 0, from = 0, k = 1;
  for (const [tt, v] of ev) { if (T0 >= tt) { from = cur; cur = v; k = P(T0, tt, 0.8, E.move); } }
  return lerp(from, cur, k);
}
function m1(i, k) { return SEC[i].starts[k]; }
function drawRail(T0) {
  const start = at(1) + m1(1, 4) + 0.9, end = at(7) - 0.3;
  if (T0 < start || T0 > end + 0.5) return;
  const a = (T0 < start + 0.2 ? 0 : 1) * (1 - P(T0, end, 0.4, E.exit));
  const act = railActive(T0);
  line([[RAIL.x0, RAIL.y], [RAIL.x0 + 3 * RAIL.dx, RAIL.y]], { color: C.line, lw: 3, alpha: a });
  for (let i = 0; i < 4; i++) place(i, RAIL.x0 + i * RAIL.dx, RAIL.y, RAIL.r, { on: Math.abs(act - i) < 0.5 ? 1 : 0, alpha: a, labelSize: 18 });
  const x = RAIL.x0 + act * RAIL.dx;
  line([[x - 22, RAIL.y + 66], [x + 22, RAIL.y + 66]], { color: C.coral, lw: 5, alpha: a });
}

// 1 · the page
S[1] = (t, m) => {
  partCard(t, 1, "One question, end to end", C.coral, m.s(2));
  // four places, big, then they shrink into the rail
  if (t > m.s(2)) {
    const shrink = P(t, m.s(4), 0.9, E.move), gone = t > m.s(4) + 0.9;
    if (!gone) for (let i = 0; i < 4; i++) {
      const wordT = m.s(3) + [0, 0.9, 1.9, 2.9][i];
      const k = P(t, wordT, 0.5, E.pop);
      const x = lerp(330 + i * 420, RAIL.x0 + i * RAIL.dx, shrink), y = lerp(520, RAIL.y, shrink), r = lerp(90, RAIL.r, shrink);
      if (i < 3) arrow([330 + i * 420 + 110, 520], [330 + (i + 1) * 420 - 110, 520], P(t, wordT + 0.3, 0.6) * (1 - shrink), { color: C.line, lw: 4 });
      place(i, x, y, r * k, { on: 1, alpha: 1, labelSize: lerp(34, 18, shrink) });
    }
  }
  // the browser window, the typed question, the request
  if (t > m.s(4) + 0.5) {
    const k = P(t, m.s(4) + 0.5, 0.8);
    const bx = 330, by = 250 + 30 * (1 - k), bw = 1260, bh = 560;
    box(bx, by, bw, bh, { r: 22, fill: "#FFFDF8", stroke: C.line, lw: 2.5, alpha: k });
    line([[bx, by + 60], [bx + bw, by + 60]], { color: C.line, lw: 2, alpha: k });
    [0, 1, 2].forEach((i) => dot(bx + 36 + i * 28, by + 30, 8, C.line, k));
    T("localhost:8000", bx + 160, by + 39, { size: 22, color: C.mute, font: MONO, alpha: k });
    T("Care data agent", bx + 60, by + 140, { size: 40, w: 600, alpha: k });
    const send = t > m.s(6);
    const q = "Are there any medication issues I should know about?";
    const ib = { x: bx + 60, y: by + bh - 140, w: bw - 120, h: 84 };
    box(ib.x, ib.y, ib.w, ib.h, { r: 42, fill: C.paper, stroke: C.ink2, lw: 2, alpha: k });
    const sent = P(t, m.s(6), 0.9, E.move);
    const shown = typed(q, t, m.s(5), 15);
    if (!send) T(shown + ((Math.floor(t * 2) % 2 && shown.length < q.length) ? "|" : ""), ib.x + 40, ib.y + 54, { size: 32, alpha: k });
    if (send) {
      // the question becomes a bubble in the thread
      const y = lerp(ib.y + 42, by + 215, sent);
      box(bx + bw - 60 - 860, y - 42, 860, 84, { r: 42, fill: C.ink, stroke: null, alpha: sent });
      T(q, bx + bw - 60 - 430, y + 11, { size: 30, color: "#fff", align: "center", alpha: sent });
      // what is sent
      const k3 = P(t, m.s(6) + 1.2, 0.7);
      box(bx + 60, by + 285, 740, 120, { r: 14, fill: C.panel, stroke: null, alpha: k3 });
      T("POST /api/ask/stream", bx + 90, by + 322, { size: 26, w: 600, font: MONO, color: C.blue, alpha: k3 });
      T('{ "question": "…",', bx + 90, by + 358, { size: 24, font: MONO, alpha: k3 });
      T('  "history": [ last 6 messages ] }', bx + 90, by + 390, { size: 24, font: MONO, alpha: k3 });
      const k4 = P(t, m.s(7), 0.7);
      if (k4 > 0) {
        box(bx + 850, by + 285, 350, 120, { r: 14, fill: "#FFFDF8", stroke: C.line, alpha: k4 });
        T("why 6?", bx + 880, by + 322, { size: 22, w: 700, color: C.mute, alpha: k4 });
        para("enough for a follow-up, without re-sending it all", bx + 880, by + 356, 300, { size: 24, alpha: k4 });
      }
    }
  }
};

// 2 · the server: request ID and the prompt
S[2] = (t, m) => {
  const idk = P(t, 0.15, 0.6, E.pop), idOut = 1 - P(t, m.s(2) - 0.4, 0.35, E.exit);
  X.save(); X.globalAlpha = idOut;
  if (idk > 0) {
    label("request", 260, 300, idk);
    chip(540, 290, "18fa2f514df3", { k: idk, color: C.blue, size: 34 });
  }
  if (t > m.s(1)) {
    const lines = [["ask.start", "question received"], ["query", "rows=34  ms=12"], ["done", "steps=3  seconds=13.4"]];
    lines.forEach(([ev, rest], i) => {
      const k = P(t, m.s(1) + 0.5 + i * 0.45, 0.5);
      const y = 430 + i * 74;
      box(260, y - 44, 1400, 62, { r: 10, fill: C.panel, stroke: null, alpha: k });
      T("18fa2f514df3", 290, y, { size: 26, w: 600, font: MONO, color: C.blue, alpha: k });
      T(ev, 560, y, { size: 26, font: MONO, alpha: k }); T(rest, 790, y, { size: 26, font: MONO, color: C.ink2, alpha: k });
    });
    T("one ID on every log line, so a bad answer can be traced", 260, 700, { size: 32, w: 500, color: C.ink2, alpha: P(t, m.s(1) + 2.2, 0.6) });
  }
  X.restore();
  if (t < m.s(2)) return;
  // the prompt stack
  label("the prompt", 260, 250, P(t, m.s(2), 0.6));
  const layers = [
    ["Instructions", "how to query, how to cite (visit 12)", C.ink, 3],
    ["Schema", "tables, columns, values · read from the live database", C.teal, 4],
    ["People", "10 active, with visit counts", C.teal, 5],
    ["Glossary", "what the data can't show · written by hand", C.ochre, 6],
  ];
  layers.forEach(([name, sub, col, si], i) => {
    const k = spring(t - m.s(si), 0.78, 1.5), a = clamp((t - m.s(si)) * 4);
    if (a <= 0) return;
    const y = 290 + i * 118 - 50 * (1 - k);
    box(260, y, 980, 100, { r: 14, fill: "#FFFDF8", stroke: col, lw: 3, alpha: a });
    box(260, y, 14, 100, { r: 7, fill: col, stroke: null, alpha: a });
    T(name, 300, y + 62, { size: 36, w: 600, color: col, alpha: a });
    T(sub, 560, y + 60, { size: 24, color: C.ink2, alpha: a });
  });
  // derived vs hand-written
  if (t > m.s(7)) {
    const k = P(t, m.s(7), 0.6);
    line([[1270, 420], [1290, 420], [1290, 618], [1270, 618]], { color: C.teal, lw: 3, alpha: k });
    T("derived from the data", 1310, 510, { size: 28, w: 600, color: C.teal, alpha: k });
    T("can't go stale", 1310, 548, { size: 26, color: C.ink2, alpha: k });
    const k2 = P(t, m.s(8), 0.6);
    line([[1270, 655], [1290, 655], [1290, 735], [1270, 735]], { color: C.ochre, lw: 3, alpha: k2 });
    T("hand-written", 1310, 690, { size: 28, w: 600, color: C.ochre, alpha: k2 });
    T("the part that can go stale", 1310, 728, { size: 26, color: C.ink2, alpha: k2 });
  }
  if (t > m.s(9)) {
    const k = P(t, m.s(9), 0.7);
    box(250, 278, 1000, 476, { r: 20, fill: null, stroke: C.mute, lw: 2.5, dash: [10, 10], alpha: k });
    pill(1310, 345, "cached · ~3,000 tokens", { color: C.mute, size: 24, alpha: k });
    T("same for every question", 1310, 300, { size: 26, color: C.ink2, alpha: k });
  }
  if (t > m.s(10)) {
    const k = spring(t - m.s(10), 0.75, 1.6), a = clamp((t - m.s(10)) * 4);
    box(260, 790 + 40 * (1 - k), 980, 90, { r: 45, fill: C.ink, stroke: null, alpha: a });
    T("+ the question: the only new part", 750, 846 + 40 * (1 - k), { size: 32, w: 600, color: "#fff", align: "center", alpha: a });
  }
};

// 3 · the model and its one tool
S[3] = (t, m) => {
  const mx = 420, my = 470;
  const k0 = P(t, 0.1, 0.7, E.pop);
  place(2, mx, my, 110 * k0, { on: 1, labelSize: 34 });
  // the tool
  const k1 = P(t, m.s(1), 0.7);
  box(760, 330, 620, 230, { r: 20, fill: "#FFFDF8", stroke: C.ochre, lw: 3, alpha: k1 });
  T("run_sql", 800, 405, { size: 48, w: 700, font: MONO, color: C.ochre, alpha: k1 });
  T("(sql, params)", 1040, 405, { size: 30, font: MONO, color: C.ink2, alpha: k1 });
  T("returns columns, rows, truncated", 800, 470, { size: 26, color: C.ink2, alpha: k1 });
  T("read-only · one SELECT per call", 800, 512, { size: 26, color: C.ink2, alpha: k1 });
  arrow([mx + 125, my - 10], [755, 440], P(t, m.s(1) + 0.3, 0.6), { color: C.ochre, lw: 4 });
  // no other tools
  if (t > m.s(2)) {
    ["search_notes()", "weekly_report()"].forEach((s, i) => {
      const k = P(t, m.s(2) + i * 0.4, 0.5), y = 640 + i * 90;
      box(760, y, 420, 70, { r: 12, fill: null, stroke: C.mute, lw: 2, dash: [8, 8], alpha: k * 0.8 });
      T(s, 790, y + 46, { size: 28, font: MONO, color: C.mute, alpha: k });
      const c = P(t, m.s(2) + 1.0 + i * 0.3, 0.4);
      if (c > 0) line([[770, y + 36], [770 + 400 * c, y + 36]], { color: C.red, lw: 4 });
    });
  }
  // the loop
  if (t > m.s(3)) {
    const k = P(t, m.s(3), 0.6);
    label("the loop", 1450, 340, k);
    const steps = ["write a query", "read the rows", "ask again?"];
    steps.forEach((s, i) => {
      const a = P(t, m.s(3) + 0.6 + i * 1.0, 0.5);
      dot(1470, 400 + i * 70, 12, C.ochre, a); T(s, 1500, 410 + i * 70, { size: 30, alpha: a });
    });
    // packet cycling: model -> tool -> back, three times
    for (let n = 0; n < 3; n++) {
      const t0 = m.s(3) + 0.8 + n * 1.6, u = clamp((t - t0) / 1.4);
      if (u > 0 && u < 1) {
        const p = u < 0.5 ? qpt([mx + 120, my], [760, 445], -0.15, E.move(u * 2)) : qpt([760, 445], [mx + 120, my], -0.15, E.move(u * 2 - 1));
        dot(p[0], p[1], 11, C.coral);
      }
      const done = P(t, t0 + 1.4, 0.3);
      dot(1470 + n * 36, 640, 12, C.ochre, done);
    }
    for (let n = 3; n < 8; n++) ring(1470 + n * 36, 640, 11, C.line, 2.5, k);
    T("steps used, out of 8", 1450, 700, { size: 24, color: C.ink2, alpha: k });
  }
  // how it knows it is done
  if (t > m.s(4)) {
    const k = P(t, m.s(4), 0.7);
    box(260, 800, 1400, 170, { r: 18, fill: C.panel, stroke: null, alpha: k });
    T("A turn with no query is the answer.", 300, 866, { size: 36, w: 600, alpha: k });
    const k2 = P(t, m.s(5), 0.6);
    T("Nothing checks it is complete:", 300, 920, { size: 28, color: C.red, w: 600, alpha: k2 });
    const k3 = P(t, m.s(6), 0.6);
    T("the prompt says read a person's notes before calling them fine.", 720, 920, { size: 28, color: C.ink2, alpha: k3 });
  }
};

// shared data rows (real rows from the database)
const ROWS = [
  [290, "Iris Bennett", "7 Nov 17:30", "Medication was prompted and taken as prescribed."],
  [291, "Iris Bennett", "8 Nov 08:00", "Medication taken without issue."],
  [292, "Iris Bennett", "8 Nov 17:30", "Medication was prompted and taken as prescribed."],
  [293, "Iris Bennett", "9 Nov 08:00", "Family reported not to have given morning medication again; escalated to office."],
  [294, "Iris Bennett", "9 Nov 17:30", "Medication was administered as prescribed."],
  [295, "Iris Bennett", "10 Nov 08:00", "Medication was prompted and taken as prescribed."],
];
const TCOL = [200, 380, 640, 880];
const ID_POS = [TCOL[0] + 30, 0];

// 4 · the database returns rows that carry their IDs
S[4] = (t, m) => {
  const k0 = P(t, 0.1, 0.6);
  place(3, 250, 260, 60, { on: 1, alpha: k0, label: false });
  T("read only", 340, 250, { size: 34, w: 600, color: C.teal, alpha: k0 });
  icon("lock", 520, 245, 40, C.teal, k0);
  T("activity_comments", 340, 290, { size: 24, font: MONO, color: C.ink2, alpha: k0 });
  // header
  const hy = 400, k1 = P(t, 0.8, 0.6);
  ["visit_id", "person", "when", "comment"].forEach((h, i) => T(h, TCOL[i], hy, { size: 24, w: 600, font: MONO, color: i === 0 && t > m.s(1) ? C.coral : C.mute, alpha: k1 }));
  line([[180, hy + 20], [1760, hy + 20]], { color: C.line, lw: 2, alpha: k1 });
  if (t > m.s(1)) box(180, hy - 40, 170, 520, { r: 12, fill: "rgba(228,87,46,0.08)", stroke: null, alpha: P(t, m.s(1), 0.6) });
  const focus = P(t, m.s(2), 0.7);
  ROWS.forEach((r, i) => {
    const k = P(t, 1.1 + i * 0.12, 0.5), y = hy + 75 + i * 76;
    const hero = r[0] === 293, a = k * (hero ? 1 : lerp(1, 0.32, focus));
    if (hero && focus > 0) box(180, y - 46, 1580, 68, { r: 10, fill: "#FFFDF8", stroke: C.coral, lw: 2.5, alpha: focus });
    if (!(hero && t > m.s(3))) T(String(r[0]), TCOL[0], y, { size: 30, w: 600, font: MONO, color: C.coral, alpha: a });
    T(r[1], TCOL[1], y, { size: 28, alpha: a }); T(r[2], TCOL[2], y, { size: 28, color: C.ink2, alpha: a });
    const cm = hero && focus > 0.5 ? r[3] : r[3].length > 52 ? r[3].slice(0, 50) + "…" : r[3];
    T(cm, TCOL[3], y, { size: hero && focus > 0.5 ? 24 : 28, alpha: a, w: hero ? 600 : 500 });
    if (hero && t > m.s(3)) chip(TCOL[0] + 40, y - 10, "293", { k: E.pop(clamp((t - m.s(3)) / 0.5)), size: 34 });
  });
  if (t > m.s(1)) {
    const k = P(t, m.s(1) + 0.4, 0.6);
    T("every row carries its record's ID", 200, 920, { size: 32, w: 600, color: C.coral, alpha: k });
  }
};

// 5 · the ID travels into the answer
S[5] = (t, m) => {
  const r = ROWS[3], y0 = 300;
  const fadeRow = lerp(1, 0.45, P(t, 2.5, 0.8));
  box(180, y0 - 46, 1580, 68, { r: 10, fill: "#FFFDF8", stroke: C.coral, lw: 2.5, alpha: fadeRow });
  T(r[1], TCOL[1], y0, { size: 28, alpha: fadeRow }); T(r[2], TCOL[2], y0, { size: 28, color: C.ink2, alpha: fadeRow }); T(r[3], TCOL[3], y0, { size: 24, w: 600, alpha: fadeRow });
  label("database row", 200, y0 - 70, fadeRow);
  // the answer types in
  const ans1 = "Iris Bennett: on 9 November the family reported not giving her";
  const ans2 = "morning medication again, and the visit still says Completed";
  label("answer", 200, 610, P(t, 0.6, 0.5));
  T(typed(ans1, t, 0.8, 26), 200, 680, { size: 38 });
  const s2 = typed(ans2, t, 0.8 + ans1.length / 26, 26);
  T(s2, 200, 740, { size: 38 });
  const endX = 200 + tw(ans2, 38) + 14;
  const tType = 0.8 + (ans1.length + ans2.length) / 26 + 0.2, tLand = tType + 1.3, fly = clamp((t - tType) / 1.3);
  const from = [TCOL[0] + 40, y0 - 10], to = [endX + 90, 728];
  const u = E.move(fly), p = qpt(from, to, 0.25, u);
  if (fly > 0 && fly < 1) arrow(from, to, u, { color: C.coral, lw: 3, bend: 0.25, dash: [8, 10], head: false, alpha: 0.7 });
  if (fly >= 1) arrow(from, to, 1, { color: C.coral, lw: 3, bend: 0.25, dash: [8, 10], head: false, alpha: lerp(0.7, 0.9, P(t, m.s(1), 0.5)) });
  if (fly < 1) chip(p[0], p[1], "293", { size: 34, k: P(t, 0.2, 0.4, E.pop) });
  else {
    const k = P(t, tLand, 0.4);
    T("(visit 293)", endX, 740, { size: 38, w: 700, color: C.coral, alpha: k });
  }
  if (t > m.s(1)) T("same ID, from the row into the sentence it supports", 200, 880, { size: 32, w: 600, color: C.coral, alpha: P(t, m.s(1), 0.6) });
};

// 6 · stream, one pattern, a button, the record
S[6] = (t, m) => {
  const exitLines = 1 - P(t, m.s(3) - 0.5, 0.35, E.exit);
  if (exitLines > 0) {
    X.save(); X.globalAlpha = exitLines;
    label("the stream: one JSON object per line", 200, 230, P(t, 0.1, 0.5));
    const L = [['{"type":"start","request_id":"18fa2f514df3"}', C.ink2], ['{"type":"query","sql":"SELECT visit_id, …"}', C.ink2], ['{"type":"result","row_count":34,"ms":12}', C.ink2],
      ['{"type":"delta","text":"…still says Completed "}', C.ink], ['{"type":"delta","text":"(visit 293)."}', C.ink], ['{"type":"done","steps":3,"seconds":13.4}', C.ink2]];
    L.forEach(([s, col], i) => T(s, 200, 300 + i * 56, { size: 28, font: MONO, color: col, alpha: P(t, 0.3 + i * 0.45, 0.4) * (t > m.s(1) ? 0.4 : 1) }));
    if (t > m.s(1)) {
      label("one pattern", 200, 720, P(t, m.s(1), 0.5));
      const parts = [["(", C.ink], ["visit or form", C.coral], ["a number", C.coral], [")", C.ink]];
      let x = 200;
      parts.forEach(([s, col], i) => {
        const k = P(t, m.s(2) + i * 0.6, 0.5, E.pop), w = tw(s, 40, 600) + 50;
        box(x, 760, w, 80, { r: 14, fill: "#FFFDF8", stroke: col, lw: 3, alpha: clamp(k) });
        T(s, x + w / 2, 812, { size: 40, w: 600, color: col, align: "center", alpha: clamp(k) });
        x += w + 18;
      });
      T("CITE = /\\((visits?|forms?) (\\d+(?:, \\d+)*)\\)/gi", x + 30, 812, { size: 24, font: MONO, color: C.mute, alpha: P(t, m.s(2) + 2.4, 0.6) });
    }
    X.restore();
  }
  if (t < m.s(3) - 0.2) return;
  // the sentence on the page: plain text becomes a button
  const lx = 200, ly = 380;
  const kIn = P(t, m.s(3) - 0.2, 0.5);
  label("on the page", lx, ly - 90, kIn);
  T("Iris Bennett: the family reported not giving her", lx, ly, { size: 36, alpha: kIn });
  T("morning medication again, and the visit still", lx, ly + 54, { size: 36, alpha: kIn });
  T("says Completed", lx, ly + 108, { size: 36, alpha: kIn });
  const bx = lx + tw("says Completed ", 36);
  const scan = clamp((t - m.s(3)) / 0.9);
  const btn = P(t, m.s(3) + 0.9, 0.5, E.pop);
  if (scan < 1) { T("(visit 293)", bx, ly + 108, { size: 36, alpha: kIn }); line([[lx, ly + 124], [lx + (bx + 200 - lx) * scan, ly + 124]], { color: C.coral, lw: 3, alpha: 0.7 }); }
  else {
    const w = tw("visit 293", 32, 600) + 36;
    X.save(); X.translate(bx + w / 2, ly + 96); X.scale(btn, btn);
    box(-w / 2, -26, w, 52, { r: 26, fill: "#FBE7DF", stroke: C.coral, lw: 3 });
    T("visit 293", 0, 10, { size: 32, w: 600, color: C.coral, align: "center" });
    X.restore();
  }
  T("anything else stays plain text, so a wrong format is visible", lx, ly + 220, { size: 26, color: C.ink2, alpha: P(t, m.s(3) + 1.6, 0.6) * (1 - P(t, m.s(4), 0.4)) });
  // tap
  if (t > m.s(4)) {
    const w = tw("visit 293", 32, 600) + 36, target = [bx + w / 2 + 10, ly + 104];
    const cm = P(t, m.s(4), 1.0, E.move), cx = lerp(900, target[0], cm), cy = lerp(800, target[1], cm);
    const click = clamp((t - m.s(4) - 1.05) / 0.5);
    if (click > 0 && click < 1) ring(target[0] - 10, target[1] - 8, 20 + 60 * click, C.coral, 3, 1 - click);
    // cursor
    X.save(); X.translate(cx, cy); X.fillStyle = C.ink; X.strokeStyle = "#fff"; X.lineWidth = 2; X.beginPath(); X.moveTo(0, 0); X.lineTo(0, 34); X.lineTo(9, 26); X.lineTo(17, 42); X.lineTo(23, 39); X.lineTo(15, 23); X.lineTo(27, 23); X.closePath(); X.fill(); X.stroke(); X.restore();
    // the request and the record card
    const kr = P(t, m.s(4) + 1.3, 0.5);
    T("GET /api/records/visit/293", 1060, 250, { size: 26, font: MONO, color: C.coral, alpha: kr });
    const kc = P(t, m.s(4) + 1.7, 0.8);
    const cx0 = 1060 + 60 * (1 - kc);
    box(cx0, 290, 700, 560, { r: 22, fill: "#FFFDF8", stroke: C.coral, lw: 3, alpha: kc });
    T("Visit 293 · Iris Bennett", cx0 + 40, 360, { size: 34, w: 700, alpha: kc });
    T("Sun 9 Nov, 08:00–08:45 · Carer Isla Munro", cx0 + 40, 404, { size: 24, color: C.ink2, alpha: kc });
    label("the answer says", cx0 + 40, 470, kc);
    box(cx0 + 30, 488, 640, 110, { r: 12, fill: "#FBE7DF", stroke: null, alpha: kc });
    para("“the family reported not giving her morning medication again”", cx0 + 52, 532, 600, { size: 26, alpha: kc });
    label("visit note, as recorded", cx0 + 40, 650, kc);
    para("Medication · Completed · “Family reported not to have given morning medication again; escalated to office.”", cx0 + 40, 694, 620, { size: 26, alpha: kc });
    arrow([bx + w + 20, ly + 96], [cx0 - 10, 540], P(t, m.s(4) + 2.2, 0.6), { color: C.coral, lw: 3, bend: -0.15 });
  }
  if (t > m.s(5)) {
    const k = P(t, m.s(5), 0.6);
    tick(245, 840, 50, P(t, m.s(5), 0.5));
    T("claim checked against its source, in one tap", 300, 855, { size: 34, w: 600, color: C.green, alpha: k });
  }
};

// 7 · part two: the rule
S[7] = (t, m) => {
  partCard(t, 2, "The limits, and what happens when each one trips", C.blue, m.s(2));
  if (t < m.s(2)) return;
  const k = P(t, m.s(2), 0.7);
  box(260, 430, 360, 180, { r: 22, fill: "#FFFDF8", stroke: C.red, lw: 3, alpha: k });
  T("a limit", 440, 505, { size: 40, w: 700, color: C.red, align: "center", alpha: k });
  T("trips", 440, 555, { size: 40, w: 700, color: C.red, align: "center", alpha: k });
  const k2 = P(t, m.s(3), 0.8, E.move);
  arrow([630, 490], [1080, 360], k2, { color: C.blue, lw: 5, bend: -0.1 });
  place(2, 1180, 360, 80, { on: 1, alpha: P(t, m.s(3) + 0.5, 0.5), labelSize: 28 });
  para("told why: narrow the query, or answer with what it has", 1290, 340, 520, { size: 30, alpha: P(t, m.s(3) + 0.8, 0.6) });
  const k3 = P(t, m.s(3) + 2.2, 0.8, E.move);
  arrow([630, 560], [1080, 720], k3, { color: C.mute, lw: 4, bend: 0.1, dash: [10, 10] });
  icon("person", 1180, 720, 120, C.mute, P(t, m.s(3) + 2.8, 0.5));
  cross(1180, 720, 60, P(t, m.s(3) + 3.2, 0.5));
  T("never a crash in front of the manager", 1290, 735, { size: 30, color: C.ink2, alpha: P(t, m.s(3) + 3.2, 0.6) });
};

// 8 · per-query limits
S[8] = (t, m) => {
  label("each query", 200, 210, P(t, 0, 0.5));
  // time limit gauge
  const gx = 200, gy = 300, gw = 1100;
  const k0 = P(t, 0.2, 0.6);
  box(gx, gy, gw, 60, { r: 30, fill: C.panel, stroke: null, alpha: k0 });
  T("0 s", gx, gy + 110, { size: 24, color: C.mute, alpha: k0 });
  const lim = gx + gw * 0.8;
  line([[lim, gy - 20], [lim, gy + 80]], { color: C.red, lw: 4, alpha: k0 });
  T("2 s", lim, gy + 110, { size: 28, w: 700, color: C.red, align: "center", alpha: k0 });
  const run = clamp((t - 1.2) / 3.0);
  const bw = gw * 0.85 * run;
  box(gx + 6, gy + 6, Math.max(0, Math.min(bw, gw * 0.8 - 6)), 48, { r: 24, fill: run > 0.94 ? C.red : C.blue, stroke: null, alpha: k0 });
  para("so one bad query cannot hang the question", 1360, gy + 30, 440, { size: 28, color: C.ink2, alpha: P(t, 1.5, 0.6) });
  if (t > m.s(1)) {
    const k = P(t, m.s(1), 0.6);
    box(gx, gy + 150, 900, 70, { r: 12, fill: "#FBE3E3", stroke: null, alpha: k });
    T('"query exceeded the time limit; narrow it"', gx + 30, gy + 196, { size: 26, font: MONO, color: C.red, alpha: k });
    arrow([gx + 920, gy + 185], [gx + 1060, gy + 185], P(t, m.s(1) + 0.6, 0.5), { color: C.ochre, lw: 4 });
    place(2, gx + 1110, gy + 185, 34, { on: 1, alpha: P(t, m.s(1) + 0.9, 0.4), label: false });
  }
  // result caps
  if (t > m.s(2)) {
    const caps = [["200", "rows"], ["500", "characters a cell"], ["30,000", "characters in all"]];
    caps.forEach(([n, u], i) => {
      const k = P(t, m.s(2) + 0.8 + i * 1.6, 0.6, E.pop), x = 200 + i * 420;
      box(x, 600, 380, 150, { r: 18, fill: "#FFFDF8", stroke: C.blue, lw: 3, alpha: clamp(k) });
      T(n, x + 30, 680, { size: 56, w: 700, color: C.blue, alpha: clamp(k) });
      T(u, x + 30, 725, { size: 26, color: C.ink2, alpha: clamp(k) });
    });
  }
  if (t > m.s(3)) {
    const k = P(t, m.s(4), 0.6);
    T("Why?", 1490, 640, { size: 40, w: 700, alpha: P(t, m.s(3), 0.5) });
    para("200 rows of long notes ≈ 25,000 tokens in one step", 1490, 690, 360, { size: 28, alpha: k });
    para("cheap, and small enough to read carefully", 1490, 800, 360, { size: 28, color: C.green, w: 600, alpha: P(t, m.s(5), 0.6) });
  }
  if (t > m.s(6)) {
    const k = P(t, m.s(6), 0.6);
    T('"truncated": true', 200, 880, { size: 32, w: 600, font: MONO, color: C.red, alpha: k });
    arrow([560, 870], [700, 870], P(t, m.s(6) + 0.5, 0.5), { color: C.ochre, lw: 4 });
    T("the model asks a smaller question", 720, 882, { size: 32, alpha: P(t, m.s(6) + 0.8, 0.6) });
  }
};

// 9 · per-question bounds, and the gaps section
S[9] = (t, m) => {
  label("each question", 200, 210, P(t, 0, 0.5));
  const words = SEC[9].words, find = (w) => { const f = words.find(([s]) => s.toLowerCase().startsWith(w)); return f ? f[1] : 0; };
  const g = [["8", "tool steps", find("eight")], ["150k", "prompt tokens", find("hundred")], ["2 min", "wall clock", find("minutes")]];
  const fillT = (i) => clamp((t - m.s(1)) / [5.2, 9, 12][i]);
  g.forEach(([n, u, w0], i) => {
    const k = P(t, w0, 0.6, E.pop), x = 200 + i * 520, y = 270;
    box(x, y, 470, 200, { r: 20, fill: "#FFFDF8", stroke: C.blue, lw: 3, alpha: clamp(k) });
    T(n, x + 34, y + 92, { size: 64, w: 700, color: C.blue, alpha: clamp(k) });
    T(u, x + 34, y + 140, { size: 28, color: C.ink2, alpha: clamp(k) });
    const f = fillT(i), tripped = i === 0 && t > m.s(3);
    box(x + 34, y + 160, 400, 14, { r: 7, fill: C.panel, stroke: null, alpha: clamp(k) });
    box(x + 34, y + 160, 400 * (tripped ? 1 : Math.min(f, i === 0 ? 0.99 : 0.75)), 14, { r: 7, fill: tripped ? C.red : C.blue, stroke: null, alpha: clamp(k) });
    if (tripped) T("trips first", x + 300, y + 92, { size: 28, w: 700, color: C.red, alpha: P(t, m.s(3), 0.4) });
  });
  if (t > m.s(1)) T("a normal question: a few steps, about 15 seconds", 200, 540, { size: 30, color: C.ink2, alpha: P(t, m.s(1), 0.6) * (1 - P(t, m.s(3), 0.4)) });
  if (t > m.s(2)) T("so one confused question cannot spend without limit", 200, 590, { size: 30, w: 600, alpha: P(t, m.s(2), 0.6) * (1 - P(t, m.s(3), 0.4)) });
  if (t > m.s(3)) {
    const k = P(t, m.s(3) + 0.3, 0.6);
    box(200, 540, 640, 110, { r: 16, fill: C.panel, stroke: null, alpha: k });
    T("next turn:", 230, 608, { size: 32, color: C.ink2, alpha: k });
    T('tools = "none"', 400, 608, { size: 32, w: 600, font: MONO, alpha: k });
  }
  if (t > m.s(4)) {
    const k = P(t, m.s(4), 0.7);
    box(900, 520, 820, 360, { r: 20, fill: "#FFFDF8", stroke: C.line, lw: 2.5, alpha: k });
    T("the answer, from what it found", 940, 580, { size: 28, w: 600, alpha: k });
    [0, 1, 2].forEach((i) => line([[940, 620 + i * 34], [1640 - i * 120, 620 + i * 34]], { color: C.line, lw: 10, alpha: k }));
    const k2 = P(t, m.s(5), 0.6);
    box(930, 730, 760, 130, { r: 14, fill: "#FBF1DE", stroke: C.ochre, lw: 2.5, alpha: k2 });
    T("What I couldn't determine:", 960, 776, { size: 28, w: 700, color: C.ochre, alpha: k2 });
    T("• no planned visit times, so lateness can't be measured", 960, 826, { size: 24, alpha: P(t, m.s(6), 0.6) });
  }
  if (t > m.s(5)) {
    const k = P(t, m.s(5), 0.6);
    T("a rule in the prompt", 200, 720, { size: 30, w: 600, alpha: k });
    T("+ the glossary says what the data can't show", 200, 770, { size: 28, color: C.ochre, alpha: P(t, m.s(6), 0.6) });
    T("+ the page draws it as its own box", 200, 815, { size: 28, color: C.ink2, alpha: P(t, m.s(6) + 3, 0.6) });
    T("nothing checks it is right: the model's judgement", 200, 880, { size: 28, w: 600, color: C.red, alpha: P(t, m.s(7), 0.6) });
  }
};

// 10 · eight at once, the ninth refused; read-only twice over
S[10] = (t, m) => {
  label("live questions at once", 200, 210, P(t, 0, 0.5));
  const sx = 200, sy = 260;
  for (let i = 0; i < 8; i++) {
    const x = sx + (i % 4) * 150, y = sy + Math.floor(i / 4) * 150;
    box(x, y, 120, 120, { r: 18, fill: "#FFFDF8", stroke: C.blue, lw: 3, alpha: P(t, 0.2 + i * 0.05, 0.5) });
    const arr = 0.6 + i * 0.25, k = P(t, arr, 0.6, E.move);
    if (k > 0) { const px = lerp(x + 60 - 300, x + 60, k); dot(px, y + 60, 30, C.blue, clamp(k * 2)); }
  }
  if (t > m.s(1)) {
    const k = P(t, m.s(1), 0.6);
    para("each holds model tokens and a server thread: this caps the spend and keeps the server responsive", 200, 640, 560, { size: 28, color: C.ink2, alpha: k * (1 - P(t, m.s(2), 0.4) * 0.6) });
  }
  if (t > m.s(2)) {
    const u = clamp((t - m.s(2)) / 1.6), x = u < 0.6 ? lerp(1000, 800, E.move(u / 0.6)) : lerp(800, 880, E.enter((u - 0.6) / 0.4));
    dot(x, 320, 30, C.red);
    box(200, 820, 760, 80, { r: 14, fill: "#FBE3E3", stroke: null, alpha: P(t, m.s(2) + 1.0, 0.5) });
    T("Busy: try again in a moment.", 230, 872, { size: 32, w: 600, color: C.red, alpha: P(t, m.s(2) + 1.0, 0.5) });
  }
  // read-only twice
  if (t > m.s(3)) {
    const k = P(t, m.s(3), 0.6);
    place(3, 1240, 380, 100, { on: 1, alpha: k, label: false });
    const l1 = P(t, m.s(3) + 1.0, 0.5, E.pop), l2 = P(t, m.s(3) + 2.0, 0.5, E.pop);
    icon("lock", 1400, 330, 60 * l1, C.teal); T("opened mode=ro", 1440, 340, { size: 28, font: MONO, alpha: clamp(l1) });
    icon("lock", 1400, 420, 60 * l2, C.teal); T("authorizer: SELECT only", 1440, 430, { size: 28, font: MONO, alpha: clamp(l2) });
    para("the model writes its own SQL, so the database itself must refuse writes, not just the prompt", 1140, 560, 640, { size: 28, color: C.ink2, alpha: P(t, m.s(4), 0.6) });
  }
  if (t > m.s(5)) {
    const k = P(t, m.s(5), 0.6), k2 = P(t, m.s(5) + 1.6, 0.6);
    box(1140, 720, 640, 70, { r: 35, fill: C.ink, stroke: null, alpha: k });
    T("Update Alfred's care plan to say he is stable.", 1460, 765, { size: 24, color: "#fff", align: "center", alpha: k });
    box(1140, 810, 640, 70, { r: 16, fill: C.panel, stroke: null, alpha: k2 });
    T("I'm read-only, so I can't change records.", 1170, 855, { size: 26, alpha: k2 });
  }
};

// 11 · part three: checked and fragile
S[11] = (t, m) => {
  partCard(t, 3, "What is checked, and what is fragile", C.green, m.s(2));
  if (t < m.s(2)) return;
  label("checked", 200, 240, P(t, m.s(2), 0.5), C.green);
  const rows = [
    [m.s(3), "Format", "a test keeps the page's pattern and the prompt in agreement"],
    [m.s(4), "Existence", "evals fail an answer citing a record that doesn't exist"],
  ];
  rows.forEach(([a, h, sub], i) => {
    const k = P(t, a, 0.6), y = 320 + i * 130;
    tick(230, y - 12, 50, P(t, a + 0.3, 0.5));
    T(h, 290, y, { size: 40, w: 700, alpha: k }); T(sub, 290, y + 44, { size: 28, color: C.ink2, alpha: k });
  });
  if (t > m.s(5)) {
    const k = P(t, m.s(5), 0.6, E.pop);
    box(1300, 270, 440, 200, { r: 20, fill: "#E6F0E8", stroke: C.green, lw: 3, alpha: clamp(k) });
    T("42 / 42", 1520, 370, { size: 72, w: 700, color: C.green, align: "center", alpha: clamp(k) });
    T("golden questions + rephrasings", 1520, 425, { size: 24, color: C.ink2, align: "center", alpha: clamp(k) });
  }
  if (t > m.s(6)) {
    const k = P(t, m.s(6), 0.6);
    T("(visit 293, form 22)", 290, 620, { size: 32, font: MONO, color: C.ink2, alpha: k });
    T("→ stays plain text: the mistake shows", 720, 620, { size: 28, color: C.ink2, alpha: k });
  }
  if (t > m.s(7)) {
    label("not checked", 200, 710, P(t, m.s(7), 0.5), C.red);
    const k = P(t, m.s(8), 0.6);
    ring(230, 770, 26, C.ochre, 5, k); T("?", 230, 782, { size: 32, w: 700, color: C.ochre, align: "center", alpha: k });
    T("Support", 290, 785, { size: 40, w: 700, alpha: k });
    T("does the record really say what the sentence claims?", 290, 829, { size: 28, color: C.ink2, alpha: k });
    if (t > m.s(9)) {
      const k2 = P(t, m.s(9), 0.6);
      chip(1250, 780, "visit 293", { k: k2, size: 28 }); chip(1520, 780, "visit 239", { k: k2, size: 28 });
      T("right record", 1250, 840, { size: 24, color: C.ink2, align: "center", alpha: k2 }); T("real, but wrong", 1520, 840, { size: 24, color: C.red, align: "center", alpha: k2 });
      T("look exactly the same", 1385, 890, { size: 26, w: 600, align: "center", alpha: P(t, m.s(9) + 1.2, 0.6) });
    }
    if (t > m.s(10)) {
      const k3 = P(t, m.s(10), 0.6);
      icon("person", 240, 950, 60, C.ink, k3);
      T("the manager's call, which is why the record is one tap away", 290, 965, { size: 30, w: 600, alpha: k3 });
    }
  }
};

// 12 · part four card
S[12] = (t, m) => partCard(t, 4, "What breaks first, in order, and the fix for each", C.red, m.dur);

// small "what breaks" header used by 13–17
function breakHead(t, n, title, color) {
  const k = P(t, 0.05, 0.6);
  dot(250, 200, 44, color, k); T(String(n), 250, 216, { size: 44, w: 700, color: "#fff", align: "center", alpha: k });
  T(title, 320, 218, { size: 54, w: 700, alpha: k });
}

// 13 · recall
S[13] = (t, m) => {
  breakHead(t, 1, "Recall", C.red);
  if (t > m.s(2)) T("of the people who need attention, how many were found", 320, 270, { size: 30, color: C.ink2, alpha: P(t, m.s(2), 0.6) });
  // ten people; five need attention
  const need = [1, 3, 4, 7, 9];
  for (let i = 0; i < 10; i++) {
    const x = 300 + i * 130, y = 400, k = P(t, 0.4 + i * 0.06, 0.5);
    const isNeed = need.includes(i);
    icon("person", x, y, 90, isNeed && t > m.s(3) ? C.ink : C.mute, k);
    if (isNeed && t > m.s(4)) {
      const varied = t > m.s(6) && i === 7;
      const found = !varied || t < m.s(6) + 1.2;
      if (found) ring(x, y + 8, 56, C.green, 5, P(t, m.s(4) + need.indexOf(i) * 0.25, 0.4));
      else { ring(x, y + 8, 56, C.red, 4, 1, -Math.PI / 2, Math.PI * 1.5); line([[x - 20, y + 90], [x + 20, y + 90]], { color: C.red, lw: 4 }); }
    }
  }
  if (t > m.s(4)) T(t > m.s(6) + 1.2 ? "4 of 5 found" : "5 of 5 found", 300, 545, { size: 40, w: 700, color: t > m.s(6) + 1.2 ? C.red : C.green, alpha: P(t, m.s(4), 0.5) });
  if (t > m.s(5)) {
    const k = P(t, m.s(5), 0.6);
    T("this data:", 300, 615, { size: 26, w: 700, color: C.mute, alpha: k });
    T("the same few phrases, again and again", 450, 615, { size: 26, font: MONO, alpha: k });
  }
  if (t > m.s(6)) {
    const k = P(t, m.s(6), 0.6);
    T("real notes:", 300, 660, { size: 26, w: 700, color: C.mute, alpha: k });
    T("“didn't want her tablets” · “pills left on the side”", 450, 660, { size: 26, font: MONO, alpha: k });
  }
  if (t > m.s(7)) {
    const k = P(t, m.s(7), 0.6);
    box(1300, 490, 440, 120, { r: 16, fill: "#FBE3E3", stroke: null, alpha: k });
    T("no error.", 1330, 545, { size: 36, w: 700, color: C.red, alpha: k });
    T("the answer just looks complete", 1330, 585, { size: 26, color: C.ink2, alpha: P(t, m.s(8), 0.5) });
  }
  const fade = 1 - P(t, m.s(11) - 0.4, 0.4, E.exit);
  if (t > m.s(11)) {
    fixCard(300, 730, 600, "measure it: real notes, real managers", P(t, m.s(11), 0.6), C.green, "FIX FIRST");
  }
  if (t > m.s(12)) {
    const k = P(t, m.s(12), 0.6);
    // shortlist -> small contexts in parallel -> rank
    const x0 = 1000, y0 = 810;
    T("SQL shortlist", x0, y0 + 20, { size: 26, w: 600, alpha: k });
    for (let i = 0; i < 4; i++) {
      const kk = P(t, m.s(12) + 0.8 + i * 0.2, 0.5);
      arrow([x0 + 190, y0 + 10], [x0 + 300, y0 - 60 + i * 50], kk, { color: C.ochre, lw: 3 });
      box(x0 + 310, y0 - 80 + i * 50, 200, 40, { r: 10, fill: "#FFFDF8", stroke: C.ochre, lw: 2, alpha: kk });
      T("one person", x0 + 410, y0 - 52 + i * 50, { size: 20, align: "center", alpha: kk });
    }
    const kr = P(t, m.s(12) + 2.2, 0.5);
    arrow([x0 + 520, y0 + 10], [x0 + 620, y0 + 10], kr, { color: C.ochre, lw: 3 });
    T("rank", x0 + 640, y0 + 20, { size: 26, w: 600, alpha: kr });
    T("a model reading one person carefully misses less", x0, y0 + 130, { size: 26, color: C.green, w: 600, alpha: P(t, m.s(13), 0.6) });
  }
  void fade;
};

// 14 · the database as it grows
S[14] = (t, m) => {
  breakHead(t, 2, "The database as it grows", C.red);
  // nested JSON -> flat rows
  if (t > m.s(2)) {
    const k = P(t, m.s(2), 0.6);
    box(200, 300, 560, 260, { r: 16, fill: C.panel, stroke: null, alpha: k });
    T("visits.activities", 230, 345, { size: 24, w: 600, font: MONO, color: C.mute, alpha: k });
    ['[{"activity":"Medication",', '  "status":"Completed",', '  "comment":"Family reported…"},', ' {"activity":"Meal", …}]'].forEach((s, i) => T(s, 230, 395 + i * 38, { size: 24, font: MONO, alpha: k }));
  }
  if (t > m.s(3)) {
    const k = P(t, m.s(3), 0.8, E.move);
    arrow([780, 430], [920, 430], k, { color: C.teal, lw: 4 });
    T("read model", 790, 400, { size: 22, w: 700, color: C.teal, alpha: k });
    const k2 = P(t, m.s(4), 0.6);
    ["visit_notes", "activity_comments", "form_answers", "search (full text)"].forEach((s, i) => {
      const kk = P(t, m.s(4) + i * 0.4, 0.5);
      box(940, 300 + i * 66, 420, 54, { r: 10, fill: "#FFFDF8", stroke: C.teal, lw: 2, alpha: kk });
      T(s, 965, 336 + i * 66, { size: 24, font: MONO, color: C.teal, alpha: kk });
    });
    T("one row per note, comment or answer", 940, 590, { size: 24, color: C.ink2, alpha: k2 });
  }
  if (t > m.s(5)) {
    const k = P(t, m.s(5), 0.6);
    box(1420, 300, 320, 120, { r: 16, fill: "#FBF1DE", stroke: C.ochre, lw: 2.5, alpha: k });
    T("rebuilt per connection", 1445, 345, { size: 24, w: 600, alpha: k });
    T("~6 ms today", 1445, 390, { size: 30, w: 700, color: C.ochre, alpha: k });
  }
  if (t > m.s(6)) {
    const k = P(t, m.s(6), 0.6);
    T("comment LIKE '%medication%'", 1420, 480, { size: 22, font: MONO, alpha: k });
    T("can't use an index: reads every row", 1420, 515, { size: 22, color: C.red, alpha: k });
  }
  // query time vs data size crossing 2 s
  if (t > m.s(7)) {
    const k = P(t, m.s(7), 0.6), ax = 200, ay = 900, aw = 700, ah = 230;
    line([[ax, ay - ah], [ax, ay], [ax + aw, ay]], { color: C.ink2, lw: 3, alpha: k });
    T("data size →", ax + aw - 160, ay + 36, { size: 22, color: C.mute, alpha: k });
    T("query time", ax, ay - ah - 16, { size: 22, color: C.mute, alpha: k });
    const limY = ay - ah * 0.72;
    line([[ax, limY], [ax + aw, limY]], { color: C.red, lw: 3, dash: [10, 8], alpha: k });
    T("2 s", ax + aw + 14, limY + 8, { size: 24, w: 700, color: C.red, alpha: k });
    const g = P(t, m.s(7) + 0.3, 3.0, E.move), pts = [];
    for (let i = 0; i <= 60 * g; i++) { const u = i / 60; pts.push([ax + u * aw, ay - ah * (0.04 + 0.92 * u * u)]); }
    line(pts, { color: C.teal, lw: 5 });
    if (t > m.s(8)) {
      const u = Math.sqrt((0.72 - 0.04) / 0.92), k2 = P(t, m.s(8), 0.4, E.pop);
      dot(ax + u * aw, limY, 12 * k2, C.red);
      T("narrow… narrow… narrow…", ax + u * aw - 260, limY - 30, { size: 22, color: C.red, alpha: P(t, m.s(8) + 1.5, 0.6) });
    }
    T("illustrative shape", ax, ay + 36, { size: 18, color: C.mute, alpha: k });
  }
  if (t > m.s(9)) {
    const h = fixCard(1000, 640, 740, "store the read model once · keep the search index updated by triggers · real indexes on person and date", P(t, m.s(10), 0.6));
    if (t > m.s(11)) T("on Postgres: a read-only role + statement_timeout", 1000, 640 + h + 50, { size: 26, w: 600, color: C.ink2, alpha: P(t, m.s(11), 0.6) });
  }
};

// 15 · many people at once
S[15] = (t, m) => {
  breakHead(t, 3, "Many people at once", C.red);
  // one thread mostly waiting
  if (t > m.s(2)) {
    const k = P(t, m.s(2), 0.6), x = 200, y = 330, w = 1100;
    T("one question's thread", x, y - 20, { size: 24, w: 600, color: C.mute, alpha: k });
    const segs = [[0, 0.03, C.blue, "SQL"], [0.03, 0.35, C.panel, "waiting for the model"], [0.35, 0.37, C.blue, ""], [0.37, 0.7, C.panel, ""], [0.7, 0.72, C.blue, ""], [0.72, 1, C.panel, ""]];
    const g = P(t, m.s(2) + 0.3, 3, E.lin);
    segs.forEach(([a, b, col, lab]) => {
      if (g <= a) return;
      box(x + w * a, y, w * (Math.min(b, g) - a), 60, { r: 6, fill: col === C.panel ? "#E4DDCD" : col, stroke: null, alpha: k });
      if (lab && g > b) T(lab, x + w * a + (col === C.panel ? 20 : 0), y + 40, { size: 22, color: C.ink2, alpha: k });
    });
    T("up to 2 minutes, mostly idle", x + w + 30, y + 40, { size: 26, w: 600, color: C.ink2, alpha: P(t, m.s(2) + 3, 0.6) });
  }
  // 8 slots + refused 9th
  if (t > m.s(3)) {
    for (let i = 0; i < 8; i++) {
      const x = 200 + i * 110, k = P(t, m.s(3) + i * 0.12, 0.4);
      box(x, 480, 90, 90, { r: 14, fill: C.blue, stroke: null, alpha: k });
    }
    const u = P(t, m.s(3) + 1.6, 0.8, E.move);
    dot(lerp(1300, 1120, u), 525, 40, C.red, u);
    T("busy", 1080, 620, { size: 28, w: 700, color: C.red, alpha: P(t, m.s(3) + 2.4, 0.5) });
  }
  if (t > m.s(4)) {
    const k = P(t, m.s(4), 0.6);
    T("honest back pressure:", 200, 690, { size: 34, w: 700, alpha: k });
    T("refuse early, rather than let everyone slow down", 590, 690, { size: 32, color: C.ink2, alpha: P(t, m.s(5), 0.6) });
  }
  if (t > m.s(6)) {
    const h1 = fixCard(200, 740, 760, "async model calls: a waiting question holds no thread, so thousands can wait cheaply", P(t, m.s(7), 0.6));
    void h1;
    fixCard(1000, 740, 740, "a queue with a quota per user: people wait in line, and one heavy user can't crowd out the rest", P(t, m.s(8), 0.6));
    if (t > m.s(9)) T("quotas need sign-in first", 1000, 1010, { size: 26, w: 600, color: C.red, alpha: P(t, m.s(9), 0.6) });
  }
};

// 16 · durability
S[16] = (t, m) => {
  breakHead(t, "+", "Durability (also missing today)", C.ochre);
  if (t > m.s(2)) {
    const k = P(t, m.s(2), 0.6);
    place(0, 330, 420, 70, { on: 1, alpha: k, labelSize: 24 });
    place(1, 830, 420, 70, { on: 1, alpha: k, labelSize: 24 });
    line([[400, 420], [760, 420]], { color: C.blue, lw: 6, alpha: k });
    T("lives only in this connection", 580, 380, { size: 24, color: C.ink2, align: "center", alpha: k });
  }
  if (t > m.s(3)) {
    const c = P(t, m.s(3) + 0.6, 0.4);
    cross(580, 420, 26, c);
    T("close the page, or restart the server: the answer is gone", 300, 580, { size: 30, w: 600, color: C.red, alpha: P(t, m.s(3), 0.6) });
  }
  if (t > m.s(4)) {
    T("every query only reads, so asking again is safe…", 300, 640, { size: 30, alpha: P(t, m.s(4), 0.6) });
    T("…just paid for twice", 1000, 640, { size: 30, w: 600, color: C.ochre, alpha: P(t, m.s(5), 0.6) });
  }
  if (t > m.s(6)) {
    const k = P(t, m.s(6), 0.6), y = 740;
    const nodes = [["question + key", 200], ["job store", 560], ["worker", 900], ["event log", 1230]];
    nodes.forEach(([s, x], i) => {
      const kk = P(t, m.s(6) + i * 0.7, 0.5);
      box(x, y - 45, 290, 90, { r: 16, fill: "#FFFDF8", stroke: C.green, lw: 3, alpha: kk });
      T(s, x + 145, y + 10, { size: 28, w: 600, align: "center", alpha: kk });
      if (i) arrow([nodes[i - 1][1] + 295, y], [x - 5, y], kk, { color: C.green, lw: 3 });
    });
    T("a retry with the same key never runs twice", 200, y + 100, { size: 26, color: C.ink2, alpha: k });
    if (t > m.s(7)) {
      const k2 = P(t, m.s(7), 0.6);
      T("the same NDJSON lines the page reads today", 1230, y + 100, { size: 24, color: C.ink2, alpha: k2 });
      T("the page reconnects and carries on", 1230, y + 150, { size: 26, w: 600, color: C.green, alpha: P(t, m.s(7) + 1.3, 0.6) });
    }
  }
};

// 17 · the long conversation, and the gate
S[17] = (t, m) => {
  const split = m.s(7);
  if (t < split) {
    breakHead(t, 4, "The long conversation", C.red);
    // a stack that grows each step
    for (let step = 0; step < 5; step++) {
      const k = P(t, m.s(2) + step * 0.9, 0.5), x = 200 + step * 230, base = 900;
      const blocks = 2 + step * 2;
      for (let b = 0; b < blocks; b++) {
        const col = b === 0 ? C.ink : b === 1 ? C.ink2 : b % 2 ? C.ochre : C.teal;
        box(x, base - (b + 1) * 52, 180, 44, { r: 8, fill: col, stroke: null, alpha: k * (b === 0 ? 1 : 0.85) });
      }
      T(`step ${step + 1}`, x + 90, base + 40, { size: 24, color: C.mute, align: "center", alpha: k });
    }
    T("prompt + every query + every result, re-sent each step", 200, 330, { size: 28, color: C.ink2, alpha: P(t, m.s(3), 0.6) });
    if (t > m.s(4)) para("each step costs more than the last, and the middle is read less carefully", 1360, 500, 380, { size: 30, w: 600, color: C.red, alpha: P(t, m.s(4), 0.6) });
    if (t > m.s(5)) fixCard(1360, 700, 380, "the per-person fan out from fix 1: many small contexts", P(t, m.s(5), 0.6));
    return;
  }
  const u = t - split;
  breakHead(u, 5, "The gate before any real use", C.red);
  const k = P(t, split + 0.4, 0.6);
  ["Care company A", "Care company B"].forEach((s, i) => {
    const x = 260 + i * 720;
    box(x, 340, 600, 380, { r: 22, fill: "#FFFDF8", stroke: i ? C.teal : C.blue, lw: 3, alpha: k });
    T(s, x + 30, 395, { size: 30, w: 700, color: i ? C.teal : C.blue, alpha: k });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) box(x + 40 + c * 90, 440 + r * 80, 70, 56, { r: 8, fill: C.panel, stroke: null, alpha: k });
  });
  if (t > m.s(8)) {
    const g = P(t, m.s(8) + 0.4, 1.2, E.move);
    arrow([700, 600], [1100, 520], g, { color: C.red, lw: 5, bend: -0.2 });
    T("today: no sign-in; any record fetched by its ID", 260, 800, { size: 30, w: 600, color: C.red, alpha: P(t, m.s(8), 0.6) });
  }
  if (t > m.s(9)) {
    const kk = P(t, m.s(9), 0.6);
    line([[910, 320], [910, 740]], { color: C.green, lw: 8, alpha: kk });
    icon("lock", 910, 300, 60, C.green, kk);
    fixCard(260, 830, 1460, "sign-in, and every lookup scoped to the caller's organisation", kk);
  }
};

// 18 · outro
S[18] = (t, m) => {
  const items = [[1, "One generic tool, over a schema read from the data.", C.ochre], [2, "Hard limits that hand problems back to the model.", C.blue], [3, "And every claim, one tap from its source.", C.coral]];
  items.forEach(([si, s, col], i) => {
    const k = P(t, m.s(si), 0.7);
    line([[240, 380 + i * 140 - 40], [240, 380 + i * 140 + 10]], { color: col, lw: 8, alpha: k });
    T(s, 280, 380 + i * 140, { size: 52, w: 600, alpha: k });
  });
  if (t > m.s(3) + 1.5) {
    const k = P(t, m.s(3) + 1.5, 0.5, E.pop);
    chip(1500, 640, "visit 293", { k, size: 34 });
  }
  T("docs/journey.html  ·  docs/manager-protocol.md", 280, 900, { size: 26, color: C.mute, alpha: P(t, m.s(3) + 2, 0.6) });
};

// ---------- captions ----------
function caption(i, t) {
  const sec = SEC[i]; let k = -1;
  for (let j = 0; j < sec.starts.length; j++) if (t >= sec.starts[j] - 0.05) k = j;
  if (k < 0 || t > sec.dur - 0.5) return;
  const a = P(t, sec.starts[k] + 0.06, 0.16, E.lin);
  const prev = k > 0 ? sec.sentences[k - 1] : null, ap = 1 - P(t, sec.starts[k] - 0.06, 0.12, E.lin);
  const draw = (s, al) => {
    const ls = wrap(s, 1500, 30, 500);
    const y0 = 1036 - (ls.length - 1) * 40;
    ls.forEach((l, j) => T(l, W / 2, y0 + j * 40, { size: 30, w: 500, color: C.ink2, align: "center", alpha: al }));
  };
  X.save(); X.fillStyle = C.paper; X.globalAlpha = 0.92; X.fillRect(0, 975, W, 105); X.restore();
  if (prev && ap > 0) draw(prev, ap);
  draw(sec.sentences[k], a);
}

// chapter tag, top left
const PARTS = [[1, 6, "1 · One question, end to end"], [7, 10, "2 · Limits, and why"], [11, 11, "3 · Checked and fragile"], [12, 17, "4 · What breaks first"]];
function chapterTag(i, t) {
  const p = PARTS.find(([a, b]) => i >= a && i <= b);
  if (!p || i === 7 || i === 11 || i === 12) return;
  if (i === 1 && t < SEC[1].starts[2]) return;
  T(p[2].toUpperCase(), 60, 60, { size: 18, w: 700, color: C.mute, track: 3 });
}

// ---------- render ----------
window.renderAt = function (T0) {
  X.setTransform(1, 0, 0, 1, 0, 0);
  X.fillStyle = C.paper; X.fillRect(0, 0, W, H);
  let i = SEC.length - 1;
  for (let j = 0; j < SEC.length; j++) if (T0 < SEC[j].at + SEC[j].dur) { i = j; break; }
  const t = T0 - SEC[i].at, m = mk(i, t);
  X.save(); X.globalAlpha = m.out * P(t, 0, 0.35, E.lin);
  S[i](t, m);
  X.restore();
  drawRail(T0);
  chapterTag(i, t);
  caption(i, t);
  // progress hairline
  X.fillStyle = C.line; X.fillRect(0, H - 4, W, 4); X.fillStyle = C.ink2; X.fillRect(0, H - 4, W * (T0 / window.TL.total), 4);
};
window.__ready = document.fonts.ready.then(() => true);
const q = new URLSearchParams(location.search);
if (q.has("t")) window.renderAt(Number(q.get("t")));
else { const t0 = performance.now(); const loop = () => { window.renderAt(((performance.now() - t0) / 1000) % window.TL.total); requestAnimationFrame(loop); }; loop(); }
