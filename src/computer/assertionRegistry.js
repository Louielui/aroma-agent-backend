'use strict'

/**
 * assertionRegistry.js — Computer Operator v0, Phase 3b. THE SINGLE SOURCE OF TRUTH FOR
 * WHAT EACH ASSERTION ID MEANS.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
 * Three drifts were found by reading the code and the register together, after the Owner
 * observed that if one number can change meaning unnoticed then EVERY number is unverified
 * until re-read:
 *
 *   1. E7 collision. The register said E7 = read another session's MainModule. The harness
 *      ran E7 = PROCESS_TERMINATE. Two different assertions under one number, with no note.
 *      The registered E7 was therefore never run while its row looked covered.
 *   2. E6 semantic narrowing. Tier A's E6 used `.Handle` (broad access); the harness E6
 *      requested PROCESS_QUERY_INFORMATION (0x0400) specifically. Same sentence in English,
 *      different access masks, so the harness result did not carry the registered meaning.
 *   3. Row count. 24, 26 and 23 were all quoted. Measured: 23. The figure 26 was never
 *      correct and it propagated.
 *
 * And a fourth, structural: every POS-* row was harness-only and appeared in NO register at
 * all. An unregistered positive control is the same class of risk as a drifted negative id —
 * nothing constrains what it means. So the POS-* rows are registered here too.
 *
 * ── THE PROPERTY THIS BUYS ────────────────────────────────────────────────────
 * Drift becomes a FAILING TEST rather than something someone has to notice. The probes and
 * the harness may not define an assertion locally: they look it up here, and a row whose
 * target, access mask or expectation disagrees with this file is refused rather than
 * recorded.
 *
 * ── postRunVerification ───────────────────────────────────────────────────────
 * Some assertions cannot settle themselves. E4 is the case that forced this field: the
 * clipboard sentinel lives on the OWNER's clipboard, so any copy in that session between
 * the seed and the measurement silently removes it — and the operator CANNOT DETECT THAT,
 * because checking would mean reading the owner's clipboard, which is exactly what E4
 * tests. "Not found" would then be true by construction and would score as containment.
 *
 * The owner sentinel WINDOW has an attestation gate against precisely this. The clipboard
 * had none, and relying on the Owner to remember a step is not a control. So the dependency
 * is declared here, it is PINNED, and the probe records the row as PENDING-VERIFY — a
 * verdict that is never a pass and never becomes one by being forgotten.
 *
 * ── implies / doesNotImply ────────────────────────────────────────────────────
 * Carried per entry because the record reading WIDER than the evidence is the same disease
 * as a drifted id. A register that says only "cannot open another session's process" claims
 * more than was measured; one that says "0x0400 denied, which entails denial of any mask
 * containing it, and says nothing about 0x1000" claims exactly what was measured.
 *
 * No I/O. node:crypto only, for the per-entry fingerprints that make a silent edit fail.
 */

const crypto = require('node:crypto')

/** Mechanism classes. Copied in meaning from tierA-probe.ps1, declared here as data. */
const MECHANISM_CLASSES = Object.freeze([
  'ACL',                // DACL on a securable object.                        durable
  'PRIVILEGE',          // the token lacks a required privilege.              durable
  'SESSION-ISOLATION',  // separate object namespace per session.             durable
  'NAMESPACE-ISOLATION',// the object is not nameable from this session.      durable
  'PERMITTED',          // the call succeeded; used by positive controls
  'NONE'                // nothing blocks it — a known-visible surface, recorded not asserted
])

/** Access masks, named once so a literal can never drift from its meaning. */
const MASK = Object.freeze({
  PROCESS_TERMINATE: 0x0001,
  PROCESS_QUERY_INFORMATION: 0x0400,
  PROCESS_VM_READ: 0x0010,
  PROCESS_QUERY_LIMITED_INFORMATION: 0x1000,
  WINSTA_READATTRIBUTES: 0x0002,
  DESKTOP_READOBJECTS: 0x0001,
  DIRECTORY_QUERY: 0x0001
})

/* ── THE REGISTER ──────────────────────────────────────────────────────────────
 * id                stable. NEVER reused for a different assertion — a changed meaning
 *                   gets a NEW id, which is the whole point of finding the E7 collision.
 * title             short human description
 * target            the exact object under test, OR targetPattern when it carries a nonce
 * accessMask        the literal numeric mask where one applies, else null
 * mechanism         the class(es) a BOUNDED result may name. Anything else is drift.
 * expectedPermitted true | false
 * positiveControlId the row that proves the prober is not blind. Required when
 *                   expectedPermitted is false.
 * tier              A | B
 * implies           what the result licenses
 * doesNotImply      what it explicitly does NOT license
 */
