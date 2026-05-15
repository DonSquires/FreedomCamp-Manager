import { Inngest } from 'inngest';

export const inngest = new Inngest({ id: 'bob-enterprise-agent' });

export const bobLongRunningTask = inngest.createFunction(
  { id: 'execute-complex-workflow', triggers: [{ event: 'bob/run.workflow' }] },
  async ({ event, step }) => {
    const payload = event.data || {};

    const analyticsSummary = await step.run('gather-metrics', async () => {
      return {
        totalGrowth: '14.2%',
        healthScore: 'optimal',
        orgId: payload.orgId || null,
      };
    });

    return { success: true, payload: analyticsSummary };
  },
);
