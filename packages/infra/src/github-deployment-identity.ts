import * as gcp from '@pulumi/gcp';
import * as pulumi from '@pulumi/pulumi';

export interface GithubDeploymentIdentityArgs { project: pulumi.Input<string>; githubRepository: pulumi.Input<string>; environment: string; provider: gcp.Provider }
export class GithubDeploymentIdentity extends pulumi.ComponentResource {
  readonly serviceAccount: gcp.serviceaccount.Account;
  readonly providerName: pulumi.Output<string>;
  constructor(name: string, args: GithubDeploymentIdentityArgs, opts?: pulumi.ComponentResourceOptions) {
    super('vibelog:infra:GithubDeploymentIdentity', name, {}, opts); const resourceOptions = { parent: this, provider: args.provider };
    const pool = new gcp.iam.WorkloadIdentityPool(`${name}-pool`, { project: args.project, workloadIdentityPoolId: `vibelog-github-${args.environment}`, displayName: 'VibeLog GitHub Actions' }, resourceOptions);
    const provider = new gcp.iam.WorkloadIdentityPoolProvider(`${name}-provider`, { project: args.project, workloadIdentityPoolId: pool.workloadIdentityPoolId, workloadIdentityPoolProviderId: 'github', displayName: 'GitHub Actions OIDC', attributeMapping: { 'google.subject': 'assertion.sub', 'attribute.repository': 'assertion.repository' }, attributeCondition: pulumi.interpolate`assertion.repository == '${args.githubRepository}'`, oidc: { issuerUri: 'https://token.actions.githubusercontent.com' } }, resourceOptions);
    this.serviceAccount = new gcp.serviceaccount.Account(`${name}-deployer`, { project: args.project, accountId: `vibelog-deploy-${args.environment}`, displayName: 'VibeLog Pulumi deployer' }, resourceOptions);
    new gcp.serviceaccount.IAMMember(`${name}-federation`, { serviceAccountId: this.serviceAccount.name, role: 'roles/iam.workloadIdentityUser', member: pulumi.interpolate`principalSet://iam.googleapis.com/${pool.name}/attribute.repository/${args.githubRepository}` }, resourceOptions);
    for (const [index, role] of [
      'roles/run.admin', 'roles/artifactregistry.admin', 'roles/iam.serviceAccountUser',
      'roles/iam.serviceAccountAdmin', 'roles/iam.workloadIdentityPoolAdmin',
      'roles/resourcemanager.projectIamAdmin', 'roles/cloudtasks.admin',
      'roles/cloudscheduler.admin', 'roles/secretmanager.admin',
      'roles/serviceusage.serviceUsageAdmin',
    ].entries()) new gcp.projects.IAMMember(`${name}-role-${String(index)}`, { project: args.project, role, member: pulumi.interpolate`serviceAccount:${this.serviceAccount.email}` }, resourceOptions);
    this.providerName = provider.name; this.registerOutputs({ serviceAccountEmail: this.serviceAccount.email, providerName: this.providerName });
  }
}