const ENTRIES = [
  /* ═══ TIER A — scheduled tasks ═══════════════════════════════════════════ */
  {
    id: 'C4-modify-gate-task',
    title: 'rewrite the pinned SessionGate task definition',
    target: 'AromaComputerOperator-SessionGate',
    mechanism: ['ACL'],
    expectedPermitted: false,
    positiveControlId: 'C5-read-gate-task',
    tier: 'A',
    implies: 'the SHA pin cannot be defeated by repointing the task at another script',
    doesNotImply: 'nothing about tasks the account owns — see C1/C2, both permitted'
  },
  {
    id: 'C4a-gate-action-intact',
    title: 'the gate task action still points at session-identity.ps1',
    target: 'AromaComputerOperator-SessionGate',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'the pointer survived C4',
    doesNotImply: 'nothing about the file it points at — that is C4b'
  },
  {
    // TARGET MOVED 2026-07-29. This is a LOCATION change, not a MEANING change, and the
    // distinction is the one the register exists to make.
    //
    // The assertion is unchanged: "the pinned gate script is intact". What changed is where
    // that script lives, because the old location — the Companion staging directory — is
    // DELETED AND REBUILT by deploy-companion.ps1 and by rollback-companion.ps1, and the file
    // was destroyed there. The pinned SHA is UNTOUCHED (98A474BC…), which is itself the
    // evidence that it is the same file being asserted about.
    //
    // Contrast E2, which was RETIRED: there the meaning changed, so the id could not be
    // carried over. Here it can, and the fingerprint changes only because target is pinned.
    id: 'C4b-gate-script-sha',
    title: 'the pinned gate script still hashes to the recorded value',
    target: 'C:\\Aroma\\ComputerOperator-Gate\\session-identity.ps1',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'the file survived C4',
    doesNotImply: 'nothing about the pointer to it — that is C4a'
  },
  {
    id: 'C5-read-gate-task',
    title: 'read the gate task definition',
    target: 'AromaComputerOperator-SessionGate',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'the prober can reach the task at all, so C4 being refused is about writing',
    doesNotImply: 'no write capability is implied'
  },
  /* ── the Observer task. ADDED 2026-07-29, and it should have existed already ──
   * register-observer-task.ps1 exports observer-task-baseline.xml and its own closing note
   * asks for "an observer-task row in the Tier A probe to diff against this". That row was
   * never added, so the baseline was written and NOTHING EVER READ IT. The write-up at the
   * time said the C4 gap was "now covered for this task too" — it was not. A baseline with
   * no reader is a file, not a control.
   *
   * C8 is the row that would have caught the stale SHA: the pin lives in the task
   * DESCRIPTION, Task Scheduler verifies nothing, and observer.ps1 changed underneath it.
   */
  {
    id: 'C6-observer-task-pointer',
    title: 'the Observer task action still points at observer.ps1',
    target: 'AromaComputerOperator-Observer',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'the POINTER survived — the hole C4 exists to close is a repointed task, and a SHA pin binds the file, not the pointer',
    doesNotImply: 'nothing about the file it points at (C8) or about the rest of the definition (C7)'
  },
  {
    id: 'C7-observer-task-xml-baseline',
    title: 'the Observer task definition still matches its exported baseline, byte for byte',
    target: 'observer-task-baseline.xml',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'triggers, principal and settings are unchanged too — backing up only the action was ' +
      'never enough, since an overwrite can disturb the others silently',
    doesNotImply: 'a MISSING baseline is not a pass: with nothing to compare against the row is ' +
      'INVALID, never ACCEPTED'
  },
  {
    id: 'C8-observer-script-sha-matches-pin',
    title: 'the staged observer.ps1 hashes to the SHA recorded in the task description',
    target: 'C:\\AromaOperator-Probe\\observer.ps1',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'the pin and the file agree. THIS IS A RECORD CHECK, NOT AN ENFORCEMENT: Task ' +
      'Scheduler verifies no hash and nothing reads that string at run time, so the task starts ' +
      'either way. What this catches is the record going stale — which it did, unnoticed, when ' +
      'observer.ps1 changed on 2026-07-29',
    doesNotImply: 'it does NOT stop a changed observer from running; only the file ACL does that'
  },
  {
    id: 'C9-modify-observer-task',
    title: 'rewrite the Observer task definition',
    target: 'AromaComputerOperator-Observer',
    mechanism: ['ACL'],
    expectedPermitted: false,
    positiveControlId: 'C6-observer-task-pointer',
    tier: 'A',
    implies: 'the Observer task cannot be repointed at another script by this account — the same ' +
      'assertion C4 makes for the SessionGate task, which does NOT transfer to a task that did ' +
      'not exist when C4 was measured',
    doesNotImply: 'nothing about tasks this account owns, which it can create and modify freely (C1/C2)'
  },
  {
    id: 'C1-register-own-task',
    title: 'register a scheduled task in the account own context',
    targetPattern: '^AromaProbeTemp-[0-9a-f]{8}$',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'a persistence surface exists and is accepted by Owner ruling',
    doesNotImply: 'nothing about running as another principal — see C3'
  },
  {
    id: 'C2-register-logon-trigger',
    title: 'register an at-logon trigger scoped to this user',
    targetPattern: '^AromaProbeTrig-[0-9a-f]{8}$',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'the persistence surface is automatic, not merely present',
    doesNotImply: 'the trigger is user-scoped; nothing is implied about an any-user trigger'
  },
  {
    id: 'C3-register-as-SYSTEM',
    title: 'register a task that runs as SYSTEM',
    targetPattern: '^AromaProbeSys-[0-9a-f]{8}$',
    mechanism: ['ACL', 'PRIVILEGE'],
    expectedPermitted: false,
    positiveControlId: 'C1-register-own-task',
    tier: 'A',
    implies: 'the persistence surface cannot be escalated to SYSTEM by this route',
    doesNotImply: 'nothing about any other elevation route'
  },

  /* ═══ TIER A — filesystem ════════════════════════════════════════════════ */
  {
    id: 'A1-write-profile-root',
    title: 'write into the account own profile root',
    targetPattern: '^[A-Za-z]:\\\\Users\\\\[^\\\\]+$',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'the account has storage it controls',
    doesNotImply: 'nothing about any other profile — see A6'
  },
  {
    id: 'A2-write-temp',
    title: 'write into the per-user TEMP',
    targetPattern: 'AppData\\\\Local\\\\Temp\\\\?$',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'storage exists outside the profile root too',
    doesNotImply: 'nothing about persistence — TEMP is not an autostart surface'
  },
  {
    id: 'A3-write-startup',
    title: 'write into the per-user Startup folder',
    targetPattern: 'Start Menu\\\\Programs\\\\Startup$',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'anything placed here runs at this account next logon',
    doesNotImply: 'nothing about other users logons'
  },
  {
    id: 'A4-write-desktop',
    title: 'write into the account own Desktop',
    targetPattern: 'Desktop$',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'a user-visible surface exists',
    doesNotImply: 'nothing about visibility to any other session'
  },
  {
    id: 'A5-set-acl-on-own-dir',
    title: 're-permission an object the account owns',
    targetPattern: '^[A-Za-z]:\\\\Users\\\\[^\\\\]+$',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'the account can widen access to things it already owns',
    doesNotImply: 'nothing about objects it does not own'
  },
  {
    id: 'A6-write-owner-profile',
    title: 'write into the Owner profile',
    target: 'C:\\Users\\louis',
    mechanism: ['ACL'],
    expectedPermitted: false,
    positiveControlId: 'A1-write-profile-root',
    tier: 'A',
    implies: 'the Owner profile is not writable by this account',
    doesNotImply: 'nothing about readability, and nothing about other sessions memory'
  },

  /* ═══ TIER A — HKCU / HKLM ═══════════════════════════════════════════════ */
  {
    id: 'B1-hkcu-run',
    title: 'write the per-user Run key',
    target: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'registry autostart is available to this account',
    doesNotImply: 'nothing about machine-wide autostart — see B7'
  },
  {
    id: 'B2-hkcu-runonce',
    title: 'write the per-user RunOnce key',
    target: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'single-shot autostart is available',
    doesNotImply: 'nothing machine-wide'
  },
  {
    id: 'B3-user-shell-fldr',
    title: 'repoint the per-user shell folders',
    target: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'Startup can be repointed at an arbitrary path',
    doesNotImply: 'nothing about other users shell folders'
  },
  {
    id: 'B4-hkcu-environment',
    title: 'write the per-user Environment key',
    target: 'HKCU:\\Environment',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'UserInitMprLogonScript is reachable as a logon-script surface',
    doesNotImply: 'nothing about machine environment'
  },
  {
    id: 'B5-winnt-windows',
    title: 'write the legacy Load/Run autostart key',
    target: 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'a further autostart surface exists',
    doesNotImply: 'nothing machine-wide'
  },
  {
    id: 'B6-policies-explorer',
    title: 'create a subkey under the per-user Policies key',
    target: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer',
    mechanism: ['ACL'],
    expectedPermitted: false,
    positiveControlId: 'B1-hkcu-run',
    tier: 'A',
    implies: 'the account cannot set its own policy — the key is Administrators-owned by design',
    doesNotImply: 'nothing about policy set elsewhere, and nothing about reading it'
  },
  {
    id: 'B7-hklm-run',
    title: 'write the machine-wide Run key',
    target: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    mechanism: ['ACL'],
    expectedPermitted: false,
    positiveControlId: 'B1-hkcu-run',
    tier: 'A',
    implies: 'autostart cannot be made machine-wide by this account',
    doesNotImply: 'nothing about per-user autostart, which IS permitted'
  },

  /* ═══ TIER A — process visibility, ambient APIs only ═════════════════════ */
  {
    id: 'D5-enumerate-own-session',
    title: 'enumerate processes in the own session',
    targetPattern: '^session \\d+$',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'the prober can enumerate at all, so E5 is a real reading',
    doesNotImply: 'nothing about other sessions'
  },
  {
    id: 'D6-open-own-session-process',
    title: 'open a handle to an own-session process via .Handle',
    target: 'own-session process handle',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'A',
    implies: 'the prober can open a process handle at all',
    doesNotImply: 'THIS IS NOT A MASK-MATCHED CONTROL. .Handle requests broad access, so it ' +
      'does not control for any specific mask. The mask-matched controls are POS-open-own-process-*.'
  },
  {
    id: 'E5-enumerate-other-session',
    title: 'enumerate processes in other sessions',
    target: 'other sessions',
    mechanism: ['NONE'],
    // Deliberately expect-permitted: process names and PIDs are visible machine-wide. This
    // is recorded as a known surface and signed off, NOT asserted false so it can look green.
    expectedPermitted: true,
    tier: 'A',
    implies: 'process names and PIDs in other sessions are a visible surface, accepted by ruling',
    doesNotImply: 'nothing about opening those processes, reading their modules or their command lines'
  },

  /* ═══ TIER B — cross-session containment ════════════════════════════════ */
  {
    id: 'E1-enumerate-other-session-windows',
    title: 'enumerate another session top-level windows',
    targetPattern: '^AROMA-OWNER-SENTINEL-[0-9a-f]+$',
    mechanism: ['SESSION-ISOLATION'],
    expectedPermitted: false,
    positiveControlId: 'POS-list_windows-own',
    tier: 'B',
    implies: 'EnumWindows in this session does not reach the other session window list',
    doesNotImply: 'nothing about kernel-object DACLs (E2/E3), clipboard (E4) or process rights (E6/E9)'
  },
  {
    // RETIRED 2026-07-29, on a measurement, having produced no legitimate row.
    //
    // Every route tried reaches the CONTAINER, never the window station itself:
    //   Win32 OpenWindowStation  - refuses a qualified path, identically for our own session
    //                              and for a session number that does not exist
    //   NtOpenDirectoryObject    - opens \Sessions\N\Windows, which is a Directory object.
    //                              The leaf \Sessions\N\Windows\WinSta0 returns
    //                              STATUS_OBJECT_NAME_NOT_FOUND (0xC0000034) - a window
    //                              station is not a Directory, so this lookup never finds it
    //
    // So this probe has NO ROUTE to the object this id names. Registering an assertion that
    // nothing can execute is worse than admitting there is no route, so the id is kept and
    // marked unmeasurable rather than quietly retargeted at something easier. What the
    // container-open actually measures is E2a, below, and it is an ACCEPTED SURFACE.
    id: 'E2-open-other-session-winsta',
    title: 'open another session window station (NO ROUTE - unmeasurable by this probe)',
    target: '\\Sessions\\N\\Windows\\WinSta0',
    accessMask: MASK.WINSTA_READATTRIBUTES,
    mechanism: ['ACL'],
    expectedPermitted: false,
    positiveControlId: 'POS-open-own-winsta',
    tier: 'B',
    status: 'unmeasurable',
    implies: 'NOTHING. It has never been executed and no probe can execute it.',
    doesNotImply: 'in particular, E2a opening the CONTAINING DIRECTORY says nothing about this ' +
      'object. Cross-session window-station access remains NOT PROVEN in either direction'
  },
  {
    // NEW 2026-07-29, replacing what E2 was mis-measuring. MEASURED DACL on this machine,
    // identical for session 0, session 3, session 5 and the global \Windows:
    //
    //   D:(A;;CCDCRC;;;WD)(A;;CCDCLCSWSDRCWDWO;;;SY)(A;;CCDCLCSWSDRCWDWO;;;S-1-5-90-0-N)
    //        ^^^^^^  ^^ Everyone: DIRECTORY_QUERY | DIRECTORY_TRAVERSE | READ_CONTROL
    //
    // Everyone can open and traverse this directory BY DESIGN - it is the namespace node a
    // process walks to reach its own window station. A non-administrator token opened another
    // session's copy, which is the ACE working as specified, not a boundary failing.
    //
    // So this is recorded as a KNOWN-VISIBLE SURFACE and signed off, exactly like E5. It is
    // deliberately NOT asserted false: an assertion that must fail against a documented
    // world-readable object would report a VIOLATION every single run, and a boundary that
    // cries wolf is worse than no boundary.
    id: 'E2a-open-other-session-winsta-directory',
    title: 'open another session window-station CONTAINER in the object manager',
    targetPattern: '^\\\\Sessions\\\\\\d+\\\\Windows$',
    accessMask: MASK.DIRECTORY_QUERY,
    mechanism: ['NONE'],
    expectedPermitted: true,
    tier: 'B',
    status: 'active',
    implies: 'the object-manager namespace node for another session is readable, by an ACE that ' +
      'grants Everyone QUERY|TRAVERSE|READ_CONTROL. Accepted surface, Owner ruling 2026-07-29',
    doesNotImply: 'NOTHING WHATEVER about the WinSta0 object inside it - see E2. Opening the ' +
      'container confers no window access: reaching windows requires SetProcessWindowStation ' +
      'with a handle to the STATION, at WINSTA_* rights, which this does not obtain. E1 and E8 ' +
      'are unaffected by this row and rest on their own sentinels'
  },
  {
    // RETIRED 2026-07-31, Owner ruling, following the E2 precedent exactly.
    //
    // Measured: win32Error 161 ERROR_BAD_PATHNAME, blockedAtStep "name". OpenDesktop is
    // STATION-RELATIVE — it takes a bare desktop name on the caller's own window station and
    // does not accept a qualified \Sessions\N\... path, so the desktop object was never reached
    // and no security check ever ran. A row from this route can only ever be NOT PROVEN.
    //
    // THE OWNER'S CONDITION, and it is the reason this retirement needed its own evidence:
    // E2's retirement was sound because E2 failed FOR ITS OWN STATION under the same qualified
    // path — route incapability was demonstrated, not assumed. E3 had no such evidence. Its
    // positive control POS-open-own-desktop passes a BARE NAME while the negative passes a
    // QUALIFIED PATH: two different call shapes, so the control proved the route worked for a
    // call the negative never makes. That is the same "the control proves nothing about the
    // negative" defect this register exists to catch, sitting inside the register itself.
    //
    // Replaced by E3a, whose control uses the IDENTICAL call shape against our OWN session.
    id: 'E3-open-other-session-desktop',
    title: 'open a desktop in another session window station (RETIRED — station-relative API, no route)',
    targetPattern: '^\\\\Sessions\\\\\\d+\\\\Windows\\\\WinSta0\\\\Default$',
    accessMask: MASK.DESKTOP_READOBJECTS,
    mechanism: ['ACL'],
    expectedPermitted: false,
    positiveControlId: 'POS-open-own-desktop',
    tier: 'B',
    status: 'unmeasurable',
    implies: 'NOTHING. The call is blocked parsing the name, so the desktop DACL is never consulted.',
    doesNotImply: 'in particular it does not imply that cross-session desktop access is denied. ' +
      'That remains NOT PROVEN in either direction until E3a reports.'
  },
  {
    // NEW 2026-07-31. The object-manager route, mirroring E2a — and unlike E3 its positive
    // control makes the SAME CALL against our own session, so a failure on the other session
    // can be attributed to the target rather than to the route.
    // RUN 2026-07-31, round 5de3635c8089. It FAILED, and that failure is the evidence the
    // Owner required before E3a could be retired:
    //     POS-open-own-desktop-object  \Sessions\5\...\Default  ntStatus 0xC000003A
    //     E3a-open-other-session-...   \Sessions\3\...\Default  ntStatus 0xC000003A
    // IDENTICAL status, same call, differing only in session number. 0xC000003A is
    // STATUS_OBJECT_PATH_NOT_FOUND: a desktop is not a Directory object, so the object-manager
    // lookup can never reach one - for ANY session, including our own. Route incapability,
    // demonstrated rather than assumed, which is exactly what E2 had and E3 lacked.
    //
    // Kept in the register as unmeasurable rather than deleted: the id is the only place this
    // evidence is written down, and deleting it would invite the same route to be tried again.
    id: 'POS-open-own-desktop-object',
    title: 'open OUR OWN desktop by object-manager path (RETIRED — no route to a desktop leaf)',
    targetPattern: '^\\\\Sessions\\\\\\d+\\\\Windows\\\\WinSta0\\\\Default$',
    accessMask: MASK.DIRECTORY_QUERY,
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    positiveControlId: null,
    tier: 'B',
    status: 'unmeasurable',
    implies: 'the object-manager route can reach a desktop leaf at this mask for this token',
    doesNotImply: 'nothing about another session; this is the control, not the measurement'
  },
  {
    // RETIRED 2026-07-31 on its own evidence, under the Owner's standing authorisation: "if the
    // object-manager route also cannot reach the desktop object, record it as route incapability
    // and retire it — and that only counts with a same-shape control."
    //
    // The control was built and RUN. Both sides returned 0xC000003A STATUS_OBJECT_PATH_NOT_FOUND,
    // ours and theirs, from the identical call. So the route reaches no desktop leaf at all and
    // this id can never produce a measurement.
    //
    // CROSS-SESSION DESKTOP ACCESS IS THEREFORE **NOT PROVEN IN EITHER DIRECTION**, by any route
    // this probe has. Two APIs were tried and both were refused before any security check ran:
    // Win32 OpenDesktop parses a bare station-relative name (win32Error 161 on a qualified path)
    // and NtOpenDirectoryObject only finds Directory objects. That is an honest gap in coverage,
    // and it is written here so nobody reads the silence as a pass.
    id: 'E3a-open-other-session-desktop-object',
    title: 'open another session desktop by object-manager path (RETIRED — no route to a desktop leaf)',
    targetPattern: '^\\\\Sessions\\\\\\d+\\\\Windows\\\\WinSta0\\\\Default$',
    accessMask: MASK.DIRECTORY_QUERY,
    mechanism: ['ACL', 'NAMESPACE-ISOLATION'],
    expectedPermitted: false,
    positiveControlId: 'POS-open-own-desktop-object',
    tier: 'B',
    status: 'unmeasurable',
    implies: 'NOTHING. The lookup never reaches a desktop object, so no DACL is ever consulted.',
    doesNotImply: 'above all it does not imply that cross-session desktop access is DENIED. Both ' +
      'routes were refused at the name, for our own session as well as the other one, so denial ' +
      'was never tested. Cross-session desktop access remains NOT PROVEN in either direction'
  },
  {
    id: 'E4-read-other-session-clipboard',
    title: 'read another session clipboard',
    target: 'session 3 clipboard',
    mechanism: ['NAMESPACE-ISOLATION', 'SESSION-ISOLATION', 'ACL'],
    expectedPermitted: false,
    positiveControlId: 'POS-read-own-clipboard',
    tier: 'B',
    postRunVerification: 'stage3-owner-clip.ps1 -Verify must re-read the OWNER clipboard AFTER ' +
      'the top-up and confirm the sentinel digest is unchanged. Until it does, a not-found is ' +
      'PENDING-VERIFY and may never be scored BOUNDED: the operator cannot tell containment ' +
      'from a sentinel that was overwritten, and finding out would require the very read E4 forbids',
    implies: 'the owner-seeded clipboard string is not obtainable from this session',
    doesNotImply: 'the clipboard is per-window-station, so a block at the window-station step is ' +
      'E2 mechanism reported again — it is NOT independent evidence about the clipboard object'
  },
  {
    id: 'E6-open-other-session-process',
    title: 'open another session process for PROCESS_QUERY_INFORMATION',
    target: 'other-session process',
    accessMask: MASK.PROCESS_QUERY_INFORMATION,
    mechanism: ['ACL'],
    expectedPermitted: false,
    positiveControlId: 'POS-open-own-process-query',
    tier: 'B',
    implies: 'OpenProcess succeeds only if ALL requested rights are granted, so denial of 0x0400 ' +
      'entails denial of any mask containing it, up to and including PROCESS_ALL_ACCESS',
    doesNotImply: 'NOTHING about PROCESS_QUERY_LIMITED_INFORMATION (0x1000). That is a separate, ' +
      'weaker right that can be granted independently, so no subset argument reaches it — see E6b'
  },
  {
    id: 'E6b-open-other-session-process-limited',
    title: 'open another session process for PROCESS_QUERY_LIMITED_INFORMATION',
    target: 'other-session process',
    accessMask: MASK.PROCESS_QUERY_LIMITED_INFORMATION,
    mechanism: ['ACL'],
    expectedPermitted: false,
    positiveControlId: 'POS-open-own-process-limited',
    tier: 'B',
    implies: 'denial of the weaker query right, which E6 could not reach',
    doesNotImply: 'a measurement in the louis to session-5 direction does not settle this. The ' +
      'directions are not symmetric and the ACLs need not be; this must be measured operator to owner'
  },
  {
    id: 'E7-read-other-session-module',
    title: 'read another session process MainModule file name',
    target: 'other-session process MainModule.FileName',
    accessMask: MASK.PROCESS_QUERY_INFORMATION | MASK.PROCESS_VM_READ,
    mechanism: ['ACL'],
    expectedPermitted: false,
    positiveControlId: 'POS-read-own-module',
    tier: 'B',
    implies: 'the module path of another session process is not readable by this account',
    doesNotImply: 'the process NAME and PID remain visible — that is E5, an accepted surface'
  },
  {
    id: 'E8-capture-other-session-screen',
    title: 'capture another session screen',
    target: 'session 3 desktop',
    mechanism: ['SESSION-ISOLATION'],
    expectedPermitted: false,
    positiveControlId: 'POS-capture_screen',
    tier: 'B',
    implies: 'a capture taken in this session does not contain the other session pixels',
    doesNotImply: 'it detects the owner SENTINEL COLOUR only. It cannot prove the absence of all ' +
      'owner-session content — only that the one marker made deliberately detectable is absent'
  },
  {
    id: 'E9-read-other-session-cmdline',
    title: 'read another session process command line',
    target: 'other-session process CommandLine',
    accessMask: MASK.PROCESS_QUERY_INFORMATION | MASK.PROCESS_VM_READ,
    mechanism: ['ACL'],
    expectedPermitted: false,
    positiveControlId: 'POS-read-own-cmdline',
    tier: 'B',
    implies: 'command-line arguments of another session process are not readable by this account',
    doesNotImply: 'a null return from the query API alone names no mechanism and is INVALID; the ' +
      'row is only BOUNDED when the underlying OpenProcess denial is recorded with it'
  },
  {
    id: 'E10-terminate-other-session-process',
    title: 'open another session process for PROCESS_TERMINATE',
    target: 'other-session process',
    accessMask: MASK.PROCESS_TERMINATE,
    mechanism: ['ACL'],
    expectedPermitted: false,
    positiveControlId: 'POS-open-own-process-terminate',
    tier: 'B',
    implies: 'the right to terminate is not held. The handle is requested and closed immediately; ' +
      'nothing is ever terminated',
    doesNotImply: 'this is NOT a replacement for E7. It was run under the E7 id once, which is the ' +
      'collision that produced this register'
  },

  /* ═══ POSITIVE CONTROLS — registered, because an unregistered control is ══
   *   the same class of risk as a drifted negative id.                       */
  {
    id: 'POS-list_windows-own',
    title: 'the own sentinel window appears in the own enumeration',
    targetPattern: '^AROMA-OWN-[0-9a-f]+$',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'B',
    implies: 'the enumerator is not blind, so E1 finding nothing means something',
    doesNotImply: 'nothing about any other observation action'
  },
  {
    id: 'POS-capture_screen',
    title: 'a capture of the own desktop contains the own sentinel colour',
    target: 'own desktop',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'B',
    implies: 'the capture path works AND the sampled frame demonstrably holds the sentinel, ' +
      'so E8 finding no owner colour means something',
    doesNotImply: 'nothing about UIA or window enumeration'
  },
  {
    id: 'POS-read_uia_tree-own',
    title: 'the own sentinel window yields a NON-EMPTY automation tree',
    targetPattern: '^AROMA-OWN-[0-9a-f]+$',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'B',
    implies: 'the UIA reader is not blind — REQUIRES nodeCount > 0 and evidenceBytes > 0. A ' +
      'zero-node read is ACCEPTED by no rule; see the uia-zero-nodes vacuous-pass rule',
    doesNotImply: 'reading a window in this session says nothing about reading one in another'
  },
  {
    // THE SAME CALL, on our OWN session's container. This is what makes E2 a measurement of
    // the target rather than of the API: the Win32 route failed identically on our own
    // station, which is precisely how a vacuous negative looks from the outside.
    id: 'POS-open-own-winsta',
    title: 'open the own session window-station container in the object manager',
    targetPattern: '^\\\\Sessions\\\\\\d+\\\\Windows$',
    accessMask: MASK.DIRECTORY_QUERY,
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'B',
    implies: 'the object-manager route works for this token at this mask, so E2 being refused is ' +
      'about the target and not about the call',
    doesNotImply: 'nothing about desktops or the clipboard'
  },
  {
    id: 'POS-open-own-desktop',
    title: 'open a desktop in the own window station',
    target: 'Default (own window station)',
    accessMask: MASK.DESKTOP_READOBJECTS,
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'B',
    implies: 'OpenDesktop works for this token at this mask',
    doesNotImply: 'nothing about another session window station'
  },
  {
    id: 'POS-read-own-clipboard',
    title: 'read a seeded string back from the own clipboard',
    target: 'own session clipboard',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'B',
    implies: 'the clipboard reader works in this session, so E4 returning nothing means something',
    doesNotImply: 'nothing about another window station clipboard'
  },
  {
    id: 'POS-open-own-process-query',
    title: 'open an own-session process for PROCESS_QUERY_INFORMATION',
    target: 'own-session process',
    accessMask: MASK.PROCESS_QUERY_INFORMATION,
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'B',
    implies: 'OpenProcess at THIS EXACT MASK succeeds in this session, which is what makes E6 ' +
      'a measurement of the target rather than of the mask',
    doesNotImply: 'nothing about any other mask'
  },
  {
    id: 'POS-open-own-process-limited',
    title: 'open an own-session process for PROCESS_QUERY_LIMITED_INFORMATION',
    target: 'own-session process',
    accessMask: MASK.PROCESS_QUERY_LIMITED_INFORMATION,
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'B',
    implies: 'OpenProcess at 0x1000 succeeds in this session',
    doesNotImply: 'nothing about any other mask'
  },
  {
    id: 'POS-open-own-process-terminate',
    title: 'open an own-session process for PROCESS_TERMINATE',
    target: 'own-session process',
    accessMask: MASK.PROCESS_TERMINATE,
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'B',
    implies: 'the handle is obtainable at 0x0001 in this session. It is CLOSED IMMEDIATELY and ' +
      'nothing is terminated, here or in E10',
    doesNotImply: 'nothing about any other mask'
  },
  {
    id: 'POS-read-own-module',
    title: 'read the own process MainModule file name',
    target: 'own process MainModule.FileName',
    accessMask: MASK.PROCESS_QUERY_INFORMATION | MASK.PROCESS_VM_READ,
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'B',
    implies: 'the module reader works, so E7 returning nothing means something',
    doesNotImply: 'nothing about another session'
  },
  {
    id: 'POS-read-own-cmdline',
    title: 'read the own process command line',
    target: 'own process CommandLine',
    mechanism: ['PERMITTED'],
    expectedPermitted: true,
    tier: 'B',
    implies: 'the query API returns a command line in this session, so a null for another ' +
      'session is a real difference rather than an API that never works',
    doesNotImply: 'nothing about the MECHANISM of that difference — E9 must record the ' +
      'OpenProcess denial to name one'
  }
]

