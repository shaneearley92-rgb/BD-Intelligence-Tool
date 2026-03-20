/**
 * Prospect Search - Apollo-powered contact discovery
 *
 * Two-pass targeted search:
 *   Pass 1: Find CIO, CISO, + 1 wildcard C-suite (CDO, CAO, CTO, CPO)
 *   Pass 2: Find up to 15 supporting contacts under those three
 *
 * Usage:
 *   COMPANY_NAME="Travelers" COMPANY_DOMAIN="travelers.com" node scripts/prospect-search.js
 *
 * Environment variables:
 *   COMPANY_NAME         - Target company name (required)
 *   COMPANY_DOMAIN       - Target company domain (optional, improves accuracy)
 *   MY_COMPANY_NAME      - Seller company name (optional, used for solution matching)
 *   MAX_CONTACTS         - Max supporting contacts to return (default: 15)
 *   APOLLO_API_KEY       - Apollo API key (required)
 *   ANTHROPIC_API_KEY    - Claude API key (required)
 *   SUPABASE_URL         - Supabase URL (required)
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
// TIER 1 - PRIMARY C-SUITE TARGETS
// These are always the first three contacts we try to find.
// CIO and CISO are mandatory. The wildcard slot picks the
// most relevant C-suite title based on what Apollo returns.
// ============================================
 
const TIER1_MANDATORY = [
    // CIO variants
    'Chief Information Officer',
    'CIO',
    // CISO variants
    'Chief Information Security Officer',
    'CISO',
    'Chief Security Officer',
    'CSO',
];
 
const TIER1_WILDCARD = [
    // One of these will be selected as the third C-suite target
    'Chief Digital Officer',
    'CDO',
    'Chief AI Officer',
    'CAIO',
    'Chief Technology Officer',
    'CTO',
    'Chief Data Officer',
    'Chief Product Officer',
    'CPO',
    'Chief Operating Officer',
    'COO',
];
 
// ============================================
// TIER 2 - SUPPORTING CONTACTS (max 15)
// Directors and VPs who work under the Tier 1 execs.
// ============================================
 
const TIER2_TITLES = [
    'VP Security',
    'VP Information Security',
    'VP Identity',
    'VP Cybersecurity',
    'VP Technology',
    'VP Engineering',
    'VP AI',
    'VP Artificial Intelligence',
    'VP Digital',
    'Director Security',
    'Director Information Security',
    'Director Identity',
    'Director Cybersecurity',
    'Director AI',
    'Director Artificial Intelligence',
    'Director Machine Learning',
    'Director Identity Access Management',
    'Director IAM',
    'Director Digital Transformation',
    'Head of Security',
    'Head of Identity',
    'Head of AI',
    'Head of Cybersecurity',
    'Head of Digital',
    'Security Architect',
    'Identity Architect',
    'Manager Identity',
    'Manager IAM',
    'Manager Security Operations',
    'Manager Cybersecurity',
];
 
const TIER2_KEYWORDS = [
    'identity',
    'security',
    'IAM',
    'zero trust',
    'cybersecurity',
    'AI',
    'artificial intelligence',
    'machine learning',
    'digital transformation',
];
 
// ============================================
// SELLER COMPANY PROFILES
// Used for solution-to-pain-point matching in AI analysis.
// Add your company here to get matched insights.
// ============================================
 
const SELLER_PROFILES = {
    saviynt: {
        name: 'Saviynt',
        solutions: [
            'Identity Governance and Administration (IGA)',
            'Privileged Access Management (PAM)',
            'Non-Human Identity (NHI) security',
            'External Identity Management',
            'AI Agent Security',
            'Cloud Security',
            'Application Access Governance',
        ],
        painPoints: [
            'Legacy IGA modernization',
            'Access sprawl and entitlement bloat',
            'Non-human identity and service account risk',
            'Compliance gaps (SOX, HIPAA, PCI)',
            'Cloud identity complexity',
            'Agentic AI access governance',
            'Third-party and contractor access risk',
        ],
        differentiators: [
            'Cloud-native IGA platform',
            'Converged IGA + PAM in a single platform',
            'AI-powered access recommendations',
            'Pre-built connectors for 500+ applications',
        ],
    },
    // Add more seller profiles here as needed
};
 
function getSellerProfile(myCompanyName) {
    if (!myCompanyName) return null;
    const key = myCompanyName.toLowerCase().trim();
    return SELLER_PROFILES[key] || null;
}
 
// ============================================
// MAIN PROSPECT SEARCH
// ============================================
 
async function searchProspects(companyName, companyDomain, options = {}) {
    const {
        maxSupportingContacts = 15,
        myCompanyName = null,
    } = options;
 
    const sellerProfile = getSellerProfile(myCompanyName);
 
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Prospect Search: ${companyName}`);
    console.log(`Domain: ${companyDomain || 'N/A'}`);
    console.log(`Seller: ${myCompanyName || 'Not specified'}`);
    console.log(`Structure: 3 C-suite + up to ${maxSupportingContacts} supporting`);
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
 
    // ============================================
    // PASS 1: FIND C-SUITE TIER 1 (CIO + CISO + 1 wildcard)
    // ============================================
 
    console.log('\n--- Pass 1: C-Suite Targets (CIO, CISO + wildcard) ---');
 
    let tier1Contacts = [];
 
    try {
        const result = await apollo.searchContacts({
            companyName,
            domain: companyDomain || undefined,
            seniorities: ['c_suite'],
            perPage: 25,
            page: 1,
        });
 
        const allCSuite = result.people || [];
        console.log(`  Found ${allCSuite.length} C-suite candidates`);
 
        // Find CIO
        const cio = findBestMatch(allCSuite, [
            'chief information officer', 'cio'
        ]);
        if (cio) {
            cio._tier = 'tier1';
            cio._role = 'CIO';
            tier1Contacts.push(cio);
            console.log(`  ✓ CIO: ${cio.name} — ${cio.title}`);
        } else {
            console.log(`  ✗ CIO: not found`);
        }
 
        // Find CISO
        const ciso = findBestMatch(allCSuite, [
            'chief information security officer', 'ciso',
            'chief security officer', 'cso'
        ], [cio?.id]);
        if (ciso) {
            ciso._tier = 'tier1';
            ciso._role = 'CISO';
            tier1Contacts.push(ciso);
            console.log(`  ✓ CISO: ${ciso.name} — ${ciso.title}`);
        } else {
            console.log(`  ✗ CISO: not found`);
        }
 
        // Find wildcard C-suite (CDO, CAO, CTO, CPO, COO)
        const usedIds = tier1Contacts.map(c => c.id);
        const wildcard = findBestMatch(allCSuite,
            TIER1_WILDCARD.map(t => t.toLowerCase()),
            usedIds
        );
        if (wildcard) {
            wildcard._tier = 'tier1';
            wildcard._role = 'Wildcard C-Suite';
            tier1Contacts.push(wildcard);
            console.log(`  ✓ Wildcard: ${wildcard.name} — ${wildcard.title}`);
        } else {
            console.log(`  ✗ Wildcard C-suite: not found`);
        }
 
    } catch (err) {
        console.error(`  Pass 1 failed: ${err.message}`);
    }
 
    console.log(`  Tier 1 total: ${tier1Contacts.length} contacts`);
 
    // ============================================
    // PASS 2: FIND SUPPORTING CONTACTS (Tier 2, max 15)
    // ============================================
 
    console.log(`\n--- Pass 2: Supporting Contacts (max ${maxSupportingContacts}) ---`);
 
    let tier2Contacts = [];
 
    try {
        const result = await apollo.searchContacts({
            companyName,
            domain: companyDomain || undefined,
            seniorities: ['vp', 'director', 'manager'],
            perPage: 25,
            page: 1,
        });
 
        const candidates = result.people || [];
        console.log(`  Found ${candidates.length} VP/Director/Manager candidates`);
 
        // Score each candidate against Tier 2 title and keyword lists
        const titlePatterns = TIER2_TITLES.map(t => t.toLowerCase());
        const keywordPatterns = TIER2_KEYWORDS.map(k => k.toLowerCase());
        const tier1Ids = tier1Contacts.map(c => c.id);
 
        const scored = candidates
            .filter(c => !tier1Ids.includes(c.id)) // don't duplicate tier1
            .map(c => {
                const titleLower = (c.title || '').toLowerCase();
                const headlineLower = (c.headline || '').toLowerCase();
                let score = 0;
 
                for (const pattern of titlePatterns) {
                    if (titleLower.includes(pattern)) { score += 10; break; }
                }
                for (const kw of keywordPatterns) {
                    if (titleLower.includes(kw) || headlineLower.includes(kw)) { score += 5; break; }
                }
                if (c.seniority === 'vp') score += 3;
                else if (c.seniority === 'director') score += 2;
                else if (c.seniority === 'manager') score += 1;
 
                return { ...c, _score: score, _tier: 'tier2', _role: 'Supporting' };
            })
            .filter(c => c._score > 0) // only relevant contacts
            .sort((a, b) => b._score - a._score)
            .slice(0, maxSupportingContacts);
 
        tier2Contacts = scored;
        console.log(`  Selected ${tier2Contacts.length} supporting contacts`);
 
    } catch (err) {
        console.error(`  Pass 2 failed: ${err.message}`);
    }
 
    // ============================================
    // COMBINE ALL CONTACTS
    // ============================================
 
    const allContacts = [...tier1Contacts, ...tier2Contacts];
    console.log(`\nTotal contacts: ${allContacts.length} (${tier1Contacts.length} C-suite + ${tier2Contacts.length} supporting)`);
 
    if (allContacts.length === 0) {
        console.log('No contacts found. Check Apollo API or company name.');
        return { company, contacts: [], analysis: null };
    }
 
    // ============================================
    // REVEAL CONTACTS (get emails + LinkedIn)
    // ============================================
 
    const missingData = allContacts.some(c => !c.email || !c.linkedinUrl || !c.lastName);
    if (missingData) {
        console.log('\n--- Revealing Contacts (email/LinkedIn/full name) ---');
        const revealed = await apollo.revealContacts(allContacts, companyName);
        // Merge revealed data back
        for (let i = 0; i < allContacts.length; i++) {
            const rev = revealed.find(r => r.id === allContacts[i].id);
            if (rev) {
                allContacts[i] = { ...allContacts[i], ...rev };
                // Update name if reveal returned a more complete name
                if (rev.firstName && rev.lastName) {
                    allContacts[i].name = `${rev.firstName} ${rev.lastName}`.trim();
                }
            }
        }
    }
 
    // ============================================
    // STORE CONTACTS IN SUPABASE
    // ============================================
 
    console.log('\n--- Storing Contacts ---');
    const storedContacts = [];
 
    for (const c of allContacts) {
        console.log(`  [${c._role}] ${c.name} | ${c.title} | email: ${c.email || 'none'}`);
 
        const { data: existing } = await supabase
            .from('contacts')
            .select('id')
            .eq('company_id', company.id)
            .eq('name', c.name)
            .single();
 
        const contactData = {
            name: c.name,
            title: c.title,
            email: c.email || null,
            phone: c.phone || null,
            linkedin_url: c.linkedinUrl || null,
            seniority: c.seniority,
            department: c.departments?.[0] || null,
            enrichment_source: 'apollo',
            enrichment_data: {
                firstName: c.firstName || '',
                lastName: c.lastName || '',
                headline: c.headline || '',
                departments: c.departments || [],
                city: c.city || '',
                state: c.state || '',
                country: c.country || '',
                company: c.company || '',
                companyDomain: c.companyDomain || '',
                tier: c._tier,
                role: c._role,
                score: c._score || null,
                source: 'apollo_search',
                enrichedAt: new Date().toISOString(),
            },
        };
 
        if (existing) {
            const { data: updated } = await supabase
                .from('contacts')
                .update({ ...contactData, updated_at: new Date().toISOString() })
                .eq('id', existing.id)
                .select()
                .single();
            if (updated) storedContacts.push(updated);
        } else {
            const { data: inserted, error } = await supabase
                .from('contacts')
                .insert({ company_id: company.id, ...contactData })
                .select()
                .single();
 
            if (error) {
                console.error(`  Failed to store ${c.name}: ${error.message}`);
            } else {
                storedContacts.push(inserted);
            }
        }
    }
 
    console.log(`Stored ${storedContacts.length} contacts`);
 
    // ============================================
    // AI ANALYSIS - solution-matched insights
    // ============================================
 
    console.log('\n--- AI Analysis ---');
    const analysis = await analyzeProspects(company, allContacts, sellerProfile);
 
    if (analysis) {
        await supabase.from('research_snapshots').insert({
            company_id: company.id,
            source: 'prospect_analysis',
            title: `Prospect Analysis: ${companyName}`,
            summary: analysis.executiveSummary,
            signals: {
                tier1Contacts: analysis.tier1Contacts,
                tier2Contacts: analysis.tier2Contacts,
                solutionAlignment: analysis.solutionAlignment,
                recommendations: analysis.recommendations,
            },
        });
        console.log('Analysis stored as research snapshot');
    }
 
    // ============================================
    // PRINT SUMMARY
    // ============================================
 
    console.log(`\n${'='.repeat(60)}`);
    console.log('PROSPECT SEARCH COMPLETE');
    console.log(`${'='.repeat(60)}`);
    console.log(`Company: ${companyName}`);
    console.log(`C-Suite targets: ${tier1Contacts.length}`);
    console.log(`Supporting contacts: ${tier2Contacts.length}`);
    console.log(`Total stored: ${storedContacts.length}`);
 
    if (analysis) {
        console.log('\n--- EXECUTIVE SUMMARY ---');
        console.log(analysis.executiveSummary);
 
        if (analysis.tier1Contacts?.length) {
            console.log('\n--- C-SUITE TARGETS ---');
            analysis.tier1Contacts.forEach((c, i) => {
                console.log(`  ${i + 1}. ${c.name} — ${c.title}`);
                console.log(`     Pain: ${c.likelyPain}`);
                console.log(`     Our solution: ${c.sellerSolution}`);
                console.log(`     Approach: ${c.engagementApproach}`);
            });
        }
 
        if (analysis.solutionAlignment?.length) {
            console.log('\n--- SOLUTION ALIGNMENT ---');
            analysis.solutionAlignment.forEach((a, i) => {
                console.log(`  ${i + 1}. ${a.pain} → ${a.solution}`);
                console.log(`     Confidence: ${a.confidence}`);
            });
        }
    }
 
    return { company, contacts: storedContacts, analysis };
}
 
// ============================================
// HELPER: Find best title match from a list
// ============================================
 
function findBestMatch(contacts, titlePatterns, excludeIds = []) {
    return contacts.find(c => {
        if (excludeIds.includes(c.id)) return false;
        const titleLower = (c.title || '').toLowerCase();
        return titlePatterns.some(p => titleLower.includes(p));
    }) || null;
}
 
// ============================================
// AI ANALYSIS
// ============================================
 
async function analyzeProspects(company, contacts, sellerProfile) {
    const tier1 = contacts.filter(c => c._tier === 'tier1');
    const tier2 = contacts.filter(c => c._tier === 'tier2');
 
    const formatContact = c =>
        `- [${c._role}] ${c.name}, ${c.title} (${c.seniority || 'N/A'}) ${c.headline ? `— "${c.headline}"` : ''}`;
 
    const sellerContext = sellerProfile
        ? `
SELLER COMPANY: ${sellerProfile.name}
Solutions: ${sellerProfile.solutions.join(', ')}
Pain points we solve: ${sellerProfile.painPoints.join(', ')}
Differentiators: ${sellerProfile.differentiators.join(', ')}`
        : 'No seller profile provided — provide general insights.';
 
    const systemPrompt = `You are a senior sales intelligence analyst. Analyze contacts at a target company and map their likely pain points to the seller's solutions. Be specific and actionable.`;
 
    const userPrompt = `Analyze these contacts at ${company.name} and map their pain points to the seller's solutions.
 
${sellerContext}
 
TIER 1 — C-SUITE TARGETS:
${tier1.map(formatContact).join('\n') || 'None found'}
 
TIER 2 — SUPPORTING CONTACTS:
${tier2.map(formatContact).join('\n') || 'None found'}
 
Respond ONLY with valid JSON (no markdown, no preamble):
{
    "executiveSummary": "2-3 sentences on the identity/security landscape at this company and the best opportunity for the seller",
    "tier1Contacts": [
        {
            "name": "...",
            "title": "...",
            "role": "CIO|CISO|Wildcard",
            "likelyPain": "specific pain point this person likely owns",
            "sellerSolution": "which seller solution maps to this pain",
            "engagementApproach": "one sentence on how to open the conversation"
        }
    ],
    "tier2Contacts": [
        {
            "name": "...",
            "title": "...",
            "likelyPain": "...",
            "sellerSolution": "...",
            "reportingLine": "likely reports to which tier1 contact"
        }
    ],
    "solutionAlignment": [
        {
            "pain": "target company pain point",
            "solution": "seller solution that maps to it",
            "confidence": "high|medium|low",
            "evidence": "what signals this pain exists"
        }
    ],
    "recommendations": [
        {
            "action": "specific next step",
            "priority": "high|medium|low",
            "targetContact": "name"
        }
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
    const myCompanyName = process.env.MY_COMPANY_NAME || 'saviynt';
    const maxContacts = parseInt(process.env.MAX_CONTACTS || '15');
 
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
 
    try {
        await searchProspects(companyName, companyDomain, {
            maxSupportingContacts: maxContacts,
            myCompanyName,
        });
    } catch (err) {
        console.error(`Prospect search failed: ${err.message}`);
        console.error(err.stack);
        process.exit(1);
    }
}
 
main();
 
module.exports = { searchProspects };
