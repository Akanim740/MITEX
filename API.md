# MITEX API Reference

Base URL: `https://mitex.onrender.com` (local: `http://localhost:3000`).

All JSON requests/responses. Auth endpoints set an `httpOnly` refresh cookie;
the returned `accessToken` is sent as `Authorization: Bearer <token>` for
protected endpoints. Rate limits apply (300 req/15min general, 30/15min auth, 10/hour enquiries).

---

## Auth — `/api/auth`

| Method | Path | Auth | Body / Query | Description |
|---|---|---|---|---|
| POST | `/register` | — | `name, email, password, country?, locale?` | Create account |
| POST | `/login` | — | `email, password` | Sign in (deactivated accounts rejected) |
| POST | `/refresh` | cookie | — | Rotate session, return new access token |
| POST | `/logout` | cookie | — | End session |
| GET | `/me` | token | — | Current user profile |
| GET | `/verify-email?token=` | — | token | Confirm email |
| POST | `/resend-verification` | token | — | Re-send verification email |
| POST | `/forgot-password` | — | `email` | Send reset link |
| POST | `/reset-password` | — | `token, newPassword` | Set new password |
| POST | `/webauthn/register/options` | token | — | Start passkey registration |
| POST | `/webauthn/register/verify` | token | credential JSON | Finish passkey registration |
| GET | `/webauthn/credentials` | token | — | List passkeys |
| DELETE | `/webauthn/credentials/:id` | token | — | Remove a passkey |
| POST | `/webauthn/login/options` | — | `email` | Start passkey login |
| POST | `/webauthn/login/verify` | — | credential JSON | Finish passkey login |
| GET | `/dashboard` | token | — | Admin dashboard stats |
| POST | `/staff/onboard` | token (admin) | `name,email,country?,locale?` | Create staff account; returns `devToken` + unique hire link in dev |
| POST | `/staff/update/:id` | token (admin) | `name?,phone?,bio?,active?` | Update a staff member |
| GET | `/staff` | token (admin) | — | List staff members |
| GET | `/staff/:id/hire-link` | token (admin) | — | Refresh the unique onboarding link |

## Users — `/api/users`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/me` | token | Own full profile |
| PUT | `/me` | token | Edit `name, phone, bio, avatar_url, country, locale` |
| POST | `/me/password` | token | Change password (`currentPassword, newPassword`) |
| DELETE | `/me` | token | Self-service account deletion (`password` in body) |
| GET | `/` | token (admin) | List all users |
| GET | `/:id` | token (staff) | Public profile |
| PATCH | `/:id/role` | token (admin) | Change `role` |
| DELETE | `/:id` | token (admin) | Remove a user |

## Listings — `/api/listings`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | public | Available listings (public marketplace) |
| GET | `/?includeSold=true` | token (staff) | All listings incl. sold |
| GET | `/mine` | token (admin/editor/staff) | Listings assigned to the staff member |
| POST | `/` | token (admin/editor) | Create listing (`title, description, price, level, tech_stack, employee_id?`) |
| PUT | `/:id` | token (admin/editor/staff) | Update; staff may only update their assigned listing's `delivery_url` |
| DELETE | `/:id` | token (admin) | Delete listing |

Setting `delivery_url` triggers a delivery-notification email to the buyer.

## Payments — `/api/payments`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/initialize` | token | Start checkout (`listingId`) -> `reference`, Paystack URL |
| GET | `/verify/:reference` | token (owner/staff) | Verify + settle payment |
| POST | `/demo-pay/:reference` | token (owner) | Simulated payment (only when Paystack not configured) |
| POST | `/webhook` | signature | Paystack charge.success webhook |
| GET | `/orders/mine` | token | Buyer's orders |
| GET | `/orders` | token (staff) | All orders, optional `?status=` |
| GET | `/orders/:id/download` | token (owner/staff) | Invoice/receipt PDF download |
| POST | `/refund/:reference` | token (admin) | Mark order refunded + email buyer |

Pending orders older than 30 minutes are auto-marked `failed` by a background sweep.

## Applications (recruitment) — `/api/applications`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/` | public | Apply (`name,email,phone,portfolio,message`) |
| GET | `/` | token (staff) | List applications |
| PATCH | `/:id/status` | token (staff) | Advance pipeline (`test_sent/submitted/passed/rejected`) |
| POST | `/:id/reject` | token (staff) | Reject + notify |
| POST | `/:id/send-test` | token (staff) | Email the technical test |
| POST | `/:id/submissions` | public | Submit the completed test |
| POST | `/:id/pass` | token (staff) | Mark tests passed |
| POST | `/:id/onboard` | public | Final onboarding (creates staff login) |
| GET | `/:id/hire-link` | token (staff) | Unique onboarding link |

Runs 24h auto-review: applications idle at `test_sent` for 24h are auto-dispatched to
available staff (code review), then auto-hired or rejected.

## Salaries — `/api/salaries`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | token (admin/editor) | All salary payments |
| POST | `/` | token (admin/editor) | Record payment (`staffUserId, amount, bonus?, period, note?`) |
| GET | `/mine` | token (staff) | Staff's own salary ledger |

## Other

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/enquiries` | public | Contact/enquiry form (10/hour/ip) |
| GET | `/api/enquiries` | token (staff) | List enquiries |
| GET | `/api/newsletter` | token (staff) | Subscribers |
| POST | `/api/newsletter` | public | Subscribe (`email`) |
| GET | `/api/health` | — | Service + DB status |
| GET | `/api/audit` | token (admin) | Audit trail (recent 100) |

## Notes

- All mutations (POST/PUT/PATCH/DELETE) are written to the audit log.
- Production requires a strong `JWT_ACCESS_SECRET` (32+ chars) or the server refuses to boot cleanly.
- The site blocks public access to `.env`, `backend/`, `*.sql`, `*.md`, config files and other sensitive paths.