// Dependency-free animated GIF89a encoder.
//
// MITEX has no build step and no image dependencies, so encoding a GIF means
// writing the container by hand: quantise the frames down to a 256-colour
// palette (median cut) and LZW-compress the index stream. Both are small,
// self-contained algorithms and both are the kind of thing that silently
// produces a file which "looks fine in some viewers" when it is subtly wrong,
// so this module keeps its assumptions explicit and is covered by an
// independent reader in scripts/gif-check.js.
//
// Input is raw 24-bit RGB (width * height * 3 per frame) -- the output of a
// rasteriser -- so this stays independent of however the frames were drawn.

class Bytes {
  constructor(initial = 4096) {
    this.buf = Buffer.allocUnsafe(initial);
    this.len = 0;
  }

  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const next = Buffer.allocUnsafe(cap);
    this.buf.copy(next, 0, 0, this.len);
    this.buf = next;
  }

  u8(v) {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }

  u16(v) {
    this.ensure(2);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
  }

  raw(src) {
    this.ensure(src.length);
    src.copy ? src.copy(this.buf, this.len) : Buffer.from(src).copy(this.buf, this.len);
    this.len += src.length;
  }

  ascii(str) {
    this.ensure(str.length);
    for (let i = 0; i < str.length; i++) this.buf[this.len++] = str.charCodeAt(i) & 0xff;
  }

  take() {
    return this.buf.subarray(0, this.len);
  }
}

// --- palette: median cut ---------------------------------------------------
//
// Median cut splits the colour space until every box is small enough to be
// represented by its average colour. Weighting the split choice by pixel
// count as well as channel range stops a large flat gradient from starving a
// small but prominent accent colour of palette entries.

// Per-channel ranges have to be tracked independently. Taking min/max of the
// packed integers and subtracting those would give the range of whichever
// channel happens to dominate the packed order, which is always red.
function boxStats(samples, start, end) {
  let rMin = 255;
  let rMax = 0;
  let gMin = 255;
  let gMax = 0;
  let bMin = 255;
  let bMax = 0;
  for (let i = start; i < end; i++) {
    const v = samples[i];
    const r = (v >>> 16) & 0xff;
    const g = (v >>> 8) & 0xff;
    const b = v & 0xff;
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (g < gMin) gMin = g;
    if (g > gMax) gMax = g;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }
  const rr = rMax - rMin;
  const gr = gMax - gMin;
  const br = bMax - bMin;
  const range = Math.max(rr, gr, br);
  // 16 = red, 8 = green, 0 = blue
  const shift = rr >= gr && rr >= br ? 16 : gr >= br ? 8 : 0;
  return { start, end, count: end - start, range, shift };
}

function averageColor(samples, start, end) {
  let r = 0;
  let g = 0;
  let b = 0;
  const n = end - start;
  for (let i = start; i < end; i++) {
    const v = samples[i];
    r += (v >>> 16) & 0xff;
    g += (v >>> 8) & 0xff;
    b += v & 0xff;
  }
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
}

function medianCut(samples, maxColors) {
  const boxes = [boxStats(samples, 0, samples.length)];
  while (boxes.length < maxColors) {
    let pick = -1;
    let best = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.count < 2 || b.range === 0) continue;
      // range weighted by log(count): prefers both diverse and well-populated boxes
      const score = b.range * Math.log2(b.count + 1);
      if (score > best) {
        best = score;
        pick = i;
      }
    }
    if (pick < 0) break;

    const box = boxes.splice(pick, 1)[0];
    const slice = samples.slice(box.start, box.end);
    slice.sort((a, b) => ((a >>> box.shift) & 0xff) - ((b >>> box.shift) & 0xff));
    for (let i = 0; i < slice.length; i++) samples[box.start + i] = slice[i];

    const mid = box.start + (box.count >> 1);
    boxes.push(boxStats(samples, box.start, mid));
    boxes.push(boxStats(samples, mid, box.end));
  }
  return boxes.map((b) => averageColor(samples, b.start, b.end));
}