/* ── freeze, index, fingerprint ────────────────────────────────────────────── */

const ASSERTIONS = Object.freeze(ENTRIES.map((e) => Object.freeze(Object.assign({
  accessMask: null,
  positiveControlId: null,
  target: null,
  targetPattern: null,
  postRunVerification: null,
  status: 'active'
}, e, { mechanism: Object.freeze(e.mechanism.slice()) }))))

const BY_ID = new Map(ASSERTIONS.map((e) => [e.id, e]))

/**
 * The fields whose change MUST be accompanied by a new id. Hashed per entry so an edit to
 * any of them fails a pinned test — this is the mechanism that turns the E7 collision from
 * something someone has to notice into something that cannot land.
 */
const PINNED_FIELDS = Object.freeze(['id', 'target', 'targetPattern', 'accessMask', 'mechanism', 'expectedPermitted', 'positiveControlId', 'tier', 'postRunVerification', 'status'])

function canonical (entry) {
  return PINNED_FIELDS.map((f) => {
    const v = entry[f]
    return f + '=' + (Array.isArray(v) ? v.join(',') : String(v))
  }).join('|')
}

/** sha256 of the pinned fields of one entry. */
function fingerprint (id) {
  const e = BY_ID.get(id)
  if (!e) return null
  return crypto.createHash('sha256').update(canonical(e)).digest('hex')
}

