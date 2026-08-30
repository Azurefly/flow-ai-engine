export type ConnectorContext = {
  projectId: string;
  sourceId: string;
  sourceType: string;
  connection: Record<string, unknown>;
  credentialRef: string | null;
};

export type ConnectionTestEvidence = {
  verified: boolean;
  readOnly: boolean;
  latencyMs?: number;
  endpointHost?: string | null;
  details?: Record<string, unknown>;
};

export type DatasetBatch = {
  rows: Record<string, unknown>[];
  schema?: Array<{ name: string; type: string }>;
  done?: boolean;
};

export type ReadRequest = ConnectorContext & {
  assetName?: string;
  columns?: string[];
  limit?: number;
};

/** Stable connector boundary: connectors never receive raw workflow users or secrets in logs. */
export interface DataConnector {
  readonly type: string;
  testConnection(input: ConnectorContext): Promise<ConnectionTestEvidence>;
  discover(input: ConnectorContext): Promise<Array<{ name: string; assetType: string }>>;
  read(input: ReadRequest): AsyncIterable<DatasetBatch>;
  write?(input: ConnectorContext & { rows: Record<string, unknown>[] }): Promise<{ rowCount: number }>;
}