function collectSamples(frames, frameBytes, budget) {
  const total = frames.length * (frameBytes / 3);
  const stride = Math.max(1, Math.floor(total / budget));
  const packed = [];
  let index = 0;
  for (const frame of frames) {
    for (let i = 0; i < frameBytes; i += 3) {
      if (index++ % stride === 0) {
        packed.push((frame[i] << 16) | (frame[i + 1] << 8) | frame[i + 2]);
      }
      if (packed.length >= budget) return packed;
    }
  }
  return packed;
}

// --- index mapping ---------------------------------------------------------
//
// Palette lookup per pixel. A colour map keeps this exact rather than bucketed,
// and rendered frames repeat colours heavily, so the hit rate is high; the cap
// stops a photographic frame from growing the map without bound.

function buildMapper(palette, maxCache = 300000) {
  const cache = new Map();
  return function map(r, g, b) {
    const key = (r << 16) | (g << 8) | b;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const v = palette[i];
      const dr = r - (v >>> 16);
      const dg = g - ((v >>> 8) & 0xff);
      const db = b - (v & 0xff);
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) {
        bestDist = d;
        best = i;
        if (d === 0) break;
      }
    }
    if (cache.size < maxCache) cache.set(key, best);
    return best;
  };
}

// --- LZW -------------------------------------------------------------------
//
// Variable-width codes written least-significant-bit first. Two details are
// easy to get wrong and are asserted here rather than assumed:
//
//  * the code width must grow the moment `next` would no longer fit, i.e. when
//    next > (1 << codeSize) -- not when it equals it;
//  * at 4096 entries (12 bits, the format maximum) a clear code is emitted and
//    the table restarts instead of growing further.

function lzwEncode(indices, minCodeSize) {
  const out = new Bytes(1024);
  let bitBuf = 0;
  let bitLen = 0;

  function emit(code, size) {
    bitBuf |= code << bitLen;
    bitLen += size;
    while (bitLen >= 8) {
      out.u8(bitBuf & 0xff);
      bitBuf >>>= 8;
      bitLen -= 8;
    }
  }

  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let next = eoiCode + 1;
  let dict = new Map();

  emit(clearCode, codeSize);

  if (indices.length === 0) {
    emit(eoiCode, codeSize);
    if (bitLen > 0) out.u8(bitBuf & 0xff);
    return out.take();
  }

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 65536 + k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }

    emit(prefix, codeSize);
    dict.set(key, next);
    next++;

    if (next >= 4096) {
      emit(clearCode, codeSize);
      dict = new Map();
      next = eoiCode + 1;
      codeSize = minCodeSize + 1;
    } else if (next > 1 << codeSize) {
      codeSize++;
    }

    prefix = k;
  }

  emit(prefix, codeSize);
  emit(eoiCode, codeSize);
  if (bitLen > 0) out.u8(bitBuf & 0xff);
  return out.take();
}

function writeSubBlocks(w, data) {
  let i = 0;
  while (i < data.length) {
    const n = Math.min(255, data.length - i);
    w.u8(n);
    w.raw(data.subarray(i, i + n));
    i += n;
  }
  w.u8(0);
}

// --- public API ------------------------------------------------------------

const MIN_DELAY_CS = 2; // viewers clamp 0-1 to 10cs, which looks like a freeze

/**
 * Encode raw RGB frames as an animated GIF.
 *
 * @param {object} opts
 * @param {number} opts.width
 * @param {number} opts.height
 * @param {Buffer[]|Uint8Array[]} opts.frames each width*height*3 bytes, RGB
 * @param {number[]} [opts.delays] per-frame delay in centiseconds
 * @param {number} [opts.delayCs] delay used when `delays` is omitted
 * @param {number} [opts.loop] 0 = loop forever, n = stop after n repeats
 * @param {number} [opts.maxColors] palette size, 2..256
 * @returns {Buffer}
 */
