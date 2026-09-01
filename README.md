# Ninety Days

A complete static equity-window product demonstrating a page-owned, progressive WebMCP tool surface.
It shows a synthetic employee account, the plan-controlled post-employment clock, a source-pinned
2026 Form 6251 derivation, and a guarded model → prepare → simulated-submit workflow.

> **Boundary:** Synthetic 2026 federal ordinary-income model. Form 6251 line 2i AMT adjustment proxy — not AMT owed. The statute uses 3 months; the plan date controls. This demonstration is not tax or legal advice, does not decide plan rights, and cannot file, exercise options, move money, or contact a brokerage.

## Run cold

Requirements: Node.js 22+ and Python 3.10+ with Playwright for the two browser checks.
The product itself has no runtime packages, backend, account, or external API.

```bash
npm test
npm run serve
```

Then open <http://localhost:8000/>. The last complete product gate passed **28/28** tests before the
five packaging and two packaging-browser checks were added; the current command runs all 35.

The browser gates use contained Chrome 154 at **1440×900** and **390×844**. The manual product works
AI-off: enter a share count, Model, Prepare the exact receipt, check the human-confirm box, then run
the simulated Submit. No financial action exists behind that button.

## What to look for

- Account-owned `grant_id` values: `EMP-4471 | EMP-4482`; invented identifiers fail schema validation.
- Progressive registry: **4 → 5 → 6 → 5** tools across initial, modeled, prepared, and blackout states.
- Maximum six simultaneously live tools, with context for
  [webmachinelearning/webmcp#255](https://github.com/webmachinelearning/webmcp/issues/255).
- Synthetic full exercise: USD 41,400 cash, USD 276,000 line-2i adjustment, USD 57,562 modeled incremental proxy.
- Exact crossover: 4,263 shares; USD 63,945 line-2i adjustment; share 4,264 produces USD 3.60 proxy.
- Visible source trail: 26 U.S.C. §56(a)(3), Form 6251 line 2i, and Rev. Proc. 2025-45.

## Model inputs

The fixture is deliberately explicit and stored in integer cents:

- tax year 2026, filing status single;
- baseline AMTI USD 180,000 and regular tax USD 40,000;
- USD 2.25 exercise price, USD 17.25 synthetic FMV, 18,400 vested shares;
- 2026 single exemption USD 90,100 and 26/28-percent breakpoint USD 244,500;
- phaseout midpoint AMTI `59,010,000` cents (USD 590,100) yields a USD 45,050 exemption.

The narrow model excludes state tax, NIIT, AMT credits, prior-year adjustments, grant ordering,
foreign tax, plan interpretation, and funding.

## Architecture

- `src/tax/amt_6251.mjs` — safe-integer-cent 2026 synthetic kernel and crossover search.
- `src/catalog.mjs` — runtime schemas, progressive six-tool cap, exact prepare/submit guards, blackout refusal.
- `src/webmcp_adapter.mjs` — progressive `registerTool` lifecycle with AbortSignal rollback.
- `src/app.mjs` — AI-optional browser controller and product rendering.
- `index.html` / `styles.css` — static, responsive product UI.
- `404.html` — byte-identical GitHub Pages fallback.

The origin-trial token is public by design and is included once in the page head before the app module.
This repository is licensed under the [MIT License](LICENSE).
