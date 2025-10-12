import { spawnSync, spawn } from 'node:child_process'

function runCli(args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn('sqlite3', args)
    let out='', err=''
    if (input) {
      p.stdin.write(input)
      p.stdin.end()
    }
    p.stdout.on('data', d => { out += d })
    p.stderr.on('data', d => { err += d })
    p.on('error', reject)
    p.on('close', code => {
      if (code !== 0) reject(new Error(err || `sqlite3 exit ${code}`))
      else resolve(out)
    })
  })
}

function runCliSync(args) {
  const r = spawnSync('sqlite3', args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr || `sqlite3 exit ${r.status}`)
  return r.stdout
}

class ShimDBHandle {
  constructor(path, flags) { this.path = path; this.flags = flags; this.isOpen = true }
  exec(sql) { runCli([this.path, sql]) }
  execSync(sql) { runCliSync([this.path, sql]) }
  async run(sql, params) { this.execSync(sql); return { changes: 0, lastInsertRowid: 0n } }
  runSync(sql, params) { this.execSync(sql); return { changes: 0, lastInsertRowid: 0n } }
  async get(sql) { const s = runCliSync(['-json', this.path, sql]); return JSON.parse(s||'[]')[0] }
  getSync(sql) { const s = runCliSync(['-json', this.path, sql]); return JSON.parse(s||'[]')[0] }
  async all(sql) { const s = runCliSync(['-json', this.path, sql]); return JSON.parse(s||'[]') }
  allSync(sql) { const s = runCliSync(['-json', this.path, sql]); return JSON.parse(s||'[]') }
  pragma(name, value) { if (value === undefined) return this.get(`PRAGMA ${name}`); else return this.exec(`PRAGMA ${name} = ${value}`) }
  pragmaSync(name, value) { if (value === undefined) return this.getSync(`PRAGMA ${name}`); else return this.execSync(`PRAGMA ${name} = ${value}`) }
  transaction(fn) { return fn() }
  transactionSync(fn) { return fn() }
  close() { this.isOpen = false }
  closeSync() { this.isOpen = false }
}

async function open(path=':memory:', flags=0) {
  return new ShimDBHandle(path, flags)
}
function openSync(path=':memory:', flags=0) {
  return new ShimDBHandle(path, flags)
}

export default { open, openSync }

