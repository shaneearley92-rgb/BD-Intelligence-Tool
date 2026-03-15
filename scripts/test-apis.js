/**
 * API Connection Test
 * Tests each API key to verify connectivity before running real searches.
 */

async function testApis() {
    const results = {};

    // 1. Test Supabase
    console.log('\n--- Testing Supabase ---');
    try {
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        const { data, error } = await supabase.from('companies').select('id').limit(1);
        if (error) throw new Error(error.message);
        console.log(`OK - Connected. Query returned ${data.length} row(s).`);
        results.supabase = 'OK';
    } catch (err) {
        console.error(`FAIL - ${err.message}`);
        results.supabase = `FAIL: ${err.message}`;
    }

    // 2. Test Apollo
    console.log('\n--- Testing Apollo ---');
    try {
        const res = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'X-Api-Key': process.env.APOLLO_API_KEY,
            },
            body: JSON.stringify({
                q_organization_name: 'Google',
                person_titles: ['CTO'],
                per_page: 1,
                page: 1,
            }),
        });
        const body = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        const data = JSON.parse(body);
        console.log(`OK - Found ${data.pagination?.total_entries || 0} total entries. Returned ${data.people?.length || 0} person(s).`);
        if (data.people?.[0]) {
            console.log(`  Sample: ${data.people[0].first_name} ${data.people[0].last_name} - ${data.people[0].title}`);
        }
        results.apollo = 'OK';
    } catch (err) {
        console.error(`FAIL - ${err.message}`);
        results.apollo = `FAIL: ${err.message}`;
    }

    // 3. Test Anthropic
    console.log('\n--- Testing Anthropic ---');
    try {
        const Anthropic = require('@anthropic-ai/sdk');
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 50,
            messages: [{ role: 'user', content: 'Reply with exactly: API_TEST_OK' }],
        });
        const text = response.content[0].text;
        console.log(`OK - Response: "${text.trim()}"`);
        results.anthropic = 'OK';
    } catch (err) {
        console.error(`FAIL - ${err.message}`);
        results.anthropic = `FAIL: ${err.message}`;
    }

    // Summary
    console.log(`\n${'='.repeat(40)}`);
    console.log('API TEST SUMMARY');
    console.log(`${'='.repeat(40)}`);
    for (const [api, status] of Object.entries(results)) {
        const icon = status === 'OK' ? 'PASS' : 'FAIL';
        console.log(`  ${icon} | ${api}: ${status}`);
    }

    const failures = Object.values(results).filter(s => s !== 'OK');
    if (failures.length > 0) {
        console.error(`\n${failures.length} API(s) failed. Fix the secrets and retry.`);
        process.exit(1);
    } else {
        console.log('\nAll APIs connected successfully!');
    }
}

testApis();
