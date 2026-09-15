import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitHubCliInstallation, GitHubCliInstallationHost } from '../contracts/index.js';
import { cliReleaseTarget, downloadGitHubCli } from './github-cli-download.js';

const exec = promisify(execFile);
type InstallationOptions = {
  isInstalled(signal: AbortSignal): Promise<boolean>;
  verify?: (executable: string, version: string, signal: AbortSignal) => Promise<void>;
  platform?: string; arch?: string;
};

export const managedGitHubCliPath = (dataDir: string, platform: string = process.platform) => path.join(dataDir, 'github-cli', 'bin', platform === 'win32' ? 'gh.exe' : 'gh');

export class GitHubCliInstaller {
  readonly executable: string;
  private readonly root: string;
  private readonly platform: string;
  private readonly arch: string;
  private state: GitHubCliInstallation = { phase: 'idle', receivedBytes: 0, totalBytes: null, error: null };
  private job: Promise<void> | null = null;
  private readonly shutdown = new AbortController();

  constructor(private readonly host: GitHubCliInstallationHost, private readonly options: InstallationOptions) {
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.root = path.join(host.dataDir, 'github-cli');
    this.executable = managedGitHubCliPath(host.dataDir, this.platform);
  }

  read(): GitHubCliInstallation { return { ...this.state }; }

  start(): GitHubCliInstallation {
    if (!this.job) {
      this.state = { phase: 'checking', receivedBytes: 0, totalBytes: null, error: null };
      // Runtime owns the job, so navigating away cannot duplicate or interrupt installation.
      this.job = this.install().catch((error: unknown) => {
        this.state = { ...this.state, phase: 'error', error: error instanceof Error ? error.message : 'GitHub CLI installation failed.' };
      }).finally(() => { this.job = null; });
    }
    return this.read();
  }

  async dispose(): Promise<void> { this.shutdown.abort(); await this.job; }

  private async install(): Promise<void> {
    const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(5 * 60_000)]);
    if (await this.options.isInstalled(signal)) { this.state.phase = 'complete'; return; }
    const target = cliReleaseTarget(this.platform, this.arch);
    const release = await downloadGitHubCli(this.host, this.platform, this.arch, signal, (phase, receivedBytes, totalBytes) => {
      this.state = { phase, receivedBytes, totalBytes, error: null };
    });
    this.state.phase = 'installing';
    await mkdir(this.root, { recursive: true });
    const staging = await mkdtemp(path.join(this.root, '.install-'));
    try {
      const executable = path.join(staging, target.executable);
      await writeFile(executable, release.binary, { mode: 0o755, flag: 'wx' });
      await writeFile(path.join(staging, 'LICENSE'), release.license, { flag: 'wx' });
      if (this.options.verify) await this.options.verify(executable, release.version, signal);
      else {
        const result = await exec(executable, ['--version'], { signal, timeout: 15_000, windowsHide: true, encoding: 'utf8', maxBuffer: 100_000 });
        if (!result.stdout.startsWith(`gh version ${release.version} `)) throw new Error('Installed GitHub CLI did not pass its version check.');
      }
      signal.throwIfAborted();
      await rename(staging, path.dirname(this.executable));
      this.state.phase = 'complete';
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
}
