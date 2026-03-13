-- Sales Prospecting Agent - Supabase Schema
-- Run this in the Supabase SQL Editor to set up all tables

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- COMPANIES
-- ============================================
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    domain TEXT,
    industry TEXT,
    employee_count INTEGER,
    revenue_estimate TEXT,
    headquarters TEXT,
    description TEXT,
    ticker_symbol TEXT,          -- For SEC EDGAR lookups
    cik_number TEXT,             -- SEC Central Index Key
    tech_stack JSONB DEFAULT '[]',  -- Known technology vendors (Apollo-ready)
    icp_match_score REAL,       -- 0-1 score for ICP fit
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'prospect')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CONTACTS
-- ============================================
CREATE TABLE contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    title TEXT,                  -- e.g. "CISO", "VP of IT Security"
    seniority TEXT,              -- e.g. "VP", "C-Suite", "Director"
    email TEXT,
    phone TEXT,
    linkedin_url TEXT,
    is_primary BOOLEAN DEFAULT FALSE,  -- Primary contact at this company
    enrichment_source TEXT,     -- 'manual', 'apollo', 'exa', etc.
    enrichment_data JSONB DEFAULT '{}',  -- Raw enrichment response
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- RESEARCH RUNS
-- ============================================
CREATE TABLE research_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending', 'running', 'completed', 'failed', 'cancelled'
    )),
    triggered_by TEXT DEFAULT 'manual',  -- 'manual', 'batch', 'scheduled'
    github_run_id TEXT,         -- GitHub Actions run ID for tracking

    -- Data collection results
    edgar_data JSONB DEFAULT '{}',
    exa_data JSONB DEFAULT '{}',
    youtube_data JSONB DEFAULT '{}',
    apollo_data JSONB DEFAULT '{}',  -- Ready for Apollo integration

    -- AI synthesis
    company_summary TEXT,       -- Claude-generated company intelligence brief
    key_signals JSONB DEFAULT '[]',  -- Extracted buying signals
    pain_points JSONB DEFAULT '[]',  -- Identified pain points
    competitive_landscape JSONB DEFAULT '{}',

    -- Cost tracking
    tokens_used INTEGER DEFAULT 0,
    estimated_cost REAL DEFAULT 0,

    -- Timing
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    error_message TEXT
);

-- ============================================
-- OUTREACH CONTENT
-- ============================================
CREATE TABLE outreach_content (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    research_run_id UUID REFERENCES research_runs(id) ON DELETE SET NULL,

    content_type TEXT NOT NULL CHECK (content_type IN (
        'email_draft', 'linkedin_message', 'call_talk_track', 'executive_briefing'
    )),

    title TEXT,
    content TEXT NOT NULL,       -- The actual generated content
    content_metadata JSONB DEFAULT '{}',  -- Subject lines, sequence position, etc.

    -- Content management
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'archived')),
    approved_by TEXT,
    approved_at TIMESTAMPTZ,

    -- Versioning
    version INTEGER DEFAULT 1,
    parent_id UUID REFERENCES outreach_content(id),  -- For regenerated versions

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ICP PROFILES (for future Apollo search integration)
-- ============================================
CREATE TABLE icp_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,          -- e.g. "Primary ICP - Mid-Market Financial"
    criteria JSONB NOT NULL DEFAULT '{}',
    -- Example criteria structure:
    -- {
    --   "titles": ["CISO", "VP of IT", "CTO", "Director of Security"],
    --   "industries": ["Financial Services", "Healthcare", "Technology"],
    --   "employee_range": [500, 10000],
    --   "geography": ["United States"],
    --   "exclude_tech_stack": ["CrowdStrike"],  -- Competitors to displace
    --   "include_tech_stack": ["Splunk", "legacy SIEM"]  -- Gap opportunities
    -- }
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE INDEX idx_research_runs_company ON research_runs(company_id);
CREATE INDEX idx_research_runs_status ON research_runs(status);
CREATE INDEX idx_outreach_content_contact ON outreach_content(contact_id);
CREATE INDEX idx_outreach_content_company ON outreach_content(company_id);
CREATE INDEX idx_outreach_content_type ON outreach_content(content_type);
CREATE INDEX idx_companies_status ON companies(status);
CREATE INDEX idx_companies_ticker ON companies(ticker_symbol);

-- ============================================
-- UPDATED_AT TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER companies_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER contacts_updated_at
    BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER outreach_content_updated_at
    BEFORE UPDATE ON outreach_content
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER icp_profiles_updated_at
    BEFORE UPDATE ON icp_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY (optional, enable per table)
-- ============================================
-- Uncomment these if you want to restrict access via Supabase auth:
-- ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE outreach_content ENABLE ROW LEVEL SECURITY;
