// 실행: node --test scripts/__tests__/install-sh.test.mjs
//
// install.sh는 npm을 거치지 않고 아카이브에서 파일을 골라 뽑아 node로 넘긴다.
// 그 부트스트랩은 사용자 머신에서만 도는 코드라, 깨져도 레포 안에서는 아무
// 신호가 없다 — 실제로 한 번 그렇게 깨졌다: `curl … | sh`는 셸이 스크립트
// 본문을 stdin으로 읽기 때문에, 대화형 입력을 살리려고 셸의 fd 0을 /dev/tty로
// 갈아끼웠더니 셸이 자기 소스를 잃고 나머지가 통째로 실행되지 않았다(진짜
// 터미널에서만 재현되는 무출력 실패). 아래 테스트는 그 부류를 잡는다.
//
// 네트워크는 쓰지 않는다. AIT_SETUP_ARCHIVE_BASE로 로컬 HTTP 서버를 물린다.
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(ROOT, 'install.sh')
const ARCHIVE_ROOT = 'apps-in-toss-harness-main'

let workdir
let server
let base

/** 세 경로만 담은 최소 아카이브를 만든다 — 부트스트랩이 소유한 건 그 배선뿐이다. */
function buildArchive(dest, { bin = true } = {}) {
  const stage = mkdtempSync(join(workdir, 'stage-'))
  const root = join(stage, ARCHIVE_ROOT)
  mkdirSync(join(root, 'scripts', 'setup'), { recursive: true })
  mkdirSync(join(root, '.claude-plugin'), { recursive: true })
  mkdirSync(join(root, 'packages', 'agent-plugin', '.claude-plugin'), { recursive: true })
  writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), '{}\n')
  writeFileSync(join(root, 'packages', 'agent-plugin', '.claude-plugin', 'plugin.json'), '{}\n')
  if (bin) {
    writeFileSync(
      join(root, 'scripts', 'setup', 'bin.mjs'),
      'console.log("FAKE-BIN " + process.argv.slice(2).join(" "))\n',
    )
  } else {
    writeFileSync(join(root, 'scripts', 'setup', 'other.mjs'), '\n')
  }
  execFileSync('tar', ['-czf', dest, '-C', stage, ARCHIVE_ROOT])
}


