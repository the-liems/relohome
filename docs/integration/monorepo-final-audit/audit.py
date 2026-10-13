"""Read-only combined-tree audit; run from the repository root with its Python.

Reuses reviewed slice decisions by exact path/text. Unrecognized hits are bugs,
so changed evidence requires review rather than inheriting a shifted line number.
Generated audits and this helper are excluded to avoid recursive evidence.
"""
import ast
import collections
import csv
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/integration/monorepo-final-audit'
EXCLUDED = {
    'docs/integration/monorepo-final-audit.md',
    'docs/integration/location-relocation/path-audit.tsv',
    'docs/integration/location-relocation/lifeflow-audit.tsv',
    'docs/integration/location-relocation/audit-summary.json',
    'docs/integration/python-examples-and-shims/remaining-references.tsv',
}
# Broad src/ intentionally catches canonical app/package-local source directories.
SEARCHES = {
    'old-roots': re.compile(r'Frontend[/\\.]|Maps(?: |%20)VN[/\\]LifeFlow|(?<![\w])src[/\\.]|(?<![\w])demo\.[A-Za-z_]|lifeflow-map-app|(?:pre)?dev:lifeflow|(?:Start|Stop)-LifeFlow|@lifeflow/'),
    'lifeflow': re.compile('lifeflow', re.I),
}
HISTORICAL_FILES = {
    'README_boilerplate.md', 'JOURNAL.md', 'WORKLOG.md',
    'location-service-requests.md', 'docs/moving-and-orchestrator-requests.md',
    'docs/integration/location-data-status.md', 'docs/integration/location-service-change-plan.md',
    'docs/integration/location-service-implementation-status.md',
    'docs/integration/moving-service-response.md', 'docs/integration/typescript-relocation-validation.md',
    'docs/location/CHECKPOINT-RESOLVE-LOCATION-SEARCH-AREAS.md', 'docs/location/HOUSING-DATA-IMPORT.md',
    'docs/location/HOUSING-QUERY-IMPLEMENTATION.md', 'docs/location/MAP-FILE-AUDIT-AND-HANDOFF.md',
    'docs/location/MCP-CONTAINER-HANDOFF.md', 'docs/location/POI-CANONICALIZATION.md',
    'docs/location/LIFEFLOW-MCP-POSTGIS-PLAN.md',
    'CHECKPOINT-POI-INGESTION-V2.md', 'tasks/plan.md', 'tasks/todo.md',
    'apps/web/PRODUCTION_UI_AUDIT.md', 'apps/web/ROOMMATE_UI_HANDOFF.md',
    'apps/web/SERVICE_AUDIT.md', 'docs/integration/monorepo-inventory.md',
    'docs/integration/llm-agents-handoff.md', 'docs/integration/location-service-response.md',
    'docs/integration/siu-ai-agent-first-frontend-plan.md',
    'docs/architecture/agent-graph.md', 'docs/architecture/mvp-architecture.md',
    'docs/intake-llm.md', 'docs/design/roommate-discovery.md',
    'docs/ideas/roommate-service.md', 'docs/ideas/housing-platform-upgrade.md',
    'docs/integration/python-packaging.md', 'docs/integration/siu-ai-frontend-screen-design.md',
    'docs/integration/roommate-backend-checkpoint.md',
    'docs/integration/location-relocation.md', 'docs/integration/python-examples-and-shims.md',
    'docs/integration/web-gateway-relocation.md', 'docs/integration/agent-app-relocation.md',
}


def historical(path):
    return (path in HISTORICAL_FILES or bool(re.search(r'2026-\d\d-\d\d', path))
            or path.startswith(('docs/adr/', 'docs/review/', 'eval/', 'presentation/',
                                    'docs/integration/monorepo-baseline/',
                                    'docs/integration/monorepo-tooling/',
                                    'docs/integration/agent-app-relocation/',
                                    'docs/integration/web-gateway-relocation/',
                                    'docs/integration/python-examples-and-shims/',
                                    'docs/integration/location-relocation/')))


def slice_decisions():
    decisions = {}
    for filename in ('location-relocation/path-audit.tsv', 'location-relocation/lifeflow-audit.tsv'):
        with (ROOT / 'docs/integration' / filename).open() as source:
            for row in csv.DictReader(source, delimiter='\t'):
                decisions[(row['path'], row['text'])] = (row['classification'], row['reason'])
    return decisions


