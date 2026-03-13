/**
 * Research Agent - Main Pipeline
 *
 * Orchestrates the full research workflow for a target company:
 * 1. Fetch data from all sources (EDGAR, Exa, YouTube)
 * 2. Synthesize findings with Claude
 * 3. Generate all 4 outreach content formats per contact
 * 4. Store everything in Supabase
 *
 * Designed to run inside a GitHub Actions workflow.
 */

const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');
const edgar = require('./fetchers/edgar');
const exa = require('./fetchers/exa');
const youtube = require('./fetchers/youtube');
const { enrichContacts } = require('./enrichment');

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

// ============================================
// MAIN PIPELINE
// ============================================

async function runResearch(companyId) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Starting research for company: ${companyId}`);
    console.log(`${'='.repeat(60)}\n`);

    // 1. Get company and contacts from Supabase
    const { data: company, error: companyErr } = await supabase
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .single();

    if (companyErr || !company) {
        throw new Error(`Company not found: ${companyId}. ${companyErr?.message || ''}`);
    }

    const { data: contacts } = await supabase
        .from('contacts')
        .select('*')
        .eq('company_id', companyId);

    console.log(`Company: ${company.name}`);
    console.log(`Contacts: ${(contacts || []).length}`);

    // 2. Create research run record
    const { data: run, error: runErr } = await supabase
        .from('research_runs')
        .insert({
            company_id: companyId,
            status: 'running',
            triggered_by: process.env.TRIGGER_SOURCE || 'manual',
            github_run_id: process.env.GITHUB_RUN_ID || null,
            started_at: new Date().toISOString()
        })
        .select()
        .single();

    if (runErr) {
        throw new Error(`Failed to create research run: ${runErr.message}`);
    }

    try {
        // 3. Enrich contacts (Apollo-ready, currently uses Exa fallback)
        console.log('\n--- Contact Enrichment ---');
        const enrichedContacts = await enrichContacts(contacts || [], company.name);

        // Update contacts with enrichment data
        for (const contact of enrichedContacts) {
            await supabase
                .from('contacts')
                .update({
                    enrichment_data: contact.enrichment_data,
                    enrichment_source: contact.enrichment_source,
                    email: contact.email || undefined,
                    linkedin_url: contact.linkedin_url || undefined
                })
                .eq('id', contact.id);
        }

        // 4. Fetch data from all sources in parallel
        console.log('\n--- Data Collection ---');
        const [edgarData, exaData, youtubeData] = await Promise.all([
            edgar.researchCompany(company.name, company.ticker_symbol).catch(err => {
                console.error('[Pipeline] EDGAR failed:', err.message);
                return { source: 'edgar', found: false, error: err.message };
            }),
            exa.researchCompany(company.name, contacts || []).catch(err => {
                console.error('[Pipeline] Exa failed:', err.message);
                return { source: 'exa', companyNews: [], cyberNews: [], executiveContent: [] };
            }),
            youtube.researchCompany(company.name, contacts || []).catch(err => {
                console.error('[Pipeline] YouTube failed:', err.message);
                return { source: 'youtube', earningsCalls: [], executiveContent: [], industryAnalysis: [] };
            })
        ]);

        // 5. Update research run with raw data
        await supabase
            .from('research_runs')
            .update({
                edgar_data: edgarData,
                exa_data: exaData,
                youtube_data: youtubeData
            })
            .eq('id', run.id);

        // 6. Synthesize with Claude
        console.log('\n--- AI Synthesis ---');
        const synthesis = await synthesizeResearch(company, contacts || [], edgarData, exaData, youtubeData);

        // 7. Update research run with synthesis
        await supabase
            .from('research_runs')
            .update({
                company_summary: synthesis.companySummary,
                key_signals: synthesis.keySignals,
                pain_points: synthesis.painPoints,
                competitive_landscape: synthesis.competitiveLandscape,
                tokens_used: synthesis.tokensUsed,
                estimated_cost: synthesis.estimatedCost
            })
            .eq('id', run.id);

        // 8. Generate outreach content for each contact
        console.log('\n--- Content Generation ---');
        for (const contact of (contacts || [])) {
            await generateOutreachContent(
                contact, company, synthesis, run.id,
                exaData.contactContent?.[`${contact.first_name} ${contact.last_name}`] || [],
                youtubeData.contactVideos?.[`${contact.first_name} ${contact.last_name}`] || []
            );
        }

        // 9. Mark research run as completed
        await supabase
            .from('research_runs')
            .update({
                status: 'completed',
                completed_at: new Date().toISOString()
            })
            .eq('id', run.id);

        console.log(`\n${'='.repeat(60)}`);
        console.log(`Research completed for ${company.name}`);
        console.log(`Tokens used: ${synthesis.tokensUsed}`);
        console.log(`Estimated cost: $${synthesis.estimatedCost.toFixed(4)}`);
        console.log(`${'='.repeat(60)}\n`);

        return { success: true, runId: run.id };

    } catch (err) {
        // Mark run as failed
        await supabase
            .from('research_runs')
            .update({
                status: 'failed',
                error_message: err.message,
                completed_at: new Date().toISOString()
            })
            .eq('id', run.id);

        throw err;
    }
}

// ============================================
// CLAUDE SYNTHESIS
// ============================================

async function synthesizeResearch(company, contacts, edgarData, exaData, youtubeData) {
    const systemPrompt = `You are a senior sales intelligence analyst supporting a VP of Sales at a cybersecurity company. Your job is to analyze raw research data about a target company and produce actionable intelligence.

