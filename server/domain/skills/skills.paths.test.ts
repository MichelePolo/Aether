import path from 'node:path';
import { existsSync } from 'node:fs';
import { skillsDirFor, draftsDirFor, agentsDirFor, defaultsDir } from './skills.paths';

describe('skills paths', () => {
  it('skillsDirFor joins skills under the data dir', () => {
    expect(skillsDirFor('/data')).toBe(path.join('/data', 'skills'));
  });

  it('draftsDirFor nests .drafts under the skills dir', () => {
    expect(draftsDirFor('/data')).toBe(path.join('/data', 'skills', '.drafts'));
  });

  it('agentsDirFor joins agents under the library dir', () => {
    expect(agentsDirFor('/lib')).toBe(path.join('/lib', 'agents'));
  });

  it('defaultsDir resolves to an existing bundled defaults directory in dev', () => {
    const dir = defaultsDir();
    expect(path.isAbsolute(dir)).toBe(true);
    expect(dir.endsWith(path.join('skills', 'defaults'))).toBe(true);
    // In the dev/test tree the bundled defaults exist on disk.
    expect(existsSync(dir)).toBe(true);
  });
});
