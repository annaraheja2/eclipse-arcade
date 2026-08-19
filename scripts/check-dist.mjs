// Pre-deploy check: refuse to publish a build that silently lost Firebase.
//
// Vite inlines VITE_* vars at BUILD time. A build run without a .env therefore
// produces a perfectly valid bundle in which isFirebaseConfigured is false — and
// the app is designed to degrade quietly in that case, so nothing errors. It
// just has no sign-in, no friends, no invites and no multiplayer.
//
// That is fine for local work and fatal for the preview, and the difference is
// invisible unless something looks. Eight deploys shipped that way before anyone
// noticed, because each was verified by checking the NEW strings were present
// rather than checking the app still worked.
//
// Run between build and publish. Exits non-zero with an explanation.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const ASSETS = join(DIST, 'assets')

/** Things a working bundle must contain, with why they matter. */
const REQUIRED = [
  { name: 'Firebase API key', re: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: 'Firebase auth domain', re: /[a-z0-9-]+\.firebaseapp\.com/ },
  { name: 'Firebase project id', re: /projectId:"[^"]+"/ },
]

function fail(lines) {
  console.error(`\n  Refusing to deploy.\n`)
  for (const l of lines) console.error(`  ${l}`)
  console.error('')
  process.exit(1)
}

let files
try {
  files = readdirSync(ASSETS).filter((f) => f.endsWith('.js'))
} catch {
  fail([`No ${ASSETS} directory — run \`npm run build\` first.`])
}
if (files.length === 0) fail([`No JavaScript in ${ASSETS} — the build produced nothing.`])

const bundle = files.map((f) => readFileSync(join(ASSETS, f), 'utf8')).join('\n')

const missing = REQUIRED.filter((r) => !r.re.test(bundle))
if (missing.length > 0) {
  fail([
    `This build has no Firebase configuration, so the deployed app would have`,
    `no sign-in, no friends, no invites and no multiplayer.`,
    ``,
    `Missing: ${missing.map((m) => m.name).join(', ')}`,
    ``,
    `Copy .env.example to .env, fill in the VITE_FIREBASE_* values, and build`,
    `again. The values are the publishable web config from the Firebase console`,
    `(Project settings -> Your apps).`,
  ])
}

console.log(`  Bundle checked: Firebase configuration present in ${files.length} file(s).`)
