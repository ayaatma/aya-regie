/**
 * `ssh2-sftp-client` ships no type declarations.
 *
 * Rather than let the import become `any`, the module is declared as untyped here and the six
 * methods `deploy-cli.ts` actually calls are described by its own `SftpClient` interface. If the
 * library changes shape, the failure is a runtime one on a deploy, which is why the deploy has a
 * `--probe` and a `--dry-run` in front of it.
 */
declare module 'ssh2-sftp-client';
