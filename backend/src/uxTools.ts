import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { discoverEnvironmentKey } from './intelTools.js';

type SessionStep = {
  screen?: string;
  route?: string;
  action?: string;
  target?: string;
  timestamp?: string;
};

type UxEvaluationResult = {
  target_screen: string;
  path_length_count: number;
  detected_bottleneck: string;
  ux_practicality_score: number;
  proposed_layout_fix: string;
  status: 'RESOLVED_AND_DEPLOYED' | 'PENDING_HUMAN_REVIEW';
  loops_detected: number;
};

function normalizeSteps(sessionLogs: any[]): SessionStep[] {
  if (!Array.isArray(sessionLogs)) {
    return [];
  }

  return sessionLogs.map((entry) => {
    if (entry && typeof entry === 'object') {
      return {
        screen: String((entry as any).screen ?? (entry as any).page ?? '').trim(),
        route: String((entry as any).route ?? (entry as any).path ?? '').trim(),
        action: String((entry as any).action ?? (entry as any).event ?? '').trim(),
        target: String((entry as any).target ?? (entry as any).selector ?? '').trim(),
        timestamp: String((entry as any).timestamp ?? '').trim(),
      };
    }

    const text = String(entry ?? '').trim();
    return { action: text, route: text };
  });
}

function countLoops(steps: SessionStep[]): number {
  if (steps.length < 3) {
    return 0;
  }

  let loops = 0;
  for (let i = 2; i < steps.length; i += 1) {
    const a = steps[i - 2].route || steps[i - 2].screen || '';
    const b = steps[i - 1].route || steps[i - 1].screen || '';
    const c = steps[i].route || steps[i].screen || '';
    if (a && c && a === c && a !== b) {
      loops += 1;
    }
  }

  return loops;
}

function scorePracticality(pathLength: number, loops: number): number {
  const pathPenalty = Math.max(0, pathLength - 3) * 0.12;
  const loopPenalty = loops * 0.15;
  const score = Math.max(0.05, 1 - pathPenalty - loopPenalty);
  return Math.round(score * 100) / 100;
}

async function generateLayoutFix(targetScreen: string, steps: SessionStep[], bottleneck: string): Promise<string> {
  const model = String(
    process.env.DR_BOB_UI_UX_MODEL ?? process.env.BOB_CHAT_MODEL ?? process.env.OLLAMA_CHAT_MODEL ?? 'llama3'
  ).trim();
  const gatewayUrl = String(process.env.MODEL_GATEWAY_URL ?? '').trim().replace(/\/+$/, '');
  const baseUrl = String(process.env.OLLAMA_PROXY_URL ?? 'http://ollama:11434').trim().replace(/\/+$/, '');

  const system = [
    'You are Bob UI/UX Designer agent.',
    'Generate a concise React + Tailwind layout correction for practical navigation flow.',
    'Return plain text only with one actionable recommendation block.',
  ].join('\n');

  const prompt = [
    `Target screen: ${targetScreen}`,
    `Detected bottleneck: ${bottleneck}`,
    `Journey trace: ${JSON.stringify(steps.slice(0, 25))}`,
    'Provide one improved layout recommendation that reduces path length to <= 3 interactions.',
  ].join('\n');

  const requestBody = {
    model,
    system,
    prompt,
    stream: false,
  };

  try {
    if (gatewayUrl) {
      const response = await axios.post(`${gatewayUrl}/api/generate`, requestBody, { timeout: 15000 });
      const text = String((response.data as { response?: string }).response ?? '').trim();
      if (text) return text;
    }

    const fallback = await axios.post(`${baseUrl}/api/generate`, requestBody, { timeout: 15000 });
    const text = String((fallback.data as { response?: string }).response ?? '').trim();
    if (text) return text;
  } catch {
    // Fall through to deterministic recommendation.
  }

  return [
    `Move the primary action for ${targetScreen} into a persistent top-level toolbar button.`,
    'Flatten nested tabs into a two-column layout with a fixed left rail for key destinations.',
    'Use explicit CTA labels and a visible progress breadcrumb to reduce back-tracking loops.',
  ].join(' ');
}

async function getSupabaseAdminClient() {
  const supabaseUrl =
    (await discoverEnvironmentKey('SUPABASE_URL')) ??
    (await discoverEnvironmentKey('VITE_SUPABASE_URL')) ??
    (process.env.SUPABASE_PROJECT_REF ? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co` : null);
  const serviceRoleKey =
    (await discoverEnvironmentKey('SUPABASE_SERVICE_ROLE_KEY')) ??
    (await discoverEnvironmentKey('SERVICE_ROLE_KEY')) ??
    null;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase admin credentials for UX ledger writes.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    realtime: {
      transport: ws as unknown as never,
    },
  });
}

export async function evaluateUserJourneyPracticality(
  sessionLogs: any[],
  context: { sessionId?: string; currentScreen?: string } = {}
): Promise<UxEvaluationResult> {
  const steps = normalizeSteps(sessionLogs);
  const pathLength = steps.length;
  const loopsDetected = countLoops(steps);
  const targetScreen = String(context.currentScreen ?? steps[0]?.screen ?? steps[0]?.route ?? 'unknown-screen').trim() || 'unknown-screen';

  const bottleneck =
    pathLength > 3
      ? 'UI_UX_BOTTLENECK: Path length exceeds practical threshold (>3).'
      : loopsDetected > 0
        ? 'UI_UX_BOTTLENECK: Back-and-forth loop pattern detected.'
        : 'No critical cognitive friction detected.';

  const score = scorePracticality(pathLength, loopsDetected);
  const requiresReview = pathLength > 3 || loopsDetected > 0;
  const proposedFix = await generateLayoutFix(targetScreen, steps, bottleneck);

  const result: UxEvaluationResult = {
    target_screen: targetScreen,
    path_length_count: pathLength,
    detected_bottleneck: bottleneck,
    ux_practicality_score: score,
    proposed_layout_fix: proposedFix,
    status: requiresReview ? 'PENDING_HUMAN_REVIEW' : 'RESOLVED_AND_DEPLOYED',
    loops_detected: loopsDetected,
  };

  const supabase = await getSupabaseAdminClient();
  const sessionId = String(context.sessionId ?? `ux-audit-${Date.now()}`).trim();

  const { error } = await (supabase as any).from('ui_ux_friction_ledger').insert({
    session_id: sessionId,
    target_screen: result.target_screen,
    path_length_count: result.path_length_count,
    detected_bottleneck: result.detected_bottleneck,
    ux_practicality_score: result.ux_practicality_score,
    proposed_layout_fix: result.proposed_layout_fix,
    status: result.status,
  });

  if (error) {
    throw new Error(`Failed to write ui_ux_friction_ledger: ${String(error.message || error)}`);
  }

  return result;
}
