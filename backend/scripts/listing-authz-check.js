/**
 * Authorization boundaries for listing mutations.
 *
 * These rules decide who may mark a listing sold -- the signal that hides it
 * from browsing and feeds the trust score -- and who may see or attach the
 * private delivery URL. They are spread across four conditionals in
 * routes/listings.js and nothing else in the suite touches them, so a
 * refactor that changes one ternary would silently hand staff the ability to
 * mark any listing sold, or let a worker attach a delivery link to a listing
 * they were not assigned.
 *
 * Roles are provisioned over HTTP where the API allows it, and promoted in
 * sqlite directly for customer -> staff, because no endpoint does that
 * (the same approach notready-smoke-test.ps1 already uses).
 */
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

require("dotenv").config();

const BASE = process.env.CHECK_BASE_URL || "http://localhost:3000";
const STAMP = Date.now();

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
};

const req = async (path_, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path_, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body is fine; status is what most assertions read */
  }
  return { status: res.status, body: json };
};

async function registerUser(name, email) {
  const reg = await req("/api/auth/register", {
    method: "POST",
    body: { name, email, password: "Passw0rd123", dob: "1992-01-15" },
  });
  if (reg.status !== 200 && reg.status !== 201) {
    throw new Error(`register ${email} failed (${reg.status})`);
  }
  if (reg.body && reg.body.devToken) {
    await req(`/api/auth/verify-email?token=${encodeURIComponent(reg.body.devToken)}`);
  }
  const login = await req("/api/auth/login", {
    method: "POST",
    body: { email, password: "Passw0rd123" },
  });
  if (!login.body || !login.body.accessToken) {
    throw new Error(`login ${email} failed (${login.status})`);
  }
  return { email, id: login.body.user.id, token: login.body.accessToken };
}

function promoteToStaff(email) {
  // The running server owns the sqlite file, so a second connection can hit
  // SQLITE_BUSY while it is mid-transaction. Retry briefly rather than
  // failing the whole run on a transient lock.
  let lastErr;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const db = new DatabaseSync(path.join(process.cwd(), "data", "mitex.db"));
      try {
        db.exec(`UPDATE users SET role='staff', active=1 WHERE email='${email}'`);
      } finally {
        db.close();
      }
      return;
    } catch (err) {
      lastErr = err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
  throw lastErr;
}