Focus areas:
- Cybersecurity posture and gaps (current vendors, compliance requirements, recent incidents)
- Buying signals (budget cycles, leadership changes, regulatory pressure, digital transformation)
- Pain points the VP can address with their cybersecurity solutions
- Competitive landscape (what security tools they already use, displacement opportunities)
- Executive priorities and communication style (based on interviews, talks, filings)

Be specific and actionable. Avoid generic observations. Every insight should connect to a potential sales angle.`;

    const researchPayload = buildResearchPayload(company, contacts, edgarData, exaData, youtubeData);

    const userPrompt = `Analyze this research data for ${company.name} and produce a structured intelligence report.

${researchPayload}

Respond in this exact JSON format:
{
    "companySummary": "2-3 paragraph executive intelligence brief about this company from a cybersecurity sales perspective",
    "keySignals": [
        {"signal": "description of buying signal", "source": "where this was found", "strength": "high|medium|low", "salesAngle": "how to leverage this in outreach"}
    ],
    "painPoints": [
        {"painPoint": "description", "evidence": "what data supports this", "solution_alignment": "how our cybersecurity solutions address this"}
    ],
    "competitiveLandscape": {
        "knownVendors": ["list of security/IT vendors they use"],
        "gaps": ["identified gaps in their security posture"],
        "displacementOpportunities": ["vendors that could be displaced and why"],
        "summary": "1-2 paragraph competitive analysis"
    }
}`;

    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = response.content[0].text;
    const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
    // Claude Sonnet pricing: ~$3/M input + $15/M output
    const estimatedCost = ((response.usage?.input_tokens || 0) * 3 / 1000000) +
                          ((response.usage?.output_tokens || 0) * 15 / 1000000);

    // Parse JSON from response
    let parsed;
    try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch[0]);
    } catch {
        console.error('[Synthesis] Failed to parse Claude response as JSON');
        parsed = {
            companySummary: responseText,
            keySignals: [],
            painPoints: [],
            competitiveLandscape: {}
        };
    }

    return {
        ...parsed,
        tokensUsed,
        estimatedCost
    };
}

// ============================================
// OUTREACH CONTENT GENERATION
// ============================================

async function generateOutreachContent(contact, company, synthesis, runId, contactWebContent, contactVideos) {
    const contactName = `${contact.first_name} ${contact.last_name}`;
    console.log(`Generating outreach for: ${contactName} (${contact.title})`);

    const systemPrompt = `You are an elite sales copywriter for a cybersecurity company's VP of Sales. You write personalized, research-backed outreach that demonstrates deep understanding of the prospect's specific situation.

Key principles:
- Lead with their pain, not your product
- Reference specific, recent events or statements they've made
- Show you've done your homework — cite specific data points from their 10-K, interviews, or news
- Be concise and respectful of their time
- Sound like a peer, not a salesperson
- Every piece of content should feel like it was written specifically for this person, not a template`;

    const contactContext = `
