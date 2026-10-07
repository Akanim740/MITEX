// End-to-end check for the AI video generator.
//
// Exercises the whole pipeline in stub mode (no credits, no network), then
// decodes the result with Windows' GDI+ decoder to prove the GIF is real:
// correct geometry, correct frame count, the expected background colour, and
// enough contrasting pixels in the text band to show glyphs were drawn.
//
// Run: node scripts/video-check.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const {
  generateVideo,
  generateVideoScript,
  validateScript,
  ASPECTS,
  LIMITS,
} = require("../services/ai-video-generator");

let failures = 0;

function check(label, condition, detail) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

const DECODE_SCRIPT = `
param([string]$Path, [int]$X, [int]$Y, [int]$Band)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($Path)
$w = $img.Width
$h = $img.Height
$dim = New-Object System.Drawing.Imaging.FrameDimension($img.FrameDimensionsList[0])
$count = $img.GetFrameCount($dim)
$frames = @()
for ($i = 0; $i -lt $count; $i++) {
  [void]$img.SelectActiveFrame($dim, $i)
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.DrawImage($img, 0, 0, $w, $h)
  $g.Dispose()
  $corner = $bmp.GetPixel($X, $Y)
  # Walk the vertical middle counting pixels that do not match the corner.
  $mid = [int]($h / 2)
  $diff = 0
  $band = [int]($Band / 2)
  for ($yy = $mid - $band; $yy -lt ($mid + $band); $yy++) {
    for ($xx = 0; $xx -lt $w; $xx += 2) {
      $p = $bmp.GetPixel($xx, [Math]::Max(0, [Math]::Min($h - 1, $yy)))
      $dr = [Math]::Abs($p.R - $corner.R)
      $dg = [Math]::Abs($p.G - $corner.G)
      $db = [Math]::Abs($p.B - $corner.B)
      if (($dr + $dg + $db) -gt 60) { $diff++ }
    }
  }
  $frames += ('{' + '"corner":[' + $corner.R + ',' + $corner.G + ',' + $corner.B + '],"contrast":' + $diff + '}')
  $bmp.Dispose()
}
$img.Dispose()
Write-Output ('{"width":' + $w + ',"height":' + $h + ',"frames":' + $count + ',"detail":[' + ($frames -join ',') + ']}')
`;

function decodeGif(file, x, y, band) {
  const dir = path.join(os.tmpdir(), "mitex-video-check");
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, "decode.ps1");
  fs.writeFileSync(script, DECODE_SCRIPT, "utf8");
  const out = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
     "-Path", file, "-X", String(x), "-Y", String(y), "-Band", String(band)],
    { encoding: "utf8", timeout: 120000 }
  ).trim();
  return JSON.parse(out.split(/\r?\n/).filter(Boolean).pop());
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

