# NOTICE

Copyright (c) 2026 DR-16. All rights reserved (see LICENSE). This is an engineering preview on **synthetic data**:

- Every company, price, financial statement and filing in this demo is written for the demo. It is not an analysis of any real company.
- Nothing here is investment advice, a buy/sell signal, or a financially validated model. The two production experts (Technical, Macro) are rule
  models used as they are; the other three (Fundamental, Valuation, Information) are experimental and not activated in production.
- No market-data vendor's data is included or fetched. In particular no Tiingo, Cboe or other licensed data, and no report built from it.

## Third-party components (shipped in vendor/ and in the built site)

| Component | Version | Licence | Text |
|---|---|---|---|
| Pyodide (CPython for WebAssembly, runtime and loader) | 314.0.7 | Mozilla Public License 2.0 | vendor/licenses/pyodide/LICENSE |
| CPython standard library (inside Pyodide) | 3.14.2 | PSF License | vendor/licenses/cpython/LICENSE |
| NumPy (Pyodide build) | 2.4.6 | BSD-3-Clause (and bundled licences listed in its file) | vendor/licenses/numpy/ |
| pandas (Pyodide build) | 3.0.2 | BSD-3-Clause | vendor/licenses/pandas/ |
| python-dateutil | 2.9.0.post0 | Apache-2.0 / BSD-3-Clause (dual) | vendor/licenses/python-dateutil/ |
| pytz | 2026.1.post1 | MIT | vendor/licenses/pytz/ |
| six | 1.17.0 | MIT | vendor/licenses/six/ |

The Pyodide files are unmodified copies of the npm package `pyodide@314.0.7` (package-lock.json); the wheels are the files named in its
`pyodide-lock.json`, and their SHA-256 values are checked against that file at build time.
