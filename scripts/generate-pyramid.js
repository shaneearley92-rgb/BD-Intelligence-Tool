const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const companyId = process.env.COMPANY_ID;
  const companyName = process.env.COMPANY_NAME;
  const companyDomain = process.env.COMPANY_DOMAIN || '';

  console.log(`Generating pyramid for: ${companyName}`);

  let researchContext = '';
  try {
    const { data: snapshots } = await supabase
      .from('research_snapshots')
      .select('summary, signals')
      .eq('company_id', companyId)
      .eq('source', 'synthesis')
      .order('created_at', { ascending: false })
      .limit(1);
    if (snapshots?.length) {
      researchContext = JSON.stringify(snapshots[0]).substring(0, 3000);
    }
  } catch (e) {
    console.log('No existing research found, using public knowledge');
  }

  const prompt = `You are a senior enterprise sales strategist. Build a Sales Value Pyramid for ${companyName}${companyDomain ? ' (' + companyDomain + ')' : ''} aligned to Saviynt's identity security platform (IGA, PAM, NHI, External Identity, AI Agent Security).

${researchContext ? 'RESEARCH DATA:\n' + researchContext : 'Use publicly available knowledge about this company.'}

Return ONLY valid JSON, no markdown, no preamble:
{
  "company_meta": "Industry · Size · one key fact",
  "goals": {
    "description": "2 sentences on top-level business objectives",
    "contacts": ["CISO — owns security strategy", "CIO — digital transformation owner"],
    "saviynt_alignment": ["IGA modernization directly supports compliance goals", "Identity governance reduces board-level risk exposure"]
  },
  "strategies": {
    "description": "2 sentences on how they plan to achieve those goals",
    "contacts": ["VP Security Architecture", "Director of Identity & Access"],
    "saviynt_alignment": ["Zero Trust strategy powered by Saviynt IGA", "PAM aligns with privileged access reduction roadmap"]
  },
  "initiatives": {
    "description": "2 sentences on specific funded programs underway",
    "contacts": ["Director of IAM", "IT Security Manager"],
    "saviynt_alignment": ["App Access Governance streamlines ERP/SaaS consolidation", "NHI secures machine identities in cloud migrations"]
  },
  "obstacles": {
    "description": "2 sentences on barriers and pain points",
    "contacts": ["IAM Program Manager", "Compliance & Risk Manager"],
    "saviynt_alignment": ["Saviynt replaces fragmented legacy IGA tools", "Automated certifications cut compliance overhead significantly"]
  },
  "needs": {
    "description": "2 sentences on capabilities needed to overcome obstacles",
    "contacts": ["IT Operations Lead", "Security Analyst"],
    "saviynt_alignment": ["Identity Cloud covers all identity types on one platform", "SaviAI reduces admin effort and accelerates app onboarding"]
  }
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }]
  });

  const raw = response.content[0].text;
  const clean = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean);

  await supabase.from('research_snapshots').insert({
    company_id: companyId,
    source: 'pyramid',
    title: `Sales Value Pyramid — ${companyName}`,
    summary: parsed.company_meta,
    signals: parsed,
  });

  console.log(`Pyramid generated and stored for ${companyName}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
