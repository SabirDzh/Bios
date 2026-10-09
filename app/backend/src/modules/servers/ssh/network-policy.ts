import { promises as dns } from 'node:dns';
import { SshFailure } from './ssh-runner';

export type IpCategory =
  | 'loopback'
  | 'linkLocal'
  | 'unspecified'
  | 'multicast'
  | 'private'
  | 'public'
  | 'documentation'
  | 'other'
  | 'invalid';

export interface NetworkPolicy {
  allowedPorts: number[];
  allowLoopback: boolean;
}

export type Resolver = (host: string) => Promise<string[]>;

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function octetsOfV4(ip: string): [number, number, number, number] | null {
  const match = IPV4_RE.exec(ip.trim());
  if (!match) return null;
  const octets = [match[1], match[2], match[3], match[4]].map(Number);
  if (octets.some((o) => o > 255)) return null;
  return [octets[0], octets[1], octets[2], octets[3]];
}

function categoryOfV4(a: number, b: number, c: number, d: number): IpCategory {
  if (a === 0 && b === 0 && c === 0 && d === 0) return 'unspecified';
  if (a === 0) return 'other'; // 0.0.0.0/8 — «эта сеть»
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'linkLocal'; // включая 169.254.169.254
  if (a === 100 && b >= 64 && b <= 127) return 'private'; // CGNAT
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a >= 240) return 'other';
  return 'public';
}

/** Разбирает группу hex-частей IPv6, допуская хвост в виде IPv4. */
function groupsFromParts(part: string): number[] | null {
  if (part === '') return [];
  const items = part.split(':');
  const groups: number[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (index === items.length - 1) {
      const embedded = octetsOfV4(item);
      if (embedded) {
        const [a, b, c, d] = embedded;
        groups.push((a << 8) | b, (c << 8) | d);
        continue;
      }
    }
    if (!/^[0-9a-f]{1,4}$/.test(item)) return null;
    groups.push(parseInt(item, 16));
  }
  return groups;
}

/**
 * IPv6 → 8 групп по 16 бит. Разбор свой, а не через `net`: категория должна
 * считаться по битам, иначе '::ffff:a9fe:a9fe' обойдёт проверку 169.254/16.
 */
export function parseIpv6(ip: string): number[] | null {
  const value = ip
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (!/^[0-9a-f:.]+$/.test(value)) return null;
  const sides = value.split('::');
  if (sides.length > 2) return null;
  const head = groupsFromParts(sides[0]);
  if (!head) return null;
  if (sides.length === 1) return head.length === 8 ? head : null;
  const tail = groupsFromParts(sides[1]);
  if (!tail) return null;
  // '::' обязана скрывать хотя бы одну нулевую группу.
  if (head.length + tail.length > 7) return null;
  return [
    ...head,
    ...Array.from({ length: 8 - head.length - tail.length }, () => 0),
    ...tail,
  ];
}

function categoryOfV6(groups: number[]): IpCategory {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  if (groups.every((g) => g === 0)) return 'unspecified';
  if (g7 === 1 && groups.slice(0, 7).every((g) => g === 0)) return 'loopback';
  const embeddedV4 = (g6 >> 8) & 255;
  if (
    [g0, g1, g2, g3, g4].every((g) => g === 0) &&
    (g5 === 0xffff || g5 === 0)
  ) {
    return categoryOfV4(embeddedV4, g6 & 255, (g7 >> 8) & 255, g7 & 255);
  }
  if ((g0 & 0xffc0) === 0xfe80) return 'linkLocal'; // fe80::/10
  if ((g0 & 0xfe00) === 0xfc00) return 'private'; // fc00::/7
  if ((g0 & 0xff00) === 0xff00) return 'multicast'; // ff00::/8
  if (g0 === 0x2001 && g1 === 0x0db8) return 'documentation'; // 2001:db8::/32
  return 'public';
}

export function ipCategory(ip: string): IpCategory {
  const value = ip.trim().replace(/^\[|\]$/g, '');
  const v4 = octetsOfV4(value);
  if (v4) return categoryOfV4(...v4);
  if (value.includes(':')) {
    const groups = parseIpv6(value);
    return groups ? categoryOfV6(groups) : 'invalid';
  }
  return 'invalid';
}

/** Голый IPv4 или IPv6 в скобках; для имени возвращает null. */
export function parseHostLiteral(host: string): string | null {
  const bare = host.trim().replace(/^\[|\]$/g, '');
  if (octetsOfV4(bare)) return bare;
  if (bare.includes(':') && parseIpv6(bare)) return bare.toLowerCase();
  return null;
}

function isAllowed(category: IpCategory, policy: NetworkPolicy): boolean {
  if (category === 'private' || category === 'public') return true;
  if (category === 'loopback') return policy.allowLoopback;
  return false; // linkLocal, unspecified, multicast, documentation, other, invalid
}

export async function resolveTarget(
  host: string,
  port: number,
  policy: NetworkPolicy,
  resolve: Resolver = defaultResolver,
): Promise<{ address: string }> {
  if (!policy.allowedPorts.includes(port)) {
    throw new SshFailure('PORT_NOT_ALLOWED', 'port is not allowed');
  }
  const literal = parseHostLiteral(host);
  if (literal !== null) {
    if (!isAllowed(ipCategory(literal), policy)) {
      throw new SshFailure('TARGET_BLOCKED', 'target address is not allowed');
    }
    return { address: literal };
  }

  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new SshFailure('RESOLUTION_FAILED', 'host name cannot be resolved');
  }
  if (addresses.length === 0) {
    throw new SshFailure('RESOLUTION_FAILED', 'host name cannot be resolved');
  }
  // Детерминированный порядок: сначала IPv4 (стабильнее в смешанных сетях).
  const ordered = [...addresses].sort(
    (a, b) => Number(b.includes(':')) - Number(a.includes(':')),
  );
  for (const address of ordered) {
    if (isAllowed(ipCategory(address), policy)) return { address };
  }
  throw new SshFailure('TARGET_BLOCKED', 'target address is not allowed');
}

async function defaultResolver(host: string): Promise<string[]> {
  const records = await dns.lookup(host, { all: true, verbatim: true });
  return records.map((record) => record.address);
}
