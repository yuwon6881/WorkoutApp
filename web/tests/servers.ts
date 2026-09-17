import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

// A unique file prevents a worker loading this module from deleting the database used by the
// already-running API process. The repository ignores SQLite files, so abandoned test files are
// harmless and never become another run's accounts.
const database = resolve('tests', `.e2e-${randomUUID()}.db`);

/// The end-to-end suite runs the real API against a disposable database, with the AI provider
/// replaced by a local stand-in so an import can be exercised without a paid call.
export const testServers = [
  { command: 'node tests/mock-idp.mjs', url: 'http://127.0.0.1:5185/.well-known/openid-configuration', reuseExistingServer: true, timeout: 30000 },
  { command: 'node tests/mock-openai.mjs', url: 'http://127.0.0.1:5184', reuseExistingServer: true, timeout: 30000 },
  {
    // The seed command exits when it finishes, so it runs first and the server follows. This
    // exercises the real seeding path rather than inserting catalog rows behind its back.
    command: `dotnet run --project ../api/Workout.Api.csproj -- --seed-exercises=${resolve('tests/fixtures/exercises.json')}`
      + ` && dotnet run --project ../api/Workout.Api.csproj --urls http://127.0.0.1:5183`,
    url: 'http://127.0.0.1:5183/health',
    reuseExistingServer: true,
    timeout: 180000,
    env: {
      ASPNETCORE_ENVIRONMENT: 'Development',
      Database__SqlitePath: database,
      Auth__MaxUsers: '2',
      Identity__Authority: 'http://127.0.0.1:5185',
      Identity__Issuer: 'http://127.0.0.1:5185',
      Identity__RequireHttpsMetadata: 'false',
      Identity__ClientId: 'workout-api',
      Identity__ClientSecret: 'workout-secret',
      Identity__RedirectUri: 'http://localhost:5182/api/auth/central/callback',
      Identity__ReturnUrl: '/',
      OpenAi__ApiKey: 'e2e-test-key',
      OpenAi__Model: 'gpt-5.4-mini',
      OpenAi__BaseUrl: 'http://127.0.0.1:5184/v1/responses'
    }
  },
  { command: 'npm run preview', url: 'http://localhost:5182', reuseExistingServer: true, timeout: 120000 }
];
