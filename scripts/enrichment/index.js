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
        const contactName = `${contact.first_name} ${contact.last_name}`;

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
                name: r.title,
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
// APOLLO PROVIDER (placeholder - uncomment when ready)
// ============================================

/*
class ApolloEnrichmentProvider extends BaseEnrichmentProvider {
    constructor() {
        super('apollo');
        this.apiKey = process.env.APOLLO_API_KEY;
        this.baseUrl = 'https://api.apollo.io/v1';
    }

    async enrichContact(contact, companyName) {
        const contactName = `${contact.first_name} ${contact.last_name}`;

        const res = await fetch(`${this.baseUrl}/people/match`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            },
            body: JSON.stringify({
                api_key: this.apiKey,
                first_name: contact.first_name,
                last_name: contact.last_name,
                organization_name: companyName,
                // domain: companyDomain  // even better if you have it
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
    }

    async searchContacts(criteria) {
        const {
            titles = [],
            companyName,
            industry,
            employeeRange,
            geography = ['United States']
        } = criteria;

        const res = await fetch(`${this.baseUrl}/mixed_people/search`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            },
            body: JSON.stringify({
                api_key: this.apiKey,
                person_titles: titles,
                q_organization_name: companyName || undefined,
                person_seniorities: ['vp', 'c_suite', 'director'],
                organization_industry_tag_ids: industry ? [industry] : undefined,
                organization_num_employees_ranges: employeeRange
                    ? [`${employeeRange[0]},${employeeRange[1]}`]
                    : undefined,
                person_locations: geography,
                page: 1,
                per_page: 25
            })
        });

        if (!res.ok) {
            throw new Error(`Apollo search error: ${res.status}`);
        }

        const data = await res.json();
        return (data.people || []).map(p => ({
            firstName: p.first_name,
            lastName: p.last_name,
            title: p.title,
            company: p.organization?.name,
            email: p.email,
            linkedinUrl: p.linkedin_url,
            seniority: p.seniority,
            source: 'apollo'
        }));
    }

    async getCompanyTechStack(companyDomain) {
        const res = await fetch(`${this.baseUrl}/organizations/enrich`, {
            method: 'GET',
            headers: { 'Cache-Control': 'no-cache' },
            // Apollo uses query params for this endpoint
        });

        // Apollo returns structured technographics data
        // including security vendors, cloud providers, etc.
        const data = await res.json();
        return {
            source: 'apollo',
            structured: true,
            technologies: data.organization?.current_technologies || [],
            techCategories: data.organization?.technology_names || []
        };
    }
}
*/

// ============================================
// PROVIDER FACTORY
// ============================================

function getProvider() {
    // When Apollo is ready, uncomment this:
    // if (process.env.APOLLO_API_KEY) {
    //     return new ApolloEnrichmentProvider();
    // }

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
    ExaEnrichmentProvider
};
