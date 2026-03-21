/**
 * Sales Deck Generator
 *
 * Generates a professional PowerPoint deck showing strategic alignment
 * between the seller company and a target company, using research data.
 *
 * Uses pptxgenjs to create slides with shapes, tables, and professional styling.
 */

const PptxGenJS = require('pptxgenjs');

// ============================================
// BRAND COLOR PRESETS
// ============================================

const BRAND_PRESETS = {
    saviynt: {
        primary: '1E2A4A',
        secondary: 'E8A800',
        accent: '3B5690',
        light: 'F6F4EF',
        text: '1A1714',
        textLight: '4A4640',
    },
    default: {
        primary: '1E2A4A',
        secondary: '2563EB',
        accent: '3B82F6',
        light: 'F8FAFC',
        text: '1E293B',
        textLight: '64748B',
    }
};

function getBrandColors(companyName) {
    const key = (companyName || '').toLowerCase().replace(/[^a-z]/g, '');
    return BRAND_PRESETS[key] || BRAND_PRESETS.default;
}

// ============================================
// LOGO FETCHING
// ============================================

async function fetchLogoBase64(domain) {
    if (!domain) return null;
    const cleanDomain = domain.replace(/https?:\/\//, '').split('/')[0];
    try {
        const res = await fetch(`https://logo.clearbit.com/${cleanDomain}`);
        if (!res.ok) return null;
        const buffer = await res.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        const contentType = res.headers.get('content-type') || 'image/png';
        return `data:${contentType};base64,${base64}`;
    } catch {
        return null;
    }
}

// ============================================
// HELPER: Truncate text
// ============================================

function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max - 3) + '...' : str;
}

// ============================================
// SLIDE BUILDERS
// ============================================

function buildTitleSlide(pres, company, sellerInfo, colors, logos) {
    const slide = pres.addSlide();

    // Dark background
    slide.background = { color: colors.primary };

    // Seller logo (top-left)
    if (logos.seller) {
        slide.addImage({
            data: logos.seller,
            x: 0.6, y: 0.4, w: 1.8, h: 0.8,
            sizing: { type: 'contain', w: 1.8, h: 0.8 },
        });
    } else {
        slide.addText(sellerInfo.name, {
            x: 0.6, y: 0.4, w: 3, h: 0.6,
            fontSize: 18, fontFace: 'Arial', bold: true,
            color: 'FFFFFF', valign: 'middle',
        });
    }

    // Target company logo (top-right)
    if (logos.target) {
        slide.addShape(pres.ShapeType.roundRect, {
            x: 10.5, y: 0.3, w: 2.2, h: 1.0,
            fill: { color: 'FFFFFF' }, rectRadius: 0.1,
        });
        slide.addImage({
            data: logos.target,
            x: 10.6, y: 0.35, w: 2.0, h: 0.9,
            sizing: { type: 'contain', w: 2.0, h: 0.9 },
        });
    }

    // Accent bar
    slide.addShape(pres.ShapeType.rect, {
        x: 0.6, y: 2.8, w: 2.0, h: 0.06,
        fill: { color: colors.secondary },
    });

    // Title text
    slide.addText('STRATEGIC PARTNERSHIP BRIEFING', {
        x: 0.6, y: 1.8, w: 10, h: 0.6,
        fontSize: 11, fontFace: 'Arial',
        color: colors.secondary, letterSpacing: 4, bold: true,
    });

    slide.addText(company.name || 'Target Company', {
        x: 0.6, y: 3.1, w: 10, h: 1.2,
        fontSize: 40, fontFace: 'Arial', bold: true,
        color: 'FFFFFF',
    });

    // Subtitle with industry/details
    const meta = [company.industry, company.employee_count ? `${Number(company.employee_count).toLocaleString()} employees` : null, company.ticker].filter(Boolean).join(' | ');
    if (meta) {
        slide.addText(meta, {
            x: 0.6, y: 4.3, w: 8, h: 0.5,
            fontSize: 13, fontFace: 'Arial',
            color: 'AAAAAA',
        });
    }

    // Date
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    slide.addText(`Prepared ${dateStr}`, {
        x: 0.6, y: 6.5, w: 5, h: 0.4,
        fontSize: 10, fontFace: 'Arial', color: '888888',
    });

    // Confidential notice
    slide.addText('CONFIDENTIAL', {
        x: 10, y: 6.5, w: 2.5, h: 0.4,
        fontSize: 9, fontFace: 'Arial', color: '666666',
        align: 'right', letterSpacing: 2,
    });
}

