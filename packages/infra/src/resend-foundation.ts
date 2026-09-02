import * as cloudflare from '@pulumi/cloudflare';
import * as pulumi from '@pulumi/pulumi';
import type { DomainRecords, ErrorResponse } from 'resend';

type ResendRegion = 'us-east-1' | 'eu-west-1' | 'sa-east-1' | 'ap-northeast-1';
type ResendTls = 'enforced' | 'opportunistic';

interface ResendRecord {
  name: string;
  type: 'CNAME' | 'MX' | 'TXT';
  value: string;
  priority?: number;
}

interface ResendDomainProviderInputs {
  managementApiKey: string;
  name: string;
  region: ResendRegion;
  tls: ResendTls;
  status?: string;
  dkimName?: string;
  dkimType?: 'CNAME' | 'TXT';
  dkimValue?: string;
  spfMxName?: string;
  spfMxValue?: string;
  spfMxPriority?: number;
  spfTxtName?: string;
  spfTxtValue?: string;
}

function resendFailure(operation: string, error: ErrorResponse): Error {
  return new Error(`Resend ${operation} failed (${error.name}${error.statusCode ? ` ${String(error.statusCode)}` : ''}): ${error.message}`);
}

function resendClient(apiKey: string): import('resend').Resend {
  // Pulumi serializes dynamic providers as CommonJS closures; a static or dynamic ESM import cannot be serialized safely.
  // oxlint-disable-next-line typescript/no-require-imports
  const { Resend } = require('resend') as typeof import('resend');
  return new Resend(apiKey);
}

function requiredRecord(records: DomainRecords[], record: 'DKIM' | 'SPF', type?: 'MX' | 'TXT'): ResendRecord {
  const found = records.find((candidate) => candidate.record === record && (!type || candidate.type === type));
  if (!found) throw new Error(`Resend did not return the required ${record}${type ? ` ${type}` : ''} DNS record`);
  if (found.type === 'CAA') throw new Error(`Resend returned an invalid ${record} DNS record type`);
  return { name: found.name, type: found.type, value: found.value, priority: 'priority' in found ? found.priority : undefined };
}

function domainOutputs(inputs: ResendDomainProviderInputs, status: string, records: DomainRecords[]): ResendDomainProviderInputs {
  const dkim = requiredRecord(records, 'DKIM');
  const spfMx = requiredRecord(records, 'SPF', 'MX');
  const spfTxt = requiredRecord(records, 'SPF', 'TXT');
  return {
    ...inputs,
    status,
    dkimName: dkim.name,
    dkimType: dkim.type as 'CNAME' | 'TXT',
    dkimValue: dkim.value,
    spfMxName: spfMx.name,
    spfMxValue: spfMx.value,
    spfMxPriority: spfMx.priority ?? 10,
    spfTxtName: spfTxt.name,
    spfTxtValue: spfTxt.value,
  };
}

class ResendDomainProvider implements pulumi.dynamic.ResourceProvider<ResendDomainProviderInputs, ResendDomainProviderInputs> {
  async create(inputs: ResendDomainProviderInputs): Promise<pulumi.dynamic.CreateResult<ResendDomainProviderInputs>> {
    const client = resendClient(inputs.managementApiKey);
    const { data, error } = await client.domains.create({
      name: inputs.name,
      region: inputs.region,
      tls: inputs.tls,
      openTracking: false,
      clickTracking: false,
      capabilities: { sending: 'enabled', receiving: 'disabled' },
    });
    if (error) throw resendFailure('domain creation', error);
    if (!data) throw new Error('Resend domain creation returned no data');
    try {
      return { id: data.id, outs: domainOutputs(inputs, data.status, data.records) };
    } catch (normalizationError) {
      await client.domains.remove(data.id);
      throw normalizationError;
    }
  }

  async read(id: pulumi.ID, props?: ResendDomainProviderInputs): Promise<pulumi.dynamic.ReadResult<ResendDomainProviderInputs>> {
    if (!props) return { id: undefined };
    const { data, error } = await resendClient(props.managementApiKey).domains.get(String(id));
    if (error?.statusCode === 404) return { id: undefined };
    if (error) throw resendFailure('domain read', error);
    if (!data) throw new Error('Resend domain read returned no data');
    return { id, props: domainOutputs(props, data.status, data.records) };
  }

