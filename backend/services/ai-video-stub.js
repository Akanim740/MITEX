// Zero-cost video script stub. Used when ANTHROPIC_API_KEY is absent or
// AI_STUB=true, so the whole video flow can be exercised without spending
// credits -- same idea as ai-builder-stub.js.
//
// The one rule here: never invent facts. The stub has no information about
// the subject beyond the prompt, so every scene is either built from the
// user's own words or is neutral framing copy. It must not produce
// statistics, testimonials, customer names or performance claims it cannot
// know, because this output gets published.

const PALETTES = [
  { bg: "#0f172a", fg: "#f0f2f5", accent: "#4f46e5" },
  { bg: "#101828", fg: "#f2f4f7", accent: "#12b76a" },
  { bg: "#1a1040", fg: "#ffffff", accent: "#22d3ee" },
  { bg: "#1c1917", fg: "#f5f5f4", accent: "#f97316" },
  { bg: "#082f49", fg: "#f0f9ff", accent: "#38bdf8" },
  { bg: "#3b0764", fg: "#faf5ff", accent: "#e879f9" },
];

const NEUTRAL_CLOSERS = [
  "Edit the scenes, then render again",
  "Adjust the wording to match your brand",
  "Swap in your own headline and colours",
];

function cleanText(value) {
  return String(value || "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Split the brief on sentence boundaries so scenes follow the user's own
// phrasing rather than a template.
function sentencesFrom(brief) {
  const text = cleanText(brief);
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+|\s*[-–—]\s*|\s*;\s*|\s*\|\s*/)
    .map((s) => s.replace(/^[.!?)\s]+|[.!?(\s]+$/g, ""))
    .filter((s) => s.length > 1);
}

function clip(text, max) {
  const t = cleanText(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const boundary = cut.lastIndexOf(" ");
  return (boundary > max * 0.5 ? cut.slice(0, boundary) : cut).trim();
}

function buildScenes(brief) {
  const parts = sentencesFrom(brief);
  const scenes = [];

  if (parts.length === 0) {
    scenes.push({
      text: "Your story, in motion",
      subtext: "Describe your topic to fill these scenes",
      durationMs: 3000,
    });
  } else {
    scenes.push({
      text: clip(parts[0], 60),
      subtext: parts[1] ? clip(parts[1], 90) : "",
      durationMs: 3200,
    });
    for (let i = 1; i < parts.length && scenes.length < 6; i++) {
      scenes.push({
        text: clip(parts[i], 60),
        subtext: "",
        durationMs: 2800,
      });
    }
  }

  if (scenes.length < 3) {
    scenes.push({
      text: "Built with MITEX",
      subtext: "",
      durationMs: 2600,
    });
  }

  scenes.push({
    text: NEUTRAL_CLOSERS[scenes.length % NEUTRAL_CLOSERS.length],
    subtext: "",
    durationMs: 3000,
  });

  return scenes;
}

async function generateVideoScriptStub({ prompt = "", aspect = "landscape", durationSec = 12 } = {}) {
  const scenes = buildScenes(prompt);
  const total = scenes.reduce((sum, s) => sum + s.durationMs, 0);

  // Stretch or trim toward the requested runtime so the result matches what
  // the caller asked for instead of whatever the sentence count happened to be.
  const targetMs = Math.max(4000, Math.round((Number(durationSec) || 12) * 1000));
  const scale = targetMs / total;
  scenes.forEach((s) => {
    s.durationMs = Math.round((s.durationMs * scale) / 100) * 100;
    if (s.durationMs < 1500) s.durationMs = 1500;
  });

  scenes.forEach((s, i) => {
    const p = PALETTES[i % PALETTES.length];
    s.bg = p.bg;
    s.fg = p.fg;
    s.accent = p.accent;
  });

  const title = cleanText(prompt).split(" ").slice(0, 6).join(" ");

  return {
    ok: true,
    script: {
      title: clip(title || "MITEX video", 60),
      aspect,
      scenes,
    },
    errors: [],
    warnings: ["Generated in stub mode -- review the copy before publishing."],
    usage: { inputTokens: 0, outputTokens: 0 },
    model: "stub/mitex-video",
  };
}

module.exports = { generateVideoScriptStub, PALETTES };
