import type { StreamConnector } from './types.js';

export class ConnectorRegistry {
  private connectors = new Map<string, StreamConnector>();

  register(connector: StreamConnector): void {
    this.connectors.set(connector.id, connector);
  }

  get(id: string): StreamConnector | undefined {
    return this.connectors.get(id);
  }

  list(): StreamConnector[] {
    return [...this.connectors.values()];
  }
}