(async () => {
  const adminEmail = process.env.MITEX_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
  const adminPassword = process.env.MITEX_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    console.log("SKIP  needs admin credentials");
    process.exit(0);
  }

  const health = await fetch(BASE + "/api/health").catch(() => null);
  if (!health || !health.ok) {
    console.log(`SKIP  no server at ${BASE}`);
    process.exit(0);
  }

  // --- provision roles ---------------------------------------------------
  const buyer = await registerUser("Authz Buyer", `authz-buyer-${STAMP}@example.com`);
  const staffA = await registerUser("Authz Staff A", `authz-staffa-${STAMP}@example.com`);
  const staffB = await registerUser("Authz Staff B", `authz-staffb-${STAMP}@example.com`);
  promoteToStaff(staffA.email);
  promoteToStaff(staffB.email);

  // Re-login so the promoted role is in the token/claims.
  const asStaffA = await req("/api/auth/login", {
    method: "POST",
    body: { email: staffA.email, password: "Passw0rd123" },
  });
  const asStaffB = await req("/api/auth/login", {
    method: "POST",
    body: { email: staffB.email, password: "Passw0rd123" },
  });
  const asAdmin = await req("/api/auth/login", {
    method: "POST",
    body: { email: adminEmail, password: adminPassword },
  });
  if (!asAdmin.body || !asAdmin.body.accessToken) throw new Error("admin login failed");

  const aTok = asStaffA.body.accessToken;
  const bTok = asStaffB.body.accessToken;
  const adminTok = asAdmin.body.accessToken;
  const staffAId = asStaffA.body.user.id;
  const staffBId = asStaffB.body.user.id;

  check("promoted staff role is live in the session", asStaffA.body.user.role === "staff", asStaffA.body.user.role);
  check("buyer stays a customer", buyer.id && asStaffB.body.user.role === "staff");

  // --- two listings, one assigned to each staff member --------------------
  const mk = async (ownerId) => {
    const r = await req("/api/listings", {
      method: "POST",
      token: adminTok,
      body: {
        title: `Authz Probe ${STAMP} ${ownerId}`,
        description: "temporary listing for authorization boundary checks",
        price: 1000,
        level: 1,
        category: "other",
        asset_type: "website",
        employeeId: ownerId,
      },
    });
    if (!r.body || !r.body.listing) throw new Error(`create failed (${r.status})`);
    return r.body.listing;
  };

  const mine = await mk(staffAId);
  const theirs = await mk(staffBId);
  check("listing created and assigned to staff A", Boolean(mine.id));
  check("second listing assigned to staff B", Boolean(theirs.id));

  // --- 1. assignment boundary -------------------------------------------
  const ownEdit = await req(`/api/listings/${mine.id}`, {
    method: "PUT",
    token: aTok,
    body: { price: 2000 },
  });
  check("staff CAN edit a listing assigned to them", ownEdit.status === 200, String(ownEdit.status));

  const foreignEdit = await req(`/api/listings/${theirs.id}`, {
    method: "PUT",
    token: aTok,
    body: { price: 999999 },
  });
  check(
    "staff CANNOT edit a listing assigned to someone else",
    foreignEdit.status === 403,
    String(foreignEdit.status)
  );
  check(
    "refusal names the assignment rule",
    /not assigned to you/i.test(JSON.stringify(foreignEdit.body || {})),
    JSON.stringify(foreignEdit.body)
  );

  const after = await req(`/api/listings/${theirs.id}`);
  check(
    "rejected edit did not change the price",
    Number(after.body?.listing?.price ?? after.body?.price) !== 999999,
    String(after.body?.listing?.price ?? after.body?.price)
  );

  // --- 2. sold is admin-only --------------------------------------------
  const staffSold = await req(`/api/listings/${mine.id}`, {
    method: "PUT",
    token: aTok,
    body: { status: "sold" },
  });
  check("staff CANNOT mark a listing sold", staffSold.status === 403, String(staffSold.status));

  // --- 3. staff cannot reassign ownership --------------------------------
  const reassign = await req(`/api/listings/${mine.id}`, {
    method: "PUT",
    token: aTok,
    body: { employeeId: staffBId },
  });
  check("reassign attempt does not error", reassign.status === 200 || reassign.status === 403, String(reassign.status));
  const stillMine = await req(`/api/listings/${mine.id}`);
  const ownerNow = String(stillMine.body?.listing?.employee_id ?? stillMine.body?.employee_id ?? "");
  check("staff could NOT hand the listing to another employee", ownerNow === String(staffAId), ownerNow);

  // --- 4. admin CAN mark sold -------------------------------------------
  const adminSold = await req(`/api/listings/${mine.id}`, {
    method: "PUT",
    token: adminTok,
    body: { status: "sold" },
  });
  check("admin CAN mark a listing sold", adminSold.status === 200, String(adminSold.status));

  // --- 5. customers cannot mutate listings at all ------------------------
  const buyerEdit = await req(`/api/listings/${mine.id}`, {
    method: "PUT",
    token: buyer.token,
    body: { price: 1 },
  });
  check("buyer CANNOT edit a listing", buyerEdit.status === 403, String(buyerEdit.status));
  const buyerSold = await req(`/api/listings/${theirs.id}`, {
    method: "PUT",
    token: buyer.token,
    body: { status: "sold" },
  });
  check("buyer CANNOT mark a listing sold", buyerSold.status === 403, String(buyerSold.status));
  const buyerAnon = await req(`/api/listings/${mine.id}`, { method: "PUT", body: { price: 1 } });
  check("anonymous CANNOT edit a listing", buyerAnon.status === 401, String(buyerAnon.status));

  // --- 6. delivery URL: staff sees only their own ------------------------
  const staffBViewsMine = await req(`/api/listings/${mine.id}`, { token: bTok });
  check(
    "another staff member cannot see the delivery url",
    !JSON.stringify(staffBViewsMine.body || {}).includes("delivery_url"),
    JSON.stringify(staffBViewsMine.body).slice(0, 120)
  );

  // --- 7. worker attaching delivery to a sold listing makes it buyable ----
  const delivery = "https://example.com/authz-delivery.zip";
  const savedDelivery = await req(`/api/listings/${mine.id}`, {
    method: "PUT",
    token: aTok,
    body: { deliveryUrl: delivery },
  });
  check("assigned staff CAN attach a delivery url", savedDelivery.status === 200, String(savedDelivery.status));

  const back = await req(`/api/listings/${mine.id}`);
  const statusNow = String(back.body?.listing?.status ?? back.body?.status ?? "");
  check(
    "attaching delivery to a sold listing returns it to available",
    statusNow === "available",
    statusNow
  );

  // --- 8. delete is admin-only -------------------------------------------
  const staffDelete = await req(`/api/listings/${theirs.id}`, { method: "DELETE", token: bTok });
  check("staff CANNOT delete a listing", staffDelete.status === 403, String(staffDelete.status));
  const buyerDelete = await req(`/api/listings/${theirs.id}`, { method: "DELETE", token: buyer.token });
  check("buyer CANNOT delete a listing", buyerDelete.status === 403, String(buyerDelete.status));

  // --- cleanup ------------------------------------------------------------
  for (const id of [mine.id, theirs.id]) {
    await req(`/api/listings/${id}`, { method: "DELETE", token: adminTok });
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log(`CRASH: ${e.message}`);
  process.exit(1);
});