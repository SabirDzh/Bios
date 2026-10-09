import { generateKeyPairSync } from 'node:crypto';
import { sign as signJwt } from 'jsonwebtoken';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { JwtTokenService } from './jwt-token.service';
import { loadAuthConfig, type AuthConfig } from './auth.config';

function genPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('JwtTokenService (RS256 strict)', () => {
  let keys: { privateKey: string; publicKey: string };
  let other: { privateKey: string; publicKey: string };
  let config: AuthConfig;
  let tokens: JwtTokenService;

  beforeAll(() => {
    keys = genPair();
    other = genPair();
    config = loadAuthConfig({
      NODE_ENV: 'test',
      JWT_PRIVATE_KEY: keys.privateKey,
      JWT_PUBLIC_KEY: keys.publicKey,
    });
    tokens = new JwtTokenService(new JwtService({}), config);
  });

  const accessInput = {
    userId: 'u1',
    username: 'john',
    email: 'john@x.io',
    familyId: 'f1',
    jti: 'a1',
  };
  const refreshInput = { userId: 'u1', familyId: 'f1', jti: 'r1' };

  test('access roundtrip keeps claims and ttl', () => {
    const token = tokens.signAccess(accessInput);
    expect(token.split('.')).toHaveLength(3);
    const claims = tokens.verifyAccess(token);
    expect(claims).toMatchObject({
      sub: 'u1',
      username: 'john',
      email: 'john@x.io',
      sid: 'f1',
      jti: 'a1',
      token_type: 'access',
    });
    const decoded = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString(),
    ) as { exp: number; iat: number; iss: string; aud: string };
    expect(decoded.exp - decoded.iat).toBe(config.accessTtlSec);
    expect(decoded.iss).toBe(config.issuer);
    expect(decoded.aud).toBe(config.audience);
    expect(
      JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()) as {
        alg: string;
      },
    ).toMatchObject({ alg: 'RS256' });
  });

  test('refresh roundtrip', () => {
    const token = tokens.signRefresh(refreshInput);
    expect(tokens.verifyRefresh(token)).toMatchObject({
      sub: 'u1',
      sid: 'f1',
      jti: 'r1',
      token_type: 'refresh',
    });
  });

  test('wrong public key rejects', () => {
    const foreign = new JwtTokenService(new JwtService({}), {
      ...config,
      publicKey: other.publicKey,
    });
    expect(() => foreign.verifyAccess(tokens.signAccess(accessInput))).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      foreign.verifyRefresh(tokens.signRefresh(refreshInput)),
    ).toThrow(UnauthorizedException);
  });

  test('tampered payload rejects', () => {
    const token = tokens.signAccess(accessInput).split('.');
    const payload = JSON.parse(
      Buffer.from(token[1], 'base64url').toString(),
    ) as Record<string, unknown>;
    payload.sub = 'attacker';
    token[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
    expect(() => tokens.verifyAccess(token.join('.'))).toThrow(
      UnauthorizedException,
    );
  });

  test('tampered header (alg confusion to HS256) rejects', () => {
    // Подпись корректна для HS256 с известным секретом, но сервер разрешает только RS256.
    const hs = signJwt(
      { sid: 'f1', token_type: 'refresh' },
      'attacker-secret',
      {
        algorithm: 'HS256',
        subject: 'u1',
        jwtid: 'r1',
        expiresIn: 600,
        issuer: config.issuer,
        audience: config.audience,
      },
    );
    expect(() => tokens.verifyRefresh(hs)).toThrow(UnauthorizedException);
  });

  test('tokens are not interchangeable', () => {
    const access = tokens.signAccess(accessInput);
    const refresh = tokens.signRefresh(refreshInput);
    expect(() => tokens.verifyRefresh(access)).toThrow(/token type/);
    expect(() => tokens.verifyAccess(refresh)).toThrow(/token type/);
  });

  test('expired token rejects', () => {
    const expired = signJwt(
      {
        sid: 'f1',
        token_type: 'refresh',
        exp: Math.floor(Date.now() / 1000) - 10,
      },
      keys.privateKey,
      {
        algorithm: 'RS256',
        subject: 'u1',
        jwtid: 'r1',
        issuer: config.issuer,
        audience: config.audience,
      },
    );
    expect(() => tokens.verifyRefresh(expired)).toThrow(UnauthorizedException);
  });

  test('missing claims reject', () => {
    const noSub = signJwt(
      { sid: 'f1', token_type: 'refresh' },
      keys.privateKey,
      {
        algorithm: 'RS256',
        jwtid: 'r1',
        issuer: config.issuer,
        audience: config.audience,
      },
    );
    expect(() => tokens.verifyRefresh(noSub)).toThrow(/sub/);
  });

  test('wrong issuer/audience reject', () => {
    const foreignIss = signJwt(
      { sid: 'f1', token_type: 'refresh' },
      keys.privateKey,
      {
        algorithm: 'RS256',
        subject: 'u1',
        jwtid: 'r1',
        issuer: 'evil',
        audience: config.audience,
      },
    );
    const foreignAud = signJwt(
      { sid: 'f1', token_type: 'refresh' },
      keys.privateKey,
      {
        algorithm: 'RS256',
        subject: 'u1',
        jwtid: 'r1',
        issuer: config.issuer,
        audience: 'evil',
      },
    );
    expect(() => tokens.verifyRefresh(foreignIss)).toThrow(
      UnauthorizedException,
    );
    expect(() => tokens.verifyRefresh(foreignAud)).toThrow(
      UnauthorizedException,
    );
  });

  test('garbage token rejects without throwing raw errors', () => {
    expect(() => tokens.verifyAccess('not.a.token')).toThrow(
      UnauthorizedException,
    );
    expect(() => tokens.verifyRefresh('')).toThrow(UnauthorizedException);
  });
});
