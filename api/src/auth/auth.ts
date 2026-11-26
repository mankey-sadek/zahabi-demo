import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { Databases } from '../db/databases';

const SECRET = process.env.JWT_SECRET ?? 'zahabi-demo-secret-change-me';

export interface TenantClaims {
  sub: string; // user id
  tid: string; // tenant id
  role: string;
  name: string;
}
export interface PlatformClaims {
  platform: true;
  sub: string;
}

export function signTenantToken(c: TenantClaims) {
  return jwt.sign(c, SECRET, { expiresIn: '8h' });
}
export function signPlatformToken(sub: string) {
  return jwt.sign({ platform: true, sub }, SECRET, { expiresIn: '8h' });
}

function bearer(req: { headers: Record<string, string | undefined> }) {
  const h = req.headers['authorization'] ?? '';
  if (!h.startsWith('Bearer ')) throw new UnauthorizedException('محتاج تسجيل دخول');
  try {
    return jwt.verify(h.slice(7), SECRET) as TenantClaims | PlatformClaims;
  } catch {
    throw new UnauthorizedException('الجلسة انتهت، سجّل دخول تاني');
  }
}

/**
 * Tenant resolution (blueprint §2.2): the shop comes from the token only, never from the URL or body.
 * The guard binds that shop's database pool to the request; handlers use @TenantDb() and nothing else.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly dbs: Databases) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const claims = bearer(req);
    if ('platform' in claims) throw new UnauthorizedException('ده حساب المنصة، مش حساب محل');
    const rec = await this.dbs.tenantRecord(claims.tid);
    if (!rec || rec.status !== 'active') throw new UnauthorizedException('المحل مش شغال');
    req.claims = claims;
    req.tenant = rec;
    req.tenantDb = await this.dbs.tenant(claims.tid);
    return true;
  }
}

@Injectable()
export class PlatformGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const claims = bearer(req);
    if (!('platform' in claims)) throw new UnauthorizedException('للفريق بتاع المنصة بس');
    req.claims = claims;
    return true;
  }
}

export const TenantDb = createParamDecorator((_: unknown, ctx: ExecutionContext): Pool => ctx.switchToHttp().getRequest().tenantDb);
export const Claims = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantClaims => ctx.switchToHttp().getRequest().claims);
