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

## Budget

Max $150/month LLM calls during Phase A.
Cost reported weekly, split by agent (Discovery/Extraction/QC).
