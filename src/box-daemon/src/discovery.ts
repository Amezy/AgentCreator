import { Bonjour, Service } from 'bonjour-service';

let instance: Bonjour | null = null;
let publishedService: Service | null = null;

export interface DiscoveryConfig {
  port: number;
  name: string;
  boxId: string;
  version: string;
}

export function startAdvertising(config: DiscoveryConfig): void {
  if (instance) return;

  instance = new Bonjour();
  publishedService = instance.publish({
    name: config.name,
    type: 'workx-aibox',
    port: config.port,
    txt: {
      version: config.version,
      name: config.name,
      id: config.boxId,
    },
  });

  console.log(`[mDNS] Advertising _workx-aibox._tcp on port ${config.port}`);
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