function buildLandscapeSlide(pres, company, synthesis, colors) {
    const slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };

    // Header bar
    slide.addShape(pres.ShapeType.rect, {
        x: 0, y: 0, w: 13.33, h: 0.9,
        fill: { color: colors.primary },
    });
    slide.addText('MARKET INTELLIGENCE & BUSINESS DRIVERS', {
        x: 0.6, y: 0, w: 10, h: 0.9,
        fontSize: 14, fontFace: 'Arial', bold: true,
        color: 'FFFFFF', valign: 'middle', letterSpacing: 2,
    });
    slide.addText(company.name || '', {
        x: 8, y: 0, w: 4.8, h: 0.9,
        fontSize: 11, fontFace: 'Arial', color: 'AAAAAA',
        align: 'right', valign: 'middle',
    });

    // Company summary
    const summary = truncate(synthesis.companySummary || 'No intelligence data available.', 600);
    slide.addText(summary, {
        x: 0.6, y: 1.2, w: 12, h: 1.2,
        fontSize: 11, fontFace: 'Arial', color: colors.textLight,
        lineSpacingMultiple: 1.5, valign: 'top',
    });

    // Pain points table
    const painPoints = (synthesis.painPoints || []).slice(0, 5);
    if (painPoints.length > 0) {
        slide.addText('KEY PAIN POINTS & EVIDENCE', {
            x: 0.6, y: 2.7, w: 5, h: 0.4,
            fontSize: 10, fontFace: 'Arial', bold: true,
            color: colors.primary, letterSpacing: 1,
        });

        const tableRows = [
            [
                { text: 'Pain Point', options: { bold: true, fontSize: 9, color: 'FFFFFF', fill: { color: colors.primary }, fontFace: 'Arial', align: 'left', valign: 'middle' } },
                { text: 'Evidence', options: { bold: true, fontSize: 9, color: 'FFFFFF', fill: { color: colors.primary }, fontFace: 'Arial', align: 'left', valign: 'middle' } },
            ],
            ...painPoints.map((p, i) => [
                { text: truncate(p.painPoint || p.pain_point || '', 120), options: { fontSize: 9, color: colors.text, fontFace: 'Arial', fill: { color: i % 2 === 0 ? 'F8F8F8' : 'FFFFFF' }, valign: 'top' } },
                { text: truncate(p.evidence || '', 150), options: { fontSize: 9, color: colors.textLight, fontFace: 'Arial', fill: { color: i % 2 === 0 ? 'F8F8F8' : 'FFFFFF' }, valign: 'top' } },
            ]),
        ];

        slide.addTable(tableRows, {
            x: 0.6, y: 3.2, w: 12,
            colW: [4.5, 7.5],
            border: { type: 'solid', pt: 0.5, color: 'E0E0E0' },
            rowH: painPoints.length > 3 ? 0.55 : 0.65,
        });
    }

    // Footer accent
    slide.addShape(pres.ShapeType.rect, {
        x: 0, y: 7.2, w: 13.33, h: 0.06,
        fill: { color: colors.secondary },
    });
}