def classify(path, text, decisions):
    # Existing data and public-path safety checks take precedence over branding.
    if re.search(r'Frontend/(?:data|public)|Maps VN[/\\]LifeFlow[/\\](?:\.env|\.runtime)', text):
        return 'runtime-data path', 'M24 fixed state/credential/media path or legacy public-path exclusion'
    if path in {'.gitignore', '.dockerignore'} and 'Frontend/' in text:
        return 'runtime-data path', 'M24 ignored legacy generated/runtime artifacts; no active source'
    if 'src.agents.models' in text and not historical(path):
        return 'preserved identifier', 'M24 persisted checkpoint alias; #114/#115 serializer contract and rollback readers (not a source shim)'
    if historical(path):
        return 'historical', 'M23 dated evidence, pinned inventory/accounting, ADR rationale or migration transcript'
    if re.search(r'LIFEFLOW_(?:API_BASE_URL|ENV_FILE|MAP_TEST_URL|LIVE_LLM)', text):
        return 'preserved identifier', 'M16 external env/opt-in interface; existing spelling and precedence retained'
    if 'lifeflow:' in text:
        return 'preserved identifier', 'M18 persisted workflow/provenance/idempotency input'
    if 'lifeflow.ci.' in text:
        return 'preserved identifier', 'M15 CI ownership label; cleanup producer/filter agreement'
    prior = decisions.get((path, text))
    if prior and prior[0] != 'bug':
        return prior
    if path.startswith('examples/design-reference/'):
        return 'historical', 'M23 byte-preserved static design artifact; not a supported application'
    if path == 'tests/test_llm_agents/test_mission_quality_live.py' and 'baseline_module(' in text:
        return 'historical', 'M23 git-show input at BASELINE_COMMIT, not a current import/source path'
    if path.endswith(('agents/common.py', 'agents/llm.py')) and 'src/agent_services/' in text:
        return 'historical', 'M23 source provenance comment citing the former branch'
    if path.startswith('docs/guide/') and 'src/' in text:
        return 'historical', 'M23 illustrative template/coverage/Next.js teaching example; P-044 current setup links DEVELOPMENT.md'
    if path == 'apps/web/README.md' and 'Git diff backend `src/`' in text:
        return 'historical', 'M23 dated UI verification statement; not a current source path'
    if path.startswith('apps/web/') and (path.endswith('README.md') or '/tests/' in path) and ('src/' in text or 'Frontend.' in text):
        return 'preserved identifier', 'M22 canonical app-local TS source path or generic frontend prose; no root Python caller'
    if ('src/' in text and not re.search(r'Frontend[/\\.]|Maps(?: |%20)VN[/\\]LifeFlow|(?<![\w/])src\.|(?<![\w])demo\.|lifeflow', text, re.I)
            and (path.startswith(('apps/', 'packages/', 'examples/')) or
                 re.search(r'(?:apps|packages|examples)/\S*/src/|src/relohome_', text))):
        return 'preserved identifier', 'M03/M22 canonical app/package-local src layout or relative workspace command; not retired repository src/'
    if re.search(r'\bdemo\.[A-Za-z_]', text) and path.endswith('.py') and 'import' not in text:
        return 'preserved identifier', 'M22 local variable/member named demo; not a demo namespace import'
    if re.search(r'(?:^|[^A-Za-z])demo\.(?:py|md|json|png)\b', text):
        return 'preserved identifier', 'M22 file basename/suffix, not a generic demo import namespace'
    if path.startswith('docs/guide/') and 'Frontend.' in text:
        return 'preserved identifier', 'M22 generic frontend prose, not a Python namespace'
    if path == 'ARCHITECTURE.md' and '`Frontend/` has no source' in text:
        return 'historical', 'M23 explicit retirement statement; current implementation is canonical'
    if path == 'docs/specs/SPEC-001-goal-understanding.md' and 'src/agent_services' in text:
        return 'historical', 'M23 explicitly labeled old ADR-006 HTTP/container design'
    if path == 'docs/architecture/intake-llm.md' and 'src/agent_services' in text:
        return 'historical', 'M23 comparison/provenance of previous implementation'
    if path == 'DEVELOPMENT.md':
        return 'preserved identifier', 'M14/M17 existing Compose/service identity; runtime paths handled as M24 above'
    return 'bug', 'Unreviewed operational reference; requires correction or an explicit decision'


