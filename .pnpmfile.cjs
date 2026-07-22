module.exports = {
  hooks: {
    /**
     * @param {{ name?: string, version?: string, peerDependencies?: Record<string, string>, peerDependenciesMeta?: Record<string, { optional?: boolean }> }} pkg
     */
    readPackage(pkg) {
      if (pkg.name !== 'better-auth' || pkg.version !== '1.6.23') {
        return pkg;
      }

      // Better Auth advertises adapters, frameworks, and test runners as
      // optional peers. VibeLog only uses its Drizzle adapter; resolving the
      // other peers would copy workspace dev tools into `pnpm deploy --prod`.
      pkg.peerDependencies = { 'drizzle-orm': '^0.45.2' };
      pkg.peerDependenciesMeta = { 'drizzle-orm': { optional: true } };

      return pkg;
    },
  },
};
