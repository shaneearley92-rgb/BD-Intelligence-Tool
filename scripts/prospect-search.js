/**
 * Prospect Search - Apollo-powered contact discovery
 *
 * Searches Apollo for key leaders at a target company matching specific
 * criteria (titles, departments, keywords), then enriches with AI analysis
 * to surface buying signals and project insights.
 *
 * Usage:
 *   COMPANY_NAME="Travelers" COMPANY_DOMAIN="travelers.com" node scripts/prospect-search.js
 *
 * Environment variables:
 *   COMPANY_NAME      - Target company name (required)
 *   COMPANY_DOMAIN    - Target company domain (optional, improves accuracy)
 *   SEARCH_TITLES     - Comma-separated titles to search (optional, has defaults)
 *   SEARCH_KEYWORDS   - Comma-separated keywords (optional, has defaults)
 *   MAX_CONTACTS      - Max contacts to return (default: 50)
 *   APOLLO_API_KEY    - Apollo API key (required)
 *   ANTHROPIC_API_KEY - Claude API key (required for AI analysis)
 *   SUPABASE_URL      - Supabase URL (required)
 *   SUPABASE_SERVICE_KEY - Supabase service key (required)
 */

const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const { ApolloEnrichmentProvider } = require('./enrichment');

// ============================================
// INITIALIZATION
// ============================================

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const apollo = new ApolloEnrichmentProvider();

// ============================================
// DEFAULT SEARCH CRITERIA FOR IDENTITY/SECURITY + AI
// ============================================

const DEFAULT_TITLES = [
    'CISO',
    'Chief Information Security Officer',
    'Chief Security Officer',
    'Chief Information Officer',
    'Chief Technology Officer',
    'VP Security',
    'VP Information Security',
    'VP Identity',
    'VP Cybersecurity',
    'VP Technology',
    'VP Engineering',
    'VP AI',
    'VP Artificial Intelligence',
    'Director Security',
    'Director Information Security',
    'Director Identity',
    'Director Cybersecurity',
    'Director AI',
    'Director Artificial Intelligence',
    'Director Machine Learning',
    'Director Identity Access Management',
    'Director IAM',
    'Head of Security',
    'Head of Identity',
    'Head of AI',
    'Head of Cybersecurity',
    'Security Architect',
    'Identity Architect',
    'AI Security',
    'Manager Identity',
    'Manager IAM',
    'Manager Security Operations',
    'Manager Cybersecurity',
];

const DEFAULT_KEYWORDS = [
    'identity',
    'security',
    'AI',
    'artificial intelligence',
    'agentic',
    'machine learning',
    'IAM',
    'zero trust',
    'cybersecurity',
];

// ============================================
// MAIN PROSPECT SEARCH
// ============================================

