/**
 * Contact Enrichment Layer
 *
 * Provides a unified interface for enriching contacts with additional data.
 * Currently uses Exa as a fallback. When Apollo is added, it slots in here
 * without changing any other code.
 *
 * To add Apollo:
 * 1. Create ./apollo.js with the ApolloProvider class
 * 2. Set APOLLO_API_KEY in environment
 * 3. Change getProvider() to return ApolloProvider when key exists
 */

const exa = require('../fetchers/exa');

// ============================================
// ENRICHMENT PROVIDER INTERFACE
// ============================================

/**
 * Base interface that all enrichment providers implement.
 * Apollo, Clearbit, or any future provider follows this shape.
 */
class BaseEnrichmentProvider {
    constructor(name) {
        this.name = name;
    }

    async enrichContact(contact, companyName) {
        throw new Error('enrichContact() must be implemented');
    }

    async searchContacts(criteria) {
        throw new Error('searchContacts() must be implemented');
    }

    async getCompanyTechStack(companyDomain) {
        throw new Error('getCompanyTechStack() must be implemented');
    }
}

// ============================================
// EXA PROVIDER (default fallback)
// ============================================

class ExaEnrichmentProvider extends BaseEnrichmentProvider {
    constructor() {
        super('exa');
    }

    async enrichContact(contact, companyName) {
        const contactName = contact.name;

        try {
            const results = await exa.searchPersonContent(contactName, companyName);
            const enrichmentData = {
                webMentions: results.slice(0, 5).map(r => ({
                    title: r.title,
                    url: r.url,
                    text: r.text?.substring(0, 500) || '',
                    date: r.publishedDate
                })),
                enrichedAt: new Date().toISOString()
            };

            // Try to extract LinkedIn URL from search results
            const linkedinResult = results.find(r => r.url?.includes('linkedin.com'));

            return {
                ...contact,
                enrichment_data: enrichmentData,
                enrichment_source: 'exa',
                linkedin_url: contact.linkedin_url || linkedinResult?.url || null
            };
        } catch (err) {
            console.error(`[Enrichment/Exa] Failed for ${contactName}:`, err.message);
            return {
                ...contact,
                enrichment_data: { error: err.message, enrichedAt: new Date().toISOString() },
                enrichment_source: 'exa_failed'
            };
        }
    }

    async searchContacts(criteria) {
        // Exa can do basic people search, but not as structured as Apollo
        const { titles = [], companyName, industry } = criteria;
        const query = `${titles.join(' OR ')} at ${companyName || ''} ${industry || ''} cybersecurity`;

        try {
            const results = await exa.search(query, {
                numResults: 10,
                includeDomains: ['linkedin.com']
            });
            return (results.results || []).map(r => ({
                name: parseLinkedInName(r.title),
                url: r.url,
                source: 'exa'
            }));
        } catch (err) {
            console.error('[Enrichment/Exa] Search failed:', err.message);
            return [];
        }
    }

    async getCompanyTechStack(companyDomain) {
        // Exa can surface some tech stack info from web content, but it's not structured
        try {
            const results = await exa.search(
                `${companyDomain} technology stack security tools vendors`,
                { numResults: 3 }
            );
            return {
                source: 'exa',
                structured: false,
                webResults: (results.results || []).map(r => ({
                    title: r.title,
                    text: r.text?.substring(0, 500) || ''
                }))
            };
        } catch (err) {
            console.error('[Enrichment/Exa] Tech stack search failed:', err.message);
            return { source: 'exa', structured: false, webResults: [] };
        }
    }
}

// ============================================
// APOLLO PROVIDER
// ============================================

class ApolloEnrichmentProvider extends BaseEnrichmentProvider {
    constructor() {
        super('apollo');
        this.apiKey = process.env.APOLLO_API_KEY;
        this.baseUrl = 'https://api.apollo.io/api/v1';
    }

    async enrichContact(contact, companyName) {
        const contactName = contact.name;
        const nameParts = contactName.trim().split(/\s+/);
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ');

        try {
            const res = await fetch(`${this.baseUrl}/people/match`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                    'X-Api-Key': this.apiKey
                },
                body: JSON.stringify({
                    api_key: this.apiKey,
                    first_name: firstName,
                    last_name: lastName,
                    organization_name: companyName,
                })
            });

            if (!res.ok) {
                throw new Error(`Apollo API error: ${res.status}`);
            }

            const data = await res.json();
            const person = data.person;

            if (!person) {
                return {
                    ...contact,
                    enrichment_data: { found: false },
                    enrichment_source: 'apollo'
                };
            }

