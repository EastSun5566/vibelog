import * as command from '@pulumi/command';
import * as pulumi from '@pulumi/pulumi';

export interface DatabaseMigrationArgs {
  databaseUrl: pulumi.Input<string>;
  imageDigest: pulumi.Input<string>;
}

/** Runs the checked-in Drizzle migrations before a new runtime revision can start. */
export class DatabaseMigration extends pulumi.ComponentResource {
  readonly run: command.local.Command;

  constructor(name: string, args: DatabaseMigrationArgs, opts?: pulumi.ComponentResourceOptions) {
    super('vibelog:infra:DatabaseMigration', name, {}, opts);
    const migrate = 'pnpm --filter @vibelog/core build && pnpm --filter @vibelog/app build && pnpm --filter @vibelog/app db:migrate';
    this.run = new command.local.Command(`${name}-run`, {
      create: migrate,
      update: migrate,
      dir: '../..',
      environment: { DATABASE_MIGRATION_URL: args.databaseUrl },
      triggers: [args.imageDigest],
      logging: command.local.Logging.None,
      addPreviousOutputInEnv: false,
    }, {
      parent: this,
      additionalSecretOutputs: ['stdout', 'stderr'],
    });
    this.registerOutputs();
  }
}
