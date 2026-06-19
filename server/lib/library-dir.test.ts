import path from 'node:path';
import { defaultLibraryDir } from './library-dir';

describe('defaultLibraryDir', () => {
  it('uses %APPDATA%/Aether on Windows when APPDATA is set', () => {
    const r = defaultLibraryDir({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
      homedir: 'C:\\Users\\me',
    });
    expect(r).toBe(path.join('C:\\Users\\me\\AppData\\Roaming', 'Aether'));
  });

  it('falls back to ~/AppData/Roaming/Aether on Windows without APPDATA', () => {
    const r = defaultLibraryDir({ platform: 'win32', env: {}, homedir: 'C:\\Users\\me' });
    expect(r).toBe(path.join('C:\\Users\\me', 'AppData', 'Roaming', 'Aether'));
  });

  it('uses ~/Library/Application Support/Aether on macOS', () => {
    const r = defaultLibraryDir({ platform: 'darwin', env: {}, homedir: '/Users/me' });
    expect(r).toBe(path.join('/Users/me', 'Library', 'Application Support', 'Aether'));
  });

  it('uses $XDG_DATA_HOME/aether on Linux when set', () => {
    const r = defaultLibraryDir({ platform: 'linux', env: { XDG_DATA_HOME: '/custom/share' }, homedir: '/home/me' });
    expect(r).toBe(path.join('/custom/share', 'aether'));
  });

  it('falls back to ~/.local/share/aether on Linux without XDG_DATA_HOME', () => {
    const r = defaultLibraryDir({ platform: 'linux', env: {}, homedir: '/home/me' });
    expect(r).toBe(path.join('/home/me', '.local', 'share', 'aether'));
  });
});
