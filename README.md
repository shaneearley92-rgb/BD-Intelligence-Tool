# BD Intelligence Tool

Autonomous sales intelligence platform for enterprise cybersecurity prospecting. Researches target companies using SEC EDGAR, Exa.ai, and YouTube, then generates personalized outreach content using Claude AI.

## Architecture

```
GitHub Actions (compute)     Supabase (database)     GitHub Pages (dashboard)
       |                           |                        |
       |  research.yml             |  companies             |  index.html
       |  batch.yml                |  contacts              |  company.html
       |                           |  research_runs         |
       v                           |  outreach_content      |
  scripts/                         |  icp_profiles          |
    research-agent.js              |                        |
    batch-runner.js                |                        |
    fetchers/                      |                        |
      edgar.js                     |                        |
      exa.js                       |                        |
      youtube.js                   |                        |
    enrichment/                    |                        |
      index.js                     |                        |
```

**No server required.** Research runs execute inside GitHub Actions. The dashboard is a static site on GitHub Pages. All data lives in Supabase.

## Data Sources

| Source | Cost | What It Provides |
|--------|------|-----------------|
| SEC EDGAR | Free | 10-K/8-K filings, risk factors, cybersecurity signals |
| Exa.ai | ~$25/mo | Company news, executive content, competitive intelligence |
| YouTube Data API | Free | Earnings calls, keynotes, interview transcripts |
| Apollo.io (future) | ~$49-99/mo | Contact enrichment, verified emails, tech stack data |
| Claude API | Variable | AI synthesis + outreach content generation |

**Estimated total: $80-145/mo** including ~$5-20/mo in Claude API costs for normal usage (20-50 companies).

## Setup (5 steps)

### 1. Get API Keys

- **Anthropic**: [console.anthropic.com](https://console.anthropic.com) — create an API key
- **Exa.ai**: [exa.ai](https://exa.ai) — sign up for starter plan ($25/mo)
- **YouTube**: [Google Cloud Console](https://console.cloud.google.com) — enable YouTube Data API v3, create an API key
- **Supabase**: [supabase.com](https://supabase.com) — free account, create a new project

### 2. Set Up Supabase Database

1. Go to your Supabase project dashboard
2. Open **SQL Editor** in the left sidebar
3. Paste the contents of `schema.sql` and click **Run**
4. Go to **Settings > API** and note your:
   - Project URL (e.g. `https://abcxyz.supabase.co`)
   - `anon` / public key
   - `service_role` key (keep private)

### 3. Configure GitHub Secrets

Go to your repo **Settings > Secrets and variables > Actions** and add:

| Secret | Value |
|--------|-------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Your Supabase service_role key |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `EXA_API_KEY` | Your Exa.ai API key |
| `YOUTUBE_API_KEY` | Your YouTube Data API key |

### 4. Configure Dashboard

Edit both `docs/index.html` and `docs/company.html` — fill in the `CONFIG` object at the top of each file's `<script>` section:

```js
const CONFIG = {
    SUPABASE_URL: 'https://your-project.supabase.co',
    SUPABASE_ANON_KEY: 'eyJ...your-anon-key',
    GITHUB_OWNER: 'shaneearley92-rgb',
    GITHUB_REPO: 'BD-Intelligence-Tool',
    GITHUB_PAT: 'ghp_...your-fine-grained-pat',
};
```

**GitHub PAT**: Create a [fine-grained personal access token](https://github.com/settings/tokens?type=beta) with `Actions: Read and write` permission scoped to this repo.

### 5. Enable GitHub Pages

1. Go to repo **Settings > Pages**
2. Set **Source** to "Deploy from a branch"
3. Set **Branch** to `main` and folder to `/docs`
4. Click **Save**

Your dashboard will be live at `https://shaneearley92-rgb.github.io/BD-Intelligence-Tool/`

## Usage

### From the Dashboard
1. Click **+ Add Company** to add a target
2. Click **Research** on any company row to trigger a research run
3. Click into a company to see contacts, intelligence, and generated outreach content
4. Use **Run Batch Research** to process multiple companies at once

### From GitHub Actions
1. Go to **Actions** tab in the repo
2. Select "Run Company Research" or "Batch Company Research"
3. Click **Run workflow**, enter the company ID from Supabase
4. Monitor the run in the Actions log

### From the API
Trigger research programmatically:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_GITHUB_PAT" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/shaneearley92-rgb/BD-Intelligence-Tool/actions/workflows/research.yml/dispatches \
  -d '{"ref":"main","inputs":{"company_id":"UUID_HERE"}}'
```

## What the Research Agent Produces

For each company, the agent:

1. **Collects data** from EDGAR (10-K filings, cybersecurity signals), Exa (news, executive content), and YouTube (earnings calls, keynotes with transcripts)
2. **Synthesizes intelligence** using Claude: company brief, buying signals, pain points, competitive landscape
3. **Generates 4 outreach formats** per contact:
   - Cold email draft (with subject line)
   - LinkedIn connection request + follow-up
   - Call talk track (opener, discovery questions, objection handling)
   - Executive briefing one-pager

## Adding Apollo.io (Future)

The enrichment layer is pre-wired for Apollo. To enable:

1. Get an Apollo API key (Basic plan, ~$49/mo)
2. Add `APOLLO_API_KEY` to GitHub Secrets
3. In `scripts/enrichment/index.js`:
   - Uncomment the `ApolloEnrichmentProvider` class
   - Uncomment the Apollo check in `getProvider()`
4. Apollo adds: verified emails, direct dials, company technographics, ICP-based contact search

## Cost Control

- Research runs only fire when you trigger them (no background polling)
- Each run costs ~$0.10-0.30 in Claude API tokens
- The dashboard shows token usage and cost per run
- Batch mode processes companies sequentially with configurable delays
- GitHub Actions: 2,000 free minutes/month on private repos (~500-1000 research runs)

## File Structure

```
bd-intelligence-tool/
├── .github/workflows/
│   ├── research.yml          # Single company research workflow
│   └── batch.yml             # Batch research workflow
├── scripts/
│   ├── research-agent.js     # Main research pipeline
│   ├── batch-runner.js       # Batch processing runner
│   ├── fetchers/
│   │   ├── edgar.js          # SEC EDGAR data fetcher
│   │   ├── exa.js            # Exa.ai web research fetcher
│   │   └── youtube.js        # YouTube data + transcript fetcher
│   └── enrichment/
│       └── index.js          # Contact enrichment (Apollo-ready)
├── docs/
│   ├── index.html            # Dashboard (GitHub Pages)
│   └── company.html          # Company detail view
├── schema.sql                # Supabase database schema
├── package.json              # Node.js dependencies
├── .env.example              # Environment variable template
└── .gitignore
```
