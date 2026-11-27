import { tmpdir } from 'node:os';
import path from 'node:path';
import { shell, type BrowserWindow } from 'electron';
import type { DesignExportFileAction, DesignPreparedExport } from '../../contracts/design-export.js';
import {
  prepareDesignExport, removeExportDirectory, savePreparedDesignExport, type DesignPackageMainHost, type PreparedDesignFile,
} from './design-export-files.js';

type ExportJob = {
  id: string;
  controller: AbortController;
  file?: PreparedDesignFile;
  saved?: string;
  action?: Promise<string | null>;
};

export class DesignPreparedExports {
  private readonly jobs = new Map<number, ExportJob>();
  private readonly retainedDirectories = new Set<string>();

  constructor(private readonly host: DesignPackageMainHost, private readonly temporaryRoot = tmpdir()) {}

  async prepare(owner: number, id: string, input: unknown, requestSignal: AbortSignal): Promise<DesignPreparedExport | null> {
    if (this.jobs.has(owner)) throw new Error('A design export is already open.');
    const job: ExportJob = { id, controller: new AbortController() };
    this.jobs.set(owner, job);
    const signal = AbortSignal.any([requestSignal, job.controller.signal]);
    try {
      const file = await prepareDesignExport(input, this.host, this.temporaryRoot, signal);
      if (signal.aborted) {
        await removeExportDirectory(file.directory);
        return null;
      }
      job.file = file;
      return { name: file.name, archive: file.archive };
    } catch (error) {
      if (signal.aborted) return null;
      throw error;
    } finally {
      if (!job.file && this.jobs.get(owner) === job) this.jobs.delete(owner);
    }
  }

  async use(owner: number, window: BrowserWindow, id: string, action: DesignExportFileAction, requestSignal: AbortSignal) {
    const job = this.jobs.get(owner);
    if (job?.id !== id || !job.file || job.action) throw new Error('The design export is unavailable.');
    const signal = AbortSignal.any([requestSignal, job.controller.signal]);
    const file = job.file;
    job.action = this.useFile(window, job, file, action, signal);
    try {
      return await job.action;
    } catch (error) {
      if (signal.aborted) return null;
      throw error;
    } finally {
      job.action = undefined;
    }
  }

  private async useFile(window: BrowserWindow, job: ExportJob, file: PreparedDesignFile, action: DesignExportFileAction, signal: AbortSignal) {
    signal.throwIfAborted();
    if (action === 'save') {
      const saved = await savePreparedDesignExport(window, file, signal);
      if (saved) job.saved = saved;
      return saved ? path.basename(saved) : null;
    }
    const target = job.saved ?? file.path;
    if (action === 'open') {
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
    } else {
      shell.showItemInFolder(target);
    }
    // External viewers may still read a revealed or opened temporary file after the dialog closes.
    if (!job.saved) this.retainedDirectories.add(file.directory);
    return null;
  }

  async close(owner: number, id?: string) {
    const job = this.jobs.get(owner);
    if (!job || (id !== undefined && job.id !== id)) return;
    this.jobs.delete(owner);
    job.controller.abort();
    await job.action?.catch(() => undefined);
    if (job.file && !this.retainedDirectories.has(job.file.directory)) await removeExportDirectory(job.file.directory);
  }

  async dispose() {
    await Promise.all([...this.jobs.keys()].map((owner) => this.close(owner)));
    await Promise.all([...this.retainedDirectories].map(removeExportDirectory));
    this.retainedDirectories.clear();
  }
}
