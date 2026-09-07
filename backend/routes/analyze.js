const express = require("express");
const router = express.Router();

const {
  fetchPage,
  analyzeHtml,
  websiteHealth,
  seoAudit,
  performanceAudit,
  analyze,
  generateDescription,
} = require("../utils/site-audit");

// Strip listing fields off so nothing sensitive leaks in tool output.
function excerpt(text, n = 400) {
  return String(text || "").trim().slice(0, n);
}

// Shared runner: fetch (optional), extract signals, then gate on what's present.
async function auditFrom(body) {
  const { url, title, level, tech_stack, assetType, description } = body || {};
  let liveRes = null;
  let meta = null;
  let fetchMeta = {};

  if (url) {
    liveRes = await fetchPage(url);
    if (liveRes.ok && liveRes.html) {
      try {
        meta = analyzeHtml(liveRes.html, liveRes.headers);
        fetchMeta = { status: liveRes.status, timeMs: liveRes.timeMs, bytes: liveRes.bytes, truncated: liveRes.truncated || false };
      } catch (err) {
        fetchMeta = { error: err.message };
      }
    } else {
      fetchMeta = { error: liveRes.error || "Could not fetch the page", status: liveRes.status || 0 };
    }
  }

  return { url, title, level, tech_stack, assetType, description, liveRes, meta, fetchMeta };
}

// POST /api/analyze - full AI Website Analyzer; works live (url) or from fields.
router.post("/", async (req, res) => {
  try {
    const a = await auditFrom(req.body);
    const result = analyze({
      url: a.url || null,
      title: excerpt(a.title),
      level: a.level,
      tech_stack: excerpt(a.tech_stack, 300),
      assetType: a.assetType,
      description: excerpt(a.description, 300),
      _internal: {
        live: a.liveRes && a.liveRes.ok ? { meta: a.meta, fetchMeta: a.fetchMeta } : null,
        meta: a.meta,
      },
    });
    if (a.liveRes && !a.liveRes.ok) result.fetchIssue = a.fetchMeta.error || "Unreachable";
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/analyze/health - Website Health Score (0-100 + checklist)
router.post("/health", async (req, res) => {
  try {
    const a = await auditFrom(req.body);
    if (a.meta) {
      res.json({ url: a.url || null, ...websiteHealth(a.meta, a.fetchMeta), note: null });
    } else {
      res.json({ url: a.url || null, score: 0, max: 100, checks: [], note: a.fetchMeta.error || "Nothing to analyze; provide a url or page fields" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/analyze/seo - SEO checker
router.post("/seo", async (req, res) => {
  try {
    const a = await auditFrom(req.body);
    if (a.meta) {
      res.json({ url: a.url || null, ...seoAudit(a.meta) });
    } else {
      res.json({ url: a.url || null, score: 0, max: 100, checks: [], note: a.fetchMeta.error || "Nothing to analyze" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/analyze/performance - Performance checker
router.post("/performance", async (req, res) => {
  try {
    const a = await auditFrom(req.body);
    if (a.meta) {
      res.json({ url: a.url || null, ...performanceAudit(a.meta, a.fetchMeta) });
    } else {
      res.json({ url: a.url || null, score: 35, max: 100, checks: [{ status: "warn", label: "No live page measured", detail: a.fetchMeta.error || "Provide a url to benchmark" }], note: null });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/analyze/describe - AI listing-description generator
router.post("/describe", async (req, res) => {
  try {
    const { title, tech_stack, level, assetType, description, url } = req.body || {};
    let meta = null;
    if (url) {
      const liveRes = await fetchPage(url);
      if (liveRes.ok && liveRes.html) {
        try {
          meta = analyzeHtml(liveRes.html, liveRes.headers);
        } catch {}
      }
    }
    const gen = generateDescription({
      title: excerpt(title),
      tech_stack: excerpt(tech_stack, 300),
      level,
      assetType,
      description: excerpt(description, 300),
      meta,
    });
    res.json(gen);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;