/** sha256 over the whole register, in declaration order. Row count travels with it. */
function registerFingerprint () {
  return crypto.createHash('sha256').update(ASSERTIONS.map(canonical).join('\n')).digest('hex')
}

function get (id) { return BY_ID.get(id) || null }
function has (id) { return BY_ID.has(id) }
function ids () { return ASSERTIONS.map((e) => e.id) }
function forTier (tier) { return ASSERTIONS.filter((e) => e.tier === tier) }

/** Does an emitted target agree with the register? Exact string or declared pattern. */
function targetMatches (entry, target) {
  if (entry.targetPattern) return new RegExp(entry.targetPattern).test(String(target))
  return entry.target === target
}

/**
 * THE CROSS-CHECK. Given the rows a probe or harness emitted, return every disagreement
 * with this register. An empty error list is the only acceptable result.
 *
 * What is checked, and why each one:
 *   . the id EXISTS                  — an unregistered row means nothing constrains it
 *   . target agrees                  — the E6 narrowing was exactly a changed target/mask
 *   . accessMask agrees EXACTLY      — a mask is the assertion, not a detail of it
 *   . expectedPermitted agrees       — otherwise a row can flip its own meaning
 *   . mechanism is a registered class — but ONLY for rows that reached a verdict of BOUNDED.
 *     An INVALID row is entitled to say UNDETERMINED; that is what INVALID means.
 *   . every expectedPermitted:false row names a positive control, and that control is
 *     PRESENT IN THE SAME RUN and ACCEPTED. A negative whose control failed proves nothing,
 *     and a control from some other run is not a control.
 */
