-- BD Intelligence Tool - Row Level Security Policies
-- Run this in Supabase SQL Editor to allow the dashboard (anon key) to read/write data.
--
-- These policies allow the anon role (used by the dashboard) full read access
-- and insert access to companies and contacts. The service_role key (used by
-- GitHub Actions backend scripts) bypasses RLS entirely.

-- ============================================
-- ENABLE RLS ON ALL TABLES
-- ============================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE icp_filters ENABLE ROW LEVEL SECURITY;

-- ============================================
-- COMPANIES - Dashboard can read and insert
-- ============================================
CREATE POLICY "Allow public read on companies"
    ON companies FOR SELECT
    TO anon
    USING (true);

CREATE POLICY "Allow public insert on companies"
    ON companies FOR INSERT
    TO anon
    WITH CHECK (true);

CREATE POLICY "Allow public update on companies"
    ON companies FOR UPDATE
    TO anon
    USING (true)
    WITH CHECK (true);

-- ============================================
-- CONTACTS - Dashboard can read and insert
-- ============================================
CREATE POLICY "Allow public read on contacts"
    ON contacts FOR SELECT
    TO anon
    USING (true);

CREATE POLICY "Allow public insert on contacts"
    ON contacts FOR INSERT
    TO anon
    WITH CHECK (true);

-- ============================================
-- RESEARCH RUNS - Dashboard can read
-- ============================================
CREATE POLICY "Allow public read on research_runs"
    ON research_runs FOR SELECT
    TO anon
    USING (true);

-- ============================================
-- RESEARCH SNAPSHOTS - Dashboard can read
-- ============================================
CREATE POLICY "Allow public read on research_snapshots"
    ON research_snapshots FOR SELECT
    TO anon
    USING (true);

-- ============================================
-- OUTREACH CONTENT - Dashboard can read
-- ============================================
CREATE POLICY "Allow public read on outreach_content"
    ON outreach_content FOR SELECT
    TO anon
    USING (true);

-- ============================================
-- ICP FILTERS - Dashboard can read and manage
-- ============================================
CREATE POLICY "Allow public read on icp_filters"
    ON icp_filters FOR SELECT
    TO anon
    USING (true);

CREATE POLICY "Allow public insert on icp_filters"
    ON icp_filters FOR INSERT
    TO anon
    WITH CHECK (true);
