import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

// A unique file prevents a worker loading this module from deleting the database used by the
// already-running API process. The repository ignores SQLite files, so abandoned test files are
// harmless and never become another run's accounts.
const database = process.env.WORKOUT_TEST_DATABASE
  ? resolve(process.env.WORKOUT_TEST_DATABASE)
  : resolve('tests', `.e2e-${randomUUID()}.db`);
const webPort = process.env.WORKOUT_TEST_WEB_PORT || '5182';
const apiPort = process.env.WORKOUT_TEST_API_PORT || '5183';
const openAiPort = process.env.WORKOUT_TEST_OPENAI_PORT || '5184';
const identityPort = process.env.WORKOUT_TEST_IDP_PORT || '5185';
const apiArtifacts = process.env.WORKOUT_TEST_API_ARTIFACTS || resolve('..', 'artifacts', 'workout-e2e-api');
const runApi = `dotnet run --project ../api/Workout.Api.csproj --artifacts-path "${apiArtifacts}" --no-launch-profile`;

/// The end-to-end suite runs the real API against a disposable database, with the AI provider
/// replaced by a local stand-in so an import can be exercised without a paid call.
export const testServers = [
  { command: `node tests/mock-idp.mjs ${identityPort}`, url: `http://127.0.0.1:${identityPort}/.well-known/openid-configuration`, reuseExistingServer: true, timeout: 30000 },
  { command: `node tests/mock-openai.mjs ${openAiPort}`, url: `http://127.0.0.1:${openAiPort}`, reuseExistingServer: true, timeout: 30000 },
  {
    // The seed command exits when it finishes, so it runs first and the server follows. This
    // exercises the real seeding path rather than inserting catalog rows behind its back.
    command: `${runApi} -- --seed-exercises=${resolve('tests/fixtures/exercises.json')}`
      + ` && ${runApi} -- --urls http://127.0.0.1:${apiPort}`,
    url: `http://127.0.0.1:${apiPort}/health`,
    reuseExistingServer: true,
    timeout: 180000,
    env: {
      WORKOUT_API: `http://127.0.0.1:${apiPort}`,
      ASPNETCORE_ENVIRONMENT: 'Development',
      Database__SqlitePath: database,
      Auth__MaxUsers: '2',
      Identity__Authority: `http://127.0.0.1:${identityPort}`,
      Identity__Issuer: `http://127.0.0.1:${identityPort}`,
      Identity__RequireHttpsMetadata: 'false',
      Identity__ClientId: 'workout-api',
      Identity__ClientSecret: 'workout-secret',
      Identity__RedirectUri: `http://localhost:${webPort}/api/auth/central/callback`,
      Identity__ReturnUrl: '/',
      OpenAi__ApiKey: 'e2e-test-key',
      OpenAi__Model: 'gpt-5.4-mini',
      OpenAi__BaseUrl: `http://127.0.0.1:${openAiPort}/v1/responses`
    }
  },
  {
    command: `node node_modules/vite/bin/vite.js preview --host 0.0.0.0 --port ${webPort} --strictPort`,
    url: `http://localhost:${webPort}`,
    reuseExistingServer: true,
    timeout: 120000,
    env: { WORKOUT_API: `http://127.0.0.1:${apiPort}` }
  }
];
