/**
 * UI Assessment Module
 *
 * Teaches Bob to visualise, read, and assess UI components for:
 *   – Layout structure & responsive behaviour
 *   – Colour contrast & palette harmony
 *   – Accessibility (a11y) compliance
 *   – Human-friendliness & usability heuristics
 *   – Design-system consistency (Tailwind + shadcn/ui)
 *
 * Two analysis modes:
 *   1. Code analysis  – parses JSX/TSX source for Tailwind classes, structure, a11y attrs
 *   2. Image analysis – uses Sharp pixel stats for colour distribution, contrast, whitespace
 */

const sharp = require('sharp');

// ---------------------------------------------------------------------------
// Project design-system reference (FieldOps Manager)
// ---------------------------------------------------------------------------

const DESIGN_SYSTEM = {
  name: 'FieldOps Manager Design System',
  framework: 'React 18 + TypeScript',
  styling: 'Tailwind CSS v3 + shadcn/ui (Radix primitives)',
  themes: ['light', 'dark', 'high-contrast', 'night-patrol'],
  color_tokens: {
    primary:     { hue: 187, saturation: 72, lightness: 37, purpose: 'Brand teal – CTAs, links, focus rings' },
    secondary:   { hue: 190, saturation: 30, lightness: 95, purpose: 'Subtle backgrounds, secondary actions' },
    accent:      { hue: 48,  saturation: 96, lightness: 53, purpose: 'Amber highlights, badges, warnings' },
    destructive: { hue: 0,   saturation: 84, lightness: 60, purpose: 'Error states, destructive actions' },
    muted:       { hue: 190, saturation: 20, lightness: 96, purpose: 'Disabled states, placeholder text' },
    background:  { hue: 0,   saturation: 0,  lightness: 100, purpose: 'Page background' },
    foreground:  { hue: 200, saturation: 20, lightness: 10,  purpose: 'Primary text' },
  },
  border_radius: '0.75rem (lg), calc(radius-2px) (md), calc(radius-4px) (sm)',
  night_patrol: {
    min_button_height: '56px',
    min_input_height: '52px',
    base_font_size: '17px',
    background: 'near-black (3% lightness)',
    primary: 'bright cyan (55% lightness) for maximum legibility',
  },
  breakpoints: { sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px' },
  component_library: 'shadcn/ui: accordion, alert-dialog, badge, breadcrumb, button, calendar, card, carousel, checkbox, collapsible, context-menu, dialog, form, input, label, menubar, navigation-menu, pagination, popover, progress, scroll-area, select, separator, sheet, sidebar, skeleton, slider, sonner, switch, table, tabs, textarea, toast, toaster, toggle, tooltip',
};

// ---------------------------------------------------------------------------
// WCAG contrast helpers
// ---------------------------------------------------------------------------

function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r, g, b) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(lum1, lum2) {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function wcagGrade(ratio) {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA-large';
  return 'fail';
}

// ---------------------------------------------------------------------------
// Tailwind class analysis
// ---------------------------------------------------------------------------

const TAILWIND_PATTERNS = {
  layout: /\b(flex|grid|block|inline|hidden|absolute|relative|fixed|sticky)\b/g,
  spacing: /\b[mp][xytblr]?-\d+\.?\d*\b/g,
  sizing: /\b[wh]-(?:\d+|full|screen|auto|min|max|fit)\b/g,
  responsive: /\b(sm|md|lg|xl|2xl):/g,
  colors: /\b(?:bg|text|border|ring|fill|stroke)-(?:primary|secondary|accent|destructive|muted|background|foreground|card|popover|white|black|gray|slate|zinc|red|orange|amber|yellow|green|teal|cyan|blue|indigo|violet|purple|pink|rose)(?:\/\d+)?(?:-foreground)?\b/g,
  typography: /\b(?:text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)|font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)|leading-\w+|tracking-\w+)\b/g,
  accessibility: /\bsr-only\b|focus:ring|focus-visible:|aria-\w+|role=/g,
  animation: /\b(?:animate-|transition-|duration-|ease-|delay-)\w+\b/g,
  dark_mode: /\bdark:/g,
  rounded: /\brounded(?:-(?:sm|md|lg|xl|2xl|3xl|full|none))?\b/g,
};