function buildAlignmentSlide(pres, company, synthesis, sellerInfo, colors) {
    const slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };

    // Header bar
    slide.addShape(pres.ShapeType.rect, {
        x: 0, y: 0, w: 13.33, h: 0.9,
        fill: { color: colors.primary },
    });
    slide.addText('STRATEGIC SOLUTION ALIGNMENT', {
        x: 0.6, y: 0, w: 10, h: 0.9,
        fontSize: 14, fontFace: 'Arial', bold: true,
        color: 'FFFFFF', valign: 'middle', letterSpacing: 2,
    });

    // Two-column layout: Signals (left) + Alignment (right)
    const signals = (synthesis.keySignals || []).slice(0, 4);
    const painPoints = (synthesis.painPoints || []).slice(0, 4);

    // Left column header
    slide.addShape(pres.ShapeType.rect, {
        x: 0.6, y: 1.2, w: 5.5, h: 0.45,
        fill: { color: colors.accent },
        rectRadius: 0.05,
    });
    slide.addText('BUYING SIGNALS DETECTED', {
        x: 0.6, y: 1.2, w: 5.5, h: 0.45,
        fontSize: 10, fontFace: 'Arial', bold: true,
        color: 'FFFFFF', align: 'center', valign: 'middle',
    });

    // Signal cards
    signals.forEach((s, i) => {
        const y = 1.85 + i * 1.2;
        // Accent bar
        slide.addShape(pres.ShapeType.rect, {
            x: 0.6, y, w: 0.08, h: 0.9,
            fill: { color: s.strength === 'high' ? '16A34A' : s.strength === 'medium' ? 'EAB308' : 'AAAAAA' },
        });
        slide.addText(truncate(s.signal || '', 120), {
            x: 0.85, y, w: 5.25, h: 0.5,
            fontSize: 10, fontFace: 'Arial', color: colors.text,
            valign: 'top', lineSpacingMultiple: 1.3,
        });
        slide.addText(`Angle: ${truncate(s.salesAngle || s.sales_angle || '', 80)}`, {
            x: 0.85, y: y + 0.5, w: 5.25, h: 0.35,
            fontSize: 8, fontFace: 'Arial', color: colors.textLight, italic: true,
        });
    });

    // Right column header
    slide.addShape(pres.ShapeType.rect, {
        x: 7, y: 1.2, w: 5.7, h: 0.45,
        fill: { color: colors.secondary },
        rectRadius: 0.05,
    });
    slide.addText(`${sellerInfo.name.toUpperCase()} ALIGNMENT`, {
        x: 7, y: 1.2, w: 5.7, h: 0.45,
        fontSize: 10, fontFace: 'Arial', bold: true,
        color: colors.primary, align: 'center', valign: 'middle',
    });

    // Alignment mapping
    painPoints.forEach((p, i) => {
        const y = 1.85 + i * 1.2;
        // Arrow connector shape
        slide.addShape(pres.ShapeType.rect, {
            x: 7, y, w: 0.08, h: 0.9,
            fill: { color: colors.secondary },
        });
        slide.addText(truncate(p.painPoint || p.pain_point || '', 80), {
            x: 7.25, y, w: 5.45, h: 0.45,
            fontSize: 9, fontFace: 'Arial', bold: true, color: colors.text, valign: 'top',
        });
        slide.addText(truncate(p.solution_alignment || p.solutionAlignment || '', 100), {
            x: 7.25, y: y + 0.4, w: 5.45, h: 0.45,
            fontSize: 9, fontFace: 'Arial', color: '16A34A', italic: true, valign: 'top',
        });
    });

    // Footer accent
    slide.addShape(pres.ShapeType.rect, {
        x: 0, y: 7.2, w: 13.33, h: 0.06,
        fill: { color: colors.secondary },
    });
}

