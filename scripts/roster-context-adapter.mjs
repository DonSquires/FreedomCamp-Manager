#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const defaultRosterPath = path.join(workspaceRoot, 'data', 'roster-active-shifts.json');

export async function loadRoster(rosterPath = defaultRosterPath) {
  try {
    const raw = await fs.readFile(rosterPath, 'utf8');
    const json = JSON.parse(raw);
    return Array.isArray(json.shifts) ? json.shifts : [];
  } catch {
    return [];
  }
}

function isShiftActive(shift, atIso) {
  if (!shift?.startAt || !shift?.endAt) return false;
  const at = new Date(atIso).getTime();
  return at >= new Date(shift.startAt).getTime() && at <= new Date(shift.endAt).getTime();
}

function classifyJobType(assignment = '') {
  const value = assignment.toLowerCase();
  if (value.includes('site security') || value.includes('private client') || value.includes('asset protection')) {
    return 'private-client';
  }
  if (value.includes('freedom camping') || value.includes('enforcement')) {
    return 'enforcement';
  }
  if (value.includes('patrol')) {
    return 'patrol';
  }
  return 'general';
}

export async function resolveJobContext({ officerId, atIso = new Date().toISOString(), rosterPath = defaultRosterPath }) {
  const shifts = await loadRoster(rosterPath);
  const active = shifts.find((shift) => shift.officerId === officerId && isShiftActive(shift, atIso));

  if (!active) {
    return {
      officerId,
      status: 'off-shift',
      type: 'general',
      assignment: 'Unassigned',
      clientId: null,
      source: path.relative(workspaceRoot, rosterPath),
    };
  }

  return {
    officerId,
    status: 'active',
    type: classifyJobType(active.assignment),
    assignment: active.assignment,
    clientId: active.clientId || null,
    patrolZoneId: active.patrolZoneId || null,
    specialistZoneId: active.specialistZoneId || null,
    source: path.relative(workspaceRoot, rosterPath),
  };
}

const args = process.argv.slice(2);
if (args.length >= 1) {
  const officerId = args[0];
  const atIso = args[1] || new Date().toISOString();
  const context = await resolveJobContext({ officerId, atIso });
  console.log(JSON.stringify(context, null, 2));
}