function extractTailwindUsage(code) {
  const result = {};
  for (const [category, regex] of Object.entries(TAILWIND_PATTERNS)) {
    const matches = code.match(regex) || [];
    result[category] = { count: matches.length, classes: [...new Set(matches)] };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Code-level analysis
// ---------------------------------------------------------------------------

function analyzeComponentCode(code) {
  const lines = code.split('\n');
  const lineCount = lines.length;

  // Tailwind usage
  const tailwind = extractTailwindUsage(code);

  // Accessibility audit
  const a11y = {
    aria_attributes: (code.match(/aria-\w+/g) || []).length,
    role_attributes: (code.match(/role="/g) || []).length,
    alt_tags: (code.match(/alt="/g) || []).length,
    sr_only: (code.match(/sr-only/g) || []).length,
    focus_management: (code.match(/focus[:-]/g) || []).length,
    semantic_elements: (code.match(/<(?:header|nav|main|footer|section|article|aside|figure|figcaption|details|summary)\b/g) || []).length,
    button_elements: (code.match(/<(?:button|Button)\b/g) || []).length,
    link_elements: (code.match(/<(?:a |Link )\b/g) || []).length,
    form_labels: (code.match(/<(?:label|Label)\b/g) || []).length,
    headings: (code.match(/<h[1-6]\b/g) || []).length,
  };

  // Image handling
  const images = {
    img_tags: (code.match(/<img\b/g) || []).length,
    missing_alt: (code.match(/<img(?![^>]*alt=)[^>]*>/g) || []).length,
    lazy_loading: (code.match(/loading="lazy"/g) || []).length,
  };

  // Layout patterns
  const layout = {
    flex_containers: (code.match(/className="[^"]*\bflex\b/g) || []).length,
    grid_containers: (code.match(/className="[^"]*\bgrid\b/g) || []).length,
    responsive_classes: tailwind.responsive.count,
    dark_mode_classes: tailwind.dark_mode.count,
  };

  // Component usage (shadcn/ui)
  const shadcnComponents = [
    'Button', 'Card', 'Dialog', 'Sheet', 'Tabs', 'Table', 'Badge',
    'Input', 'Textarea', 'Select', 'Checkbox', 'Switch', 'Slider',
    'Toast', 'Tooltip', 'Popover', 'Form', 'Label', 'Separator',
    'ScrollArea', 'Skeleton', 'Progress', 'Accordion', 'Alert',
    'NavigationMenu', 'Breadcrumb', 'Pagination', 'Calendar',
  ];

  const components_used = {};
  for (const comp of shadcnComponents) {
    const regex = new RegExp(`<${comp}[\\s/>]`, 'g');
    const count = (code.match(regex) || []).length;
    if (count > 0) components_used[comp] = count;
  }

  // Scoring
  const scores = computeCodeScores({ a11y, images, layout, tailwind, lineCount, components_used });

  return {
    line_count: lineCount,
    tailwind,
    accessibility: a11y,
    images,
    layout,
    components_used,
    scores,
    recommendations: generateCodeRecommendations({ a11y, images, layout, tailwind, scores }),
  };
}

function computeCodeScores({ a11y, images, layout, tailwind, lineCount, components_used }) {
  const scores = {};

  // Accessibility score (0-100)
  let a11yScore = 50; // base
  if (a11y.aria_attributes > 0) a11yScore += 10;
  if (a11y.role_attributes > 0) a11yScore += 5;
  if (a11y.sr_only > 0) a11yScore += 10;
  if (a11y.focus_management > 0) a11yScore += 10;
  if (a11y.semantic_elements > 0) a11yScore += 10;
  if (a11y.form_labels > 0) a11yScore += 5;
  if (images.missing_alt > 0) a11yScore -= 15 * images.missing_alt;
  scores.accessibility = Math.max(0, Math.min(100, a11yScore));

  // Responsiveness score (0-100)
  let respScore = 30;
  if (tailwind.responsive.count >= 3) respScore += 30;
  else if (tailwind.responsive.count >= 1) respScore += 15;
  if (layout.flex_containers > 0 || layout.grid_containers > 0) respScore += 20;
  if (layout.dark_mode_classes > 0) respScore += 20;
  scores.responsiveness = Math.min(100, respScore);

  // Design consistency score (0-100)
  let consistencyScore = 40;
  const shadcnCount = Object.keys(components_used).length;
  if (shadcnCount >= 3) consistencyScore += 30;
  else if (shadcnCount >= 1) consistencyScore += 15;
  if (tailwind.rounded.count > 0) consistencyScore += 10;
  if (tailwind.colors.count > 0) consistencyScore += 20;
  scores.design_consistency = Math.min(100, consistencyScore);

  // Human-friendliness score (weighted average)
  scores.human_friendliness = Math.round(
    scores.accessibility * 0.35 +
    scores.responsiveness * 0.30 +
    scores.design_consistency * 0.35
  );

  return scores;
}

function generateCodeRecommendations({ a11y, images, layout, tailwind, scores }) {
  const recs = [];

  if (scores.accessibility < 60) {
    recs.push({
      severity: 'high',
      area: 'accessibility',
      message: 'Accessibility score is low. Add ARIA attributes, semantic HTML elements, and focus management.',
    });
  }

  if (images.missing_alt > 0) {
    recs.push({
      severity: 'high',
      area: 'accessibility',
      message: `${images.missing_alt} image(s) missing alt text. All <img> must have descriptive alt attributes.`,
    });
  }

  if (a11y.semantic_elements === 0 && a11y.headings === 0) {
    recs.push({
      severity: 'medium',
      area: 'structure',
      message: 'No semantic HTML or headings found. Use <section>, <header>, <h1>-<h6> for screen reader navigation.',
    });
  }

  if (tailwind.responsive.count === 0) {
    recs.push({
      severity: 'medium',
      area: 'responsiveness',
      message: 'No responsive breakpoint classes found. Add sm:/md:/lg: variants for mobile, tablet, and desktop.',
    });
  }

  if (tailwind.dark_mode.count === 0 && tailwind.colors.count > 0) {
    recs.push({
      severity: 'low',
      area: 'theming',
      message: 'No dark: variants detected. FieldOps uses four themes (light, dark, high-contrast, night-patrol).',
    });
  }

  if (a11y.button_elements > 0 && a11y.focus_management === 0) {
    recs.push({
      severity: 'medium',
      area: 'accessibility',
      message: 'Buttons found but no focus styling. Add focus:ring or focus-visible: classes for keyboard navigation.',
    });
  }

  if (layout.flex_containers === 0 && layout.grid_containers === 0) {
    recs.push({
      severity: 'low',
      area: 'layout',
      message: 'No flex or grid containers detected. Modern layouts should use flexbox/grid for alignment and flow.',
    });
  }

  if (scores.human_friendliness >= 80) {
    recs.push({
      severity: 'info',
      area: 'overall',
      message: 'Good human-friendliness score. Component follows design-system patterns well.',
    });
  }

  return recs;
}

// ---------------------------------------------------------------------------
// Image / screenshot analysis (colour, contrast, whitespace)
// ---------------------------------------------------------------------------

async function analyzeScreenshot(imageBuffer) {
  const metadata = await sharp(imageBuffer).metadata();
  const { width, height, channels, format } = metadata;

  // Resize for faster analysis (max 400px wide)
  const analysisWidth = Math.min(width, 400);
  const scale = analysisWidth / width;
  const analysisHeight = Math.round(height * scale);

  const resized = sharp(imageBuffer)
    .resize(analysisWidth, analysisHeight, { fit: 'inside' })
    .removeAlpha()
    .raw();

  const { data, info } = await resized.toBuffer({ resolveWithObject: true });

  // Compute overall stats
  const stats = await sharp(imageBuffer).stats();
  const avgR = stats.channels?.[0]?.mean ?? 0;
  const avgG = stats.channels?.[1]?.mean ?? 0;
  const avgB = stats.channels?.[2]?.mean ?? 0;

  // Sample pixel distribution for colour analysis
  const colourBuckets = {};
  const pixelCount = info.width * info.height;

  for (let i = 0; i < data.length; i += 3) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Quantize to 6-level buckets (216 total)
    const qr = Math.floor(r / 43);
    const qg = Math.floor(g / 43);
    const qb = Math.floor(b / 43);
    const key = `${qr}-${qg}-${qb}`;
    colourBuckets[key] = (colourBuckets[key] || 0) + 1;
  }

  // Top 10 colours
  const topColours = Object.entries(colourBuckets)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => {
      const [qr, qg, qb] = key.split('-').map(Number);
      return {
        rgb: [qr * 43 + 21, qg * 43 + 21, qb * 43 + 21],
        percentage: Math.round((count / pixelCount) * 1000) / 10,
      };
    });

  // Colour variety (number of distinct buckets > 0.5%)
  const significantBuckets = Object.values(colourBuckets).filter((c) => c / pixelCount > 0.005).length;

  // Whitespace estimation (near-white or near-background pixels)
  let whitePixels = 0;
  for (let i = 0; i < data.length; i += 3) {
    if (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 230) whitePixels++;
  }
  const whitespaceRatio = Math.round((whitePixels / pixelCount) * 1000) / 10;

  // Foreground-background contrast estimate
  const bgLum = relativeLuminance(Math.round(avgR), Math.round(avgG), Math.round(avgB));
  // Assume text is roughly the opposite brightness
  const estimatedTextLum = bgLum > 0.5 ? 0.05 : 0.95;
  const estimatedContrast = contrastRatio(bgLum, estimatedTextLum);
  const contrastGrade = wcagGrade(estimatedContrast);

  // Edge density for visual complexity (Sobel-like via Sharp)
  let edgeDensity = 0;
  try {
    const edgeData = await sharp(imageBuffer)
      .resize(analysisWidth, analysisHeight, { fit: 'inside' })
      .greyscale()
      .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
      .raw()
      .toBuffer();
    let edgeSum = 0;
    for (let i = 0; i < edgeData.length; i++) edgeSum += edgeData[i];
    edgeDensity = Math.round((edgeSum / (edgeData.length * 255)) * 100);
  } catch {
    edgeDensity = null;
  }

  const scores = computeScreenshotScores({
    whitespaceRatio,
    significantBuckets,
    estimatedContrast,
    contrastGrade,
    edgeDensity,
  });

  return {
    dimensions: { width, height, format, channels },
    colour_analysis: {
      average_rgb: [Math.round(avgR), Math.round(avgG), Math.round(avgB)],
      top_colours: topColours,
      colour_variety: significantBuckets,
    },
    whitespace_percentage: whitespaceRatio,
    contrast: {
      estimated_ratio: Math.round(estimatedContrast * 100) / 100,
      wcag_grade: contrastGrade,
    },
    visual_complexity: edgeDensity,
    scores,
    recommendations: generateScreenshotRecommendations({ whitespaceRatio, significantBuckets, estimatedContrast, contrastGrade, edgeDensity, scores }),
  };
}

function computeScreenshotScores({ whitespaceRatio, significantBuckets, estimatedContrast, contrastGrade, edgeDensity }) {
  const scores = {};

  // Colour harmony (0-100): moderate variety is best (too few = monotonous, too many = chaotic)
  if (significantBuckets <= 5) scores.colour_harmony = 40 + significantBuckets * 8;
  else if (significantBuckets <= 15) scores.colour_harmony = 80;
  else if (significantBuckets <= 25) scores.colour_harmony = 80 - (significantBuckets - 15) * 2;
  else scores.colour_harmony = Math.max(30, 60 - significantBuckets);
  scores.colour_harmony = Math.min(100, scores.colour_harmony);

  // Whitespace balance (0-100): 15-40% is ideal for data-dense apps
  if (whitespaceRatio >= 15 && whitespaceRatio <= 40) scores.whitespace_balance = 90;
  else if (whitespaceRatio >= 10 && whitespaceRatio <= 50) scores.whitespace_balance = 70;
  else if (whitespaceRatio < 10) scores.whitespace_balance = 40;
  else scores.whitespace_balance = 50;

  // Contrast (0-100)
  if (contrastGrade === 'AAA') scores.contrast_score = 100;
  else if (contrastGrade === 'AA') scores.contrast_score = 85;
  else if (contrastGrade === 'AA-large') scores.contrast_score = 60;
  else scores.contrast_score = 30;

  // Visual balance (0-100): moderate edge density = clean but not empty
  if (edgeDensity !== null) {
    if (edgeDensity >= 5 && edgeDensity <= 20) scores.visual_balance = 85;
    else if (edgeDensity >= 2 && edgeDensity <= 30) scores.visual_balance = 70;
    else scores.visual_balance = 50;
  } else {
    scores.visual_balance = 60;
  }

  // Overall aesthetics
  scores.aesthetics = Math.round(
    scores.colour_harmony * 0.25 +
    scores.whitespace_balance * 0.25 +
    scores.contrast_score * 0.30 +
    scores.visual_balance * 0.20
  );

  return scores;
}

function generateScreenshotRecommendations({ whitespaceRatio, significantBuckets, estimatedContrast, contrastGrade, edgeDensity, scores }) {
  const recs = [];

  if (contrastGrade === 'fail') {
    recs.push({
      severity: 'high',
      area: 'contrast',
      message: `Estimated contrast ratio ${Math.round(estimatedContrast * 100) / 100}:1 fails WCAG AA. Increase contrast between text and background.`,
    });
  } else if (contrastGrade === 'AA-large') {
    recs.push({
      severity: 'medium',
      area: 'contrast',
      message: 'Contrast passes WCAG AA for large text only. Small text may be hard to read for some users.',
    });
  }

  if (whitespaceRatio < 10) {
    recs.push({
      severity: 'medium',
      area: 'whitespace',
      message: `Only ${whitespaceRatio}% whitespace detected. Increase padding and margins for visual breathing room.`,
    });
  } else if (whitespaceRatio > 50) {
    recs.push({
      severity: 'low',
      area: 'whitespace',
      message: `${whitespaceRatio}% whitespace detected. Consider using the space more effectively with data or visual elements.`,
    });
  }

  if (significantBuckets > 25) {
    recs.push({
      severity: 'medium',
      area: 'colour_harmony',
      message: 'High colour variety detected. Simplify the palette — FieldOps uses teal/amber/destructive-red system.',
    });
  } else if (significantBuckets <= 2) {
    recs.push({
      severity: 'low',
      area: 'colour_harmony',
      message: 'Very limited colour use. Consider using accent colours to draw attention to key actions.',
    });
  }

  if (edgeDensity !== null && edgeDensity > 30) {
    recs.push({
      severity: 'low',
      area: 'visual_complexity',
      message: 'High visual complexity. Simplify layout or increase spacing between elements.',
    });
  }

  if (scores.aesthetics >= 80) {
    recs.push({
      severity: 'info',
      area: 'overall',
      message: 'Good aesthetic balance. The screenshot shows appropriate colour variety, contrast, and whitespace.',
    });
  }

  return recs;
}

// ---------------------------------------------------------------------------
// Colour palette assessment
// ---------------------------------------------------------------------------

function assessColourPalette(colours) {
  // colours: array of { name, hsl: [h,s,l] } or { name, rgb: [r,g,b] }
  if (!Array.isArray(colours) || colours.length === 0) {
    return { error: 'Provide an array of colour objects with name and hsl/rgb values.' };
  }

  const results = [];

  for (let i = 0; i < colours.length; i++) {
    for (let j = i + 1; j < colours.length; j++) {
      const c1 = colours[i];
      const c2 = colours[j];

      let rgb1, rgb2;
      if (c1.hsl) rgb1 = hslToRgb(c1.hsl[0], c1.hsl[1], c1.hsl[2]);
      else if (c1.rgb) rgb1 = c1.rgb;
      else continue;

      if (c2.hsl) rgb2 = hslToRgb(c2.hsl[0], c2.hsl[1], c2.hsl[2]);
      else if (c2.rgb) rgb2 = c2.rgb;
      else continue;

      const lum1 = relativeLuminance(rgb1[0], rgb1[1], rgb1[2]);
      const lum2 = relativeLuminance(rgb2[0], rgb2[1], rgb2[2]);
      const ratio = contrastRatio(lum1, lum2);

      results.push({
        pair: [c1.name || `colour-${i}`, c2.name || `colour-${j}`],
        contrast_ratio: Math.round(ratio * 100) / 100,
        wcag_grade: wcagGrade(ratio),
        suitable_for_text: ratio >= 4.5,
        suitable_for_large_text: ratio >= 3,
      });
    }
  }

  return {
    pair_count: results.length,
    pairs: results,
    design_system_note: 'FieldOps uses HSL CSS variables for theming. Primary is teal (187°), accent is amber (48°), destructive is red (0°).',
  };
}

// ---------------------------------------------------------------------------
// Layout pattern assessment
// ---------------------------------------------------------------------------

const LAYOUT_PATTERNS = {
  dashboard: {
    description: 'Grid of metric cards + table/chart below',
    indicators: ['grid', 'Card', 'Table', 'recharts', 'stat', 'metric'],
    best_practices: [
      'Use grid-cols responsive variants (grid-cols-1 sm:grid-cols-2 lg:grid-cols-4).',
      'Card headers should be concise (one line). Body shows key metric + trend.',
      'Primary action (e.g., export, filter) should be top-right aligned.',
      'Data tables need horizontal scroll on mobile (overflow-x-auto).',
    ],
  },
  form: {
    description: 'Input fields, labels, validation, submit',
    indicators: ['Form', 'Input', 'Label', 'Select', 'Textarea', 'submit', 'onSubmit'],
    best_practices: [
      'Every input needs a visible <Label> — never placeholder-only.',
      'Group related fields with <fieldset> or visual sections.',
      'Show validation errors inline below the field, not in a toast.',
      'Submit button should be prominent (primary colour) and bottom-right.',
      'Consider night-patrol mode: inputs need min-height 52px.',
    ],
  },
  list: {
    description: 'Scrollable list of items with actions',
    indicators: ['ScrollArea', 'map(', 'list', 'forEach', 'Table'],
    best_practices: [
      'Use virtualization for lists >50 items (react-window or TanStack Virtual).',
      'Each row should have a clear primary action (click) and secondary actions (menu).',
      'Empty state should be helpful — suggest how to add items.',
      'Add loading skeletons during data fetch, not spinners.',
    ],
  },
  map_view: {
    description: 'Geographic map with overlays',
    indicators: ['MapContainer', 'Marker', 'latitude', 'longitude', 'leaflet', 'mapbox'],
    best_practices: [
      'Map should fill available space (h-full, flex-1).',
      'Overlays should use semi-transparent fills with solid borders.',
      'Legend should be visible but not obstruct the map.',
      'Mobile: map controls (zoom, layers) need 44px+ touch targets.',
    ],
  },
  detail: {
    description: 'Single entity detail view (record, profile)',
    indicators: ['Badge', 'Tabs', 'Sheet', 'detail', 'profile', 'record'],
    best_practices: [
      'Hero section with entity name, status badge, and primary actions.',
      'Use Tabs for sections (details, history, attachments).',
      'Breadcrumb navigation back to list view.',
      'Destructive actions (delete, archive) should be visually separated.',
    ],
  },
};

function identifyLayoutPattern(code) {
  const lowered = code.toLowerCase();
  const matched = [];

  for (const [pattern, config] of Object.entries(LAYOUT_PATTERNS)) {
    const matchCount = config.indicators.filter((ind) => {
      const regex = new RegExp(ind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      return regex.test(code);
    }).length;

    if (matchCount >= 2) {
      matched.push({ pattern, confidence: Math.min(1, matchCount / config.indicators.length), ...config });
    }
  }

  matched.sort((a, b) => b.confidence - a.confidence);
  return matched;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  DESIGN_SYSTEM,
  analyzeComponentCode,
  analyzeScreenshot,
  assessColourPalette,
  identifyLayoutPattern,
  // Expose helpers for testing
  contrastRatio,
  relativeLuminance,
  hslToRgb,
  wcagGrade,
};