function encodeGif({
  width,
  height,
  frames,
  delays,
  delayCs = 100,
  loop = 0,
  maxColors = 256,
}) {
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (!(w > 0) || !(h > 0)) throw new Error("GIF width and height must be positive");
  if (!Array.isArray(frames) || frames.length === 0) throw new Error("GIF needs at least one frame");

  const frameBytes = w * h * 3;
  for (const [i, f] of frames.entries()) {
    if (!f || f.length !== frameBytes) {
      throw new Error(`GIF frame ${i} is ${f ? f.length : 0} bytes, expected ${frameBytes}`);
    }
  }

  const colorCount = Math.min(256, Math.max(2, Math.floor(maxColors) || 256));
  const samples = collectSamples(frames, frameBytes, 60000);
  let palette = medianCut(samples, colorCount);

  // The GIF header stores the table size as log2(n)-1, so the table has to be
  // a power of two and the LZW minimum code size is its log2. A one-colour
  // palette would produce a minimum code size of 1, which the format forbids.
  let size = 4;
  while (size < palette.length) size *= 2;
  if (size < 4) size = 4;
  while (palette.length < size) palette.push(palette[palette.length - 1] || 0);
  const sizeCode = Math.log2(size) - 1;
  const minCodeSize = sizeCode + 1;

  const toIndex = buildMapper(palette);
  const indexFrames = frames.map((frame) => {
    const idx = Buffer.allocUnsafe(frameBytes);
    for (let i = 0, p = 0; i < frameBytes; i += 3, p++) {
      idx[p] = toIndex(frame[i], frame[i + 1], frame[i + 2]);
    }
    return idx;
  });

  const frameDelays = indexFrames.map((_, i) => {
    const raw = delays && delays[i] != null ? delays[i] : delayCs;
    const cs = Math.round(Number(raw) || 0);
    return Math.max(MIN_DELAY_CS, Math.min(65535, cs));
  });

  const w2 = new Bytes(1 << 16);
  w2.ascii("GIF89a");
  w2.u16(w);
  w2.u16(h);
  w2.u8(0xf0 | sizeCode); // global colour table present, 8-bit colour resolution
  w2.u8(0); // background colour index
  w2.u8(0); // pixel aspect ratio: unspecified

  for (const color of palette) {
    w2.u8((color >>> 16) & 0xff);
    w2.u8((color >>> 8) & 0xff);
    w2.u8(color & 0xff);
  }

  if (indexFrames.length > 1) {
    // NETSCAPE2.0 looping extension -- without it the GIF plays once and stops.
    w2.u8(0x21);
    w2.u8(0xff);
    w2.u8(0x0b);
    w2.ascii("NETSCAPE2.0");
    w2.u8(0x03);
    w2.u8(0x01);
    w2.u16(Math.max(0, Math.min(65535, Math.floor(loop))));
    w2.u8(0x00);
  }

  for (let f = 0; f < indexFrames.length; f++) {
    // Graphic control extension: disposal 1 (leave the frame in place), no
    // transparency, per-frame delay.
    w2.u8(0x21);
    w2.u8(0xf9);
    w2.u8(0x04);
    w2.u8(0x04);
    w2.u16(frameDelays[f]);
    w2.u8(0);
    w2.u8(0x00);

    // Image descriptor: whole canvas, no local table, not interlaced.
    w2.u8(0x2c);
    w2.u16(0);
    w2.u16(0);
    w2.u16(w);
    w2.u16(h);
    w2.u8(0x00);

    w2.u8(minCodeSize);
    writeSubBlocks(w2, lzwEncode(indexFrames[f], minCodeSize));
  }

  w2.u8(0x3b); // trailer
  return Buffer.from(w2.take());
}

module.exports = { encodeGif, medianCut, lzwEncode };
