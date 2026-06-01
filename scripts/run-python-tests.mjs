import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = new URL('..', import.meta.url).pathname

const candidates = [
  process.env.SPRITESPLIT_PYTHON,
  join(root, '.venv', 'Scripts', 'python.exe'),
  join(root, '.venv', 'bin', 'python'),
  join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'bin', 'python3'),
  join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
  'python3.13',
  'python3.12',
  'python3.11',
  'python3.10',
  'python3',
  'python',
].filter(Boolean)

function isUsablePython(program) {
  if (program.includes('/') || program.includes('\\')) {
    if (!existsSync(program)) return false
  }

  const result = spawnSync(program, ['--version'], { encoding: 'utf8' })
  if (result.status !== 0) return false

  const match = `${result.stdout}${result.stderr}`.match(/Python\s+(\d+)\.(\d+)/)
  if (!match) return false

  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 3 || (major === 3 && minor >= 10)
}

const python = candidates.find(isUsablePython)

if (!python) {
  console.error('No usable Python runtime found. Set SPRITESPLIT_PYTHON to a Python 3.10+ executable.')
  process.exit(1)
}

const result = spawnSync(
  python,
  ['-m', 'unittest', 'discover', '-s', 'python_tests', '-p', 'test_*.py'],
  { cwd: root, stdio: 'inherit' },
)

process.exit(result.status ?? 1)
