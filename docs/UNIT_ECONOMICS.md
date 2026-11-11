# MillProof: unit economics

Anything not marked **Sourced** is a **working assumption**, made to be tested with the first customers.

## Cost to serve (hosting only; AI cost ₹0)

The customer's own Claude plan pays for reading the certificate. MillProof does arithmetic against a spec table, so it pays nothing per AI call.

| Stage | Infrastructure | Monthly cost | Per customer |
|---|---|---|---|
| Demo (today) | Render free web service + free Postgres | ₹0 | ₹0 |
| First ~25 customers | Render Starter web ($7) + Postgres Basic-256mb ($6) + ~5 GB storage ($1.50) | ~$14.50 ≈ **₹1,300** | ~₹50 |
| 100 customers | Render Standard web ($25) + Postgres Basic-1gb ($19) + storage (~$3) + domain/email (~₹800) | ≈ **₹4,900** | **≈ ₹49** |

- Render prices are from a mid-2026 third-party summary of Render's list prices; check them on render.com/pricing. Exchange rate ₹88/USD (*assumption*).
- At an assumed 150 certificates per customer per month, 100 customers is 15,000 certificates, or **≈ ₹0.33 hosting cost per certificate** (*assumption*).
- MillProof stores extracted values, not the PDFs, so storage stays small.

## Pricing (INR)

| Plan | Price | For |
|---|---|---|
| Pay-as-you-go | **₹20 per certificate**, 1 seat | Traders, small fabricators |
| Site | **₹4,999 / month**: 3 QA seats, 400 certificates, ₹12 per extra certificate | Fabrication shops, EPC project sites |
| Enterprise | **from ₹24,999 / month**: unlimited seats, multiple sites, custom spec tables, ERP export | EPC contractors, large stockists |

**Value anchor (*assumption*):** about 15 minutes of QA engineer time per manual check at a loaded cost of about ₹400 an hour is **≈ ₹100 per certificate**, before counting the cost of accepting a wrong heat. MillProof costs ₹12–20 per certificate.

**Gross margin at 100 customers (*assumption*):** about ₹49 cost against a blended ≈ ₹5,000 ARPU is **≈ 99%**.

## First 100 customers (*targets are assumptions*)

| Channel | Play | Target |
|---|---|---|
| Steel trader associations | Present at city association meetings. Traders get free verification links to send their buyers, so each trader introduces 5–20 fabricators. | 30 |
| Fabricators in industrial clusters | On-site demos in fabrication clusters with a 1-month free pilot. The prospect brings their own MTCs. | 40 |
| IIT Bombay alumni in EPC firms | Warm introductions; 3–5 design partners that convert to Enterprise. | 5 enterprise |
| LinkedIn outreach to QA/QC heads | 25 personalised messages a day; a 10-minute demo on one of their own certificates. | 25 |

Funnel (*assumption*): about 2,000 contacts → 200 demos → 100 paying customers (10% demo rate, 50% close).

## Where the business is

| | 1 year | 3 years |
|---|---|---|
| Customers | 100 paying | ~1,500, including ~30 EPC enterprise accounts |
| Revenue | ~₹5 lakh MRR, **~₹60 lakh ARR** | **~₹10 crore ARR** (1,470 × ₹5k × 12 + 30 × ₹25k × 12) |
| Product | IS 2062 + ASTM A36 plates, then TMT rebar (IS 1786) and pipes; ERP export | Supplier-quality network across buyers. Mills and traders pay for a "verified supplier" listing. Export buyers of Indian steel. |

All of these figures are *assumptions*.

## Market context

- **Sourced:** India's finished steel consumption was **163.7 million tonnes** in FY2025-26 (provisional; Ministry of Steel, Joint Plant Committee data).
- *Assumption:* one delivery per ~20 t is ≈ 8.2 million deliveries a year. Each certificate is checked about 3 times along the chain (trader, fabricator, EPC/inspector), which gives **≈ 25 million certificate checks a year**. At ₹15 per check, the checking step alone is worth **≈ ₹370 crore a year**.
- The 3-year plan (~1,500 customers × ~150 certificates a month ≈ 2.7 million checks a year) is about 11% of those checks and about 3% of that value.