  diff(_id: pulumi.ID, olds: ResendDomainProviderInputs, news: ResendDomainProviderInputs): Promise<pulumi.dynamic.DiffResult> {
    const replaces = ['name', 'region', 'tls'].filter((property) => olds[property as keyof ResendDomainProviderInputs] !== news[property as keyof ResendDomainProviderInputs]);
    return Promise.resolve({ changes: replaces.length > 0 || olds.managementApiKey !== news.managementApiKey, replaces, deleteBeforeReplace: false });
  }

  async update(id: pulumi.ID, _olds: ResendDomainProviderInputs, news: ResendDomainProviderInputs): Promise<pulumi.dynamic.UpdateResult<ResendDomainProviderInputs>> {
    const { data, error } = await resendClient(news.managementApiKey).domains.get(String(id));
    if (error) throw resendFailure('domain credential update', error);
    if (!data) throw new Error('Resend domain credential update returned no data');
    return { outs: domainOutputs(news, data.status, data.records) };
  }

  async delete(id: pulumi.ID, props: ResendDomainProviderInputs): Promise<void> {
    const { error } = await resendClient(props.managementApiKey).domains.remove(String(id));
    if (error && error.statusCode !== 404) throw resendFailure('domain deletion', error);
  }
}

interface ResendDomainArgs {
  managementApiKey: pulumi.Input<string>;
  name: pulumi.Input<string>;
  region: pulumi.Input<ResendRegion>;
  tls: pulumi.Input<ResendTls>;
}

class ResendDomain extends pulumi.dynamic.Resource {
  declare readonly status: pulumi.Output<string>;
  declare readonly dkimName: pulumi.Output<string>;
  declare readonly dkimType: pulumi.Output<'CNAME' | 'TXT'>;
  declare readonly dkimValue: pulumi.Output<string>;
  declare readonly spfMxName: pulumi.Output<string>;
  declare readonly spfMxValue: pulumi.Output<string>;
  declare readonly spfMxPriority: pulumi.Output<number>;
  declare readonly spfTxtName: pulumi.Output<string>;
  declare readonly spfTxtValue: pulumi.Output<string>;

  constructor(name: string, args: ResendDomainArgs, opts?: pulumi.CustomResourceOptions) {
    super(new ResendDomainProvider(), name, {
      ...args,
      status: undefined,
      dkimName: undefined,
      dkimType: undefined,
      dkimValue: undefined,
      spfMxName: undefined,
      spfMxValue: undefined,
      spfMxPriority: undefined,
      spfTxtName: undefined,
      spfTxtValue: undefined,
    }, opts, 'resend', 'Domain');
  }
}

interface ResendVerificationProviderInputs {
  managementApiKey: string;
  domainId: string;
  timeoutSeconds: number;
  status?: string;
}

class ResendVerificationProvider implements pulumi.dynamic.ResourceProvider<ResendVerificationProviderInputs, ResendVerificationProviderInputs> {
  async create(inputs: ResendVerificationProviderInputs): Promise<pulumi.dynamic.CreateResult<ResendVerificationProviderInputs>> {
    const client = resendClient(inputs.managementApiKey);
    const verification = await client.domains.verify(inputs.domainId);
    if (verification.error) throw resendFailure('domain verification', verification.error);
    const deadline = Date.now() + inputs.timeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const current = await client.domains.get(inputs.domainId);
      if (current.error) throw resendFailure('domain verification status', current.error);
      if (current.data?.status === 'verified') return { id: inputs.domainId, outs: { ...inputs, status: 'verified' } };
      if (current.data?.status === 'failed') throw new Error('Resend domain verification failed');
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    throw new Error(`Resend domain verification did not complete within ${String(inputs.timeoutSeconds)} seconds`);
  }