function buildValueSlide(pres, company, synthesis, sellerInfo, colors) {
    const slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };

    // Header bar
    slide.addShape(pres.ShapeType.rect, {
        x: 0, y: 0, w: 13.33, h: 0.9,
        fill: { color: colors.primary },
    });
    slide.addText('COMPETITIVE LANDSCAPE & VALUE PROPOSITION', {
        x: 0.6, y: 0, w: 10, h: 0.9,
        fontSize: 14, fontFace: 'Arial', bold: true,
        color: 'FFFFFF', valign: 'middle', letterSpacing: 2,
    });

    const landscape = synthesis.competitiveLandscape || {};
    const vendors = landscape.knownVendors || [];
    const gaps = landscape.gaps || [];
    const displacements = landscape.displacementOpportunities || [];

    // Left panel: Current Vendor Landscape
    slide.addShape(pres.ShapeType.roundRect, {
        x: 0.6, y: 1.2, w: 5.8, h: 3.2,
        fill: { color: 'F8F8F8' }, line: { color: 'E0E0E0', width: 1 },
        rectRadius: 0.1,
    });
    slide.addText('CURRENT VENDOR LANDSCAPE', {
        x: 0.9, y: 1.35, w: 5.2, h: 0.35,
        fontSize: 10, fontFace: 'Arial', bold: true, color: colors.primary,
        letterSpacing: 1,
    });

    if (vendors.length > 0) {
        vendors.slice(0, 6).forEach((v, i) => {
            const row = Math.floor(i / 3);
            const col = i % 3;
            const x = 0.9 + col * 1.8;
            const y = 1.9 + row * 0.7;
            slide.addShape(pres.ShapeType.roundRect, {
                x, y, w: 1.6, h: 0.5,
                fill: { color: 'FFFFFF' }, line: { color: 'D0D0D0', width: 0.5 },
                rectRadius: 0.05,
            });
            slide.addText(truncate(v, 20), {
                x, y, w: 1.6, h: 0.5,
                fontSize: 9, fontFace: 'Arial', color: colors.text,
                align: 'center', valign: 'middle',
            });
        });
    } else {
        slide.addText('No known vendors identified', {
            x: 0.9, y: 2.0, w: 5.2, h: 0.4,
            fontSize: 10, fontFace: 'Arial', color: colors.textLight, italic: true,
        });
    }

    if (landscape.summary) {
        slide.addText(truncate(landscape.summary, 300), {
            x: 0.9, y: 3.3, w: 5.2, h: 0.9,
            fontSize: 9, fontFace: 'Arial', color: colors.textLight,
            lineSpacingMultiple: 1.4, valign: 'top',
        });
    }

    // Right panel: Displacement Opportunities
    slide.addShape(pres.ShapeType.roundRect, {
        x: 6.8, y: 1.2, w: 5.9, h: 3.2,
        fill: { color: colors.primary }, rectRadius: 0.1,
    });
    slide.addText('DISPLACEMENT OPPORTUNITIES', {
        x: 7.1, y: 1.35, w: 5.3, h: 0.35,
        fontSize: 10, fontFace: 'Arial', bold: true, color: colors.secondary,
        letterSpacing: 1,
    });

    const oppItems = displacements.length > 0 ? displacements : gaps;
    if (oppItems.length > 0) {
        oppItems.slice(0, 4).forEach((item, i) => {
            const y = 1.9 + i * 0.65;
            slide.addShape(pres.ShapeType.rect, {
                x: 7.1, y: y + 0.05, w: 0.06, h: 0.4,
                fill: { color: colors.secondary },
            });
            slide.addText(truncate(typeof item === 'string' ? item : item.opportunity || item.gap || JSON.stringify(item), 120), {
                x: 7.35, y, w: 5.05, h: 0.55,
                fontSize: 10, fontFace: 'Arial', color: 'FFFFFF',
                valign: 'middle', lineSpacingMultiple: 1.3,
            });
        });
    } else {
        slide.addText('Detailed competitive analysis pending', {
            x: 7.1, y: 2.2, w: 5.3, h: 0.4,
            fontSize: 10, fontFace: 'Arial', color: 'AAAAAA', italic: true,
        });
    }

    // Bottom section: Key metrics / signals summary
    slide.addShape(pres.ShapeType.rect, {
        x: 0.6, y: 4.8, w: 12.1, h: 0.06,
        fill: { color: 'E0E0E0' },
    });

    const keyMetrics = (synthesis.keySignals || []).filter(s => s.strength === 'high').slice(0, 3);
    if (keyMetrics.length > 0) {
        slide.addText('HIGH-PRIORITY SIGNALS', {
            x: 0.6, y: 5.1, w: 5, h: 0.3,
            fontSize: 10, fontFace: 'Arial', bold: true, color: colors.primary,
            letterSpacing: 1,
        });
        keyMetrics.forEach((m, i) => {
            const x = 0.6 + i * 4.1;
            slide.addShape(pres.ShapeType.roundRect, {
                x, y: 5.5, w: 3.8, h: 1.3,
                fill: { color: 'F0FFF4' }, line: { color: '86EFAC', width: 1 },
                rectRadius: 0.08,
            });
            slide.addText(truncate(m.signal || '', 100), {
                x: x + 0.15, y: 5.55, w: 3.5, h: 0.7,
                fontSize: 9, fontFace: 'Arial', color: colors.text,
                valign: 'top', lineSpacingMultiple: 1.3,
            });
            slide.addText(`Source: ${truncate(m.source || '', 40)}`, {
                x: x + 0.15, y: 6.3, w: 3.5, h: 0.35,
                fontSize: 8, fontFace: 'Arial', color: colors.textLight, italic: true,
            });
        });
    }

    // Footer accent
    slide.addShape(pres.ShapeType.rect, {
        x: 0, y: 7.2, w: 13.33, h: 0.06,
        fill: { color: colors.secondary },
    });
}