CONTACT: ${contactName}, ${contact.title} at ${company.name}
SENIORITY: ${contact.seniority || 'Unknown'}
LINKEDIN: ${contact.linkedin_url || 'N/A'}

COMPANY INTELLIGENCE:
${synthesis.companySummary}

KEY BUYING SIGNALS:
${JSON.stringify(synthesis.keySignals, null, 2)}

PAIN POINTS:
${JSON.stringify(synthesis.painPoints, null, 2)}

COMPETITIVE LANDSCAPE:
${JSON.stringify(synthesis.competitiveLandscape, null, 2)}

CONTACT-SPECIFIC WEB CONTENT:
${contactWebContent.map(c => `- ${c.title}: ${c.highlights?.join(' ') || c.text?.substring(0, 200)}`).join('\n') || 'No specific content found'}

CONTACT-SPECIFIC VIDEOS:
${contactVideos.map(v => `- ${v.title} (${v.publishedAt}): ${v.transcript?.substring(0, 500) || v.description}`).join('\n') || 'No specific videos found'}
`;

    const contentTypes = [
        {
            type: 'email_draft',
            prompt: `Write a cold email to ${contactName}. Include:
- Subject line (compelling, under 50 chars)
- Body (3-4 short paragraphs max)
- Clear, low-friction CTA
Format as JSON: {"subject": "...", "body": "..."}`
        },
        {
            type: 'linkedin_message',
            prompt: `Write a LinkedIn connection request message (under 300 chars) and a follow-up message (under 1000 chars) to ${contactName}.
Format as JSON: {"connectionRequest": "...", "followUp": "..."}`
        },
        {
            type: 'call_talk_track',
            prompt: `Write a cold call talk track for calling ${contactName}. Include:
- Opening hook (10 seconds)
- 3 discovery questions tailored to their situation
- Key talking points based on their specific pain points
- Objection handling for common cybersecurity sales objections
- Close/next step ask
Format as JSON: {"opener": "...", "discoveryQuestions": ["..."], "talkingPoints": ["..."], "objectionHandling": [{"objection": "...", "response": "..."}], "close": "..."}`
        },
        {
            type: 'executive_briefing',
            prompt: `Write a 1-page executive briefing about ${company.name} for the VP of Sales to review before engaging ${contactName}. Include:
