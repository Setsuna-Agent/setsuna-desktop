import type { ComputerCommand, ComputerControlPort, ComputerResult } from '../contracts/index.js';
import { computerCommandTimeout } from '../contracts/index.js';
export class ComputerControlClient implements ComputerControlPort {
  constructor(private readonly url: string, private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password || !token) throw new Error('Desktop control requires authenticated loopback HTTP.');
  }
  static fromEnvironment(env = process.env): ComputerControlClient | null {
    const url = env.SETSUNA_DESKTOP_COMPUTER_CONTROL_URL; const token = env.SETSUNA_DESKTOP_COMPUTER_CONTROL_TOKEN;
    return url && token ? new ComputerControlClient(url, token) : null;
  }
  async isEnabled(): Promise<boolean> {
    const response = await this.fetchImpl(`${this.url}/v1/computer/availability`, {
      headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error('Desktop settings unavailable.');
    const body = await response.json() as { enabled?: unknown };
    return body.enabled === true;
  }
  async execute(command: ComputerCommand, signal?: AbortSignal): Promise<ComputerResult> {
    const response = await this.fetchImpl(`${this.url}/v1/computer/command`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command), signal: AbortSignal.any([AbortSignal.timeout(computerCommandTimeout(command.kind, process.platform) + 2000), ...(signal ? [signal] : [])]),
    });
    const body = await response.json() as { error?: string; result?: ComputerResult };
    if (!response.ok) throw new Error(body.error ?? 'Desktop control failed.');
    if (body.result?.kind !== 'stopped' && body.result?.kind !== 'frame' && body.result?.kind !== 'windows') throw new Error('Invalid desktop response.');
    return body.result;
  }
}