  async read(id: pulumi.ID, props?: ResendVerificationProviderInputs): Promise<pulumi.dynamic.ReadResult<ResendVerificationProviderInputs>> {
    if (!props) return { id: undefined };
    const { data, error } = await resendClient(props.managementApiKey).domains.get(props.domainId);
    if (error?.statusCode === 404) return { id: undefined };
    if (error) throw resendFailure('domain verification read', error);
    return data?.status === 'verified' ? { id, props: { ...props, status: 'verified' } } : { id: undefined };
  }

  diff(_id: pulumi.ID, olds: ResendVerificationProviderInputs, news: ResendVerificationProviderInputs): Promise<pulumi.dynamic.DiffResult> {
    const replaces = olds.domainId === news.domainId ? [] : ['domainId'];
    return Promise.resolve({ changes: replaces.length > 0 || olds.timeoutSeconds !== news.timeoutSeconds || olds.managementApiKey !== news.managementApiKey, replaces, deleteBeforeReplace: false });
  }

  update(_id: pulumi.ID, olds: ResendVerificationProviderInputs, news: ResendVerificationProviderInputs): Promise<pulumi.dynamic.UpdateResult<ResendVerificationProviderInputs>> {
    return Promise.resolve({ outs: { ...news, status: olds.status } });
  }
}

class ResendDomainVerification extends pulumi.dynamic.Resource {
  declare readonly status: pulumi.Output<string>;
  constructor(name: string, args: { managementApiKey: pulumi.Input<string>; domainId: pulumi.Input<string>; timeoutSeconds: pulumi.Input<number> }, opts?: pulumi.CustomResourceOptions) {
    super(new ResendVerificationProvider(), name, { ...args, status: undefined }, opts, 'resend', 'DomainVerification');
  }
}

interface ResendApiKeyProviderInputs {
  managementApiKey: string;
  name: string;
  permission: 'sending_access';
  domainId: string;
  token?: string;
}

class ResendApiKeyProvider implements pulumi.dynamic.ResourceProvider<ResendApiKeyProviderInputs, ResendApiKeyProviderInputs> {
  async create(inputs: ResendApiKeyProviderInputs): Promise<pulumi.dynamic.CreateResult<ResendApiKeyProviderInputs>> {
    const { data, error } = await resendClient(inputs.managementApiKey).apiKeys.create({ name: inputs.name, permission: inputs.permission, domain_id: inputs.domainId });
    if (error) throw resendFailure('API key creation', error);
    if (!data) throw new Error('Resend API key creation returned no data');
    return { id: data.id, outs: { ...inputs, token: data.token } };
  }

  async read(id: pulumi.ID, props?: ResendApiKeyProviderInputs): Promise<pulumi.dynamic.ReadResult<ResendApiKeyProviderInputs>> {
    if (!props) return { id: undefined };
    const client = resendClient(props.managementApiKey);
    let after: string | undefined;
    for (;;) {
      const { data, error } = await client.apiKeys.list(after ? { limit: 100, after } : { limit: 100 });
      if (error) throw resendFailure('API key read', error);
      if (!data) throw new Error('Resend API key read returned no data');
      if (data.data.some((key) => key.id === id)) return { id, props };
      if (!data.has_more || data.data.length === 0) return { id: undefined };
      after = data.data.at(-1)?.id;
    }
  }

  diff(_id: pulumi.ID, olds: ResendApiKeyProviderInputs, news: ResendApiKeyProviderInputs): Promise<pulumi.dynamic.DiffResult> {
    const replaces = ['permission', 'domainId'].filter((property) => olds[property as keyof ResendApiKeyProviderInputs] !== news[property as keyof ResendApiKeyProviderInputs]);
    return Promise.resolve({ changes: replaces.length > 0 || olds.name !== news.name || olds.managementApiKey !== news.managementApiKey, replaces, deleteBeforeReplace: false });
  }

  async update(id: pulumi.ID, olds: ResendApiKeyProviderInputs, news: ResendApiKeyProviderInputs): Promise<pulumi.dynamic.UpdateResult<ResendApiKeyProviderInputs>> {
    if (olds.name !== news.name) {
      const { error } = await resendClient(news.managementApiKey).apiKeys.update(String(id), { name: news.name });
      if (error) throw resendFailure('API key update', error);
    }
    return { outs: { ...news, token: olds.token } };
  }

