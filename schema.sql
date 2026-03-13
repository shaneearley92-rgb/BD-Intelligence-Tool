-- BD Intelligence Tool - Supabase Schema
-- This schema reflects the actual deployed database tables.

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
    employee_count TEXT,
    hq_location TEXT,
    description TEXT,
    ticker TEXT,
    is_public BOOLEAN,
    research_status TEXT,
    last_researched_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CONTACTS
-- ============================================
CREATE TABLE contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    title TEXT,
    email TEXT,
    phone TEXT,
    linkedin_url TEXT,
    seniority TEXT,
    department TEXT,
    enrichment_source TEXT,
    enrichment_data JSONB,
    tech_stack JSONB,
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
    status TEXT DEFAULT 'pending',
    triggered_by TEXT DEFAULT 'manual',
    estimated_tokens INTEGER,
    actual_tokens INTEGER,
    sources_fetched TEXT[],
    error_message TEXT,
    queued_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- ============================================
-- RESEARCH SNAPSHOTS
-- ============================================
CREATE TABLE research_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    run_id UUID REFERENCES research_runs(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    title TEXT,
    url TEXT,
    raw_content TEXT,
    summary TEXT,
    signals JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- OUTREACH CONTENT
-- ============================================
CREATE TABLE outreach_content (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    run_id UUID REFERENCES research_runs(id) ON DELETE SET NULL,
    pitch_angle TEXT,
    email_subject TEXT,
    email_draft TEXT,
    linkedin_sequence JSONB,
    call_talk_track TEXT,
    discovery_questions TEXT[],
    exec_briefing TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ICP FILTERS
-- ============================================
CREATE TABLE icp_filters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    titles TEXT[],
    industries TEXT[],
    employee_min INTEGER,
    employee_max INTEGER,
    locations TEXT[],
    tech_stack TEXT[],
    filter_params JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE INDEX idx_research_runs_company ON research_runs(company_id);
CREATE INDEX idx_research_runs_status ON research_runs(status);
CREATE INDEX idx_research_snapshots_company ON research_snapshots(company_id);
CREATE INDEX idx_research_snapshots_run ON research_snapshots(run_id);
CREATE INDEX idx_outreach_content_contact ON outreach_content(contact_id);
CREATE INDEX idx_outreach_content_company ON outreach_content(company_id);
CREATE INDEX idx_companies_research_status ON companies(research_status);
CREATE INDEX idx_companies_ticker ON companies(ticker);
