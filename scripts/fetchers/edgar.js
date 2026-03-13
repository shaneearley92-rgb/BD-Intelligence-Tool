/**
 * SEC EDGAR Fetcher
 *
 * Fetches 10-K filings, 8-K filings, and company data from SEC EDGAR.
 * Completely free, no API key needed. Rate limit: 10 requests/second.
 *
 * Key data extracted:
 * - Risk factors (cybersecurity mentions = buying signals)
 * - Business description
 * - Recent 8-K filings (material events, breaches, executive changes)
 */

const EDGAR_BASE = 'https://efts.sec.gov/LATEST';
const EDGAR_FILING_BASE = 'https://www.sec.gov/cgi-bin/browse-edgar';
const EDGAR_FULL_TEXT = 'https://efts.sec.gov/LATEST/search-index';
const USER_AGENT = 'SalesIntelAgent research@example.com'; // SEC requires identification

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Search for a company by name and get their CIK number
 */
async function findCompanyCIK(companyName) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(companyName)}%22&dateRange=custom&startdt=2023-01-01&forms=10-K`;

    // Try the company tickers endpoint first (more reliable)
    try {
        const tickerRes = await fetch('https://www.sec.gov/files/company_tickers.json', {
            headers: { 'User-Agent': USER_AGENT }
        });
        const tickers = await tickerRes.json();

        const nameNormalized = companyName.toLowerCase().trim();
        for (const [, entry] of Object.entries(tickers)) {
            if (entry.title.toLowerCase().includes(nameNormalized) ||
                nameNormalized.includes(entry.title.toLowerCase())) {
                return {
                    cik: String(entry.cik_str).padStart(10, '0'),
                    ticker: entry.ticker,
                    name: entry.title
                };
            }
        }
    } catch (err) {
        console.error('Error searching company tickers:', err.message);
    }

    return null;
}

/**
 * Search EDGAR by ticker symbol
 */
async function findByTicker(ticker) {
    try {
        const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
            headers: { 'User-Agent': USER_AGENT }
        });
        const tickers = await res.json();

        const tickerUpper = ticker.toUpperCase().trim();
        for (const [, entry] of Object.entries(tickers)) {
            if (entry.ticker === tickerUpper) {
                return {
                    cik: String(entry.cik_str).padStart(10, '0'),
                    ticker: entry.ticker,
                    name: entry.title
                };
            }
        }
    } catch (err) {
        console.error('Error searching by ticker:', err.message);
    }

    return null;
}

/**
 * Get recent filings for a company by CIK
 */
async function getFilings(cik, formTypes = ['10-K', '10-Q', '8-K'], count = 10) {
    await sleep(150); // Respect rate limits

    try {
        const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT }
        });

        if (!res.ok) {
            throw new Error(`EDGAR API returned ${res.status}`);
        }

        const data = await res.json();
        const recent = data.filings?.recent;

        if (!recent) return [];

        const filings = [];
        for (let i = 0; i < recent.form.length && filings.length < count; i++) {
            if (formTypes.includes(recent.form[i])) {
                filings.push({
                    form: recent.form[i],
                    filingDate: recent.filingDate[i],
                    accessionNumber: recent.accessionNumber[i],
                    primaryDocument: recent.primaryDocument[i],
                    description: recent.primaryDocDescription?.[i] || '',
                    url: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${recent.accessionNumber[i].replace(/-/g, '')}/${recent.primaryDocument[i]}`
                });
            }
        }

        return filings;
    } catch (err) {
        console.error('Error fetching filings:', err.message);
        return [];
    }
}

/**
 * Fetch and extract text from a filing document
 * Returns a truncated version suitable for LLM processing
 */
