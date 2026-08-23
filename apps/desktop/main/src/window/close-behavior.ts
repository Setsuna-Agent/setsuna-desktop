import type { DesktopWindowCloseBehavior } from '@setsuna-desktop/contracts';
import type { DesktopWindowPreferencesPersistence } from './preferences.js';

export interface DesktopTrayVisibilityController {
  setEnabled(enabled: boolean): void;
}

export class DesktopWindowCloseBehaviorController {
  private closeBehavior: DesktopWindowCloseBehavior = 'quit';

  constructor(
    private readonly preferences: DesktopWindowPreferencesPersistence,
    private readonly tray: DesktopTrayVisibilityController,
    private readonly reportError: (message: string, error: unknown) => void = (message, error) => {
      console.error(message, error);
    },
  ) {}

  async initialize(): Promise<DesktopWindowCloseBehavior> {
    const storedCloseBehavior = await this.preferences.load();
    if (storedCloseBehavior === 'hide-to-tray') {
      try {
        this.tray.setEnabled(true);
        this.closeBehavior = storedCloseBehavior;
        return this.closeBehavior;
      } catch (error) {
        // Never hide a window without a working tray entry that can restore it.
        this.reportError('[window] unable to initialize the system tray', error);
        await this.preferences.save('quit').catch((saveError) => {
          this.reportError('[window] unable to persist the safe close behavior fallback', saveError);
        });
      }
    } else {
      this.tray.setEnabled(false);
    }
    this.closeBehavior = 'quit';
    return this.closeBehavior;
  }

  getCloseBehavior(): DesktopWindowCloseBehavior {
    return this.closeBehavior;
  }

  async setCloseBehavior(closeBehavior: DesktopWindowCloseBehavior): Promise<DesktopWindowCloseBehavior> {
    if (closeBehavior === this.closeBehavior) return this.closeBehavior;
    const previousCloseBehavior = this.closeBehavior;

    if (closeBehavior === 'hide-to-tray') {
      this.tray.setEnabled(true);
      try {
        await this.preferences.save(closeBehavior);
      } catch (error) {
        this.tray.setEnabled(previousCloseBehavior === 'hide-to-tray');
        throw error;
      }
    } else {
      await this.preferences.save(closeBehavior);
    }

    this.closeBehavior = closeBehavior;
    if (closeBehavior === 'quit') this.tray.setEnabled(false);
    return this.closeBehavior;
  }

  shouldHideWindow(exitInProgress: boolean): boolean {
    return !exitInProgress && this.closeBehavior === 'hide-to-tray';
  }
}
