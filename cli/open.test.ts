import { openBrowser } from './open';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
}));
import { spawn } from 'node:child_process';

describe('openBrowser', () => {
  beforeEach(() => { (spawn as unknown as ReturnType<typeof vi.fn>).mockClear(); });

  it('uses cmd /c start on win32', () => {
    openBrowser('http://x', 'win32');
    expect(spawn).toHaveBeenCalledWith('cmd', ['/c', 'start', '', 'http://x'], expect.any(Object));
  });

  it('uses open on darwin', () => {
    openBrowser('http://x', 'darwin');
    expect(spawn).toHaveBeenCalledWith('open', ['http://x'], expect.any(Object));
  });

  it('uses xdg-open on linux', () => {
    openBrowser('http://x', 'linux');
    expect(spawn).toHaveBeenCalledWith('xdg-open', ['http://x'], expect.any(Object));
  });

  it('never throws if spawn throws', () => {
    (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw new Error('boom'); });
    expect(() => openBrowser('http://x', 'linux')).not.toThrow();
  });
});
