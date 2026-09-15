import { createServer } from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';

const port = parseInt(process.env.PORT || process.argv[2] || '5185', 10);
const host = process.env.HOST || '127.0.0.1';
const issuer = `http://${host}:${port}`;

const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = keyPair.publicKey.export({ format: 'jwk' });
publicJwk.kid = 'mock-key-1';
publicJwk.alg = 'RS256';
publicJwk.use = 'sig';

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(header, payload) {
  const encHeader = base64Url(JSON.stringify(header));
  const encPayload = base64Url(JSON.stringify(payload));
  const data = `${encHeader}.${encPayload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(data);
  const signature = signer.sign(keyPair.privateKey, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${signature}`;
}

const codes = new Map();
const clientSecrets = new Map([
  ['nutrition-api', 'nutrition-secret'],
  ['workout-api', 'workout-secret']
]);

function basicCredentials(req) {
  const header = req.headers.authorization || '';
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  return separator < 0 ? null : { clientId: decoded.slice(0, separator), clientSecret: decoded.slice(separator + 1) };
}

function reject(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

const server = createServer((req, res) => {
  const reqUrl = new URL(req.url, issuer);

  if (req.method === 'GET' && reqUrl.pathname === '/.well-known/openid-configuration') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      issuer,
      authorization_endpoint: `${issuer}/connect/authorize`,
      token_endpoint: `${issuer}/connect/token`,
      jwks_uri: `${issuer}/.well-known/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256']
    }));
    return;
  }

  if (req.method === 'GET' && reqUrl.pathname === '/.well-known/jwks') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      keys: [publicJwk]
    }));
    return;
  }

  if (reqUrl.pathname === '/connect/authorize') {
    if (req.method === 'GET') {
      const redirectUri = reqUrl.searchParams.get('redirect_uri');
      const state = reqUrl.searchParams.get('state') || '';
      const nonce = reqUrl.searchParams.get('nonce') || '';
      const clientId = reqUrl.searchParams.get('client_id') || '';
      const scope = reqUrl.searchParams.get('scope') || '';
      const codeChallenge = reqUrl.searchParams.get('code_challenge') || '';
      const codeChallengeMethod = reqUrl.searchParams.get('code_challenge_method') || '';

      if (reqUrl.searchParams.get('auto') === 'true') {
        const code = 'mock_code_' + crypto.randomBytes(16).toString('hex');
        const username = (reqUrl.searchParams.get('username') || 'e2e-lifter').trim();
        codes.set(code, { clientId, redirectUri, nonce, scope, username, codeChallenge, codeChallengeMethod });
        res.writeHead(302, { Location: `${redirectUri}?code=${code}&state=${encodeURIComponent(state)}` });
        res.end();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html>
<html>
<head><title>Mock Fitness Account</title></head>
<body style="font-family:system-ui;padding:2rem;">
  <h1>Fitness Account (Test Mock)</h1>
  <form method="POST" action="/connect/authorize">
    <input type="hidden" name="redirect_uri" value="${redirectUri || ''}" />
    <input type="hidden" name="state" value="${state}" />
    <input type="hidden" name="nonce" value="${nonce}" />
    <input type="hidden" name="client_id" value="${clientId}" />
    <input type="hidden" name="scope" value="${scope}" />
    <input type="hidden" name="code_challenge" value="${codeChallenge}" />
    <input type="hidden" name="code_challenge_method" value="${codeChallengeMethod}" />
    <label for="username">Username</label><br />
    <input id="username" name="username" value="e2e-lifter" style="padding:8px;font-size:16px;margin:8px 0;" /><br />
    <button type="submit" id="mock-submit" style="padding:10px 16px;font-size:16px;">Sign in to Fitness Account</button>
  </form>
</body>
</html>`);
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const params = new URLSearchParams(body);
        const redirectUri = params.get('redirect_uri');
        const state = params.get('state') || '';
        const nonce = params.get('nonce') || '';
        const clientId = params.get('client_id') || '';
        const scope = params.get('scope') || '';
        const codeChallenge = params.get('code_challenge') || '';
        const codeChallengeMethod = params.get('code_challenge_method') || '';
        const username = (params.get('username') || 'e2e-lifter').trim();

        const code = 'mock_code_' + crypto.randomBytes(16).toString('hex');
        codes.set(code, { clientId, redirectUri, nonce, scope, username, codeChallenge, codeChallengeMethod });
        res.writeHead(302, { Location: `${redirectUri}?code=${code}&state=${encodeURIComponent(state)}` });
        res.end();
      });
      return;
    }
  }

  if (req.method === 'POST' && reqUrl.pathname === '/connect/token') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const code = params.get('code');
      const authData = codes.get(code);
      const credentials = basicCredentials(req);
      if (!authData || !credentials || credentials.clientId !== authData.clientId || clientSecrets.get(credentials.clientId) !== credentials.clientSecret)
        return reject(res, 401, 'invalid_client');
      if (params.get('redirect_uri') !== authData.redirectUri || authData.codeChallengeMethod !== 'S256')
        return reject(res, 400, 'invalid_grant');
      const verifier = params.get('code_verifier') || '';
      const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
      if (!verifier || challenge !== authData.codeChallenge)
        return reject(res, 400, 'invalid_grant');
      codes.delete(code);

      const now = Math.floor(Date.now() / 1000);
      const subject = 'mock_sub_' + crypto.createHash('sha256').update(authData.username).digest('hex').slice(0, 16);

      const idToken = signJwt(
        { alg: 'RS256', typ: 'JWT', kid: 'mock-key-1' },
        {
          iss: issuer,
          aud: authData.clientId,
          sub: subject,
          name: authData.username,
          nonce: authData.nonce,
          iat: now,
          exp: now + 3600
        }
      );

      const accessToken = signJwt(
        { alg: 'RS256', typ: 'at+jwt', kid: 'mock-key-1' },
        {
          iss: issuer,
          aud: ['workout-api', 'nutrition-api'],
          sub: subject,
          scope: authData.scope || 'openid profile',
          iat: now,
          exp: now + 3600
        }
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        token_type: 'Bearer',
        id_token: idToken,
        access_token: accessToken,
        expires_in: 3600,
        refresh_token: 'mock-refresh-' + crypto.randomBytes(16).toString('hex')
      }));
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(port, host, () => {
  console.log(`mock idp listening on ${issuer}`);
});