- Company overview (2-3 sentences)
- Why now: Key triggers and timing signals
- Decision maker profile: What we know about ${contactName}'s priorities
- Recommended approach: How to position our solution
- Competitive intelligence: What they're currently using and our advantages
- Suggested meeting agenda if we get a meeting
Format as plain text with clear section headers.`
        }
    ];

    for (const { type, prompt } of contentTypes) {
        try {
            const response = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 2000,
                system: systemPrompt,
                messages: [{
                    role: 'user',
                    content: `${contactContext}\n\n${prompt}`
                }]
            });

            const content = response.content[0].text;

            // Parse metadata if JSON format
            let metadata = {};
            try {
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch && type !== 'executive_briefing') {
                    metadata = JSON.parse(jsonMatch[0]);
                }
            } catch {
                // Non-JSON content is fine for executive briefings
            }

            await supabase
                .from('outreach_content')
                .insert({
                    contact_id: contact.id,
                    company_id: company.id,
                    research_run_id: runId,
                    content_type: type,
                    title: metadata.subject || `${type} for ${contactName}`,
                    content: content,
                    content_metadata: metadata
                });

            console.log(`  ✓ Generated ${type}`);
        } catch (err) {
            console.error(`  ✗ Failed to generate ${type}:`, err.message);
        }
    }
}

// ============================================
// HELPERS
// ============================================

function buildResearchPayload(company, contacts, edgarData, exaData, youtubeData) {
    const sections = [];

    // Company basics
    sections.push(`COMPANY: ${company.name}`);
    sections.push(`Industry: ${company.industry || 'Unknown'}`);
    sections.push(`Employees: ${company.employee_count || 'Unknown'}`);
    sections.push(`Domain: ${company.domain || 'Unknown'}`);
    if (company.tech_stack?.length) {
        sections.push(`Known Tech Stack: ${JSON.stringify(company.tech_stack)}`);
    }

    // SEC EDGAR
    if (edgarData.found) {
        sections.push('\n--- SEC EDGAR DATA ---');
        sections.push(`Ticker: ${edgarData.company?.ticker || 'N/A'}`);
        if (edgarData.filings?.length) {
            sections.push(`Recent Filings: ${edgarData.filings.map(f => `${f.form} (${f.date})`).join(', ')}`);
        }
        if (edgarData.cyberSignals?.found) {
            sections.push(`Cybersecurity Signals (${edgarData.cyberSignals.count} found):`);
            edgarData.cyberSignals.sections.slice(0, 10).forEach(s => {
                sections.push(`  - [${s.keyword}]: ${s.context.substring(0, 300)}`);
            });
        }
        if (edgarData.riskFactors) {
            sections.push(`Risk Factors (excerpt): ${edgarData.riskFactors.substring(0, 3000)}`);
        }
    }

    // Exa web content
    if (exaData.companyNews?.length || exaData.cyberNews?.length) {
        sections.push('\n--- WEB RESEARCH (Exa) ---');
        if (exaData.companyNews?.length) {
            sections.push('Company News:');
            exaData.companyNews.slice(0, 5).forEach(n => {
                sections.push(`  - ${n.title} (${n.publishedDate || 'N/A'}): ${n.text?.substring(0, 500) || n.highlights?.join(' ') || ''}`);
            });
        }
        if (exaData.cyberNews?.length) {
            sections.push('Cybersecurity-Related News:');
            exaData.cyberNews.slice(0, 5).forEach(n => {
                sections.push(`  - ${n.title}: ${n.text?.substring(0, 500) || n.highlights?.join(' ') || ''}`);
            });
        }
        if (exaData.executiveContent?.length) {
            sections.push('Executive Content:');
            exaData.executiveContent.slice(0, 3).forEach(n => {
                sections.push(`  - ${n.title}: ${n.text?.substring(0, 500) || ''}`);
            });
        }
    }

    // YouTube
    if (youtubeData.earningsCalls?.length || youtubeData.executiveContent?.length) {
        sections.push('\n--- YOUTUBE DATA ---');
        if (youtubeData.earningsCalls?.length) {
            sections.push('Earnings Calls / Investor Presentations:');
            youtubeData.earningsCalls.slice(0, 2).forEach(v => {
                sections.push(`  - ${v.title} (${v.publishedAt})`);
                if (v.transcript) {
                    sections.push(`    Transcript: ${v.transcript.substring(0, 2000)}`);
                }
            });
        }
        if (youtubeData.executiveContent?.length) {
            sections.push('Executive Talks / Interviews:');
            youtubeData.executiveContent.slice(0, 2).forEach(v => {
                sections.push(`  - ${v.title} (${v.publishedAt})`);
                if (v.transcript) {
                    sections.push(`    Transcript: ${v.transcript.substring(0, 2000)}`);
                }
            });
        }
    }

    // Contacts
    if (contacts.length) {
        sections.push('\n--- CONTACTS ---');
        contacts.forEach(c => {
            sections.push(`  - ${c.first_name} ${c.last_name}, ${c.title || 'Unknown title'} (${c.seniority || 'Unknown seniority'})`);
        });
    }

    return sections.join('\n');
}

// ============================================
// ENTRY POINT (called by GitHub Actions)
// ============================================

async function main() {
    const companyId = process.env.COMPANY_ID;

    if (!companyId) {
        console.error('COMPANY_ID environment variable is required');
        process.exit(1);
    }

    // Validate required env vars
    const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'ANTHROPIC_API_KEY'];
    const missing = required.filter(v => !process.env[v]);
    if (missing.length > 0) {
        console.error(`Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }

    try {
        const result = await runResearch(companyId);
        console.log(`Research run completed: ${result.runId}`);
    } catch (err) {
        console.error(`Research failed: ${err.message}`);
        console.error(err.stack);
        process.exit(1);
    }
}

main();

module.exports = { runResearch };
