"""Compare relative Markdown file targets with the local origin/main merge base.

Scans every tracked Markdown file plus the two explicitly authored new guides.
Checks inline links/images and reference definitions outside fenced code; URL
schemes, absolute paths and anchor-only links are excluded. Fragment validity is
not asserted. Historical exceptions are reported separately, never hidden.
"""
import collections
import json
from pathlib import Path
import posixpath
import re
import subprocess
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
# Only immutable, dated/layout evidence may retain newly missing source links.
# Exact (document,target) pairs are frozen in the reviewed exception ledger.
EXCEPTIONS = OUT / 'historical-links.json'
INLINE = re.compile(r'!?\[[^\]\n]*\]\((?:<([^>\n]+)>|([^\s)]+))(?:\s+["\'][^\n]*?["\'])?\)')
REFERENCE = re.compile(r'^\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|([^\s]+))', re.M)
FENCES = re.compile(r'^\s*(`{3,}|~{3,})[^\n]*\n.*?^\s*\1[^\n]*$', re.M | re.S)


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode()


def inspect(files, revision=None):
    paths = set(files)
    broken = []
    for path in sorted(files):
        if not path.endswith('.md'):
            continue
        text = git('show', f'{revision}:{path}') if revision else (ROOT / path).read_text()
        text = FENCES.sub(lambda match: '\n' * match[0].count('\n'), text)
        for pattern in (INLINE, REFERENCE):
            for match in pattern.finditer(text):
                target = match[1] or match[2]
                decoded = unquote(target)
                url = urlsplit(decoded)
                if not url.path or url.scheme or decoded.startswith('/'):
                    continue
                destination = posixpath.normpath(posixpath.join(posixpath.dirname(path), url.path))
                exists = ((destination in paths or any(p.startswith(destination + '/') for p in paths))
                          if revision else (ROOT / destination).exists())
                if not exists:
                    broken.append({'path': path, 'line': text[:match.start()].count('\n') + 1,
                                   'target': target, 'destination': destination})
    return broken


def main():
    base = git('merge-base', 'HEAD', 'origin/main').strip()
    original = set(filter(None, git('ls-tree', '-rz', '--name-only', base).split('\0')))
    current = set(filter(None, git('ls-files', '-z').split('\0')))
    current.update({'DEVELOPMENT.md', 'docs/integration/monorepo-final-audit.md'})
    before = inspect(original, base)
    after = inspect(current)
    existing = {(r['path'], r['target']) for r in before}
    new = [r for r in after if (r['path'], r['target']) not in existing]
    exceptions = {(r['path'], r['target']) for r in json.loads(EXCEPTIONS.read_text())}
    retained = [r for r in new if (r['path'], r['target']) in exceptions]
    unexpected = [r for r in new if (r['path'], r['target']) not in exceptions]
    summary = {'base': base, 'base_markdown_files': sum(p.endswith('.md') for p in original),
               'current_tracked_markdown_files': sum(p.endswith('.md') for p in current if p not in {'DEVELOPMENT.md', 'docs/integration/monorepo-final-audit.md'}),
               'explicit_new_markdown_files': 2,
               'base_broken': len(before), 'current_broken': len(after),
               'new_raw_broken': len(new), 'new_historical_exceptions': len(retained),
               'new_unexpected_broken': len(unexpected),
               'development_broken': sum(r['path'] == 'DEVELOPMENT.md' for r in after)}
    (OUT / 'link-results.json').write_text(json.dumps({'summary': summary, 'base_broken': before,
                                                     'current_broken': after, 'new': new,
                                                     'unexpected': unexpected}, indent=2) + '\n')
    print(json.dumps(summary, indent=2))
    for row in unexpected:
        print(json.dumps(row))
    return int(bool(unexpected) or bool(summary['development_broken']))


if __name__ == '__main__':
    raise SystemExit(main())