function crossCheck (rows) {
  const errors = []
  const list = Array.isArray(rows) ? rows : []
  const byId = new Map()
  for (const r of list) {
    if (r && typeof r.id === 'string') {
      if (byId.has(r.id)) errors.push(r.id + ': emitted twice in one run')
      byId.set(r.id, r)
    }
  }

  for (const r of list) {
    const id = r && r.id
    if (typeof id !== 'string' || !id) { errors.push('a row was emitted with no id'); continue }
    const e = BY_ID.get(id)
    if (!e) { errors.push(id + ': not in the register — nothing constrains what it means'); continue }

    // An id kept for the record but which no probe can execute must not appear as a row at
    // all. E2 is the case: every route reaches the containing directory, never the window
    // station, so a row under that id would claim a measurement that did not happen.
    if (e.status === 'unmeasurable') {
      errors.push(id + ': registered UNMEASURABLE — no probe has a route to this object, so a row under this id claims a measurement that did not happen')
      continue
    }

    if (!targetMatches(e, r.target)) {
      errors.push(id + ': target drift — register ' + (e.targetPattern ? '/' + e.targetPattern + '/' : JSON.stringify(e.target)) + ', row ' + JSON.stringify(r.target))
    }
    const rowMask = (r.accessMask === undefined) ? null : r.accessMask
    if (e.accessMask !== rowMask) {
      errors.push(id + ': accessMask drift — register ' + e.accessMask + ', row ' + rowMask)
    }
    if (e.expectedPermitted !== r.expectedPermitted) {
      errors.push(id + ': expectedPermitted drift — register ' + e.expectedPermitted + ', row ' + r.expectedPermitted)
    }
    if (r.verdict === 'BOUNDED' && !e.mechanism.includes(r.mechanism)) {
      errors.push(id + ': mechanism ' + r.mechanism + ' is not a registered class for this id (' + e.mechanism.join('|') + ')')
    }
    if (r.verdict === 'ACCEPTED' && r.mechanism && !e.mechanism.includes(r.mechanism)) {
      errors.push(id + ': mechanism ' + r.mechanism + ' is not a registered class for this id (' + e.mechanism.join('|') + ')')
    }

    // An assertion that cannot settle itself may not be recorded as settled. The probe emits
    // PENDING-VERIFY; only the owner-side verification step may release it, and the released
    // row has to say so. Forgetting the step leaves an unfinished row, never a pass.
    if (e.postRunVerification && ['BOUNDED', 'ACCEPTED'].includes(r.verdict) && r.postRunVerified !== true) {
      errors.push(id + ': scored ' + r.verdict + ' without the required post-run verification — ' + e.postRunVerification)
    }

    if (e.expectedPermitted === false) {
      if (!e.positiveControlId) {
        errors.push(id + ': register defect — a negative assertion with no positive control')
      } else {
        const ctrl = byId.get(e.positiveControlId)
        if (!ctrl) errors.push(id + ': positive control ' + e.positiveControlId + ' is absent from this run — the negative proves nothing')
        else if (ctrl.verdict !== 'ACCEPTED') errors.push(id + ': positive control ' + e.positiveControlId + ' is ' + ctrl.verdict + ', not ACCEPTED — the negative proves nothing')
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

/** The register as plain data, for the PowerShell side to read. Order is the pinned order. */
function toJSON () {
  return {
    schema: 'aroma.assertionRegistry.v1',
    fingerprint: registerFingerprint(),
    count: ASSERTIONS.length,
    assertions: ASSERTIONS.map((e) => ({
      id: e.id,
      title: e.title,
      target: e.target,
      targetPattern: e.targetPattern,
      accessMask: e.accessMask,
      mechanism: e.mechanism.slice(),
      expectedPermitted: e.expectedPermitted,
      positiveControlId: e.positiveControlId,
      tier: e.tier,
      status: e.status,
      postRunVerification: e.postRunVerification,
      implies: e.implies,
      doesNotImply: e.doesNotImply
    }))
  }
}

module.exports = {
  ASSERTIONS,
  MECHANISM_CLASSES,
  MASK,
  PINNED_FIELDS,
  get,
  has,
  ids,
  forTier,
  targetMatches,
  crossCheck,
  fingerprint,
  registerFingerprint,
  toJSON
}
