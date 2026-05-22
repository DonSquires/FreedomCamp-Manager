import axios from 'axios';

export interface AgentPatchConfig {
  projectId: string;
  environmentId: string;
  serviceId: string;
  variableName: string;
  variableValue: string;
}

const RAILWAY_GRAPHQL_ENDPOINT = 'https://backboard.railway.app/graphql/v2';

const VARIABLE_UPSERT_MUTATION = `
  mutation VariableUpsert($input: VariableUpsertInput!) {
    variableUpsert(input: $input)
  }
`;

export async function applyAgentPatch(config: AgentPatchConfig): Promise<void> {
  const token =
    process.env.RAILWAY_API_TOKEN ??
    process.env.RAILWAY_TOKEN ??
    process.env.RAILWAY_CORE_TOKEN ??
    process.env.RAILWAY_STT_TOKEN;
  if (!token) {
    throw new Error('Missing Railway token. Set RAILWAY_API_TOKEN (or RAILWAY_TOKEN)');
  }

  const { projectId, environmentId, serviceId, variableName, variableValue } = config;

  await axios.post(
    RAILWAY_GRAPHQL_ENDPOINT,
    {
      query: VARIABLE_UPSERT_MUTATION,
      variables: {
        input: {
          projectId,
          environmentId,
          serviceId,
          name: variableName,
          value: variableValue,
        },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );
}