            return {
                ...contact,
                email: person.email || contact.email,
                phone: person.phone_numbers?.[0]?.sanitized_number || contact.phone,
                linkedin_url: person.linkedin_url || contact.linkedin_url,
                title: person.title || contact.title,
                seniority: person.seniority || contact.seniority,
                enrichment_data: {
                    apolloId: person.id,
                    headline: person.headline,
                    departments: person.departments,
                    employmentHistory: person.employment_history,
                    enrichedAt: new Date().toISOString()
                },
                enrichment_source: 'apollo'
            };
        } catch (err) {
            console.error(`[Enrichment/Apollo] Failed for ${contactName}:`, err.message);
            return {
                ...contact,
                enrichment_data: { error: err.message, enrichedAt: new Date().toISOString() },
                enrichment_source: 'apollo_failed'
            };
        }
    }

    async searchContacts(criteria) {
        const {
            titles = [],
            companyName,
            keywords = [],
            seniorities = ['vp', 'c_suite', 'director', 'manager'],
            geography = ['United States'],
            perPage = 25,
            page = 1
        } = criteria;

        const body = {
            api_key: this.apiKey,
            person_titles: titles.length > 0 ? titles : undefined,
            q_organization_name: companyName || undefined,
            organization_domains: criteria.domain ? [criteria.domain] : undefined,
            person_seniorities: seniorities,
            person_locations: geography,
            page,
            per_page: perPage
        };

        console.log(`  Apollo search request: org="${companyName}" domain="${criteria.domain || 'none'}" seniorities=${JSON.stringify(seniorities)} page=${page}`);

        // Use /mixed_people/api_search (Apollo deprecated /mixed_people/search)
        const res = await fetch(`${this.baseUrl}/mixed_people/api_search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'X-Api-Key': this.apiKey
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Apollo search error ${res.status}: ${errText}`);
        }

        const data = await res.json();
        const rawPeople = data.people || data.contacts || [];

        // Debug: log raw response structure
        if (rawPeople.length > 0) {
            const sample = rawPeople[0];
            console.log(`  Apollo returned ${rawPeople.length} results.`);
            console.log(`  Sample top-level keys:`, Object.keys(sample).join(', '));
            console.log(`  Sample name fields: first_name="${sample.first_name}" last_name="${sample.last_name}" name="${sample.name}"`);
            console.log(`  Sample contact fields: email="${sample.email}" linkedin_url="${sample.linkedin_url}"`);
            if (sample.organization) {
                console.log(`  Sample org keys:`, Object.keys(sample.organization).join(', '));
            }
        } else {
            console.log(`  Apollo returned 0 results. Response keys:`, Object.keys(data).join(', '));
            console.log(`  Raw response (first 1000 chars):`, JSON.stringify(data).substring(0, 1000));
            if (data.pagination) {
                console.log(`  Pagination:`, JSON.stringify(data.pagination));
            }
        }

        return {
            people: rawPeople.map(p => {
                // Apollo /api_search returns last_name_obfuscated instead of last_name,
                // and omits email, linkedin_url, phone, city, state etc.
                // These must be retrieved via the /people/match (reveal) endpoint.
                const firstName = (p.first_name || '').trim();
                const lastName = (p.last_name || p.last_name_obfuscated || '').trim();
                const fullName = [firstName, lastName].filter(Boolean).join(' ') || p.name || 'Unknown';
                return {
                    id: p.id || '',
                    firstName,
                    lastName,
                    name: fullName,
                    title: p.title || '',
                    company: p.organization?.name || '',
                    companyDomain: p.organization?.website_url || p.organization?.primary_domain || '',
                    email: p.email || '',
                    phone: p.phone_numbers?.[0]?.sanitized_number || p.sanitized_phone || '',
                    linkedinUrl: p.linkedin_url || '',
                    seniority: p.seniority || '',
                    departments: p.departments || [],
                    headline: p.headline || '',
                    city: p.city || '',
                    state: p.state || '',
                    country: p.country || '',
                    // Flags from /api_search indicating data is available via reveal
                    hasEmail: p.has_email || false,
                    hasPhone: p.has_direct_phone || false,
                    hasCity: p.has_city || false,
                    hasState: p.has_state || false,
                    source: 'apollo'
                };
            }),
            totalEntries: data.pagination?.total_entries || 0,
            page: data.pagination?.page || page,
            totalPages: data.pagination?.total_pages || 1
        };
    }

    /**
     * Enrich/reveal a list of contacts to get email, LinkedIn, full name, etc.
     * Uses Apollo's /people/match endpoint with the Apollo person ID when available,
     * falling back to name + org matching.
     */
    async revealContacts(contacts, companyName) {
        const revealed = [];
        for (const c of contacts) {
            if (c.email && c.linkedinUrl && c.lastName && !c.lastName.includes('*')) {
                revealed.push(c);
                continue;
            }
            try {
                // Prefer Apollo ID for matching (always works).
                // Fall back to name + org if no ID available.
                const matchBody = c.id
                    ? {
                        api_key: this.apiKey,
                        id: c.id,
                        reveal_personal_emails: true,
                        reveal_phone_number: false,
                    }
                    : {
                        api_key: this.apiKey,
                        first_name: c.firstName,
                        last_name: c.lastName,
                        organization_name: companyName,
                        reveal_personal_emails: true,
                        reveal_phone_number: false,
                    };

                const res = await fetch(`${this.baseUrl}/people/match`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache',
                        'X-Api-Key': this.apiKey
                    },
                    body: JSON.stringify(matchBody)
                });

                if (!res.ok) {
                    const errBody = await res.text().catch(() => '');
                    console.warn(`  Reveal failed for ${c.name}: ${res.status} — ${errBody.substring(0, 200)}`);
                    console.warn(`    Match body sent: ${JSON.stringify({ id: matchBody.id, first_name: matchBody.first_name, last_name: matchBody.last_name })}`);
                    revealed.push(c);
                    continue;
                }

                const data = await res.json();
                const person = data.person;
                if (person) {
                    const revealedFirstName = (person.first_name || '').trim() || c.firstName;
                    const revealedLastName = (person.last_name || '').trim() || c.lastName;
                    const revealedFullName = [revealedFirstName, revealedLastName].filter(Boolean).join(' ') || c.name;
                    revealed.push({
                        ...c,
                        firstName: revealedFirstName,
                        lastName: revealedLastName,
                        name: revealedFullName,
                        email: person.email || c.email,
                        linkedinUrl: person.linkedin_url || c.linkedinUrl,
                        phone: person.phone_numbers?.[0]?.sanitized_number || c.phone,
                        title: person.title || c.title,
                        headline: person.headline || c.headline,
                        departments: person.departments || c.departments,
                        city: person.city || c.city,
                        state: person.state || c.state,
                    });
                    console.log(`  Revealed ${revealedFullName}: email=${person.email || 'none'} linkedin=${person.linkedin_url || 'none'}`);
                } else {
                    revealed.push(c);
                }

                // Rate limit: small delay between reveal calls
                await new Promise(r => setTimeout(r, 300));
            } catch (err) {
                console.warn(`  Reveal error for ${c.name}:`, err.message);
                revealed.push(c);
            }
        }
        return revealed;
    }

    async getCompanyTechStack(companyDomain) {
        try {
            const res = await fetch(`${this.baseUrl}/organizations/enrich?domain=${encodeURIComponent(companyDomain)}&api_key=${encodeURIComponent(this.apiKey)}`, {
                method: 'GET',
                headers: {
                    'Cache-Control': 'no-cache',
                    'X-Api-Key': this.apiKey
                },
            });

            if (!res.ok) {
                throw new Error(`Apollo org enrich error: ${res.status}`);
            }

            const data = await res.json();
            return {
                source: 'apollo',
                structured: true,
                technologies: data.organization?.current_technologies || [],
                techCategories: data.organization?.technology_names || []
            };
        } catch (err) {
            console.error('[Enrichment/Apollo] Tech stack failed:', err.message);
            return { source: 'apollo', structured: true, technologies: [], techCategories: [] };
        }
    }
}

