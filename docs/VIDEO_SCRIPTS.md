# MillProof: 5-minute pitch video

Total: 5:00. Spoken lines are written for about 140 words a minute. **[On screen]** lines are what to show or click.

## Before you hit record

- [ ] Open the live app and click **Connect Claude → Reset demo data** (you get exactly 6 sample records).
- [ ] Stay logged in to the app in one browser tab. Open a **private/incognito window** for the share link.
- [ ] In Claude, connect the MillProof connector and turn it on. Start a **fresh chat**.
- [ ] Have `sample/SAMPLE_MTC_RK24-3561_photo.jpg` ready to drag in.
- [ ] Wake the free Render service 2 minutes before you start (open the app once).
- [ ] Do one full rehearsal, then **Reset demo data** again.

---

## 1. Who I am (0:00 – 0:45)

**[On screen]** You on camera, or a title card: *Mausam Madhesia, Founder, MillProof.*

> Hi, I'm Mausam Madhesia, founder of MillProof. I'm a final-year B.Tech student in Metallurgical Engineering and Materials Science at IIT Bombay, graduating in 2027. Reading a chemistry table and a tensile test is literally what my degree trains me to do.
>
> This summer I interned at EY on GenAI in agentic channels. I benchmarked the financials of more than 20 insurers and researched GenAI use cases for strategy and operating-model work. Before that I worked in the Founder's Office at SwapSo, a FinTech and EdTech startup. And at E-Cell IIT Bombay, I ran campaigns for Eureka, which drew more than 25,000 teams, and managed over 300 campus ambassadors.

## 2. My best work (0:45 – 1:15)

**[On screen]** One slide: **+35% engagement · 5+ university partnerships · 10K+ students · MVP shipped 2 weeks early**.

> My best work was at SwapSo's Founder's Office. The platform improvements I worked on lifted engagement by 35 percent. In the same internship I signed more than five university partnerships reaching over 10,000 students, co-launched six courses that raised completion by 28 percent, and we shipped the MVP two weeks early. That's how I like to work: ship fast, then prove it with a number.

## 3. Why this business will win (1:15 – 2:15)

**[On screen]** The sample MTC, then the MillProof dashboard.

> Every steel delivery in India comes with a mill test certificate: heat number, grade, chemistry, yield and tensile strength. Before a fabricator, an EPC contractor or a steel trader accepts the steel, a QA engineer has to check every value against the standard, usually IS 2062. Today that's done by hand. It's slow, it's error-prone, it leaves no searchable record, and fake or mismatched certificates are a known problem.
>
> MillProof splits the job. The customer's own Claude reads the certificate, from a PDF or even a phone photo. MillProof checks every value against fixed, written-down rules, with no AI inside, so the same certificate always gets the same answer, with the clause it came from.
>
> Why not just Claude? Claude forgets when the chat ends. MillProof keeps an audit trail for every heat number, builds a supplier history, gives a verification link to send to the client or inspector, and runs the same check every time.

## 4. Demo (2:15 – 4:15)

| Time | What you do | What you say |
|---|---|---|
| **2:15** | Claude, fresh chat. Drag in `SAMPLE_MTC_RK24-3561_photo.jpg`. Type the prompt below and send. | "Here's a phone photo of a mill test certificate. It's a fictitious sample I generated for this demo. I just ask Claude to add it." |
| **2:30** | Claude calls **create_certificate**. Click the tool call to expand it and show the extracted values. | "Claude read every field: the heat number, the grade E250 BR, all 13 elements. There are two test pieces, and it took the lower yield strength, 298, exactly as the tool description tells it to." |
| **2:50** | Claude's reply shows **PASS** and the record link. Click the link. | "MillProof checked it with fixed rules and says PASS. Let's open the record." |
| **3:00** | App: record page. Point at the heat number, the *via Claude* tag, the Limit and Source columns, and *Carbon equivalent (calculated) 0.328*. | "Every value has its limit and the clause it comes from. MillProof also recalculates carbon equivalent from the chemistry: 0.328 against 0.33 reported, so the certificate is internally consistent." |
| **3:20** | **The edit.** Click the **Sulphur** value `0.024`, type `0.052`, press Enter. The row flashes, the badge turns **Fail**, the verdict at the top flips **PASS → FAIL**, and the audit trail shows `0.024 → 0.052`. | "Now say our own lab retests a plate and sulphur comes back at 0.052. I correct it right here. The check re-runs instantly: sulphur fails against the 0.045 limit, the verdict flips to FAIL, and the change is on the audit trail with my name." |
| **3:40** | Show **Approve** is disabled. Type the note `Lab retest: S 0.052, above 0.045 limit` and click **Reject batch**. | "Approve is locked because a value fails. I reject the batch with a note." |
| **3:50** | Click **Copy** next to the share link, paste it into the incognito window. | "This is the link I'd send to the client or a third-party inspector. Read-only, no login, showing the verdict and the decision." |
| **4:00** | Back in the app: **Suppliers**. Vardhan Steel Traders now shows **67%** (it was 100%). | "And the supplier scorecard updates. Vardhan just dropped from 100 to 67 percent. Over months, this is how a buyer sees which suppliers to trust." |
| *(optional, if time)* | In Claude: *"What's Vardhan Steel Traders' pass rate?"* → **supplier_scorecard**. | "The same history is available inside Claude." |

**Prompt to type in Claude:**

```
Read this mill test certificate and add it to MillProof. The supplier is Vardhan Steel Traders. Tell me the verdict and anything that failed or is missing.
```

**What Claude should extract from the sample** (so you can check it on camera): heat **RK24-3561**, IS 2062:2011 **E250BR**, 16 mm plate, certificate RRM/TC/26-27/04418 dated 2026-11-06. Chemistry: C 0.18, Mn 0.82, Si 0.21, S 0.024, P 0.028, Cr 0.03, Ni 0.02, Cu 0.03, Mo 0.01, V 0.002, Nb 0.002, Ti 0.002, CE 0.33. Mechanical (lowest of two test pieces): YS 298, UTS 452, El 27, proportional gauge. Expected verdict: **PASS**.

If Claude misreads a value, **keep rolling**. Correct it in the app on camera: "Claude misread this one, and that's exactly why a person reviews it here." That shows the human-in-the-loop edit just as well.

## 5. The money (4:15 – 5:00)

**[On screen]** The unit-economics slide.

> The money. MillProof runs no AI, because the customer's own Claude does the reading. My cost per customer is just hosting: about fifty rupees a month once I have a hundred customers.
>
> Pricing: twenty rupees a certificate pay-as-you-go, or ₹4,999 a month for a site with three seats and 400 certificates. I estimate a manual check costs about a hundred rupees of an engineer's time.
>
> My first 100 customers come from steel trader associations, where every trader sends verification links to their buyers; from fabricators in industrial clusters; from IIT Bombay alumni in EPC firms as design partners; and from direct LinkedIn outreach to QA heads.
>
> In one year: 100 paying customers and about ₹60 lakh ARR. In three years: around ₹10 crore ARR, and a supplier-quality record across India's 164 million tonnes of steel a year. Thank you.

*Market number source: India's finished steel consumption was 163.7 Mt in FY2025-26 (provisional; Ministry of Steel / JPC). The other figures are assumptions; see `docs/UNIT_ECONOMICS.md`.*