function buildNextStepsSlide(pres, company, synthesis, contacts, sellerInfo, colors) {
    const slide = pres.addSlide();
    slide.background = { color: colors.primary };

    // Title
    slide.addText('RECOMMENDED NEXT STEPS', {
        x: 0.6, y: 0.4, w: 10, h: 0.6,
        fontSize: 11, fontFace: 'Arial', bold: true,
        color: colors.secondary, letterSpacing: 4,
    });
    slide.addShape(pres.ShapeType.rect, {
        x: 0.6, y: 1.1, w: 2.0, h: 0.05,
        fill: { color: colors.secondary },
    });

    slide.addText(`Engagement Roadmap for ${company.name}`, {
        x: 0.6, y: 1.3, w: 10, h: 0.6,
        fontSize: 24, fontFace: 'Arial', bold: true, color: 'FFFFFF',
    });

    // Timeline steps
    const steps = [
        { phase: 'PHASE 1', title: 'Discovery & Alignment', desc: 'Initial outreach to key stakeholders. Validate pain points identified in research. Establish executive sponsorship.' },
        { phase: 'PHASE 2', title: 'Technical Evaluation', desc: 'Present tailored solution architecture. Demonstrate capabilities against identified gaps. Engage technical decision-makers.' },
        { phase: 'PHASE 3', title: 'Business Case & Proposal', desc: 'Quantify ROI based on identified metrics. Build compelling business case for executive buy-in. Present formal proposal.' },
    ];

    steps.forEach((step, i) => {
        const x = 0.6 + i * 4.1;
        // Phase number circle
        slide.addShape(pres.ShapeType.ellipse, {
            x: x + 0.0, y: 2.3, w: 0.55, h: 0.55,
            fill: { color: colors.secondary },
        });
        slide.addText(`${i + 1}`, {
            x: x + 0.0, y: 2.3, w: 0.55, h: 0.55,
            fontSize: 16, fontFace: 'Arial', bold: true,
            color: colors.primary, align: 'center', valign: 'middle',
        });
        // Connector line
        if (i < steps.length - 1) {
            slide.addShape(pres.ShapeType.rect, {
                x: x + 0.65, y: 2.53, w: 3.45, h: 0.04,
                fill: { color: colors.secondary },
            });
        }
        // Phase label
        slide.addText(step.phase, {
            x, y: 3.0, w: 3.8, h: 0.3,
            fontSize: 9, fontFace: 'Arial', bold: true,
            color: colors.secondary, letterSpacing: 2,
        });
        // Title
        slide.addText(step.title, {
            x, y: 3.3, w: 3.8, h: 0.4,
            fontSize: 14, fontFace: 'Arial', bold: true, color: 'FFFFFF',
        });
        // Description
        slide.addText(step.desc, {
            x, y: 3.75, w: 3.8, h: 1.0,
            fontSize: 10, fontFace: 'Arial', color: 'BBBBBB',
            lineSpacingMultiple: 1.4, valign: 'top',
        });
    });

    // Key contacts section
    const tier1 = (contacts || []).filter(c => {
        const ed = c.enrichment_data || {};
        return ed.tier === 'tier1' || ['C-Suite', 'VP'].includes(c.seniority);
    }).slice(0, 4);

    if (tier1.length > 0) {
        slide.addShape(pres.ShapeType.rect, {
            x: 0.6, y: 5.1, w: 12, h: 0.04,
            fill: { color: colors.accent },
        });
        slide.addText('KEY STAKEHOLDERS TO ENGAGE', {
            x: 0.6, y: 5.3, w: 5, h: 0.3,
            fontSize: 10, fontFace: 'Arial', bold: true,
            color: colors.secondary, letterSpacing: 1,
        });

        tier1.forEach((c, i) => {
            const x = 0.6 + i * 3.1;
            slide.addShape(pres.ShapeType.roundRect, {
                x, y: 5.8, w: 2.8, h: 1.0,
                fill: { color: colors.accent }, rectRadius: 0.08,
            });
            slide.addText(truncate(c.name, 30), {
                x: x + 0.15, y: 5.85, w: 2.5, h: 0.4,
                fontSize: 11, fontFace: 'Arial', bold: true, color: 'FFFFFF',
            });
            slide.addText(truncate(c.title || '', 40), {
                x: x + 0.15, y: 6.25, w: 2.5, h: 0.4,
                fontSize: 9, fontFace: 'Arial', color: 'CCCCCC',
            });
        });
    }

    // Footer
    slide.addText(`Prepared by ${sellerInfo.name} | ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`, {
        x: 0.6, y: 6.9, w: 12, h: 0.4,
        fontSize: 9, fontFace: 'Arial', color: '666666', align: 'center',
    });
}