  async delete(id: pulumi.ID, props: ResendApiKeyProviderInputs): Promise<void> {
    const { error } = await resendClient(props.managementApiKey).apiKeys.remove(String(id));
    if (error && error.statusCode !== 404) throw resendFailure('API key deletion', error);
  }
}

class ResendApiKey extends pulumi.dynamic.Resource {
  declare readonly token: pulumi.Output<string>;
  constructor(name: string, args: { managementApiKey: pulumi.Input<string>; domainId: pulumi.Input<string> }, opts?: pulumi.CustomResourceOptions) {
    super(new ResendApiKeyProvider(), name, { ...args, name: 'vibelog-prod-app', permission: 'sending_access', token: undefined }, {
      ...opts,
      additionalSecretOutputs: [...(opts?.additionalSecretOutputs ?? []), 'token'],
    }, 'resend', 'ApiKey');
  }
}

export interface EmailFoundationArgs {
  accountId: pulumi.Input<string>;
  zoneId: pulumi.Input<string>;
  rootDomain: string;
  forwardingDestination: pulumi.Input<string>;
  resendManagementApiKey: pulumi.Input<string>;
  cloudflareProvider: cloudflare.Provider;
}

export class EmailFoundation extends pulumi.ComponentResource {
  readonly domain: ResendDomain;
  readonly verification: ResendDomainVerification;
  readonly runtimeApiKey: ResendApiKey;
  readonly runtimeApiKeyToken: pulumi.Output<string>;
  readonly forwardingAddress: cloudflare.EmailRoutingAddress;
  readonly routingDns: cloudflare.EmailRoutingDns;

  constructor(name: string, args: EmailFoundationArgs, opts?: pulumi.ComponentResourceOptions) {
    super('vibelog:infra:EmailFoundation', name, {}, opts);
    const cloudflareOptions = { parent: this, provider: args.cloudflareProvider };
    this.domain = new ResendDomain(`${name}-domain`, {
      managementApiKey: args.resendManagementApiKey,
      name: `send.${args.rootDomain}`,
      region: 'ap-northeast-1',
      tls: 'enforced',
    }, { parent: this, protect: true });
    const dnsRecords = [
      new cloudflare.DnsRecord(`${name}-resend-dkim`, { zoneId: args.zoneId, name: this.domain.dkimName, type: this.domain.dkimType, content: this.domain.dkimValue, ttl: 1, proxied: false }, cloudflareOptions),
      new cloudflare.DnsRecord(`${name}-resend-spf-mx`, { zoneId: args.zoneId, name: this.domain.spfMxName, type: 'MX', content: this.domain.spfMxValue, priority: this.domain.spfMxPriority, ttl: 1, proxied: false }, cloudflareOptions),
      new cloudflare.DnsRecord(`${name}-resend-spf-txt`, { zoneId: args.zoneId, name: this.domain.spfTxtName, type: 'TXT', content: this.domain.spfTxtValue, ttl: 1, proxied: false }, cloudflareOptions),
    ];
    this.verification = new ResendDomainVerification(`${name}-domain-verification`, {
      managementApiKey: args.resendManagementApiKey,
      domainId: this.domain.id,
      timeoutSeconds: 900,
    }, { parent: this, dependsOn: dnsRecords });
    this.runtimeApiKey = new ResendApiKey(`${name}-runtime-key`, {
      managementApiKey: args.resendManagementApiKey,
      domainId: this.domain.id,
    }, { parent: this, dependsOn: this.verification });
    this.runtimeApiKeyToken = pulumi.secret(this.runtimeApiKey.token);
    this.forwardingAddress = new cloudflare.EmailRoutingAddress(`${name}-forwarding-destination`, {
      accountId: args.accountId,
      email: args.forwardingDestination,
    }, cloudflareOptions);
    this.routingDns = new cloudflare.EmailRoutingDns(`${name}-routing-dns`, {
      zoneId: args.zoneId,
    }, cloudflareOptions);
    this.registerOutputs({
      domainId: this.domain.id,
      domainStatus: this.verification.status,
      forwardingAddressId: this.forwardingAddress.id,
      routingStatus: this.routingDns.status,
    });
  }
}
