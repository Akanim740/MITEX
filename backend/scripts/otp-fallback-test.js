// Simulates a live DB whose tokens.type CHECK doesn't accept 'verify_otp'
// (i.e. the 2026-09-11-otp-verification.sql migration has not run on Supabase).
// Verifies registration + resend still work (falling back to link verification)
// and never return a 500.
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const { getStore } = require("../db");

(async () => {
  const store = await getStore();
  const realTokens = store.tokens;
  store.tokens = {
    ...realTokens,
    async create({ type, ...rest }) {
      if (type === "verify_otp") {
        const err = new Error('new row for relation "tokens" violates check constraint "tokens_type_check"');
        err.code = "23514";
        throw err;
      }
      return realTokens.create({ type, ...rest });
    },
  };
  store._publicUser = store._publicUser || ((r) => r);

  const app = express();
  const { Router } = require("express");
  const auth = require("../routes/auth");
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => { req.store = store; next(); });
  app.use("/api/auth", auth);

  const server = app.listen(0, async () => {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    let pass = 0, fail = 0;
    const check = (name, cond) => { if (cond) { pass++; console.log("PASS  " + name); } else { fail++; console.log("FAIL  " + name); } };

    const email = `fallbacktest${Date.now()}@example.com`;

    // 1. Register must NOT 500 when verify_otp is rejected.
    const raw = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "FB Tester", email, password: "Passw0rd123", dob: "1997-11-03" }),
    });
    const reg = await raw.json();
    check("register returns non-500", raw.status === 201);
    check("register falls back to verifyBy=link", reg.verifyBy === "link");

    // 2. Login works (account still usable).
    const loginResp = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "Passw0rd123" }),
    });
    const login = await loginResp.json();
    check("login works after link-fallback register", loginResp.status === 200 && login.accessToken);

    // 3. resend-verification must NOT 500 either.
    const rs = await fetch(`${base}/api/auth/resend-verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.accessToken}` },
      body: JSON.stringify({}),
    });
    const rsj = await rs.json();
    check("resend-verification falls back to link", rs.status === 200 && rsj.verifyBy === "link");

    server.close(() => {
      console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    });
  });
})().catch((err) => { console.error(err); process.exit(2); });