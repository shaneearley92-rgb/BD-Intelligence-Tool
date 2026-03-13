/**
 * Batch Research Runner
 *
 * Processes multiple companies sequentially with configurable delays.
 * Designed to run as a GitHub Action triggered by workflow_dispatch.
 *
 * Input: Comma-separated company IDs or "all_pending"
 * Output: Research runs for each company
 */

const { createClient } = require('@supabase/supabase-js');
const { runResearch } = require('./research-agent');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    const input = process.env.COMPANY_IDS || '';
    const delayBetween = parseInt(process.env.DELAY_SECONDS || '30') * 1000;
    const maxCompanies = parseInt(process.env.MAX_COMPANIES || '10');

    let companyIds = [];

    if (input === 'all_pending' || input === 'all_active') {
        // Fetch companies by research_status
        const status = input === 'all_pending' ? 'prospect' : 'active';
        const { data, error } = await supabase
            .from('companies')
            .select('id, name')
            .eq('research_status', status)
            .limit(maxCompanies);

        if (error) {
            console.error('Failed to fetch companies:', error.message);
            process.exit(1);
        }

        companyIds = (data || []).map(c => ({ id: c.id, name: c.name }));
    } else {
        // Parse comma-separated IDs
        const ids = input.split(',').map(id => id.trim()).filter(Boolean);

        // Fetch company names for logging
        const { data } = await supabase
            .from('companies')
            .select('id, name')
            .in('id', ids);

        companyIds = (data || []).map(c => ({ id: c.id, name: c.name }));
    }

    if (companyIds.length === 0) {
        console.log('No companies to process.');
        return;
    }

    console.log(`\nBatch Research Run`);
    console.log(`Companies: ${companyIds.length}`);
    console.log(`Delay between runs: ${delayBetween / 1000}s`);
    console.log(`${'='.repeat(60)}\n`);

    const results = [];

    for (let i = 0; i < companyIds.length; i++) {
        const { id, name } = companyIds[i];
        console.log(`\n[${i + 1}/${companyIds.length}] Processing: ${name} (${id})`);

        try {
            // Set COMPANY_ID for the research agent
            process.env.COMPANY_ID = id;
            const result = await runResearch(id);
            results.push({ id, name, status: 'completed', runId: result.runId });
            console.log(`✓ Completed: ${name}`);
        } catch (err) {
            results.push({ id, name, status: 'failed', error: err.message });
            console.error(`✗ Failed: ${name} - ${err.message}`);
        }

        // Delay between runs (except after the last one)
        if (i < companyIds.length - 1) {
            console.log(`Waiting ${delayBetween / 1000}s before next run...`);
            await sleep(delayBetween);
        }
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('BATCH SUMMARY');
    console.log(`${'='.repeat(60)}`);
    const completed = results.filter(r => r.status === 'completed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    console.log(`Completed: ${completed}/${companyIds.length}`);
    console.log(`Failed: ${failed}/${companyIds.length}`);

    results.forEach(r => {
        const icon = r.status === 'completed' ? '✓' : '✗';
        console.log(`  ${icon} ${r.name}: ${r.status}${r.error ? ` (${r.error})` : ''}`);
    });

    if (failed > 0) {
        process.exit(1);
    }
}

main();