// ============================================
// HELPERS
// ============================================

/**
 * Parse a person's name from a LinkedIn page title.
 * LinkedIn titles look like: "Bill O'Hern - VP & CISO at Travelers | LinkedIn"
 * We want just the name part before the first " - " or " | ".
 */
function parseLinkedInName(title) {
    if (!title) return 'Unknown';
    // Strip common LinkedIn suffixes
    let name = title.split(' - ')[0].split(' | ')[0].trim();
    // Remove trailing "| LinkedIn" if split didn't catch it
    name = name.replace(/\s*\|\s*LinkedIn$/i, '').trim();
    return name || 'Unknown';
}

// ============================================
// PROVIDER FACTORY
// ============================================

function getProvider() {
    if (process.env.APOLLO_API_KEY) {
        return new ApolloEnrichmentProvider();
    }

    return new ExaEnrichmentProvider();
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Enrich an array of contacts with additional data
 */
async function enrichContacts(contacts, companyName) {
    const provider = getProvider();
    console.log(`[Enrichment] Using provider: ${provider.name}`);

    const enriched = [];
    for (const contact of contacts) {
        const result = await provider.enrichContact(contact, companyName);
        enriched.push(result);
    }

    return enriched;
}

/**
 * Search for contacts matching ICP criteria
 */
async function searchContacts(criteria) {
    const provider = getProvider();
    return provider.searchContacts(criteria);
}

/**
 * Get tech stack data for a company
 */
async function getCompanyTechStack(companyDomain) {
    const provider = getProvider();
    return provider.getCompanyTechStack(companyDomain);
}

module.exports = {
    enrichContacts,
    searchContacts,
    getCompanyTechStack,
    getProvider,
    BaseEnrichmentProvider,
    ExaEnrichmentProvider,
    ApolloEnrichmentProvider
};
