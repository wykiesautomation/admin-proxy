
# PayFast Proxy (+PDF Invoices)

Adds server‑signed PayFast, ITN handling, and **PDF invoice generation** + **email**. Invoices are saved under `/invoices/INV-*.pdf` and exposed at `https://<host>/invoices/INV-*.pdf`.

## New endpoints
- `POST /payfast/sign` — unchanged (server‑signed)
- `POST /payfast/itn` — on COMPLETE + valid: generates invoice PDF, saves JSON+PDF, emails buyer + admin
- `GET /invoices/resend?invoiceNo=INV-...` — re‑email existing invoice
- `GET /invoices/repair?invoiceNo=INV-...` — regenerate PDF and return `fileUrl`

## Email (Nodemailer)
Set Gmail SMTP (recommended: **App Password**):
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=wykiesautomation@gmail.com
SMTP_PASS=<your-app-password>
FROM_EMAIL=wykiesautomation@gmail.com
ADMIN_EMAIL=wykiesautomation@gmail.com
```

## Invoice format
- Number: `INV-YYYYMM-<last6 of pf_payment_id>`
- One line item: SKU (quantity 1), VAT‑inclusive amount from server price log
- Footer note: "All prices VAT‑inclusive."

## Serve invoices
PDF and a JSON metadata file are stored in `./invoices/`. Express serves `/invoices` statically for download links in Admin.

## Front‑end
Use the `payfastBuy.js` on the public site to call `/payfast/sign`. After a successful ITN, your Admin Payments list can point to `/invoices/<invoice>.pdf`.
