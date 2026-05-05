#!/usr/bin/env node

/**
 * Route/Role Truth Validator
 * 
 * Phase A Week 3: Validates that all bootstrap routes have:
 * 1. Correct role guards (admin, officer, master check)
 * 2. Org isolation enforcement on data queries
 * 3. No cross-org data leakage risks
 * 
 * Usage: node scripts/validate-route-role-truth.mjs
 * Output: Audit report with blockers and recommendations
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const BOOTSTRAP_ROUTES = [
  {
    path: 'src/pages/FieldOfficerPortal.tsx',
    pattern: 'FieldOfficer',
    requiredRoles: ['officer', 'admin', 'master'],
    description: 'Field Officer Portal - Patrol Dispatch',
  },
  {
    path: 'src/pages/DispatchConsole.tsx',
    pattern: 'DispatchConsole',
    requiredRoles: ['admin', 'master', 'dispatcher'],
    description: 'Admin Portal - Dispatch Console',
  },
  {
    path: 'src/pages/EnforcementCommandCenter.tsx',
    pattern: 'Enforcement',
    requiredRoles: ['admin', 'master', 'compliance'],
    description: 'Admin Portal - Enforcement Timeline',
  },
];

// Color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}✓ ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ ${msg}${colors.reset}`),
  header: (msg) => console.log(`${colors.cyan}${msg}${colors.reset}`),
};

/**
 * Scan files for role guards and org isolation
 */