def main():
    files = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    # Explicit new authored input before staging; no untracked/ignored user data is read.
    files = sorted(set(filter(None, files)) | {'DEVELOPMENT.md', 'docs/integration/monorepo-final-audit.md'})
    decisions = slice_decisions()
    rows = []
    for path in files:
        if path in EXCLUDED or path.startswith('docs/integration/monorepo-final-audit/'):
            continue
        if re.search(r'^(?:Frontend/|src/|Maps VN/LifeFlow/)|lifeflow', path, re.I):
            category = 'historical' if historical(path) or path.startswith('docs/location/') else 'bug'
            rows.append(('tracked-paths', path, 0, category, 'M23 historical document basename; not an active implementation root' if category == 'historical' else 'Unreviewed legacy tracked path'))
        try:
            lines = (ROOT / path).read_text().splitlines()
        except (UnicodeError, FileNotFoundError):
            continue  # Binary/LFS payloads and deleted files are outside text audit.
        for number, text in enumerate(lines, 1):
            for search, pattern in SEARCHES.items():
                if pattern.search(text):
                    category, reason = classify(path, text, decisions)
                    rows.append((search, path, number, category, reason))
    with (OUT / 'references.tsv').open('w') as output:
        writer = csv.writer(output, delimiter='\t', lineterminator='\n')
        writer.writerow(('search', 'path', 'line', 'classification', 'reason'))
        writer.writerows(rows)
    counts = {search: dict(sorted(collections.Counter(row[3] for row in rows if row[0] == search).items()))
              for search in (*SEARCHES, 'tracked-paths')}
    legacy_files = [path for path in files if path.startswith('src/') or
                    (path.startswith('Frontend/') and path.endswith('.py')) or
                    path.startswith('Maps VN/LifeFlow/')]
    counts['legacy-source-files'] = legacy_files
    counts['compatibility'] = json.loads((ROOT / 'packages/python/compatibility.json').read_text())
    counts['legacy-python-imports'] = []
    for path in files:
        if not path.endswith('.py') or not path.startswith(('apps/', 'packages/python/', 'examples/', 'scripts/', 'tests/')):
            continue
        for node in ast.walk(ast.parse((ROOT / path).read_text(), filename=path)):
            names = ([alias.name for alias in node.names] if isinstance(node, ast.Import) else
                     [node.module or ''] if isinstance(node, ast.ImportFrom) and node.level == 0 else [])
            for name in names:
                if name.split('.')[0] in {'src', 'Frontend', 'demo'}:
                    counts['legacy-python-imports'].append({'path': path, 'line': node.lineno, 'import': name})
    counts['src-directory-exists'] = (ROOT / 'src').exists()
    counts['frontend-python-files'] = [str(path.relative_to(ROOT)) for path in (ROOT / 'Frontend').rglob('*.py')]
    guide = (ROOT / 'DEVELOPMENT.md').read_text()
    npm_commands = set(re.findall(r'npm run ([\w:-]+)', guide))
    make_commands = set(re.findall(r'make ([\w-]+)', guide))
    scripts = json.loads((ROOT / 'package.json').read_text())['scripts']
    targets = set(re.findall(r'^([\w-]+):', (ROOT / 'Makefile').read_text(), re.M))
    project_roots = [str(path.relative_to(ROOT)) for parent in ('apps', 'packages', 'packages/python', 'examples', 'deploy')
                     for path in (ROOT / parent).iterdir() if path.is_dir() and path.name != 'python']
    counts['development-guide'] = {
        'npm-commands': len(npm_commands), 'make-targets': len(make_commands), 'project-roots': len(project_roots),
        'missing-npm-commands': sorted(npm_commands - scripts.keys()), 'missing-make-targets': sorted(make_commands - targets),
        'missing-ownership-roots': sorted(path for path in project_roots if f'`{path}/`' not in guide),
    }
    with (OUT / 'summary.json').open('w') as output:
        json.dump(counts, output, indent=2, sort_keys=True)
        output.write('\n')
    print(json.dumps(counts, indent=2, sort_keys=True))
    for search, path, number, category, reason in rows:
        if category == 'bug':
            print(f'{search}\t{path}:{number}\t{(ROOT / path).read_text().splitlines()[number - 1] if number else path}')
    return int(any(row[3] == 'bug' for row in rows) or bool(legacy_files) or
               bool(counts['legacy-python-imports']) or counts['src-directory-exists'] or
               bool(counts['frontend-python-files']) or
               any(counts['development-guide'][key] for key in ('missing-npm-commands', 'missing-make-targets', 'missing-ownership-roots')))


if __name__ == '__main__':
    raise SystemExit(main())