async function main() {
  process.env.AI_STUB = "true";
  const dir = path.join(os.tmpdir(), "mitex-video-check");
  fs.mkdirSync(dir, { recursive: true });

  console.log("video-check: stub pipeline");
  const brief = "Launch our new portfolio site. Built with MITEX. Clean, fast, and ready to edit.";
  const res = await generateVideo({
    prompt: brief,
    aspect: "landscape",
    durationSec: 10,
    fadeFrames: 4,
  });

  check("returns ok", res.ok === true);
  check("stub model reported", res.model === "stub/mitex-video", `got ${res.model}`);
  check("fallback flag set", res._fallback === null || typeof res._fallback === "object");
  check("produced bytes", res.bytes > 1000, `got ${res.bytes}`);
  check("dimensions", res.width === 640 && res.height === 360, `${res.width}x${res.height}`);

  const scenes = res.script.scenes;
  check("scene count within limits", scenes.length >= LIMITS.minScenes && scenes.length <= LIMITS.maxScenes, `${scenes.length}`);
  check("text length limit", scenes.every((s) => s.text.length <= LIMITS.maxText), JSON.stringify(scenes.map((s) => s.text.length)));
  check("subtext length limit", scenes.every((s) => s.subtext.length <= LIMITS.maxSubtext));
  check("durations clamped", scenes.every((s) => s.durationMs >= LIMITS.minDurationMs && s.durationMs <= LIMITS.maxDurationMs));
  check("colours are hex", scenes.every((s) => /^#[0-9a-f]{6}$/.test(s.bg) && /^#[0-9a-f]{6}$/.test(s.fg)));

  const totalMs = scenes.reduce((n, s) => n + s.durationMs, 0);
  check("runtime stays under cap", totalMs <= LIMITS.maxTotalMs, `${totalMs}ms`);

  console.log("video-check: GIF decodes with correct geometry and content");
  const file = path.join(dir, "out.gif");
  fs.writeFileSync(file, res.gif);
  const dec = decodeGif(file, 8, 8, 60);

  const dims = ASPECTS[res.script.aspect];
  check("decoded width", dec.width === dims.width, `got ${dec.width}`);
  check("decoded height", dec.height === dims.height, `got ${dec.height}`);
  // scenes + crossfades
  const expectedMin = scenes.length;
  check("at least one frame per scene", dec.frames >= expectedMin, `${dec.frames} frames for ${expectedMin} scenes`);

  const first = dec.detail[0];
  const want = hexToRgb(scenes[0].bg);
  const cornerDelta = first.corner.reduce((n, v, i) => n + Math.abs(v - want[i]), 0);
  check("frame 0 background matches script", cornerDelta <= 45, `want ${want} got ${first.corner} delta ${cornerDelta}`);
  check("frame 0 has contrasting text pixels", first.contrast > 40, `only ${first.contrast}`);

  const lastIdx = dec.detail.length - 1;
  const lastWant = hexToRgb(scenes[scenes.length - 1].bg);
  const lastDelta = dec.detail[lastIdx].corner.reduce((n, v, i) => n + Math.abs(v - lastWant[i]), 0);
  check("last frame background matches last scene", lastDelta <= 45, `want ${lastWant} got ${dec.detail[lastIdx].corner}`);

  console.log("video-check: aspect ratios");
  for (const aspect of ["square", "portrait"]) {
    const r = await generateVideo({ prompt: "Square and portrait test", aspect, durationSec: 6, fadeFrames: 0 });
    const d = ASPECTS[aspect];
    check(`${aspect} dimensions`, r.width === d.width && r.height === d.height, `${r.width}x${r.height}`);
    check(`${aspect} produces bytes`, r.bytes > 500, `${r.bytes}`);
  }

  console.log("video-check: validation rejects bad input");
  const rejected = [
    ["no scenes", { scenes: [] }],
    ["scene without text", { scenes: [{ text: "" }, { text: "ok" }] }],
    ["non-object", null],
  ];
  for (const [label, input] of rejected) {
    const out = validateScript(input, { aspect: "landscape" });
    check(`${label} rejected`, out.ok === false, JSON.stringify(out.errors));
  }

  const clamped = [
    ["too many scenes", { scenes: Array.from({ length: 40 }, (_, i) => ({ text: "s" + i })) }],
    ["oversized text", { scenes: [{ text: "x".repeat(500) }, { text: "ok" }] }],
  ];
  for (const [label, input] of clamped) {
    const out = validateScript(input, { aspect: "landscape" });
    check(
      `${label} clamped`,
      out.ok === true && out.script.scenes.length <= LIMITS.maxScenes &&
        out.script.scenes.every((s) => s.text.length <= LIMITS.maxText)
    );
  }

  // A colour field is not a code path, so a hostile value should be dropped
  // and reported rather than fail the whole render.
  const poisoned = validateScript(
    { scenes: [{ text: "ok", bg: "javascript:alert(1)" }, { text: "fine", fg: "<script>x</script>" }] },
    { aspect: "landscape" }
  );
  check("hostile colour accepted but sanitised", poisoned.ok === true);
  check("hostile colour reported as warning", poisoned.warnings.length > 0, JSON.stringify(poisoned.warnings));
  check("poisoned bg never reaches the script", poisoned.script.scenes[0].bg !== "javascript:alert(1)", poisoned.script.scenes[0].bg);
  check("colour falls back when invalid", /^#[0-9a-f]{6}$/.test(poisoned.script.scenes[0].bg), poisoned.script.scenes[0].bg);
  check("non-hex fg falls back to hex", /^#[0-9a-f]{6}$/.test(poisoned.script.scenes[1].fg), poisoned.script.scenes[1].fg);
  check("aspect falls back when unknown", validateScript({ scenes: [{ text: "a" }, { text: "b" }] }, { aspect: "nope" }).script.aspect === "landscape");

  console.log("video-check: script generation without rendering");
  const gen = await generateVideoScript({ prompt: "Hello world", aspect: "landscape", durationSec: 8 });
  check("returns a script", gen.ok === true && gen.script.scenes.length >= LIMITS.minScenes);

  if (failures) {
    console.error(`\nvideo-check: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nvideo-check: all passed");
}

main().catch((e) => {
  console.error("video-check crashed:", e);
  process.exit(1);
});
