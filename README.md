# floede-agent

Autonomous pipeline for public permit data extraction.
Phase A: Extraction proof-of-concept using Claude Haiku on 5 known municipalities.

## Setup

```bash
npm install
cp .env.example .env
# Fill in ANTHROPIC_API_KEY and SUPABASE credentials
```

## Phase A — Extraction PoC

```bash
# Step 1: Fetch HTML from 5 municipalities
node src/fetch-html.js

# Step 2: Run Haiku extraction on fetched HTML
node src/extract.js

# Step 3: Compare results against legacy system
node src/compare.js

# Step 4: Generate cost report
node src/report.js
```

## Municipalities (Phase A)

| Municipality | Platform       | Legacy configs |
|-------------|----------------|----------------|
| Nacka       | Sitevision     | Yes            |
| Helsingborg | Sitevision     | Yes            |
| Malmö       | Netpublicator  | Yes            |
| Mölndal     | MeetingsPlus   | Yes            |
| Lund        | WordPress/Other| Yes            |

## Data contract

Output per permit:
```json
{
  "municipality": "string",
  "case_number": "string",
  "address": "string | null",
  "permit_type": "bygglov | marklov | rivningslov | förhandsbesked | strandskyddsdispens | anmälan",
  "status": "ansökt | beviljat | avslag | överklagat | startbesked | slutbesked",
  "date": "ISO 8601",
  "description": "string | null",
  "source_url": "string"
}
```

Fields that cannot be extracted = null. Never guess.

## Deploy to Railway (cron job)

The pipeline runs daily at 06:00 CEST / 05:00 CET (04:00 UTC) via Railway cron.

```bash
# 1. Install Railway CLI and log in
railway login

# 2. Create a NEW project (do not use the production project)
railway init

# 3. Deploy
railway up

# 4. Set environment variables in Railway dashboard:
#    - ANTHROPIC_API_KEY
#    - SUPABASE_URL
#    - SUPABASE_SERVICE_KEY
#    - COST_BUDGET_MONTHLY_USD (optional, default 150)
```

The cron schedule is configured in `railway.toml`. No credentials are baked into the Docker image.

## Budget

Max $150/month LLM calls during Phase A.
Cost reported weekly, split by agent (Discovery/Extraction/QC).
