// node render.mjs sheet out.png t1,t2,...   |   node render.mjs video out.mp4 [workers] [fps]
import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
const HERE = new URL(".", import.meta.url).pathname;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [mode, out, a3, a4] = process.argv.slice(2);
const url = pathToFileURL(HERE + "film.html").href + "?t=0";
const b = await chromium.launch({ executablePath: CHROME, args: ["--force-color-profile=srgb"] });
async function page() {
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto(url); await p.evaluate(() => window.__ready);
  return p;
}
const grab = (p, t) => p.evaluate((t) => { window.renderAt(t); return document.getElementById("c").toDataURL("image/png").split(",")[1]; }, t);
if (mode === "sheet") {
  const p = await page(); const ts = a3.split(",").map(Number); mkdirSync(HERE + "qa", { recursive: true });
  const files = [];
  for (const t of ts) { const f = HERE + `qa/s_${t}.png`; writeFileSync(f, Buffer.from(await grab(p, t), "base64")); files.push(f); }
  const cols = 3, rows = Math.ceil(files.length / cols);
  const args = []; files.forEach((f) => args.push("-i", f));
  const lay = files.map((_, i) => `${(i % cols) * 640}_${Math.floor(i / cols) * 360}`).join("|");
  const fc = files.map((_, i) => `[${i}]scale=640:360[v${i}]`).join(";") + ";" + files.map((_, i) => `[v${i}]`).join("") + `xstack=inputs=${files.length}:layout=${lay}:fill=black`;
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args, "-filter_complex", fc, out]);
} else {
  const total = await (await page()).evaluate(() => window.TL.total);
  const workers = Number(a3 || 6), fps = Number(a4 || 30), N = Math.ceil(total * fps), per = Math.ceil(N / workers);
  mkdirSync(HERE + "seg", { recursive: true });
  const started = Date.now();
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const p = await page(); const a = w * per, z = Math.min(N, a + per);
    const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "medium", HERE + `seg/${w}.mp4`]);
    for (let i = a; i < z; i++) {
      const buf = Buffer.from(await grab(p, i / fps), "base64");
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if (w === 0 && (i - a) % 300 === 0) console.log(`w0 ${i - a}/${z - a}  ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end(); await new Promise((r) => ff.on("close", r));
  }));
  writeFileSync(HERE + "seg/list.txt", Array.from({ length: workers }, (_, w) => `file '${w}.mp4'`).join("\n"));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", HERE + "seg/list.txt", "-c", "copy", HERE + "silent.mp4"]);
  console.log("frames", N, "in", ((Date.now() - started) / 1000).toFixed(0), "s");
}
await b.close();
