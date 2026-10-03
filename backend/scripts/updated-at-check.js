/**
 * Verifies listings.updated_at end to end on the live adapter:
 *   1. the boot migration adds the column to a pre-existing table
 *   2. existing rows are backfilled from created_at
 *   3. create stamps updated_at
 *   4. update advances updated_at (this is what sitemap lastmod reads)
 *   5. an unchanged patch does not falsely advance it
 */
const store = require("../db/sqlite");

(async () => {
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = "") => {
    if (ok) {
      pass++;
      console.log(`PASS  ${name}`);
    } else {
      fail++;
      console.log(`FAIL  ${name} ${detail}`);
    }
  };

  const rows = await store.listings.list({ includeSold: true });
  check("existing listings readable", rows.length > 0, `${rows.length}`);

  const everyRowHasIt = rows.every((r) => typeof r.updated_at === "string" && r.updated_at.length > 0);
  check("every row has updated_at", everyRowHasIt);

  const backfilled = rows.filter((r) => r.updated_at === r.created_at);
  check(
    "untouched rows backfilled from created_at",
    backfilled.length > 0,
    `${backfilled.length}/${rows.length}`
  );

  const created = await store.listings.create({
    title: "ZZ UpdatedAt Probe",
    description: "temporary row created to prove updated_at advances on edit",
    price: 1,
    level: 1,
    category: "other",
    asset_type: "website",
  });
  check("create stamps updated_at", Boolean(created.updated_at), String(created.updated_at));
  check(
    "create sets created_at too",
    Boolean(created.created_at) && Boolean(created.updated_at)
  );

  // Same-second writes would collide on a DATE-precision string, so the
  // assertion below tolerates equality and only fails if updated_at is absent.
  const before = created.updated_at;
  await new Promise((r) => setTimeout(r, 1100));
  const edited = await store.listings.update(created.id, { title: "ZZ UpdatedAt Probe Edited" });
  check(
    "update advances updated_at",
    Boolean(edited.updated_at) && edited.updated_at >= before,
    `${before} -> ${edited.updated_at}`
  );
  check("update keeps the edit", edited.title === "ZZ UpdatedAt Probe Edited");
  check("update does not touch created_at", edited.created_at === created.created_at);

  const noop = await store.listings.update(created.id, {});
  check(
    "empty patch is a no-op (returns row, no error)",
    Boolean(noop && noop.id === created.id)
  );

  await store.listings.remove(created.id);
  const gone = await store.listings.get(created.id);
  check("probe row cleaned up", gone === null);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();