// ============================================
// MAIN GENERATOR
// ============================================

/**
 * Generate a sales deck PowerPoint file and upload to Supabase Storage.
 *
 * @param {Object} company - Company record from Supabase
 * @param {Object} synthesis - Synthesis output (companySummary, keySignals, painPoints, competitiveLandscape)
 * @param {Array} contacts - Array of contact records
 * @param {Object} sellerInfo - { name, url }
 * @param {Object} supabase - Supabase client instance
 * @param {string} runId - Research run ID
 * @returns {Object} { url, fileName }
 */
async function generateSalesDeck(company, synthesis, contacts, sellerInfo, supabase, runId) {
    console.log(`[Deck] Generating sales deck for ${company.name}, branded to ${sellerInfo.name}`);

    const colors = getBrandColors(sellerInfo.name);

    // Fetch logos in parallel
    const sellerDomain = (sellerInfo.url || '').replace(/https?:\/\//, '').split('/')[0];
    const targetDomain = (company.domain || '').replace(/https?:\/\//, '').split('/')[0];

    const [sellerLogo, targetLogo] = await Promise.all([
        fetchLogoBase64(sellerDomain),
        fetchLogoBase64(targetDomain),
    ]);
    const logos = { seller: sellerLogo, target: targetLogo };

    console.log(`[Deck] Logos: seller=${sellerLogo ? 'loaded' : 'none'}, target=${targetLogo ? 'loaded' : 'none'}`);

    // Create presentation
    const pres = new PptxGenJS();
    pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 inches
    pres.author = sellerInfo.name;
    pres.subject = `Strategic Partnership Briefing — ${company.name}`;
    pres.title = `${sellerInfo.name} x ${company.name}`;

    // Build slides
    buildTitleSlide(pres, company, sellerInfo, colors, logos);
    buildLandscapeSlide(pres, company, synthesis, colors);
    buildAlignmentSlide(pres, company, synthesis, sellerInfo, colors);
    buildValueSlide(pres, company, synthesis, sellerInfo, colors);
    buildNextStepsSlide(pres, company, synthesis, contacts, sellerInfo, colors);

    // Generate buffer
    const buffer = await pres.write({ outputType: 'nodebuffer' });
    console.log(`[Deck] Generated PPTX: ${(buffer.length / 1024).toFixed(1)} KB`);

    // Upload to Supabase Storage
    const fileName = `sales-decks/${company.id}/${runId}.pptx`;
    const { data: uploadData, error: uploadError } = await supabase.storage
        .from('research-assets')
        .upload(fileName, buffer, {
            contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            upsert: true,
        });

    if (uploadError) {
        throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
        .from('research-assets')
        .getPublicUrl(fileName);

    const downloadUrl = urlData.publicUrl;

    // Store reference in research_snapshots
    await supabase.from('research_snapshots').insert({
        company_id: company.id,
        source: 'sales_deck',
        title: `Sales Deck: ${sellerInfo.name} x ${company.name}`,
        summary: `Strategic partnership briefing for ${company.name}, branded to ${sellerInfo.name}`,
        signals: {
            url: downloadUrl,
            fileName,
            sellerCompany: sellerInfo.name,
            slidesGenerated: 5,
            generatedAt: new Date().toISOString(),
        },
    });

    console.log(`[Deck] Uploaded to: ${downloadUrl}`);
    return { url: downloadUrl, fileName };
}

module.exports = { generateSalesDeck };