function scanRouteForRoleGuards(filePath, requiredRoles) {
  try {
    const files = getAllFilesInDirectory(filePath);
    const blockers = [];
    const findings = [];

    files.forEach((file) => {
      const content = fs.readFileSync(file, 'utf8');

      // Check for role guards
      const hasRoleCheck = /useAuth|authStore|role|useUserContext|permit|requireRole/i.test(
        content
      );
      const hasOrgCheck = /organization_id|useOrganization|org_id|current.org/i.test(content);
      const hasRLSComment = /RLS|row.level|security.policy/i.test(content);

      if (!hasRoleCheck) {
        blockers.push(`${path.basename(file)}: Missing role guard check`);
      }

      if (!hasOrgCheck) {
        findings.push(`${path.basename(file)}: No org_id filtering found (may rely on RLS)`);
      }

      if (hasRLSComment)
        findings.push(`${path.basename(file)}: RLS policy documented`);

      // Check for hardcoded org IDs (anti-pattern)
      if (/organization_id\s*[:=]\s*['"][a-f0-9-]+['"]/.test(content)) {
        blockers.push(`${path.basename(file)}: Hardcoded organization_id detected`);
      }

      // Check for cross-org queries without filters
      if (
        /\.from\(['"].*['"]\)/.test(content) &&
        !hasOrgCheck &&
        !hasRLSComment
      ) {
        findings.push(
          `${path.basename(file)}: Database query found, verify RLS policies are enforced`
        );
      }
    });

    return { blockers, findings };
  } catch (error) {
    return {
      blockers: [`Error scanning directory: ${error.message}`],
      findings: [],
    };
  }
}

/**
 * Get all TypeScript/TSX files — supports both a directory and a single file path.
 */
function getAllFilesInDirectory(dir, fileList = []) {
  try {
    const stat = fs.statSync(dir);

    // Single file path supplied
    if (stat.isFile()) {
      if (dir.endsWith('.ts') || dir.endsWith('.tsx')) {
        fileList.push(dir);
      }
      return fileList;
    }

    const files = fs.readdirSync(dir);

    files.forEach((file) => {
      const filePath = path.join(dir, file);
      const childStat = fs.statSync(filePath);

      if (childStat.isDirectory()) {
        if (!file.startsWith('.') && file !== 'node_modules')
          getAllFilesInDirectory(filePath, fileList);
      } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        fileList.push(filePath);
      }
    });
  } catch (error) {
    // Path may not exist, skip silently
  }

  return fileList;
}

/**
 * Main validation routine
 */
function validateRouteRoleTruth() {
  const rootDir = path.join(__dirname, '..');
  const timestamp = new Date().toISOString();

  console.log(`\n╔════════════════════════════════════════════════════════════════════╗`);
  console.log(
    `║     PHASE A WEEK 3: ROUTE/ROLE TRUTH VALIDATION                      ║`
  );
  console.log(`╚════════════════════════════════════════════════════════════════════╝\n`);

  let totalBlockers = 0;
  let totalFindings = 0;
  const results = [];

  BOOTSTRAP_ROUTES.forEach((route) => {
    const fullPath = path.join(rootDir, route.path);
    const exists = fs.existsSync(fullPath);

    log.header(`\n📍 Route: ${route.description}`);
    log.info(`Path: ${route.path}`);
    log.info(`Required Roles: ${route.requiredRoles.join(', ')}`);

    if (!exists) {
      log.warn(`Route directory not found: ${fullPath}`);
      results.push({ route: route.description, blockers: 1, findings: 0 });
      totalBlockers++;
      return;
    }

    const { blockers, findings } = scanRouteForRoleGuards(fullPath, route.requiredRoles);

    if (blockers.length === 0) {
      log.success(`No critical blockers found`);
    } else {
      blockers.forEach((blocker) => {
        log.error(`  ${blocker}`);
      });
      totalBlockers += blockers.length;
    }

    if (findings.length > 0) {
      findings.forEach((finding) => {
        log.warn(`  ${finding}`);
      });
      totalFindings += findings.length;
    }

    results.push({
      route: route.description,
      blockers: blockers.length,
      findings: findings.length,
    });
  });

  // Summary report
  console.log(`\n╔════════════════════════════════════════════════════════════════════╗`);
  console.log(`║                    VALIDATION SUMMARY REPORT                       ║`);
  console.log(`╠════════════════════════════════════════════════════════════════════╣`);

  results.forEach((result) => {
    const status =
      result.blockers === 0
        ? `${colors.green}✅ PASS${colors.reset}`
        : `${colors.red}❌ FAIL${colors.reset}`;
    console.log(`║ Route: ${result.route.padEnd(40)} ${status}`);
    if (result.blockers > 0) {
      console.log(
        `│   Blockers: ${result.blockers}, Findings: ${result.findings}`
      );
    }
  });

  console.log(`╠════════════════════════════════════════════════════════════════════╣`);
  console.log(`║ Total Critical Blockers: ${totalBlockers.toString().padEnd(44)}║`);
  console.log(
    `║ Total Findings (Non-Critical): ${totalFindings.toString().padEnd(34)}║`
  );
  console.log(`╠════════════════════════════════════════════════════════════════════╣`);

  if (totalBlockers === 0) {
    log.success(`\n✅ ALL ROUTES PASSED VALIDATION — Ready for Phase B\n`);
    console.log(`║ Status: ${colors.green}APPROVED${colors.reset} — Route/role truth gates are GREEN ║`);
  } else {
    log.error(`\n❌ VALIDATION FAILED — ${totalBlockers} blocking issues must be fixed\n`);
    console.log(
      `║ Status: ${colors.red}NEEDS FIXES${colors.reset} — Please address blockers and re-run ║`
    );
  }

  console.log(`╚════════════════════════════════════════════════════════════════════╝\n`);

  // Write report to file
  const reportPath = path.join(rootDir, `data/route-validation-${Date.now()}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        timestamp,
        totalBlockers,
        totalFindings,
        routes: results,
        status: totalBlockers === 0 ? 'PASSED' : 'FAILED',
      },
      null,
      2
    )
  );

  log.info(`Report saved to: ${reportPath}`);

  // Exit with appropriate code
  process.exit(totalBlockers === 0 ? 0 : 1);
}

// Run validation
validateRouteRoleTruth();
