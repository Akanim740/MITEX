# MITEX - Website Delivery Template

Copy this message for every sale. Replace everything in [brackets].

---

## The message you send after payment

**Subject: Your MITEX website is ready! [Website Name]**

Hi [Buyer Name],

Thank you for your purchase! Your **[Website Name]** has been confirmed as paid
(reference: [MITEX-...]) and here is everything you need.

### 1. Your files

Download your website here:
[Download link - from Google Drive / or tell them to use My Account > My Orders > Download]

### 2. How to run it on your own computer

1. Install Node.js from https://nodejs.org (choose LTS)
2. Unzip the folder, open a terminal inside it
3. Run these commands one by one:

```
cd backend
npm install
npm run seed
node server.js
```

4. Open http://localhost:3000 in your browser - that's your website!

### 3. Putting it online

Your package includes deployment. Send us:
- Your domain name (or we can advise where to buy one)
- A Gmail address for the hosting account

We will deploy it and hand it back live within 48 hours.

### 4. Important first steps

1. Change the admin password immediately
2. Add your own Paystack keys in backend/.env to receive payments
3. Update the text/images to match your brand

### Support

You have [14/30] days of free support. Message us any time:
WhatsApp: +234 701 163 3770

Congratulations on your new website!

MITEX Team

---

## Pre-delivery checklist (do every time)

- [ ] Payment confirmed as "paid" in admin dashboard
- [ ] ZIP contains full source code + README with run instructions
- [ ] No personal secrets inside the ZIP (your .env, API keys, database file)
- [ ] Listing status changed to "sold"
- [ ] Delivery link added to the listing (so future automated downloads work)
- [ ] Buyer contact saved (email/WhatsApp) for support period
- [ ] Sent the message above