before(async () => {
  workdir = mkdtempSync(join(tmpdir(), 'ait-install-sh-'))
  const good = join(workdir, 'good.tgz')
  const noBin = join(workdir, 'nobin.tgz')
  buildArchive(good)
  buildArchive(noBin, { bin: false })

  server = createServer((req, res) => {
    // install.sh 가 만드는 URL 형상: /<owner>/<repo>/tar.gz/refs/heads/<ref>
    if (req.url?.endsWith('/tar.gz/refs/heads/main')) {
      res.writeHead(200, { 'content-type': 'application/gzip' })
      res.end(readFileSync(good))
    } else if (req.url?.endsWith('/tar.gz/refs/heads/nobin')) {
      res.writeHead(200, { 'content-type': 'application/gzip' })
      res.end(readFileSync(noBin))
    } else {
      res.writeHead(404)
      res.end('nope')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  server?.close()
  if (workdir) rmSync(workdir, { recursive: true, force: true })
})

const env = (extra = {}) => ({ ...process.env, AIT_SETUP_ARCHIVE_BASE: base, ...extra })

/** POSIX 전용 셸을 찾는다. 없으면 그 테스트는 건너뛴다. */
function dash() {
  for (const candidate of ['/bin/dash', '/usr/bin/dash']) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

describe('install.sh', () => {
  test('아카이브에서 설치기를 뽑아 인자를 그대로 넘긴다', async () => {
    const { stdout } = await run('sh', [SCRIPT, 'claude', '--dry-run'], { env: env() })
    assert.match(stdout, /FAKE-BIN claude --dry-run/)
  })

  test('curl | sh 형태에서도 동작한다 (셸이 본문을 stdin으로 읽는 경로)', async () => {
    const { stdout } = await run('sh', ['-c', `cat ${SCRIPT} | sh -s -- codex`], { env: env() })
    assert.match(stdout, /FAKE-BIN codex/)
  })

  test('제어 터미널이 없어도 stderr를 더럽히지 않는다', async () => {
    const { stderr } = await run('sh', ['-c', `cat ${SCRIPT} | sh -s -- claude`], { env: env() })
    assert.equal(stderr, '')
  })

  test('받지 못하면 조용히 넘어가지 않고 1로 죽는다', async () => {
    await assert.rejects(
      run('sh', [SCRIPT, '--help'], { env: env({ AIT_SETUP_REF: 'no-such-ref' }) }),
      (err) => {
        assert.equal(err.code, 1)
        assert.match(err.stderr, /소스를 받지 못했습니다/)
        return true
      },
    )
  })

  test('아카이브에 설치기가 없으면 그 사실을 말하고 죽는다', async () => {
    await assert.rejects(run('sh', [SCRIPT, '--help'], { env: env({ AIT_SETUP_REF: 'nobin' }) }), (err) => {
      assert.equal(err.code, 1)
      return true
    })
  })

  test('Node가 24 미만이면 설치기를 부르기 전에 막는다', async () => {
    const fakebin = mkdtempSync(join(workdir, 'fakenode-'))
    const node = join(fakebin, 'node')
    writeFileSync(node, '#!/bin/sh\n[ "$1" = "-v" ] && echo v20.11.0 || echo 20\n')
    chmodSync(node, 0o755)
    await assert.rejects(
      run('sh', [SCRIPT, '--help'], { env: env({ PATH: `${fakebin}:${process.env.PATH}` }) }),
      (err) => {
        assert.match(err.stderr, /Node 24/)
        return true
      },
    )
  })

  // macOS의 `sh`는 bash라, POSIX 전용 셸에서만 나는 결함은 로컬에서 영영 안
  // 잡힌다. 실제로 한 번 그렇게 통과했다: dash는 리다이렉션이 붙은 중괄호
  // 그룹이 if 조건에서 실패할 때 `set -e`를 잘못 발동시켜, 스크립트가 출력
  // 한 줄 없이 exit 2로 죽었다(서브셸에는 그 버그가 없다). CI(ubuntu, sh=dash)가
  // 잡아줬지만 push하기 전에 잡히는 편이 낫다.
  test('POSIX 전용 셸(dash)에서도 같게 동작한다', { skip: !dash() }, async () => {
    const sh = dash()
    const direct = await run(sh, [SCRIPT, 'claude'], { env: env() })
    assert.match(direct.stdout, /FAKE-BIN claude/)
    const piped = await run(sh, ['-c', `cat ${SCRIPT} | ${sh} -s -- codex`], { env: env() })
    assert.match(piped.stdout, /FAKE-BIN codex/)
    assert.equal(piped.stderr, '')
  })

  test('전송이 잘리면 반쪽 실행되지 않는다 (main() 감싸기 회귀)', async () => {
    // 닫는 중괄호와 `main "$@"` 이전에서 끊긴 스크립트.
    const full = readFileSync(SCRIPT, 'utf8')
    const truncated = full.slice(0, Math.floor(full.length * 0.6))
    // 자른 지점이 정말 main() 안쪽이어야 이 테스트가 무언가를 증명한다.
    assert.match(truncated, /main\(\) \{/)
    assert.doesNotMatch(truncated, /^main "\$@"/m)
    const cut = join(workdir, 'cut.sh')
    writeFileSync(cut, truncated)
    const { stdout, stderr } = await run('sh', ['-c', `sh ${cut} claude 2>&1 || true`], { env: env() })
    assert.doesNotMatch(stdout + stderr, /FAKE-BIN/)
    // 아무 일도 안 일어난 게 아니라, 문법 오류로 멈춘 것이어야 한다. 정확히
    // 어디서 잘리느냐에 따라 dash는 "unexpected end of file"을, bash는
    // "unexpected EOF while looking for matching ..."를 낸다 — 셸 방언에
    // 따라 문구가 갈리므로 둘 다 받는다.
    assert.match(stdout + stderr, /(syntax error|unexpected (end of file|eof))/i)
  })
})
