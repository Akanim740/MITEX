# MITEX production database migrations

Run order (Supabase dashboard -> SQL Editor -> New query -> paste -> Run):

1. `2026-08-28-not-ready-delivery.sql` — fixes the missing-column outage
   (users.dob/nin_bvn/nin_file/payment_enc, applications.dob/nin_bvn,
   orders.notes) and creates the not-ready-delivery tables
   (`buy_intents`, `push_subscriptions`, `notifications`).

After running the SQL, refresh the PostgREST schema cache if registration
still 500s:

```sql
NOTIFY pgrst, 'reload schema';
```

The `NOTIFY` is already the last statement of the migration above, but it is
also safe to run on its own.

--------------------------------------------------------------------------------
## Web Push (VAPID) environment variables
Required on Render so browser notifications work. Add these to the Render
service env (no stay-needed rotation like keys above; these can be rotated
from the backend build settings or any VAPID generator). The public key is
safe to share; the private key must never leak.

```
VAPID_PUBLIC_KEY=<your-vapid-public-key>
VAPID_PRIVATE_KEY=<your-vapid-private-key>     <-- never commit this
VAPID_SUBJECT=mailto:no-reply@mitex.store
```

After saving, Render restarts the service automatically (autoDeploy:true).
If the server cannot load `web-push`, rebuild the deploy (dependencies were
added to `backend/package.json`).