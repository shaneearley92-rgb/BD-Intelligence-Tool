# BD Intelligence Tool - Setup Guide

## 1. Supabase RLS Policies (Required for Dashboard)

The dashboard uses the Supabase **anon key** to read/write data. Row Level Security must be configured to allow this.

**Run the SQL in `supabase-rls-policies.sql` in your Supabase SQL Editor:**
1. Go to https://supabase.com/dashboard → Your project → SQL Editor
2. Paste the contents of `supabase-rls-policies.sql`
3. Click "Run"

This enables the dashboard to:
- Read all tables (companies, contacts, research_runs, research_snapshots, outreach_content, icp_filters)
- Insert/update companies and contacts from the UI

## 2. GitHub Repository Secrets (Required for Research Pipeline)

Go to **Settings → Secrets and variables → Actions** in your GitHub repo and add these secrets:

| Secret Name | Description | Where to find it |
|---|---|---|
| `SUPABASE_URL` | Your Supabase project URL | Supabase Dashboard → Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | Service role key (bypasses RLS) | Supabase Dashboard → Settings → API → `service_role` key |
| `ANTHROPIC_API_KEY` | Claude API key | https://console.anthropic.com/settings/keys |
| `EXA_API_KEY` | Exa.ai search API key | https://dashboard.exa.ai/api-keys |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key | Google Cloud Console → APIs & Services → Credentials |

## 3. GitHub Pages (Dashboard Hosting)

1. Go to **Settings → Pages** in your GitHub repo
2. Set Source: **Deploy from a branch**
3. Branch: `main`, Folder: `/docs`
4. Click Save

Dashboard URL will be: `https://shaneearley92-rgb.github.io/BD-Intelligence-Tool/`

## 4. GitHub PAT for Research Triggers (Optional)

To trigger research runs from the dashboard "Research" button:
1. Go to https://github.com/settings/tokens → Fine-grained tokens → Generate new token
2. Set repository access to `BD-Intelligence-Tool` only
3. Under **Permissions → Repository permissions**, set **Actions** to **Read and write**
4. Copy the token
5. Edit `docs/index.html` and `docs/company.html` — paste the token into `CONFIG.GITHUB_PAT`

> **Note:** The PAT is visible in client-side code. For production use, consider a backend proxy.

## 5. Seed Test Data

After running the RLS policies, add a test company from the dashboard or run this in the Supabase SQL Editor:

```sql
INSERT INTO companies (name, domain, industry, employee_count, research_status)
VALUES ('CrowdStrike', 'crowdstrike.com', 'Cybersecurity', '8000', 'prospect');
```

## Architecture

```
docs/                    → Static dashboard (GitHub Pages)
  index.html             → Company list + stats
  company.html           → Company detail + tabs

scripts/
  research-agent.js      → Main research pipeline (runs in GitHub Actions)
  batch-runner.js        → Batch processing wrapper
  fetchers/
    edgar.js             → SEC EDGAR (free, no key needed)
    exa.js               → Exa.ai web search
    youtube.js           → YouTube Data API
  enrichment/
    index.js             → Contact enrichment (Exa fallback, Apollo-ready)

.github/workflows/
  research.yml           → Single company research workflow
  batch.yml              → Batch research workflow

schema.sql               → Database schema reference
supabase-rls-policies.sql → RLS policies to run in Supabase
```
