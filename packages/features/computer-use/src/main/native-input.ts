import type { NativeModule } from '@zavora-ai/computer-use-mcp/host-native';
import { parseComputerKeystroke, type ComputerAction, type ComputerModifier } from '../contracts/index.js';
import type { DesktopInputFrame } from './backend.js';
import { InputAdmission } from './input-admission.js';

export type InputFrame = DesktopInputFrame;
const keys: Record<string, string> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Escape: 'escape', Backspace: 'backspace', Delete: 'delete', Tab: 'tab', Enter: 'enter', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown', Space: 'space' };
const modifiers: Record<ComputerModifier, string> = { Meta: 'win', Control: 'ctrl', Alt: 'alt', Shift: 'shift' };
export type NativeInputApi = Pick<NativeModule, 'getDisplaySize' | 'listDisplays' | 'mouseClick' | 'mouseMove' | 'mouseScroll' | 'keyPress' | 'typeText'>;

/** No screenshots, clipboard, scripting, MCP server or persistent key holds. */
export async function dispatchNativeInput(native: NativeInputApi, action: ComputerAction, frame: InputFrame, admission: InputAdmission, platform = process.platform): Promise<void> {
  admission.check();
  if (platform !== 'win32' || frame.display.inputCoordinateSpace !== 'windows-physical-pixels') throw new Error('Global desktop input is available on Windows only.');
  const expected = frame.display.inputBounds;
  const actual = native.getDisplaySize();
  if (native.listDisplays().length !== 1 || actual.width !== expected.width || actual.height !== expected.height || (actual.x ?? 0) !== expected.x || (actual.y ?? 0) !== expected.y || expected.x !== 0 || expected.y !== 0) throw new Error('Native input display geometry differs from the authorized capture.');
  if (!Number.isFinite(frame.width) || !Number.isFinite(frame.height) || frame.width <= 0 || frame.height <= 0) throw new Error('Invalid observation dimensions.');
  if ('x' in action) {
    if (!Number.isInteger(action.x) || !Number.isInteger(action.y) || action.x < 0 || action.y < 0 || action.x >= frame.width || action.y >= frame.height) throw new Error('Input coordinate outside the observation.');
    const x = action.x * expected.width / frame.width;
    const y = action.y * expected.height / frame.height;
    if (action.kind === 'click') native.mouseClick(x, y, 'left', 1);
    else {
      native.mouseMove(x, y);
      const delta = action.direction === 'up' ? -1 : 1;
      await admission.each(Array.from({ length: action.amount }), async () => { native.mouseScroll(delta, 0); });
    }
  } else if (action.kind === 'type') {
    await admission.each(action.text, async (text) => { native.typeText(text); });
  } else {
    const stroke = parseComputerKeystroke(action.key, action.modifiers);
    const key = keys[stroke.key] ?? stroke.key;
    native.keyPress([...(stroke.modifiers ?? []).map((modifier) => modifiers[modifier]), key].join('+'), 1);
  }
  admission.check();
}
