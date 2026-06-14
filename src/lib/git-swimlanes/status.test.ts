import { parseStatusPorcelain } from './status';

describe('parseStatusPorcelain', () => {
  it('parses branch header + ahead/behind', () => {
    const r = parseStatusPorcelain('# branch.head main\n# branch.ab +2 -1\n');
    expect(r.branch).toBe('main');
    expect(r.ahead).toBe(2);
    expect(r.behind).toBe(1);
  });

  it('splits staged (X) and unstaged (Y) from ordinary "1" lines', () => {
    // X=M (staged modified), Y=. → staged only
    const staged = parseStatusPorcelain('1 M. N... 100644 100644 100644 aaa bbb a.txt\n');
    expect(staged.staged).toEqual([{ path: 'a.txt', status: 'modified' }]);
    expect(staged.unstaged).toEqual([]);
    // X=. Y=M → unstaged only
    const unstaged = parseStatusPorcelain('1 .M N... 100644 100644 100644 aaa bbb b.txt\n');
    expect(unstaged.unstaged).toEqual([{ path: 'b.txt', status: 'modified' }]);
    expect(unstaged.staged).toEqual([]);
  });

  it('handles a file both staged and modified', () => {
    const r = parseStatusPorcelain('1 MM N... 100644 100644 100644 aaa bbb c.txt\n');
    expect(r.staged).toEqual([{ path: 'c.txt', status: 'modified' }]);
    expect(r.unstaged).toEqual([{ path: 'c.txt', status: 'modified' }]);
  });

  it('parses untracked, deleted, renamed (with oldPath), conflicted', () => {
    const text = [
      '? new.txt',
      '1 D. N... 100644 000000 000000 aaa bbb gone.txt',
      '2 R. N... 100644 100644 100644 aaa bbb R100 newname.txt\toldname.txt',
      'u UU N... 100644 100644 100644 100644 a b c conflict.txt',
    ].join('\n');
    const r = parseStatusPorcelain(text);
    expect(r.untracked).toEqual([{ path: 'new.txt', status: 'untracked' }]);
    expect(r.staged).toContainEqual({ path: 'gone.txt', status: 'deleted' });
    expect(r.staged).toContainEqual({ path: 'newname.txt', oldPath: 'oldname.txt', status: 'renamed' });
    expect(r.conflicted).toEqual([{ path: 'conflict.txt', status: 'conflicted' }]);
  });

  it('returns all-empty for a clean repo', () => {
    const r = parseStatusPorcelain('# branch.head main\n# branch.ab +0 -0\n');
    expect(r.staged).toEqual([]);
    expect(r.unstaged).toEqual([]);
    expect(r.untracked).toEqual([]);
    expect(r.conflicted).toEqual([]);
  });
});