async function searchProspects(companyName, companyDomain, options = {}) {
    const {
        titles = DEFAULT_TITLES,
        keywords = DEFAULT_KEYWORDS,
        maxContacts = 50,
    } = options;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Prospect Search: ${companyName}`);
    console.log(`Domain: ${companyDomain || 'N/A'}`);
    console.log(`Target: ${maxContacts} contacts`);
    console.log(`${'='.repeat(60)}\n`);

    // 1. Ensure company exists in Supabase
    let { data: company } = await supabase
        .from('companies')
        .select('*')
        .eq('name', companyName)
        .single();

    if (!company) {
        console.log(`Creating company record for ${companyName}...`);
        const { data: newCompany, error } = await supabase
            .from('companies')
            .insert({
                name: companyName,
                domain: companyDomain || null,
                research_status: 'active',
            })
            .select()
            .single();

        if (error) throw new Error(`Failed to create company: ${error.message}`);
        company = newCompany;
    }

    console.log(`Company ID: ${company.id}`);

    // 2. Search Apollo for contacts across multiple pages
    console.log('\n--- Apollo Contact Search ---');
    const allContacts = [];
    const perPage = Math.min(maxContacts, 25); // Apollo max per_page is 25 in some tiers
    const totalPages = Math.ceil(maxContacts / perPage);

    for (let page = 1; page <= totalPages && allContacts.length < maxContacts; page++) {
        console.log(`  Fetching page ${page}/${totalPages}...`);

        try {
            const result = await apollo.searchContacts({
                companyName,
                titles,
                keywords,
                seniorities: ['c_suite', 'vp', 'director', 'manager'],
                perPage,
                page,
            });

            if (result.people.length === 0) {
                console.log(`  No more results on page ${page}`);
                break;
            }

            allContacts.push(...result.people);
            console.log(`  Found ${result.people.length} contacts (total: ${allContacts.length} / ${result.totalEntries} available)`);

            // Respect rate limits
            if (page < totalPages) {
                await new Promise(r => setTimeout(r, 500));
            }
        } catch (err) {
            console.error(`  Page ${page} failed:`, err.message);
            break;
        }
    }

    // Trim to max
    const contacts = allContacts.slice(0, maxContacts);
    console.log(`\nTotal contacts found: ${contacts.length}`);

    if (contacts.length === 0) {
        console.log('No contacts found. Check your search criteria.');
        return { company, contacts: [], analysis: null };
    }

    // 3. Store contacts in Supabase
    console.log('\n--- Storing Contacts ---');
    const storedContacts = [];

    for (const c of contacts) {
        // Check if contact already exists
        const { data: existing } = await supabase
            .from('contacts')
            .select('id')
            .eq('company_id', company.id)
            .eq('name', c.name)
            .single();

        if (existing) {
            // Update existing
            const { data: updated } = await supabase
                .from('contacts')
                .update({
                    title: c.title,
                    email: c.email,
                    linkedin_url: c.linkedinUrl,
                    seniority: c.seniority,
                    department: c.departments?.[0] || null,
                    enrichment_source: 'apollo',
                    enrichment_data: {
                        headline: c.headline,
                        departments: c.departments,
                        city: c.city,
                        state: c.state,
                        source: 'apollo_search',
                        enrichedAt: new Date().toISOString()
                    },
                    updated_at: new Date().toISOString(),
                })
                .eq('id', existing.id)
                .select()
                .single();
            storedContacts.push(updated);
        } else {
            // Insert new
            const { data: inserted, error } = await supabase
                .from('contacts')
                .insert({
                    company_id: company.id,
                    name: c.name,
                    title: c.title,
                    email: c.email,
                    linkedin_url: c.linkedinUrl,
                    seniority: c.seniority,
                    department: c.departments?.[0] || null,
                    enrichment_source: 'apollo',
                    enrichment_data: {
                        headline: c.headline,
                        departments: c.departments,
                        city: c.city,
                        state: c.state,
                        source: 'apollo_search',
                        enrichedAt: new Date().toISOString()
                    },
                })
                .select()
                .single();

            if (error) {
                console.error(`  Failed to store ${c.name}:`, error.message);
            } else {
                storedContacts.push(inserted);
            }
        }
    }

    console.log(`Stored ${storedContacts.length} contacts in Supabase`);

    // 4. AI Analysis - Generate insights about these contacts and signals
    console.log('\n--- AI Analysis ---');
    const analysis = await analyzeProspects(company, contacts);

    // 5. Store analysis as a research snapshot
    if (analysis) {
        await supabase.from('research_snapshots').insert({
            company_id: company.id,
            source: 'prospect_analysis',
            title: `Prospect Analysis: ${companyName} - Identity/Security + AI Leaders`,
            summary: analysis.executiveSummary,
            signals: {
                keyContacts: analysis.keyContacts,
                aiSignals: analysis.aiSignals,
                projectInsights: analysis.projectInsights,
                recommendations: analysis.recommendations,
            },
        });
        console.log('Analysis stored as research snapshot');
    }

    // 6. Print summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('PROSPECT SEARCH COMPLETE');
    console.log(`${'='.repeat(60)}`);
    console.log(`Company: ${companyName}`);
    console.log(`Contacts found: ${contacts.length}`);
    console.log(`Contacts stored: ${storedContacts.length}`);
    console.log();

    if (analysis) {
        console.log('--- EXECUTIVE SUMMARY ---');
        console.log(analysis.executiveSummary);
        console.log();

        if (analysis.keyContacts?.length) {
            console.log('--- KEY CONTACTS TO TARGET ---');
            analysis.keyContacts.forEach((kc, i) => {
                console.log(`  ${i + 1}. ${kc.name} - ${kc.title}`);
                console.log(`     Why: ${kc.reason}`);
            });
            console.log();
        }

        if (analysis.aiSignals?.length) {
            console.log('--- AI / AGENTIC AI SIGNALS ---');
            analysis.aiSignals.forEach((s, i) => {
                console.log(`  ${i + 1}. ${s.signal}`);
                console.log(`     Evidence: ${s.evidence}`);
            });
            console.log();
        }

        if (analysis.projectInsights?.length) {
            console.log('--- PROJECT INSIGHTS ---');
            analysis.projectInsights.forEach((p, i) => {
                console.log(`  ${i + 1}. ${p.project}`);
                console.log(`     Status: ${p.status}`);
                console.log(`     Relevance: ${p.relevance}`);
            });
        }
    }

    return { company, contacts: storedContacts, analysis };
}

// ============================================
// AI ANALYSIS
// ============================================

async function analyzeProspects(company, contacts) {
    const contactSummary = contacts.map(c =>
        `- ${c.name}, ${c.title} (${c.seniority || 'N/A'}) [${c.departments?.join(', ') || 'N/A'}] ${c.headline ? `- "${c.headline}"` : ''} ${c.linkedinUrl ? `- LinkedIn: ${c.linkedinUrl}` : ''}`
    ).join('\n');

    const systemPrompt = `You are a senior sales intelligence analyst specializing in cybersecurity and AI/identity solutions. Analyze a list of contacts at a target company to identify key decision makers, AI and agentic AI signals, and project insights relevant to identity and security.

Focus on:
- Who are the most important contacts to engage first and why
- Any signals of AI, agentic AI, or machine learning initiatives in identity/security
- Active projects related to identity management, IAM, zero trust, or security transformation
- Organizational structure insights (who reports to whom, team dynamics)
- Budget and decision-making authority indicators`;

    const userPrompt = `Analyze these ${contacts.length} contacts at ${company.name} (${company.domain || 'N/A'}).

CONTACTS:
${contactSummary}

Produce a JSON response with:
{
    "executiveSummary": "2-3 paragraph overview of the identity/security/AI landscape at this company based on the leadership team found",
    "keyContacts": [
        {"name": "...", "title": "...", "reason": "why this person is a priority target", "engagementApproach": "suggested approach"}
    ],
    "aiSignals": [
        {"signal": "description of AI/agentic AI indicator", "evidence": "what suggests this from titles/roles/structure", "strength": "high|medium|low"}
    ],
    "projectInsights": [
        {"project": "likely project or initiative name", "status": "likely status", "relevance": "how this connects to identity/security AI", "keyPeople": ["names involved"]}
    ],
    "organizationalInsights": "analysis of org structure, reporting lines, and team dynamics",
    "recommendations": [
        {"action": "specific recommended next step", "priority": "high|medium|low", "targetContact": "name"}
    ]
}`;

    try {
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4000,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }]
        });

        const responseText = response.content[0].text;
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        return JSON.parse(jsonMatch[0]);
    } catch (err) {
        console.error('[Analysis] Failed:', err.message);
        return null;
    }
}

// ============================================
// ENTRY POINT
// ============================================

async function main() {
    const companyName = process.env.COMPANY_NAME;
    const companyDomain = process.env.COMPANY_DOMAIN || '';

    if (!companyName) {
        console.error('COMPANY_NAME environment variable is required');
        process.exit(1);
    }

    const required = ['APOLLO_API_KEY', 'ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
    const missing = required.filter(v => !process.env[v]);
    if (missing.length > 0) {
        console.error(`Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }

    const titles = process.env.SEARCH_TITLES
        ? process.env.SEARCH_TITLES.split(',').map(t => t.trim())
        : DEFAULT_TITLES;

    const keywords = process.env.SEARCH_KEYWORDS
        ? process.env.SEARCH_KEYWORDS.split(',').map(k => k.trim())
        : DEFAULT_KEYWORDS;

    const maxContacts = parseInt(process.env.MAX_CONTACTS || '50');

    try {
        await searchProspects(companyName, companyDomain, {
            titles,
            keywords,
            maxContacts,
        });
    } catch (err) {
        console.error(`Prospect search failed: ${err.message}`);
        console.error(err.stack);
        process.exit(1);
    }
}

main();

module.exports = { searchProspects };
