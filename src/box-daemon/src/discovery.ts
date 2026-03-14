import { Bonjour, Service } from 'bonjour-service';
import * as os from 'os';

let instance: Bonjour | null = null;
let publishedService: Service | null = null;

export interface DiscoveryConfig {
  port: number;
  name: string;
  boxId: string;
  version: string;
}

/** Get the first non-loopback IPv4 address */
function getLocalIPv4(): string | undefined {
  const interfaces = os.networkInterfaces();
  for (const addrs of Object.values(interfaces) as (os.NetworkInterfaceInfo[] | undefined)[]) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return undefined;
}

export function startAdvertising(config: DiscoveryConfig): void {
  if (instance) return;

  const host = getLocalIPv4();
  instance = new Bonjour();
  publishedService = instance.publish({
    name: config.name,
    type: 'workx-aibox',
    port: config.port,
    host,
    txt: {
      version: config.version,
      name: config.name,
      id: config.boxId,
    },
  });

  console.log(`[mDNS] Advertising _workx-aibox._tcp on port ${config.port} (host=${host || 'default'})`);
}

export function stopAdvertising(): void {
  if (publishedService) {
    publishedService.stop?.();
    publishedService = null;
  }
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
