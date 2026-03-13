/**
 * Exa.ai Fetcher
 *
 * Uses Exa's neural search API to find relevant web content about target companies.
 * Exa returns full page content (not just snippets), making it ideal for AI agents.
 *
 * Key searches:
 * - Company news and press releases
 * - Executive interviews and thought leadership
 * - Cybersecurity incidents and compliance news
 * - Competitor mentions and market positioning
 */

const EXA_API_BASE = 'https://api.exa.ai';

/**
 * Execute an Exa search with full content retrieval
 */
async function search(query, options = {}) {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
        throw new Error('EXA_API_KEY environment variable not set');
    }

    const {
        numResults = 5,
        useAutoprompt = true,
        type = 'auto',           // 'neural', 'keyword', or 'auto'
        startPublishedDate = null,
        includeDomains = [],
        excludeDomains = [],
        includeText = true,       // Return full page text
        maxCharacters = 3000      // Per result
    } = options;

    const body = {
        query,
        numResults,
        useAutoprompt,
        type,
        contents: {
            text: includeText ? { maxCharacters } : undefined,
            highlights: { numSentences: 3 }
        }
    };

    if (startPublishedDate) body.startPublishedDate = startPublishedDate;
    if (includeDomains.length > 0) body.includeDomains = includeDomains;
    if (excludeDomains.length > 0) body.excludeDomains = excludeDomains;

    const res = await fetch(`${EXA_API_BASE}/search`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Exa API error ${res.status}: ${errText}`);
    }

    return res.json();
}

/**
 * Search for company news and press releases
 */
async function searchCompanyNews(companyName, options = {}) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const query = `${companyName} company news announcements`;

    return search(query, {
        numResults: options.numResults || 5,
        startPublishedDate: sixMonthsAgo.toISOString().split('T')[0],
        excludeDomains: ['reddit.com', 'twitter.com'],
        ...options
    });
}

/**
 * Search for cybersecurity-related news about a company
 */
async function searchCyberNews(companyName, options = {}) {
    const queries = [
        `${companyName} cybersecurity data breach security incident`,
        `${companyName} CISO security strategy compliance`
    ];

    const results = [];
    for (const query of queries) {
        try {
            const res = await search(query, {
                numResults: 3,
                startPublishedDate: getDateMonthsAgo(12),
                ...options
            });
            results.push(...(res.results || []));
        } catch (err) {
            console.error(`[Exa] Error searching "${query}":`, err.message);
        }
    }

    // Deduplicate by URL
    const seen = new Set();
    return results.filter(r => {
        if (seen.has(r.url)) return false;
        seen.add(r.url);
        return true;
    });
}

/**
 * Search for executive interviews and thought leadership
 */
async function searchExecutiveContent(companyName, executiveName = null, options = {}) {
    const person = executiveName || `${companyName} CEO CTO CISO`;
    const query = `${person} interview keynote presentation "${companyName}"`;

    return search(query, {
        numResults: 5,
        startPublishedDate: getDateMonthsAgo(12),
        ...options
    });
}

/**
 * Search for a specific person's public content and mentions
 */
async function searchPersonContent(personName, companyName, options = {}) {
    const queries = [
        `"${personName}" "${companyName}" interview`,
        `"${personName}" cybersecurity presentation keynote`,
        `"${personName}" ${companyName} article opinion`
    ];

    const results = [];
    for (const query of queries) {
        try {
            const res = await search(query, {
                numResults: 3,
                startPublishedDate: getDateMonthsAgo(12),
                ...options
            });
            results.push(...(res.results || []));
        } catch (err) {
            console.error(`[Exa] Error searching for person "${query}":`, err.message);
        }
    }

    const seen = new Set();
    return results.filter(r => {
        if (seen.has(r.url)) return false;
        seen.add(r.url);
        return true;
    });
}

/**
 * Find similar companies to a target (competitive intelligence)
 */
async function findSimilarCompanies(companyUrl, options = {}) {
    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
        throw new Error('EXA_API_KEY environment variable not set');
    }

    const res = await fetch(`${EXA_API_BASE}/findSimilar`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
        },
        body: JSON.stringify({
            url: companyUrl,
            numResults: options.numResults || 5,
            contents: {
                text: { maxCharacters: 1000 },
                highlights: { numSentences: 2 }
            }
        })
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Exa findSimilar error ${res.status}: ${errText}`);
    }

    return res.json();
}

/**
 * Main entry point: Research a company via Exa
 */
async function researchCompany(companyName, contacts = []) {
    console.log(`[Exa] Researching: ${companyName}`);

    const results = {
        source: 'exa',
        companyNews: [],
        cyberNews: [],
        executiveContent: [],
        contactContent: {}
    };

    // Run company-level searches in parallel
    try {
        const [newsRes, cyberRes, execRes] = await Promise.all([
            searchCompanyNews(companyName).catch(err => {
                console.error('[Exa] News search failed:', err.message);
                return { results: [] };
            }),
            searchCyberNews(companyName).catch(err => {
                console.error('[Exa] Cyber news search failed:', err.message);
                return [];
            }),
            searchExecutiveContent(companyName).catch(err => {
                console.error('[Exa] Executive search failed:', err.message);
                return { results: [] };
            })
        ]);

        results.companyNews = (newsRes.results || []).map(formatResult);
        results.cyberNews = (Array.isArray(cyberRes) ? cyberRes : (cyberRes.results || [])).map(formatResult);
        results.executiveContent = (execRes.results || []).map(formatResult);
    } catch (err) {
        console.error('[Exa] Company research failed:', err.message);
    }

    // Search for each contact individually
    for (const contact of contacts.slice(0, 3)) { // Limit to 3 contacts to control costs
        const contactName = `${contact.first_name} ${contact.last_name}`;
        try {
            const personResults = await searchPersonContent(contactName, companyName);
            results.contactContent[contactName] = personResults.map(formatResult);
        } catch (err) {
            console.error(`[Exa] Contact search failed for ${contactName}:`, err.message);
            results.contactContent[contactName] = [];
        }
    }

    console.log(`[Exa] Found ${results.companyNews.length} news, ${results.cyberNews.length} cyber, ${results.executiveContent.length} exec articles`);

    return results;
}

// Helpers

function formatResult(result) {
    return {
        title: result.title,
        url: result.url,
        publishedDate: result.publishedDate,
        text: result.text || '',
        highlights: result.highlights || [],
        score: result.score
    };
}

function getDateMonthsAgo(months) {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    return d.toISOString().split('T')[0];
}

module.exports = { researchCompany, search, searchCompanyNews, searchCyberNews, searchExecutiveContent, searchPersonContent, findSimilarCompanies };