async function getFilingContent(filingUrl, maxChars = 50000) {
    await sleep(150); // Respect rate limits

    try {
        const res = await fetch(filingUrl, {
            headers: { 'User-Agent': USER_AGENT }
        });

        if (!res.ok) {
            throw new Error(`Failed to fetch filing: ${res.status}`);
        }

        let text = await res.text();

        // Strip HTML tags if it's an HTML document
        text = text.replace(/<[^>]*>/g, ' ')
                   .replace(/&nbsp;/g, ' ')
                   .replace(/&amp;/g, '&')
                   .replace(/&lt;/g, '<')
                   .replace(/&gt;/g, '>')
                   .replace(/\s+/g, ' ')
                   .trim();

        // Truncate to max chars
        if (text.length > maxChars) {
            text = text.substring(0, maxChars) + '\n\n[TRUNCATED - Full document available at ' + filingUrl + ']';
        }

        return text;
    } catch (err) {
        console.error('Error fetching filing content:', err.message);
        return null;
    }
}

/**
 * Extract cybersecurity-relevant sections from a 10-K filing
 */
function extractCyberSecuritySignals(filingText) {
    if (!filingText) return { found: false, sections: [] };

    const textLower = filingText.toLowerCase();
    const signals = [];

    const keywords = [
        'cybersecurity', 'cyber security', 'data breach', 'ransomware',
        'incident response', 'information security', 'data protection',
        'security operations', 'threat', 'vulnerability', 'compliance',
        'CISO', 'chief information security', 'SOC', 'SIEM',
        'zero trust', 'endpoint detection', 'EDR', 'XDR',
        'penetration test', 'security audit', 'ISO 27001', 'SOC 2',
        'NIST', 'GDPR', 'CCPA', 'HIPAA', 'PCI DSS',
        'security investment', 'security budget', 'security spending'
    ];

    for (const keyword of keywords) {
        const idx = textLower.indexOf(keyword);
        if (idx !== -1) {
            // Extract surrounding context (200 chars each side)
            const start = Math.max(0, idx - 200);
            const end = Math.min(filingText.length, idx + keyword.length + 200);
            signals.push({
                keyword,
                context: filingText.substring(start, end).trim()
            });
        }
    }

    return {
        found: signals.length > 0,
        count: signals.length,
        sections: signals.slice(0, 20) // Cap at 20 most relevant
    };
}

/**
 * Main entry point: Research a company via EDGAR
 */
async function researchCompany(companyNameOrTicker, tickerSymbol = null) {
    console.log(`[EDGAR] Researching: ${companyNameOrTicker}`);

    // Find the company
    let company = null;
    if (tickerSymbol) {
        company = await findByTicker(tickerSymbol);
    }
    if (!company) {
        company = await findCompanyCIK(companyNameOrTicker);
    }

    if (!company) {
        console.log(`[EDGAR] Company not found: ${companyNameOrTicker}`);
        return {
            source: 'edgar',
            found: false,
            company: companyNameOrTicker,
            error: 'Company not found in EDGAR database. May be private company.'
        };
    }

    console.log(`[EDGAR] Found: ${company.name} (CIK: ${company.cik}, Ticker: ${company.ticker})`);

    // Get recent filings
    const filings = await getFilings(company.cik, ['10-K', '8-K'], 5);
    console.log(`[EDGAR] Found ${filings.length} recent filings`);

    // Get the most recent 10-K content for cyber analysis
    const tenK = filings.find(f => f.form === '10-K');
    let cyberSignals = { found: false, sections: [] };
    let riskFactors = null;

    if (tenK) {
        console.log(`[EDGAR] Fetching 10-K from ${tenK.filingDate}...`);
        const content = await getFilingContent(tenK.url, 80000);
        if (content) {
            cyberSignals = extractCyberSecuritySignals(content);
            console.log(`[EDGAR] Found ${cyberSignals.count || 0} cybersecurity signals`);

            // Extract risk factors section
            const riskStart = content.toLowerCase().indexOf('risk factors');
            if (riskStart !== -1) {
                riskFactors = content.substring(riskStart, riskStart + 10000).trim();
            }
        }
    }

    return {
        source: 'edgar',
        found: true,
        company: {
            name: company.name,
            cik: company.cik,
            ticker: company.ticker
        },
        filings: filings.map(f => ({
            form: f.form,
            date: f.filingDate,
            description: f.description,
            url: f.url
        })),
        cyberSignals,
        riskFactors: riskFactors ? riskFactors.substring(0, 5000) : null
    };
}

module.exports = { researchCompany, findCompanyCIK, findByTicker, getFilings };
