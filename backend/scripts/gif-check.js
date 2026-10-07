// Independent check for utils/gif.js.
//
// The encoder is hand-written, so the only meaningful test is an end-to-end
// round trip through a decoder that was not written alongside it. Windows'
// GDI+ GIF decoder is available without any dependency, so this script writes
// a GIF, asks PowerShell to decode it, and compares the reported geometry and
// sampled pixels against what was encoded.
//
// Run: node scripts/gif-check.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { encodeGif } = require("../utils/gif");

const POWERSHELL = "powershell.exe";

// GDI+ reports what it decoded. Frames are sampled at (x,y) after selecting
// each active frame, which catches a decoder silently reusing frame 0.
const DECODE_SCRIPT = `
param([string]$Path, [int]$X, [int]$Y)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($Path)
$w = $img.Width
$h = $img.Height
$fmt = $img.PixelFormat.ToString()
$dim = New-Object System.Drawing.Imaging.FrameDimension($img.FrameDimensionsList[0])
$count = $img.GetFrameCount($dim)
$colors = @()
for ($i = 0; $i -lt $count; $i++) {
  [void]$img.SelectActiveFrame($dim, $i)
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.DrawImage($img, 0, 0, $w, $h)
  $g.Dispose()
  $p = $bmp.GetPixel($X, $Y)
  $colors += ($p.R.ToString() + ',' + $p.G.ToString() + ',' + $p.B.ToString())
  $bmp.Dispose()
}
$img.Dispose()
Write-Output ('{"width":' + $w + ',"height":' + $h + ',"frames":' + $count + ',"pixelFormat":"' + $fmt + '","samples":[' + ($colors -join ',') + ']}')
`;

// PowerShell joins the per-frame colours without quoting them, so the JSON
// arrives as a flat [r,g,b,r,g,b,...] array. Rebuild triples before use.
function triples(flat) {
  const out = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

function decodeGif(file, x, y) {
  const dir = path.join(os.tmpdir(), "mitex-gif-check");
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, "decode.ps1");
  fs.writeFileSync(script, DECODE_SCRIPT, "utf8");
  const out = execFileSync(
    POWERSHELL,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Path", file, "-X", String(x), "-Y", String(y)],
    { encoding: "utf8", timeout: 60000 }
  ).trim();
  return JSON.parse(out.split(/\r?\n/).filter(Boolean).pop());
}

function solidFrame(w, h, r, g, b) {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < buf.length; i += 3) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
  }
  return buf;
}

function gradientFrame(w, h) {
  const buf = Buffer.alloc(w * h * 3);
  let p = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      buf[p++] = Math.round((x / (w - 1)) * 255);
      buf[p++] = Math.round((y / (h - 1)) * 255);
      buf[p++] = 128;
    }
  }
  return buf;
}

function run() {
  const dir = path.join(os.tmpdir(), "mitex-gif-check");
  fs.mkdirSync(dir, { recursive: true });

  console.log("gif-check: solid colour frames");
  {
    const w = 32;
    const h = 32;
    const frames = [
      solidFrame(w, h, 255, 0, 0),
      solidFrame(w, h, 0, 255, 0),
      solidFrame(w, h, 0, 0, 255),
      solidFrame(w, h, 255, 255, 255),
    ];
    const gif = encodeGif({ width: w, height: h, frames, delayCs: 50, loop: 0 });
    const file = path.join(dir, "solid.gif");
    fs.writeFileSync(file, gif);

    check("starts with GIF89a", gif.subarray(0, 6).toString("ascii") === "GIF89a");
    check("ends with trailer", gif[gif.length - 1] === 0x3b);

    const dec = decodeGif(file, 16, 16);
    check("width", dec.width === w, `got ${dec.width}`);
    check("height", dec.height === h, `got ${dec.height}`);
    check("frame count", dec.frames === 4, `got ${dec.frames}`);

    const expect = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];
    const got = triples(dec.samples);
    expect.forEach((c, i) => {
      const close = c.every((v, j) => Math.abs(got[i][j] - v) <= 8);
      check(`frame ${i} colour`, close, `want ${c} got ${got[i]}`);
    });
  }

  console.log("gif-check: gradient quantisation");
  {
    const w = 48;
    const h = 48;
    const frames = [gradientFrame(w, h)];
    const gif = encodeGif({ width: w, height: h, frames, maxColors: 64 });
    const file = path.join(dir, "gradient.gif");
    fs.writeFileSync(file, gif);

    const dec = decodeGif(file, 24, 24);
    check("single frame", dec.frames === 1, `got ${dec.frames}`);
    // centre of the gradient: r=128, g=128, b=128
    const got = triples(dec.samples)[0];
    const close = [128, 128, 128].every((v, j) => Math.abs(got[j] - v) <= 16);
    check("centre pixel close to source", close, `want ~128,128,128 got ${got}`);

    // A tiny palette must still produce a decodable file.
    const small = encodeGif({ width: w, height: h, frames, maxColors: 4 });
    fs.writeFileSync(path.join(dir, "small.gif"), small);
    const dec2 = decodeGif(path.join(dir, "small.gif"), 10, 10);
    check("4-colour palette decodes", dec2.frames === 1 && dec2.width === w);
  }

  console.log("gif-check: many colours force code-width growth");
  {
    // 4096+ distinct colours guarantees the LZW table fills and resets,
    // which is where an off-by-one in codeSize growth shows up.
    const w = 128;
    const h = 128;
    const buf = Buffer.alloc(w * h * 3);
    let p = 0;
    for (let i = 0; i < w * h; i++) {
      buf[p++] = (i * 3) & 0xff;
      buf[p++] = (i * 7) & 0xff;
      buf[p++] = (i * 13) & 0xff;
    }
    const gif = encodeGif({ width: w, height: h, frames: [buf] });
    const file = path.join(dir, "noisy.gif");
    fs.writeFileSync(file, gif);
    const dec = decodeGif(file, 64, 64);
    check("noisy frame decodes", dec.width === w && dec.height === h);
    check("noisy frame has content", triples(dec.samples).length > 0);
  }

  console.log("gif-check: bad input rejected");
  {
    let threw = 0;
    try {
      encodeGif({ width: 0, height: 10, frames: [Buffer.alloc(30)] });
    } catch {
      threw++;
    }
    try {
      encodeGif({ width: 10, height: 10, frames: [Buffer.alloc(10)] });
    } catch {
      threw++;
    }
    try {
      encodeGif({ width: 10, height: 10, frames: [] });
    } catch {
      threw++;
    }
    check("rejects bad dimensions/frame sizes/empty", threw === 3, `only ${threw} threw`);
  }

  if (failures) {
    console.error(`\ngif-check: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\ngif-check: all passed");
}

run();
