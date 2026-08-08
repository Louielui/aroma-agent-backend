'use strict'

/**
 * catalogue.js — the interface words, in both languages, written at the same time.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「Extract first, translate as you go. Each string becomes an entry with a written
 * > Chinese value and an English value, written at the same time.」**
 *
 * Not governance: these are words, and the Owner should be able to reword them without a work
 * order. The RULES that keep data out of translation live in `src/governance/textResolver.js`.
 *
 * ⛔ TEMPLATES, NOT SENTENCES — and the proof is `errand.recallAnswer` below.
 *
 * The ingredient, the count and **the site's own recall title** are DATA. They sit in slots and
 * are inserted verbatim. Translation changes the frame and can never reach inside a slot. The
 * tempting mistake is to store that whole line as one translatable string, which would put a
 * supplier's or a product's own name inside the translated unit.
 *
 * ⛔ HER REPLIES ARE NOT HERE AND WILL NEVER BE. Model output is not interface text; there is no
 * key for it. Her language is the conversation contract's rule plus `traditionalGuard.js`.
 *
 * ── STATUS ──────────────────────────────────────────────────────────────────
 * ⚠ PARTIAL. 首頁 and its server-side surface are extracted; the browser half and the rest of
 * the server are not. `src/governance/textClasses.js` is the authority on which files may be
 * translated at all — only a minority of the Chinese in this codebase may.
 *
 * ⛔ THREE TIMES NOW, THE GAP BETWEEN THE TWO LANGUAGES WAS NOT IN THE WORDS:
 *   · 「、」 and 「；」 — CJK punctuation, outside the Han range the survey counted.
 *   · number agreement — 「{n} of them were」 is wrong at n=1 and renders anyway.
 *   · sentence joining — 「…daily.Still run by hand」, because Chinese needs no space.
 * Whatever the next one is, it will not be a word either.
 */

/**
 * Each entry: one key, one template per locale. The zh is WRITTEN Chinese (書面語), which is
 * the Owner's standing rule and the reason extraction and rewording happen in one pass rather
 * than editing the same strings twice.
 */
const CATALOGUE = Object.freeze({
  /**
   * ⛔ THIS FILE ONCE HELD `briefing.nothingWaiting` TWICE.
   *
   * The proof-set version lived here and the real one arrived later under 首頁 BRIEFING, with
   * different wording. An object literal keeps the LAST and discards the first in silence, so
   * every test passed, the catalogue reported the right number of entries, and one of the two
   * sentences simply did not exist. The 「Nothing waiting on you.」 that was written first was
   * gone and nothing said so.
   *
   * It cannot be caught by reading the object — by then the duplicate is already resolved. It
   * is caught by scanning THIS SOURCE, in `textResolver.test.js`.
   */
  'briefing.updatedAt': {
    zh: '更新於 {time}',
    en: 'Updated {time}'
  },

  /**
   * ⛔ THE PROOF ENTRY. Both kinds of thing in one line:
   *
   *   「mushrooms」(詞組搜尋):個站搵到 51 條:2026-08-04 Highline brand Organic Mini Bella…
   *    └─ DATA ─┘  └ interface ┘  └int┘ 51 └int┘  └────────── DATA, verbatim ──────────┘
   *
   * `ingredient`, `count` and `items` are slots. The recall titles come from the register and
   * must appear exactly as that register wrote them — a translated product name is an order for
   * the wrong thing.
   */
  'errand.recallAnswer': {
    zh: '「{ingredient}」（{narrowing}）：網站找到 {count} 條，顯示前 {shown} 條：{items}',
    en: '"{ingredient}" ({narrowing}): the site returned {count}, showing the first {shown}: {items}'
  },
  'errand.recallNone': {
    zh: '「{ingredient}」（{narrowing}）：沒有找到相關回收。',
    en: '"{ingredient}" ({narrowing}): no matching recalls.'
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 首頁 CONCLUSIONS — the four fields, none of which may absorb another.
  // ⛔ A GAP MUST NEVER READ AS CALM, IN EITHER LANGUAGE. That rule is structural in
  // `errandConclusion.js` (four separate fields); here it is a rule about WORDING — the English
  // must not be gentler than the Chinese, because a softer translation is how a fence gets
  // talked around without anyone editing the fence.
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * ⛔ PUNCTUATION IS INTERFACE TOO, AND THE MEASUREMENT MISSED IT.
   *
   * The survey that produced 「721 lines carry interface Chinese」 looked for Han ideographs
   * (U+4E00–U+9FFF). 「、」 and 「；」 are CJK PUNCTUATION, outside that range, so every list
   * joined with them was invisible to the count. Left alone, the English would have rendered
   *
   *     green onion、romaine could not be checked
   *
   * — English words held together by Chinese punctuation, in a sentence that otherwise looks
   * finished. Separators are interface and get keys like anything else.
   */
  'punct.listSep': {
    zh: '、',
    en: ', '
  },
  'punct.clauseSep': {
    zh: '；',
    en: '; '
  },
  'conclusion.alert': {
    zh: '⚠ {findings}',
    en: '⚠ {findings}'
  },
  'conclusion.alertOne': {
    zh: '{ingredient} 有新回收：{items}',
    en: '{ingredient} — new recall: {items}'
  },
  /**
   * ⛔ ENGLISH TEMPLATES MUST NOT REQUIRE NUMBER AGREEMENT WITH A SLOT.
   *
   * The first English here read 「so {n} of them were never searched」, which is wrong at n=1 and
   * right at n=2. Chinese has no number agreement, so a template that is correct in Chinese for
   * every value can be ungrammatical in English for half of them — and it renders, so nothing
   * fails. Write the English so the count sits in apposition and no verb has to agree with it.
   *
   * ⛔ THIS IS NOT TESTED, AND SAYING SO IS THE HONEST PART. A regex for 「{n} … were」 would
   * give the appearance of a guard while missing every other agreement it does not know about.
   * It is a writing rule, checked by reading, and it is written here where it will be read.
   */
  'conclusion.gap': {
    zh: '⛔ {ingredients} 查不到，所以這 {n} 樣今天沒有查過 —— 這不等於沒有事。',
    en: '⛔ Could not check {ingredients} — {n} not searched today, which is not the same as nothing found.'
  },
  'conclusion.calm': {
    zh: '{n} 樣查過，沒有新的回收。',
    en: '{n} checked, nothing new.'
  },
  'conclusion.cannotCompare': {
    zh: '{ingredients} 沒有得比（{why}），所以說不出有沒有新的。',
    en: 'Nothing to compare {ingredients} against ({why}), so I cannot say whether anything is new.'
  },
  'conclusion.whyNoItemsRecorded': {
    zh: '這次沒有記下找到什麼',
    en: 'this run did not record what it found'
  },
  'conclusion.whyNoPriorRun': {
    zh: '之前沒有紀錄可比',
    en: 'no earlier run to compare with'
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 首頁 BRIEFING.
  // ⛔ A DEFECT MUST NOT READ AS A STATE. 「未接線」 is a wiring failure, 「沒有」 is a finding,
  // and they are one careless English sentence apart.
  // ══════════════════════════════════════════════════════════════════════════
  'briefing.nothingWaiting': {
    zh: '沒有等你決定的事。',
    // ⛔ NOT 「Nothing awaits your decision」. Written as he would say it.
    en: 'Nothing needs you.'
  },
  'briefing.errandsCannotRead': {
    zh: '我看不到差事紀錄。',
    en: 'I cannot read the errand record.'
  },
  'briefing.waitingCannotRead': {
    zh: '我看不到差事紀錄，所以答不到你有沒有事等著。',
    en: 'I cannot read the errand record, so I cannot tell you whether anything is waiting.'
  },
  'briefing.errandsNotWired': {
    zh: '差事紀錄未接線 —— 這是一個缺陷，不是一個狀態。',
    en: 'The errand record is not wired — that is a defect, not a state.'
  },
  'briefing.waitingNotWired': {
    zh: '差事紀錄未接線，所以我答不到有沒有事等你。這是一個缺陷。',
    en: 'The errand record is not wired, so I cannot tell you whether anything is waiting. That is a defect.'
  },
  'briefing.noneRan': {
    zh: '未有差事紀錄 —— 到今天為止每一單都是手動跑的，沒有記下。',
    en: 'No errands on record — every one so far has been run by hand and nothing was written down.'
  },
  'briefing.driveNotWired': {
    zh: 'Drive 未接線 —— 我根本沒有去看。這是一個缺陷，不是一個狀態。',
    en: 'Drive is not wired — I never went and looked. That is a defect, not a state.'
  },
  'briefing.driveNotChecked': {
    zh: '我還沒有看過 Drive。',
    en: 'I have not looked at Drive yet.'
  },
  'briefing.driveCannotRead': {
    zh: '我看不到 Drive 那個資料夾（{error}）。',
    en: 'I cannot read that Drive folder ({error}).'
  },
  'briefing.driveEmpty': {
    zh: 'Drive 裡沒有等著處理的發票。',
    en: 'No invoices waiting in Drive.'
  },

  /**
   * ⛔ FLAGGED — THIS ONE DID NOT SURVIVE BEING WRITTEN NATIVELY IN ENGLISH.
   *
   * 「呢個價我 N 個鐘之前讀，可能唔同咗。」 and 「太耐（N 個鐘）。個價同存貨都要重新睇 ——
   * 建議我重新行一次，唔好接住做。」 are one concept in Cantonese: the number is stale AND
   * here is what to do about it. Written natively in English they split in two, because English
   * will not carry the recommendation inside the same breath without sounding like an apology.
   *
   * That is the tell the Owner asked to be told about: the Chinese was doing something
   * STRUCTURAL — the age and the instruction are one field, `amountNote`, precisely so a stale
   * price can never appear without the instruction attached. Two sentences in English is fine;
   * two FIELDS would not be, because the second could be dropped at a call site.
   *
   * Kept as one key with two sentences in the English. Recorded here rather than silently
   * resolved, because the next person to tidy this will want to split it.
   */
  'briefing.amountStale': {
    zh: '這個價我 {hours} 個鐘之前讀的，可能已經不同了。',
    en: 'I read this price {hours} hours ago. It may have moved.'
  },
  'briefing.amountExpired': {
    zh: '太久了（{hours} 個鐘）。價錢同存貨都要重新看 —— 建議我重新跑一次，不要接住做。',
    en: 'Too long ago ({hours} hours). Both the price and the stock need re-reading. Let me run it again rather than carry on from this.'
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DURATIONS.
  //
  // ⛔ ENGLISH NEEDS A SINGULAR AND CHINESE DOES NOT. 「1 分鐘」 and 「11 分鐘」 are one
  // template; 「1 minute」 and 「11 minutes」 are two. Where `conclusion.gap` could be REWRITTEN to
  // dodge agreement, a bare duration cannot — there is nowhere for the number to hide.
  //
  // So the singular is its own key, chosen at the call site with `n === 1 ? t(a) : t(b)`. NOT a
  // `plural(n, keyOne, keyMany)` helper, however much tidier that reads: keys passed to a helper
  // are invisible to the source scan that keeps data out of the translator, and buying tidiness
  // with a hole in rule ① is the wrong trade. Two visible `t()` calls stay scannable.
  //
  // Six keys, and no plural FRAMEWORK. If a language turns up needing dual or paucal forms, that
  // is a real design conversation, not a number to nudge.
  // ══════════════════════════════════════════════════════════════════════════
  'time.oneMinute': { zh: '1 分鐘', en: '1 minute' },
  'time.minutes': { zh: '{n} 分鐘', en: '{n} minutes' },
  'time.oneHour': { zh: '1 個鐘', en: '1 hour' },
  'time.hours': { zh: '{n} 個鐘', en: '{n} hours' },
  'time.oneDay': { zh: '1 日', en: '1 day' },
  'time.days': { zh: '{n} 日', en: '{n} days' },

  'cadence.daily': { zh: '每日', en: 'daily' },
  'cadence.everyNDays': { zh: '每 {n} 日', en: 'every {n} days' },
  'cadence.hourly': { zh: '每個鐘', en: 'hourly' },
  'cadence.everyNHours': { zh: '每 {n} 個鐘', en: 'every {n} hours' },

  // ══════════════════════════════════════════════════════════════════════════
  // FRESHNESS — the registry-driven line for each errand kind.
  // ⛔ DUE MUST NOT CRY WOLF, and the English must not be louder than the Chinese. Today's
  // normal state is 「nobody ran it」; if that reads as an alarm he learns to skip the line
  // within a week, and the day it means something he skips it then too.
  // ══════════════════════════════════════════════════════════════════════════
  'freshness.neverRun': {
    zh: '{title}：從來沒有查過。應該{cadence}一次。',
    en: '{title}: never checked. It should run {cadence}.'
  },
  'freshness.unjudgeable': {
    zh: '{title}：有紀錄但沒有時間，所以我判斷不到有多新。這是一個缺陷。',
    en: '{title}: there are records but no times, so I cannot judge how fresh they are. That is a defect.'
  },
  'freshness.fresh': {
    zh: '{title}：{ago}之前查過。{cadence}一次。',
    en: '{title}: last checked {ago} ago. Runs {cadence}.'
  },
  'freshness.dueHead': {
    zh: '{title}：{ago}之前查過，應該{cadence}一次。',
    en: '{title}: last checked {ago} ago, and it should run {cadence}.'
  },
  'freshness.dueUnknownSchedule': {
    zh: '我問不到 Windows 有沒有排程，所以我不知道是沒有人跑，還是排程死了。',
    en: 'I could not ask Windows whether a schedule exists, so I cannot tell you whether nobody ran it or the schedule is dead.'
  },
  /**
   * ⛔ THE QUIETEST FAILURE MODE HAD BEEN MAPPED ONTO THE CALMEST SENTENCE — 「switched off」
   * once read as 「never set up」. Both languages must keep the distinction audible.
   */
  'freshness.dueDisabled': {
    zh: '⚠ 排程 task 是裝了的，但被人停用了，所以它一世都不會跑。不是沒有裝 —— 是裝了而關掉了。',
    en: '⚠ The scheduled task IS installed, but someone disabled it, so it will never fire. Not missing — installed and switched off.'
  },
  'freshness.dueManual': {
    zh: '還是手動跑的，沒有人跑就沒有新的。',
    en: 'Still run by hand, so nothing is new until someone runs it.'
  },
  'freshness.dueFailed': {
    zh: '⚠ 排程跑過但失敗了，要去看。{saying}',
    en: '⚠ The schedule ran and failed. Worth looking at. {saying}'
  },
  /**
   * ⛔ THE WHOLE REASON THERE ARE TWO WITNESSES. Windows reports nothing wrong; there is simply
   * no row. A trigger that never fired leaves no error anywhere, and this sentence is the only
   * place it surfaces.
   */
  'freshness.dueNeverFired': {
    zh: '⚠ 有排程，但沒有跑過 —— Windows 那邊沒有報錯，即是那個 trigger 可能根本沒有 fire 過。這種情況沒有任何錯誤訊息，只是少了一行紀錄。',
    en: '⚠ A schedule exists but has never run — and Windows reports no error, which means the trigger may never have fired at all. This case produces no error message anywhere; it is only a missing row.'
  },
  'witness.notAsked': {
    zh: '沒有問過 Windows。',
    en: 'Windows was not asked.'
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION DETAIL — the per-day drill-down.
  // ══════════════════════════════════════════════════════════════════════════
  'detail.whyNoItemsRecordedThen': {
    zh: '那次沒有記下找到什麼（舊紀錄）',
    en: 'that run did not record what it found (an older row)'
  },
  'detail.dayCannotCompare': {
    zh: '{day}：沒有得比（之前沒有紀錄）。',
    en: '{day}: nothing to compare against (no earlier run).'
  },
  'detail.dayNothingNew': {
    zh: '{day}：沒有新的。',
    en: '{day}: nothing new.'
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION ATTACHMENT — what travels when he types from inside a section.
  // ⛔ These are NOT the freshness lines, however similar they read. A converted assertion
  // pointed at `freshness.neverRun` and failed here: the attachment builds its own sentence,
  // and 「never ran」 said twice in two places is two strings, not one.
  // ══════════════════════════════════════════════════════════════════════════
  'attachment.neverRan': {
    zh: '{title}：從來沒有跑過。',
    en: '{title}: has never run.'
  },
  'attachment.noConclusion': {
    zh: '{title}：今天沒有可以講的結論。',
    en: '{title}: nothing conclusive to say today.'
  },

  // ══════════════════════════════════════════════════════════════════════════
  // WINDOWS SCHEDULER WITNESS.
  // ⛔ 267011 IS NOT A FAILURE. It means 「installed, has not run yet」, and reading it as an
  // error cost a day once. The wording must not drift back toward alarm in either language.
  // ══════════════════════════════════════════════════════════════════════════
  'sched.ready': { zh: '這個 task 裝了，準備跑（Ready）。', en: 'The task is installed and ready to run.' },
  'sched.running': { zh: '這個 task 正在跑。', en: 'The task is running now.' },
  'sched.disabled': { zh: '這個 task 被人停用了。', en: 'The task has been disabled.' },
  'sched.notYetRun': {
    zh: '這個 task 裝了，但還沒有跑過 —— 未到時間，不是失敗。',
    en: 'The task is installed but has not run yet — not due yet, not failed.'
  },
  'sched.noMoreRuns': {
    zh: '⚠ Windows 說沒有下一次執行（no more runs）—— 對一個每日 task 來說，即是那個 trigger 出了事。',
    en: '⚠ Windows reports no further runs — for a daily task that means the trigger is broken.'
  },
  'sched.notScheduled': { zh: '⚠ Windows 說這個 task 沒有被排程（not scheduled）。', en: '⚠ Windows reports the task is not scheduled.' },
  'sched.terminated': {
    zh: '⚠ 上次跑到一半被終止（terminated）—— 通常是撞到執行時限。',
    en: '⚠ The last run was terminated part-way — usually the execution time limit.'
  },
  'sched.noValidTrigger': { zh: '⚠ 這個 task 沒有任何有效 trigger，所以它不會自己跑。', en: '⚠ The task has no valid trigger, so it will never fire on its own.' },
  'sched.cannotAsk': {
    zh: '問不到 Windows 排程（{error}）。我不知道有沒有 task。',
    en: 'I could not ask Windows about the schedule ({error}). I do not know whether a task exists.'
  },
  'sched.unparseable': {
    zh: 'Windows 答了一些我讀不懂的東西，所以我不知道有沒有 task。',
    en: 'Windows answered with something I could not parse, so I do not know whether a task exists.'
  },
  'sched.notInstalled': { zh: '沒有裝過排程 task。', en: 'No scheduled task has ever been installed.' },
  'sched.installedButDisabled': {
    zh: '這個 task 裝了但被人停用了 —— 它不會跑。',
    en: 'The task is installed but disabled — it will not run.'
  },
  'sched.lastRunFailed': {
    zh: '上次跑那次 Windows 報失敗，退出碼 {code}（0x{hex}）。',
    en: 'Windows reported the last run as failed, exit code {code} (0x{hex}).'
  },
  /**
   * ⛔ THE 0x1 HINT. It is a hint, not a diagnosis, and it says so — a scheduler logon cannot
   * see files inside a user profile, and that is exactly how the backup task died.
   */
  'sched.hint0x1': {
    zh: '⚠ 0x1 通常是排程 logon 看不到 user profile 裡的檔案 —— 備份 task 就是這樣死過。',
    en: '⚠ 0x1 usually means the scheduler logon cannot see files inside a user profile — that is how the backup task died.'
  },
  'sched.noResultReported': {
    zh: '這個 task 裝了，但 Windows 沒有報過一次執行結果。',
    en: 'The task is installed, but Windows has never reported a run result.'
  },
  'sched.healthy': {
    zh: '這個 task 裝了，在跑，上次 Windows 報成功。',
    en: 'The task is installed, running, and Windows reported the last run as successful.'
  },

  // ══════════════════════════════════════════════════════════════════════════
  // HOME ROUTES — what an endpoint says when it will not or cannot answer.
  // ⛔ Every one of these is 「a defect, not a state」 or 「I cannot」 — never 「there is none」.
  // ══════════════════════════════════════════════════════════════════════════
  'route.schedNotWired': {
    zh: '排程入口未接上服務憑證守衛，所以它是關住的。這是一個缺陷，不是一個狀態。',
    en: 'The scheduling endpoint is not wired to the service-credential guard, so it is closed. That is a defect, not a state.'
  },
  'route.cannotAskWindows': { zh: '問不到 Windows 排程。', en: 'I could not ask Windows about the schedule.' },
  'route.unknownSection': { zh: '我不認得這一節：{kind}', en: 'I do not recognise that section: {kind}' },
  'route.unknownSectionNoAttach': { zh: '我不認得這一節，所以沒有東西好附上。', en: 'I do not recognise that section, so there is nothing to attach.' },
  'route.cannotReadOpenSection': { zh: '我看不到差事紀錄，所以打不開這一節。', en: 'I cannot read the errand record, so I cannot open this section.' },
  'route.cannotReadAttach': { zh: '我看不到差事紀錄，所以說不出會附上什麼。', en: 'I cannot read the errand record, so I cannot tell you what would travel.' },
  'route.cannotReadFindErrand': { zh: '我看不到差事紀錄，所以找不到那一單。', en: 'I cannot read the errand record, so I cannot find that errand.' },
  'route.noSettingSeen': { zh: '我從你那句話裡看不出要改哪個設定。', en: 'I cannot tell from that which setting you mean.' },
  'route.errandNotFound': { zh: '找不到那一單差事。', en: 'I could not find that errand.' },
  'route.noTarget': { zh: '那一單沒有記下停在哪一頁。', en: 'That errand did not record which page it stopped on.' },
  /**
   * ⛔ THE RULE IN THE SENTENCE IS THE RULE IN THE CODE: 「Never auto-clear a stale
   * SingletonLock. Two Chromes writing one profile is the kind of corruption that surfaces days
   * later as something else entirely.」 The English must keep the reason, not just the refusal —
   * a refusal without its reason reads as an obstacle and invites someone to remove it.
   */
  'route.profileBusy': {
    zh: '香香現在用著這個 profile，所以開不到。停了它先，或者等它做完。⛔ 我不會自動清那個鎖 —— 兩個 Chrome 一齊寫一個 profile 的損壞，會在幾天之後以另一件事的樣子出現。',
    en: 'She is using that profile right now, so it cannot be opened. Stop her first, or wait until she is done. ⛔ I will not clear the lock automatically — two Chromes writing one profile is the kind of corruption that surfaces days later as something else entirely.'
  },
  'route.launchFailed': { zh: '開不到 Chrome：{error}', en: 'Could not launch Chrome: {error}' },
  'route.opened': {
    zh: '開了在香香那個 profile 裡 —— 即是你會見回她那個購物車。',
    en: 'Opened in her profile — so you will see the same cart she left.'
  },

  'errand.recallTitle': { zh: '回收檢查', en: 'Recall check' },

  /**
   * ⛔ SENTENCE JOINING IS INTERFACE TOO, AND ENGLISH NEEDS IT WHERE CHINESE DOES NOT.
   * The DUE line is a head plus a cause, concatenated. In Chinese 「…一次。還是手動跑的…」 is
   * correct with nothing between them; in English it rendered 「…run daily.Still run by hand」.
   * Third time the same lesson: the gap between Chinese and English is not only in the words.
   */
  'punct.sentenceSep': { zh: '', en: ' ' },

  // ══════════════════════════════════════════════════════════════════════════
  // THE BROWSER HALF.
  //
  // ⛔ EXTRACTING THESE FOUND A DUPLICATION THE WORDING HAD HIDDEN. `app.js` carried its own
  // copies of 「我睇唔到差事紀錄。」, 「冇嘢等你決定。」 and 「未有差事紀錄 ——…」 — the SAME
  // sentences the server already produces in `briefing.js`, as fallbacks for when `line` is
  // absent. Two copies of one sentence, in two languages of code, free to drift the moment
  // either is reworded. They now resolve THE SAME KEYS the server uses: one sentence, one
  // entry, two renderers that provably agree (see browserResolver.test.js).
  // ══════════════════════════════════════════════════════════════════════════
  'nav.home': { zh: '首頁', en: 'Home' },
  'nav.backHome': { zh: '← 返首頁', en: '← Back to Home' },
  'client.noHomeApi': {
    zh: '我找不到首頁那個 API，所以答不到你有什麼等著。',
    en: 'I cannot find the Home API, so I cannot tell you what is waiting.'
  },
  'client.cannotOpenSection': {
    zh: '我打不開這一節 —— 那個 API 看不到。',
    en: 'I cannot open this section — the API is not reachable.'
  },
  /**
   * ⛔ THE STALE-TAB BAR. It has cost a full round three times: the reject button that
   * 「worked」 and never called the server, the entrance that did not appear, the backlog line
   * that did not render. The instruction must survive translation intact — a hard reload is
   * the whole message, and 「refresh」 alone does not do it.
   */
  'client.staleTab': {
    zh: '這個頁面不是最新版本 — 按 Ctrl+Shift+R 硬重新整理。',
    en: 'This page is not the current version — press Ctrl+Shift+R to hard-reload.'
  },

  // ══════════════════════════════════════════════════════════════════════════
  // THE CLIENT — app.js. Every remaining interface string on the screen.
  // ══════════════════════════════════════════════════════════════════════════

  // ── who is answering, and what they can see ──
  'provider.claude': { zh: '香香（Claude）', en: 'Xiangxiang (Claude)' },
  'provider.gpt': { zh: '香香（GPT）', en: 'Xiangxiang (GPT)' },
  'provider.canSee': { zh: '看到 {sources}', en: 'Can see {sources}' },
  /**
   * ⛔ THE ASYMMETRY IS THE POINT, and the English must not soften it. The same data, but a
   * SECOND VENDOR receives it. contextAsymmetry.test.js pins that this stays true.
   */
  'provider.canSeeButSends': {
    zh: '一樣看到 {sources} —— 但這些資料會送去 OpenAI',
    en: 'Sees the same {sources} — but that data is sent to OpenAI'
  },
  'provider.pastDecisions': { zh: '同過往決定', en: 'and past decisions' },

  // ── conversations ──
  'conv.new': { zh: '新對話', en: 'New conversation' },
  'conv.deleteLabel': { zh: '刪除「{title}」', en: 'Delete "{title}"' },
  'conv.delete': { zh: '刪除', en: 'Delete' },
  /** ⛔ 「冇得復原」 must survive translation — it is the whole reason there is a confirm. */
  'conv.deleteConfirm': {
    zh: '刪除「{title}」？這是永久的，沒有得復原。',
    en: 'Delete "{title}"? This is permanent and cannot be undone.'
  },
  'conv.cannotRead': { zh: '讀不到這個對話，可以再按一次。', en: 'I could not load that conversation. Try again.' },
  'conv.cannotDelete': { zh: '刪不到，可以再試一次。', en: 'I could not delete it. Try again.' },
  'conv.today': { zh: '今日', en: 'Today' },
  'conv.yesterday': { zh: '尋日', en: 'Yesterday' },
  'conv.earlier': { zh: '更早', en: 'Earlier' },
  /**
   * ⛔ NO MONTH NAMES. Twelve of them is twelve more things to keep in step, for a label that
   * only has to be unambiguous. He writes 「8月7日」 and would write 「8/7」.
   */
  'conv.monthDay': { zh: '{m}月{d}日', en: '{m}/{d}' },

  // ── the greeting ──
  'greeting.unavailable': {
    zh: '（我拿不到今日的招呼語 —— {error}）',
    en: '(I could not fetch today\'s greeting — {error})'
  },

  // ── section attachment preview: ⛔ 附上咗乜要睇得見 ──
  'attach.travelling': { zh: '⬚ 我會帶著這些落去（{title}）：', en: '⬚ This travels with what you type ({title}):' },
  'attach.open': { zh: '打開 {title} →', en: 'Open {title} →' },

  // ── section detail ──
  'detail.blocked': { zh: '查不到 —— {why}', en: 'Could not check — {why}' },
  'detail.noItemsRecorded': { zh: '沒有記下找到什麼。', en: 'This run did not record what it found.' },
  /** ⛔ The false all-clear, named out loud. Neither language may soften it. */
  'detail.noItemsWarning': {
    zh: '沒有記下找到什麼 —— 不要當它是沒有回收。',
    en: 'Nothing was recorded — do not read that as "no recalls".'
  },
  'detail.siteFound': { zh: '網站找到 {n} 條', en: 'The site returned {n}' },
  'detail.nothingFound': { zh: '沒有找到相關回收。', en: 'No matching recalls.' },
  'detail.whichDayChanged': { zh: '哪日變了什麼', en: 'What changed, and when' },

  // ── the errand outcomes ──
  'outcome.answered': { zh: '答到', en: 'Answered' },
  'outcome.stopped': { zh: '停低，等你', en: 'Stopped for you' },
  'outcome.blocked': { zh: '被網站擋住', en: 'Blocked by the site' },

  // ── the errand history strip ──
  'errands.ranTimesToday': { zh: '今日跑過 {n} 次', en: 'ran {n} times today' },
  'errands.oneRow': { zh: '1 條紀錄', en: '1 row' },
  'errands.rows': { zh: '{n} 條紀錄', en: '{n} rows' },
  'errands.moreHidden': { zh: '還有 {n} 條沒有顯示', en: '{n} more not shown' },
  'errands.noHistoryPage': { zh: '{bits} —— 沒有紀錄頁，要看就問我。', en: '{bits} — there is no history page yet; ask me and I will show you.' },

  // ── the waiting card ──
  'waiting.heading': { zh: '⏸ 等你 —— {title}', en: '⏸ Waiting on you — {title}' },
  'waiting.where': { zh: '邊度', en: 'Where' },
  'waiting.account': { zh: '用邊個', en: 'Account' },
  'waiting.didWhat': { zh: '我做咗', en: 'What I did' },
  'waiting.notPressed': { zh: '我冇撳', en: 'What I did NOT press' },
  'waiting.notPressedValue': { zh: '{role}「{name}」', en: '{role} "{name}"' },
  'waiting.amount': { zh: '金額', en: 'Amount' },
  'waiting.whyStopped': { zh: '點解停', en: 'Why it stopped' },
  'waiting.reopen': { zh: '開返嗰版', en: 'Reopen that page' },
  'waiting.opening': { zh: '開緊…', en: 'Opening…' },
  'waiting.opened': { zh: '開咗', en: 'Opened' },
  'waiting.profileBusyShort': { zh: '香香而家用緊個 profile。', en: 'She is using that profile right now.' },
  'waiting.cannotOpen': { zh: '開唔到。', en: 'Could not open it.' },
  'waiting.countWaiting': { zh: '⏸ {n} 單等你決定', en: '⏸ {n} waiting on you' },
  'waiting.look': { zh: '睇下', en: 'Look' },

  // ── copy ──
  'copy.label': { zh: '複製這個回覆', en: 'Copy this reply' },
  'copy.title': { zh: '複製', en: 'Copy' },
  'copy.done': { zh: '已複製', en: 'Copied' },
  'copy.failed': { zh: '複製唔到', en: 'Could not copy' },

  // ── lanes ──
  'lane.emailDraft': { zh: '寫 Email', en: 'Draft an email' },
  'lane.emailDraftNote': { zh: '直接走 Email 草稿通道', en: 'Goes straight to the email-draft lane' },
  'lane.proposal': { zh: '建立提案', en: 'Make a proposal' },
  'lane.proposalNote': { zh: '講明改哪個檔案、改什麼；批准後才執行', en: 'Names the file and the change; nothing runs until you approve' },
  'lane.next': { zh: '下一句：{name}（按一下取消）', en: 'Next message: {name} (click to cancel)' },
  'lane.chat': { zh: '聊天', en: 'Chat' },
  'lane.emailName': { zh: 'Email 草稿', en: 'Email draft' },
  'lane.proposalName': { zh: '提案', en: 'Proposal' },

  // ── errors ──
  'err.connection': { zh: '連線失敗，可以重新送出。', en: 'Connection failed. You can send it again.' },
  'err.demoDisabled': { zh: '示範功能未啟用（demo_disabled）。', en: 'The demo is not enabled (demo_disabled).' },
  'err.badInput': { zh: '輸入無效，請檢查訊息或模式。', en: 'Invalid input — check the message or the mode.' },
  'err.serverBusy': { zh: '系統暫時無法處理這個請求。', en: 'The system cannot handle this request right now.' },
  'err.retrySuffix': { zh: '{message}（可重新送出）', en: '{message} (you can send it again)' },
  'err.unknownShape': { zh: '收到回應但格式未知。requestId: {id}', en: 'A reply arrived in a shape I do not recognise. requestId: {id}' },
  'err.none': { zh: '（無）', en: '(none)' },
  'err.unknownReason': { zh: '未知原因', en: 'no reason given' },

  // ── who answered ──
  'served.by': { zh: '由 {name} 回答', en: 'Answered by {name}' },
  /** ⛔ The fallback must SAY it was a fallback; silently switching vendor is the thing to avoid. */
  'served.byFallback': {
    zh: '由 {name} 回答（你揀的那個失敗了，已自動改用它）',
    en: 'Answered by {name} (the one you picked failed, so this one was used instead)'
  },
  'served.noExternalModel': { zh: '未送外部模型，未執行任何動作', en: 'No external model was called; nothing was executed' },

  // ── email draft ──
  'draft.title': { zh: '草稿（未寄出）', en: 'Draft (not sent)' },
  'draft.subject': { zh: '主旨：{subject}', en: 'Subject: {subject}' },
  'draft.emptyBody': { zh: '（無內文）', en: '(no body)' },
  'draft.meta': { zh: 'SHADOW_ONLY · 未寄出 · 未寫入記憶', en: 'SHADOW_ONLY · not sent · not written to memory' },

  // ── proposals ──
  'proposal.none': { zh: '尚未建立任何提案', en: 'No proposal has been created' },
  'proposal.meta': { zh: '提案 {id} · 只是提案，未執行', en: 'Proposal {id} · a proposal only; nothing has run' },
  'proposal.file': { zh: '檔案：{file}', en: 'File: {file}' },
  'proposal.intent': { zh: '改動：{intent}', en: 'Change: {intent}' },
  'proposal.correctIt': {
    zh: '看錯了？直接打多一句話講清楚就可以，不用填表。',
    en: 'Got it wrong? Just say so in another sentence — there is no form to fill in.'
  },
  'proposal.whichFile': { zh: '你想改哪個檔？', en: 'Which file do you want changed?' },
  'proposal.askFileLabel': { zh: '要改的單一檔案路徑', en: 'The single file path to change' },
  'proposal.askIntentLabel': { zh: '打算改成甚麼', en: 'What it should become' },
  'proposal.askFilePlaceholder': { zh: '請輸入要改的檔案路徑', en: 'Enter the file path to change' },
  'proposal.askIntentPlaceholder': { zh: '請輸入想改成甚麼', en: 'Enter what it should become' },
  'proposal.makeWorkOrder': { zh: '產生工作單', en: 'Create a work order' },

  // ── the settings offer (deterministic entrance) ──
  'offer.settingAsk': { zh: '要我改這個設定？', en: 'Shall I change this setting?' },
  'offer.change': { zh: '{say}：{from} → {to}', en: '{say}: {from} → {to}' },
  'offer.needsReregister': {
    zh: '⚠ 這個不會即刻生效 —— 改完還要重新登記那個 task。',
    en: '⚠ This does not take effect immediately — the task has to be re-registered afterwards.'
  },
  'offer.go': { zh: '改', en: 'Change it' },
  'offer.changing': { zh: '改緊…', en: 'Changing…' },
  'offer.failed': { zh: '改不到：{reason}', en: 'Could not change it: {reason}' },
  'offer.done': { zh: '改咗：{say} = {to}{how}', en: 'Changed: {say} = {to}{how}' },
  'offer.liveNow': { zh: '（即刻生效）', en: ' (live now)' },
  'offer.howToApply': { zh: '（要重新登記 task：{how}）', en: ' (re-register the task: {how})' },
  'offer.noAnswer': { zh: '改不到 —— 那個 API 沒有回答。', en: 'Could not change it — the API did not answer.' },
  'offer.workOrderAsk': { zh: '要我出一張工作單改 {file}？', en: 'Shall I raise a work order to change {file}?' },
  'offer.makeWorkOrder': { zh: '出工作單', en: 'Raise a work order' },
  'offer.making': { zh: '正在出工作單…', en: 'Raising a work order…' },
  /** ⛔ 「甚麼都沒有建立」 is the reassurance that matters on a failure. Keep it in both. */
  'offer.makeFailed': {
    zh: '未能出工作單（{reason}）。甚麼都沒有建立。',
    en: 'Could not raise the work order ({reason}). Nothing was created.'
  },
  'offer.makeFailedNet': {
    zh: '連線失敗，未能出工作單。甚麼都沒有建立。',
    en: 'Connection failed, so no work order was raised. Nothing was created.'
  },
  'offer.createFailed': { zh: '未能建立工作單：{reason}', en: 'Could not create the work order: {reason}' },
  'offer.createFailedNet': { zh: '連線失敗（未建立任何工作單）。', en: 'Connection failed (no work order was created).' },

  // ── the approval card ──
  'approve.approve': { zh: '批准測試', en: 'Approve test' },
  'approve.reject': { zh: '拒絕', en: 'Reject' },
  'approve.technical': { zh: '技術細節', en: 'Technical detail' },
  'approve.details': { zh: '詳細', en: 'Detail' },
  'approve.typeToConfirm': { zh: '請輸入 {word} 以確認', en: 'Type {word} to confirm' },
  'approve.cancelling': { zh: '正在取消…', en: 'Cancelling…' },
  'approve.rejected': {
    zh: '你拒絕了這張工作單。提案已取消，甚麼都沒有執行。',
    en: 'You rejected this work order. The proposal is cancelled and nothing ran.'
  },
  'approve.cancelFailed': {
    zh: '未能取消這張工作單（{reason}）。甚麼都沒有執行，但提案仍然存在。',
    en: 'Could not cancel this work order ({reason}). Nothing ran, but the proposal still exists.'
  },
  'approve.cancelFailedNet': {
    zh: '連線失敗，未能取消。甚麼都沒有執行，但提案仍然存在。',
    en: 'Connection failed, so it was not cancelled. Nothing ran, but the proposal still exists.'
  },
  'approve.startedInCopy': { zh: '已批准。香香開始在丟棄式副本裡面做。', en: 'Approved. She has started, in a throwaway copy.' },
  /** ⛔ 「甚麼都冇跑過」 — approved is not the same as executed, and the sentence must say so. */
  'approve.confirmedNotRun': {
    zh: '已批准：工作單已確認，但執行通道未開啟，所以甚麼都沒有跑過。',
    en: 'Approved: the work order is confirmed, but the execution lane is not open, so nothing has run.'
  },
  'approve.refused': { zh: '被拒絕：{reason}（這張單已作廢，請重新產生）', en: 'Refused: {reason} (this card is void — raise a new one)' },
  'approve.refusedNet': { zh: '連線失敗（這張單已作廢，請重新產生）', en: 'Connection failed (this card is void — raise a new one)' },
  'approve.currentContent': { zh: '現時內容', en: 'Current content' },
  'approve.intendedChange': { zh: '打算改成', en: 'Intended change' },

  // ── run progress ──
  'run.starting': { zh: '正在開始…', en: 'Starting…' },
  'run.done': { zh: '完成', en: 'Done' },
  'run.failed': { zh: '未成功', en: 'Did not succeed' },
  /** No agreement problem: seconds are always plural in this form, and 「1s」 reads correctly. */
  'run.elapsed': { zh: '已用 {secs} 秒', en: '{secs}s elapsed' },
  'run.elapsedOfCap': { zh: '已用 {secs} 秒 / 上限 {cap} 秒', en: '{secs}s elapsed of {cap}s' },
  'run.timedOut': { zh: '超過時限仍未收到結果 —— 請查伺服器記錄', en: 'Past the time limit with no result — check the server log' },
  'run.result': { zh: '執行結果', en: 'Result' },
  'run.changes': { zh: '改動', en: 'Changes' },

  // ── settings panel ──
  'set.conversationRecall': { zh: '對話記憶', en: 'Conversation memory' },
  'set.decisionRecall': { zh: '決定記憶', en: 'Decision memory' },
  'set.setByOwner': { zh: '你設定', en: 'set by you' },
  'set.setAtStartup': { zh: '啟動時設定', en: 'set at startup' },
  'set.on': { zh: '開', en: 'On' },
  'set.off': { zh: '關', en: 'Off' },
  /** ⛔ A switch that is on but cannot read must say so, or it reads as working. */
  'set.masterOff': {
    zh: '總開關 READ_ACCESS 是關的，所以這個開了也讀不到',
    en: 'The READ_ACCESS master switch is off, so turning this on still reads nothing'
  },
  'set.loading': { zh: '讀取中…', en: 'Loading…' },
  'set.lastSaved': { zh: '上次儲存 {when}', en: 'Last saved {when}' },
  'set.loadFailed': { zh: '讀取設定失敗', en: 'Could not load settings' },
  'set.saving': { zh: '儲存中…', en: 'Saving…' },
  'set.saved': { zh: '已儲存。下一句即時生效。', en: 'Saved. It takes effect on your next message.' },
  'set.saveFailed': { zh: '儲存失敗', en: 'Could not save' },

  'brand.name': { zh: '香香', en: 'Xiangxiang' },

  /**
   * ⛔ MORE SEPARATORS, FOUND THE SAME WAY. 「／」 joins the read-source names and 「·」 joins
   * the errand history bits. Neither is a Han ideograph, so neither appeared in any count of
   * 「Chinese in the codebase」 — and left alone the English would have read
   * 「Drive／Gmail／Calendar」. Fourth instance of the same lesson.
   */
  'punct.sourceSep': { zh: '／', en: ' / ' },
  'punct.bulletSep': { zh: ' · ', en: ' · ' },

  // ══════════════════════════════════════════════════════════════════════════
  // THE PAGE SHELL — index.html's static text, and the settings page.
  //
  // ⛔ index.html NOW CARRIES NO WORDS AT ALL. Static markup cannot call t(), and baking the
  // text at assembly time would freeze it: the document is built ONCE at module load, so a
  // language change would need a RESTART rather than the reload the setting promises. So the
  // markup ships empty-labelled and app.js fills every one of these at boot, through the same
  // resolver as everything else — see applyShellText().
  // ══════════════════════════════════════════════════════════════════════════
  'shell.title': { zh: '香香', en: 'Xiangxiang' },
  'shell.settingsTitle': { zh: '香香 設定', en: 'Xiangxiang — Settings' },
  'shell.convListLabel': { zh: '對話列表', en: 'Conversations' },
  'shell.collapse': { zh: '收合側欄', en: 'Collapse sidebar' },
  'shell.expand': { zh: '展開側欄', en: 'Expand sidebar' },
  'shell.placesLabel': { zh: '地方', en: 'Places' },
  'shell.newChat': { zh: '＋ 開新對話', en: '+ New conversation' },
  'shell.historyLabel': { zh: '歷史對話', en: 'Conversation history' },
  'shell.settings': { zh: '設定', en: 'Settings' },
  'shell.local': { zh: '本機 · 127.0.0.1', en: 'Local · 127.0.0.1' },
  /**
   * ⛔ THE COMPOSER PLACEHOLDER CARRIES A PROMISE, NOT A HINT. 「改檔案要你批准才會執行」 is the
   * standing guarantee that nothing runs unapproved, and it is the first thing he reads on an
   * empty screen. It must survive translation whole.
   */
  'shell.composerPlaceholder': {
    zh: '跟香香說…改檔案要你批准才會執行',
    en: 'Talk to Xiangxiang… file changes run only after you approve'
  },
  'shell.messageLabel': { zh: '訊息', en: 'Message' },
  'shell.more': { zh: '更多', en: 'More' },
  'shell.shortcuts': { zh: '捷徑', en: 'Shortcuts' },
  'shell.pickWho': { zh: '揀邊個香香', en: 'Choose which Xiangxiang' },
  'shell.send': { zh: '送出', en: 'Send' },
  'shell.composerNote': {
    zh: '本機示範 · 任何動作都要你批准',
    en: 'Local demo · every action needs your approval'
  },
  'shell.close': { zh: '關閉', en: 'Close' },

  // ── the settings sheet ──
  'set.styleHeading': { zh: '說話風格', en: 'How she speaks' },
  'set.styleHint': {
    zh: '你想她怎樣講嘢。例如：「講嘢簡短一點，一段一件事，不要每次都反問我」',
    en: 'How you want her to talk. For example: "keep it short, one thing per paragraph, stop asking me a question back every time".'
  },
  'set.stylePlaceholder': { zh: '（留空即沿用預設）', en: '(leave empty to keep the default)' },
  'set.prefsHeading': { zh: '要她記住的事', en: 'Things for her to remember' },
  'set.prefsHint': {
    zh: '你寫下要她長期記住的事。你親手寫的，優先於對話記憶。',
    en: 'What you want her to remember long-term. What you write by hand outranks conversation memory.'
  },
  'set.prefsPlaceholder': { zh: '每行一件事', en: 'One thing per line' },
  'set.memoryHeading': { zh: '記憶與讀取', en: 'Memory and reading' },
  /** ⛔ 「唔會扮知道」 is the honesty guarantee, not decoration. Both languages keep it. */
  'set.memoryHint': {
    zh: '關了就是關了 —— 她會照直講讀不到，不會扮知道。',
    en: 'Off means off — she will say plainly that she cannot read it, and will not pretend to know.'
  },
  /**
   * ⛔ THE PARAGRAPH THAT SAYS WHAT THIS SCREEN CANNOT DO. Identity is frozen; the honesty
   * rules, the red-line policy and the read-state guard are CODE, not text — so nothing typed
   * on this screen can change them. An English rendering that softened this into 「settings do
   * not affect safety」 would lose the point, which is that they are a different KIND of thing.
   */
  'set.foot': {
    zh: '這裡只改風格、記憶同開關。身分是凍結的，不在這裡改。誠實守則、紅線政策、讀取狀態守衛是程式碼，不是文字 —— 寫在這裡的東西改變不了它們。',
    en: 'This screen changes style, memory and switches only. Identity is frozen and is not changed here. The honesty rules, the red-line policy and the read-state guard are CODE, not text — nothing written here can change them.'
  },
  'set.save': { zh: '儲存', en: 'Save' },
  'set.savedNextTurn': { zh: '已儲存。下次對話即時生效。', en: 'Saved. It takes effect on your next message.' },
  'set.subtitle': {
    zh: '改完儲存，下次對話即時生效。不需要重啟。',
    en: 'Save your changes and they take effect on your next message. No restart needed.'
  },
  /**
   * ⛔ THE STANDALONE SETTINGS PAGE names PERSONA_IDENTITY explicitly where the in-chat sheet
   * does not. Kept as its own entry rather than folded into set.foot: two surfaces saying
   * ALMOST the same thing is exactly how one of them silently loses half its meaning.
   */
  'set.footPage': {
    zh: '這頁只改風格、記憶同開關。身分（PERSONA_IDENTITY）是凍結的，不在這裡改。誠實守則、紅線政策、讀取狀態守衛是程式碼，不是文字 —— 寫在這裡的東西改變不了它們。',
    en: 'This page changes style, memory and switches only. Identity (PERSONA_IDENTITY) is frozen and is not changed here. The honesty rules, the red-line policy and the read-state guard are CODE, not text — nothing written here can change them.'
  },
  'set.readDrive': { zh: '讀取 Drive', en: 'Read Drive' },
  'set.readGmail': { zh: '讀取 Gmail', en: 'Read Gmail' },
  'set.readCalendar': { zh: '讀取 Calendar', en: 'Read Calendar' },
  'set.readGithub': { zh: '讀取 GitHub', en: 'Read GitHub' },

  // ══════════════════════════════════════════════════════════════════════════
  // THE APPROVAL CARD — agent/workOrderView.js.
  //
  // ⛔ EVERY SENTENCE HERE IS A GOVERNANCE CLAIM, NOT A LABEL. 「只在丟棄式副本內操作」 and
  // 「不會提交」 are what he is approving ON THE STRENGTH OF. An English rendering that
  // softened, generalised or dropped any of them would narrow a guarantee without touching a
  // line of enforcement — which is the quietest way this card could go wrong.
  // ══════════════════════════════════════════════════════════════════════════
  'card.notProvided': { zh: '（未提供）', en: '(not provided)' },
  'card.none': { zh: '（無）', en: '(none)' },
  'card.yes': { zh: '是', en: 'yes' },
  'card.no': { zh: '否', en: 'no' },

  // ── the nine forbidden actions, as HE would name them ──
  'wont.commit': { zh: '提交', en: 'commit' },
  'wont.push': { zh: '上傳', en: 'push' },
  'wont.pr': { zh: '開 PR', en: 'open a PR' },
  'wont.merge': { zh: '合併', en: 'merge' },
  'wont.deploy': { zh: '部署', en: 'deploy' },
  'wont.credEdit': { zh: '改憑證', en: 'change credentials' },
  'wont.envEdit': { zh: '改環境設定', en: 'change environment settings' },
  'wont.gateEdit': { zh: '改授權閘', en: 'change the authorisation gate' },
  'wont.auditEdit': { zh: '改稽核紀錄', en: 'change the audit record' },

  /**
   * ⛔ THE CHINESE IS PRESERVED EXACTLY, AND MY FIRST ATTEMPT DID NOT PRESERVE IT.
   *
   * The execution list negates EVERY item — 「不會提交、不會上傳、不會開 PR」 — and the
   * file-scope list negates once — 「亦不會改憑證、改環境設定」. That asymmetry is the Owner's
   * wording and it is emphatic on purpose.
   *
   * I first 「fixed」 it into a single negation because that reads better in English, and
   * cardFace.test.js failed on 「不會上傳」. Rewriting HIS Chinese to suit MY English is the
   * translation equivalent of narrowing a claim to make it fit — so the per-item form stays,
   * and the English carries it as 「will not commit, will not push」, which is emphatic in the
   * same way rather than merely shorter.
   */
  'wont.each': { zh: '不會{item}', en: 'will not {item}' },
  'wont.execSentence': { zh: '{list}。', en: 'It {list}.' },
  'wont.alsoSentence': { zh: '亦不會{list}。', en: 'It will also not {list}.' },
  'wont.none': {
    zh: '這張工作單沒有宣告任何禁止動作。',
    en: 'This work order declares no forbidden actions.'
  },
  /** ⛔ AN ACTION THE MAP DOES NOT KNOW IS COUNTED, NEVER DROPPED — the omission would be a guarantee. */
  'wont.unnamed': {
    zh: '另有 {n} 項禁止動作未能顯示名稱（{ids}）。',
    en: 'A further {n} forbidden actions could not be named ({ids}).'
  },

  // ── durations, reused from the errand formatter's rules ──
  'card.seconds': { zh: '{n} 秒', en: '{n}s' },
  'card.minutes': { zh: '{n} 分鐘', en: '{n} min' },

  // ── the face ──
  'card.heading': { zh: '香香想改一個檔案', en: 'Xiangxiang wants to change one file' },
  'card.scopeOneFile': { zh: '只修改 {file} 一個檔案。', en: 'Changes {file} and nothing else.' },
  /** ⛔ THE ISOLATION PROMISE. It is the reason approving this is safe at all. */
  'card.scopeThrowaway': {
    zh: '只在丟棄式副本內操作，真實程式庫不會被改動。',
    en: 'Works only inside a throwaway copy; the real repository is not touched.'
  },
  'card.beforeLabel': { zh: '現時內容（讀自真實檔案{truncated}）', en: 'Current content (read from the real file{truncated})' },
  'card.truncated': { zh: '，已截斷，下面還有', en: ', truncated — there is more below' },
  /** ⛔ 「不是已完成的結果」 — an intention, not an outcome. Both languages must keep that apart. */
  'card.afterLabel': {
    zh: '香香打算改成（這是香香的打算，不是已完成的結果 —— 它仍未執行，實際結果可能不同）',
    en: 'What she intends to change it to (an intention, not a result — it has not run, and the real outcome may differ)'
  },
  'card.worstCase': {
    zh: '改壞了？只改副本，你的程式庫不受影響。',
    en: 'Breaks something? Only the copy changes; your repository is untouched.'
  },
  'card.caps': { zh: '最長 {time} · 最多 {money}', en: 'Up to {time} · at most {money}' },
  'card.secBeforeAfter': { zh: '現時內容 / 打算改成', en: 'Current content / intended change' },
  'card.secBefore': { zh: '現時內容', en: 'Current content' },
  'card.secWhatChanges': { zh: '要修改的內容', en: 'What changes' },
  'card.secScope': { zh: '影響範圍', en: 'Scope' },
  'card.secWillNot': { zh: '不會發生', en: 'What will not happen' },
  'card.secCaps': { zh: '上限', en: 'Limits' },
  'card.approve': { zh: '批准', en: 'Approve' },
  'card.reject': { zh: '拒絕', en: 'Reject' },
  'card.details': { zh: '詳細', en: 'Detail' },
  'card.technical': { zh: '技術細節', en: 'Technical detail' },

  /**
   * ⛔ THE TECHNICAL BLOCK IS COLUMN-ALIGNED WITH FULL-WIDTH PADDING, AND THAT IS ANOTHER
   * PLACE THE GAP IS NOT IN THE WORDS.
   *
   * 「分支              : 」 lines up because CJK glyphs are double-width in a monospace
   * terminal. The same padding in English produces a ragged column, and padding computed by
   * character count would be wrong for either. So the SPACING IS PART OF EACH LANGUAGE'S
   * TEMPLATE — the Chinese keeps its alignment, the English uses a plain label and colon.
   */
  'tech.branch': { zh: '分支              : {v}', en: 'Branch: {v}' },
  'tech.allowedFiles': { zh: '可改檔案          : {v}', en: 'Files it may change: {v}' },
  'tech.testCommand': { zh: '測試指令          : {v}', en: 'Test command: {v}' },
  'tech.forbidden': { zh: '禁止動作          : {v}', en: 'Forbidden actions: {v}' },
  'tech.capsRaw': { zh: '上限（原始值）    : {v}', en: 'Limits (raw): {v}' },
  'tech.ttl': {
    zh: '工作單有效時間    : {v}（逾時自動失效，需重新產生）',
    en: 'Work order valid for: {v} (expires automatically; raise a new one)'
  },
  'tech.truncated': { zh: '現時內容是否截斷  : {v}', en: 'Current content truncated: {v}' },
  'tech.secondFile': {
    zh: '如需改第二個檔案  : 必須重新建立一張新的工作單（沒有中途加檔案的機制）',
    en: 'To change a second file: a new work order is required — there is no mechanism for adding one mid-run'
  },
  'tech.isolation': {
    zh: '隔離方式          : 丟棄式副本，已移除所有 remote，改動無法回到 main',
    en: 'Isolation: a throwaway copy with every remote removed; changes cannot reach main'
  },

  // ══════════════════════════════════════════════════════════════════════════
  // THE EXECUTION RESULT — agent/agentResultView.js.
  // ⛔ Same class of claims as the approval card: what ran, whether it stayed in scope, and
  // that the real repository was not touched. 「越界」 must stay as loud in English.
  // ══════════════════════════════════════════════════════════════════════════
  'result.unknown': { zh: '（執行器沒有提供這項資料）', en: '(the runner did not report this)' },
  'phase.accepted': { zh: '已批准，正在排隊', en: 'Approved, queued' },
  'phase.preparing': { zh: '正在準備丟棄式副本', en: 'Preparing the throwaway copy' },
  'phase.running': { zh: '香香正在處理', en: 'She is working' },
  'phase.verifying': { zh: '正在核對改動範圍', en: 'Checking what changed' },
  'phase.done': { zh: '完成', en: 'Done' },
  'phase.failed': { zh: '未成功', en: 'Did not succeed' },

  'result.running': { zh: '香香正在丟棄式副本內處理中…', en: 'She is working inside the throwaway copy…' },
  'result.pending': {
    zh: '仍未有結果（這次批准未有執行，或執行器未回報）',
    en: 'No result yet (this approval never ran, or the runner has not reported)'
  },
  'result.refused': { zh: '執行器拒絕了這張工作單（沒有任何改動）', en: 'The runner refused this work order (nothing changed)' },
  'result.timeout': { zh: '超時中止 —— 測試副本已丟棄', en: 'Timed out and stopped — the test copy is discarded' },
  'result.doneHeadline': { zh: '完成 —— 這是在丟棄式副本內的結果', en: 'Done — this is the result inside the throwaway copy' },
  'result.failedHeadline': { zh: '未成功 —— 測試副本已丟棄', en: 'Did not succeed — the test copy is discarded' },
  'result.noFilesChanged': { zh: '（沒有任何檔案被改動）', en: '(no file was changed)' },
  'result.inScope': { zh: '有守住範圍：只動過批准的 {files}。', en: 'Stayed in scope: only the approved {files} were touched.' },
  /** ⛔ 「這份結果不應採用」 is an instruction, not a description. It must survive translation. */
  'result.outOfScope': {
    zh: '越界：動過不在批准範圍內的檔案 —— {files}。這份結果不應採用。',
    en: 'OUT OF SCOPE: files outside the approval were touched — {files}. Do not use this result.'
  },
  'result.noTestCommand': { zh: '（這張工作單沒有測試指令）', en: '(this work order has no test command)' },
  'result.testPassed': { zh: '測試通過：{cmd}', en: 'Tests passed: {cmd}' },
  'result.testFailed': { zh: '測試失敗：{cmd}', en: 'Tests failed: {cmd}' },
  'result.durationSec': { zh: '{n} 秒', en: '{n}s' },
  'result.capsText': { zh: '（上限 {money} / {time}）', en: ' (limits: {money} / {time})' },
  'result.capSeconds': { zh: '{n} 秒', en: '{n}s' },
  'result.noPatchNoChange': { zh: '沒有改動，所以沒有 patch。', en: 'Nothing changed, so there is no patch.' },
  'result.patchTooBig': {
    zh: 'patch 太大，沒有寫入 —— 改動範圍超出了預期，請重新出一張更窄的工作單。',
    en: 'The patch was too large to write — the change went wider than expected. Raise a narrower work order.'
  },
  'result.patchFailed': {
    zh: 'patch 寫不到（{status}）。改動已經隨副本刪除，要重新跑。',
    en: 'The patch could not be written ({status}). The changes went with the copy and it must be run again.'
  },
  'result.secResult': { zh: '結果', en: 'Result' },
  'result.secChanged': { zh: '實際改動了甚麼', en: 'What actually changed' },
  'result.secScope': { zh: '有沒有超出批准範圍', en: 'Did it go outside the approval' },
  'result.secTest': { zh: '測試', en: 'Tests' },
  'result.secDiff': { zh: '改動內容（diff）', en: 'The change (diff)' },
  'result.secCost': { zh: '用了多少', en: 'What it used' },
  'result.secPatch': { zh: '改動去咗邊', en: 'Where the change went' },
  'result.secYourRepo': { zh: '你的真實程式庫', en: 'Your real repository' },
  /** ⛔ The whole reason approving was safe. Neither language may soften it. */
  'result.yourRepoBody': {
    zh: '完全沒有被改動。這次操作只發生在丟棄式副本裡，副本已經（或即將）被刪除。',
    en: 'Not touched at all. This ran only inside a throwaway copy, which has been (or is about to be) deleted.'
  },
  'result.secRefusedReason': { zh: '拒絕原因', en: 'Why it was refused' },
  'result.secFailedReason': { zh: '失敗原因', en: 'Why it failed' },
  'result.noApprovalId': { zh: '（無 approvalId）', en: '(no approvalId)' },
  'result.title': { zh: '【執行結果 — {id}】', en: '[Result — {id}]' },

  // ══════════════════════════════════════════════════════════════════════════
  // ANSWER PLAN — the labels that reach the screen.
  // ⛔ THIS FILE ALSO HOLDS MODEL TEXT AND MATCHING TOKENS. Only the labels below moved; see
  // the ⛔ notes in intake/answerPlan.js at each region that must never be translated.
  // ══════════════════════════════════════════════════════════════════════════
  'unit.ea': { zh: '件', en: 'ea' },
  'unit.cs': { zh: '箱', en: 'cs' },
  'unit.box': { zh: '盒', en: 'box' },
  'unit.pal': { zh: '卡板', en: 'pallet' },
  'unit.bag': { zh: '袋', en: 'bag' },
  'unit.bottle': { zh: '支', en: 'bottle' },
  'unit.pack': { zh: '包', en: 'pack' },

  'status.needsReview': { zh: '需要審批', en: 'needs approval' },
  'status.approved': { zh: '已批准', en: 'approved' },
  'status.sent': { zh: '已發送', en: 'sent' },
  'status.received': { zh: '已收貨', en: 'received' },
  'status.partiallyReceived': { zh: '部分收貨', en: 'partly received' },
  'status.active': { zh: '啟用中', en: 'active' },
  'status.inactive': { zh: '已停用', en: 'inactive' },
  /** ⛔ NOT 「unknown」. The record does not say — which is a different claim from 「it is unknown」. */
  'status.unknown': { zh: '狀態未確認', en: 'status not confirmed' },

  'entity.inventoryItem': { zh: '項存貨記錄', en: 'stock records' },
  'entity.supplier': { zh: '個供應商', en: 'suppliers' },
  'entity.invoice': { zh: '張發票', en: 'invoices' },
  'entity.purchaseOrder': { zh: '張採購單', en: 'purchase orders' },
  'entity.dailyCount': { zh: '次盤點', en: 'counts' },
  'entity.orderSuggestion': { zh: '項訂貨建議', en: 'order suggestions' },
  'entity.mail': { zh: '封郵件', en: 'emails' },
  'entity.file': { zh: '份文件', en: 'documents' },
  'entity.event': { zh: '件安排', en: 'calendar entries' },
  'entity.commit': { zh: '個改動', en: 'commits' },
  'entity.pullRequest': { zh: '個 PR', en: 'pull requests' },
  'entity.generic': { zh: '項記錄', en: 'records' },

  'source.aromaSystem': { zh: '餐廳系統', en: 'the restaurant system' },
  'source.calendar': { zh: '日曆', en: 'Calendar' },

  /** ⛔ 「不會亂說」 is the promise. Read succeeded, answer withheld — two separate facts. */
  'plan.cannotRead': {
    zh: '我這次讀不到可以用來回答這個問題的資料。',
    en: 'I could not read anything this time that would answer that.'
  },
  'plan.readButNoAnswer': {
    zh: '我讀到 {parts}。資料讀取成功，但這一次我組不出一個可靠的答案，所以不會亂說。',
    en: 'I read {parts}. The read succeeded, but I cannot assemble a reliable answer from it this time, so I will not guess.'
  },
  'plan.countOf': { zh: '{n} {kind}', en: '{n} {kind}' },

  // ══════════════════════════════════════════════════════════════════════════
  // THE PROFILE PROBE — governance/profileProbe.js.
  //
  // ⛔ EVERY SENTENCE HERE IS A REFUSAL OR ITS REASON. 「讀唔到就當唔安全,唔開工」 is the
  // fail-closed rule stated to him in words; an English rendering that softened it into
  // 「could not check」 would describe the same code as a warning instead of a stop.
  // ══════════════════════════════════════════════════════════════════════════
  'probe.neverWrote': {
    zh: '這個 profile Chrome 沒有寫過資料庫 —— 即是沒有存過卡，不是「查過沒有卡」。',
    en: 'Chrome has never written a database for this profile — so no card was ever stored, which is NOT the same as "checked and found none".'
  },
  'probe.unreadableTables': {
    zh: '我打得開這個資料庫，但一張表都查不到。當作不安全處理。',
    en: 'I can open the database but cannot read a single table. Treated as unsafe.'
  },
  'probe.hasPaymentMethods': {
    zh: '這個 profile 現在有付款方式（{total} 項：{findings}）。最可能是你上次在這個 profile 完成付款時，Chrome 問你存不存卡，而存了。要在 Chrome 設定裡刪走它，我才可以開工。',
    en: 'This profile now has payment methods ({total}: {findings}). Most likely Chrome offered to save a card when you last paid in this profile, and it was saved. Remove it in Chrome settings before I can work.'
  },
  'probe.clean': { zh: '查過 {n} 張付款表，全部空。', en: 'Checked {n} payment tables; all empty.' },
  /** ⛔ 「讀不到就當不安全，不開工」 — the fail-closed rule, not a description of one. */
  'probe.cannotRead': {
    zh: '我讀不到這個 profile 的付款資料庫（{error}）。讀不到就當不安全，不開工。',
    en: 'I cannot read this profile\'s payment database ({error}). Unreadable is treated as unsafe, so I will not start.'
  },
  'probe.noProfileDir': { zh: '這個 profile 資料夾還不存在。', en: 'That profile folder does not exist yet.' },
  'probe.noLock': { zh: '沒有鎖，這個 profile 有空。', en: 'No lock; the profile is free.' },
  /**
   * ⛔ THE STANDING RULE, IN HIS WORDS: 「Never auto-clear a stale SingletonLock. Two Chromes
   * writing one profile is the kind of corruption that surfaces days later as something else
   * entirely.」 The refusal AND its reason must both survive translation — a refusal without
   * its reason reads as an obstacle and invites someone to remove it.
   */
  'probe.locked': {
    zh: '這個 profile 有鎖（{files}）。可能香香用著，也可能是上次 crash 留下的。⛔ 我不會自動刪 —— 兩個 Chrome 一齊寫一個 profile 的損壞，會在幾天之後以另一件事的樣子出現。',
    en: 'This profile is locked ({files}). She may be using it, or it may be left over from a crash. ⛔ I will not clear it automatically — two Chromes writing one profile is the kind of corruption that surfaces days later as something else entirely.'
  },
  'probe.chromeHoldsPrefs': {
    zh: 'Chrome 現在開著這個 profile，它自己拿著設定檔 —— 它是原子性重寫的，所以會有一刻讀不到。關掉 Chrome 我就讀得回。這個檔案沒有不見。',
    en: 'Chrome has this profile open and is holding the preferences file. It rewrites it atomically, so there is a moment when it cannot be read. Close Chrome and I can read it again. The file is not missing.'
  },
  'probe.noPreferences': {
    zh: '這個 profile 沒有設定檔，而 Chrome 也沒有開著它。讀不到就當不安全。',
    en: 'This profile has no preferences file and Chrome does not have it open. Unreadable is treated as unsafe.'
  },
  'probe.prefsUnreadable': { zh: '設定檔讀不到（{error}）。當作不安全。', en: 'The preferences file cannot be read ({error}). Treated as unsafe.' },
  'probe.saveCardOff': { zh: '存卡功能是關掉的。', en: 'Card saving is switched off.' },
  'probe.saveCardOn': {
    zh: 'Chrome 現在會問你存不存卡（設定是 {value}）。這個是在開 profile 時就應該關死的東西 —— 現在它開回了，所以下次你付款，卡會留在這個 profile 裡。',
    en: 'Chrome will now offer to save your card (the setting is {value}). This should have been switched off when the profile was created — it is back on, so the next time you pay, the card stays in this profile.'
  },
  'probe.prefsUnreadableNoStart': { zh: '設定檔讀不到。當作不安全，不開工。', en: 'The preferences file cannot be read. Treated as unsafe; I will not start.' },
  /** ⛔ 「「沒有付款方式」已經不成立」 — the claim being withdrawn, not a caution. */
  'probe.signedIn': {
    zh: 'Chrome 本身登了 Google 帳戶，或者開了同步。這樣 Google Pay 的卡同自動填表會同步入這個 profile —— 即是不用去過任何付款頁，「沒有付款方式」已經不成立。要在 Chrome 裡登出同關掉同步，我才可以開工。',
    en: 'Chrome itself is signed into a Google account, or sync is on. Google Pay cards and autofill then sync INTO this profile — so without ever visiting a payment page, "no payment methods" no longer holds. Sign out and turn off sync in Chrome before I can start.'
  },
  'probe.signinAllowed': {
    zh: 'Chrome 仍然准許登入它自己的 Google 帳戶。這個應該在開 profile 時就關死。',
    en: 'Chrome still allows signing into its own Google account. That should have been switched off when the profile was created.'
  },
  'probe.signinBlocked': { zh: 'Chrome 本身不准登入，也沒有同步。', en: 'Chrome itself cannot sign in, and sync is off.' },

  // ══════════════════════════════════════════════════════════════════════════
  // THE RECALL ERRAND — errands/recallCheck.js.
  //
  // ⛔ EVERY 「blocked」 REASON EXISTS TO PREVENT ONE SENTENCE: 「沒有回收」. The whole file is
  // built so that a failure to search never renders as a clean result, and the English must
  // carry that distinction as sharply.
  // ══════════════════════════════════════════════════════════════════════════
  'recall.narrowingPhrase': { zh: '詞組搜尋', en: 'phrase search' },
  'recall.budgetBeforeStart': { zh: '還沒開始就已經超出動作上限（budget）。', en: 'The action budget was spent before it even started.' },
  'recall.cannotNavigate': { zh: '去不到回收登記處：{reason}', en: 'Could not reach the recall register: {reason}' },
  'recall.budgetBeforeRead': { zh: '讀這一頁之前就超出動作上限（budget）。', en: 'The action budget ran out before the page could be read.' },
  'recall.loginWall': {
    zh: '這一頁出了登入牆（讀到 password 欄位）。什麼都沒有打過就收手了。',
    en: 'The page showed a login wall (a password field was present). Nothing was typed and it stopped there.'
  },
  /** ⛔ 「這不等於「沒有回收」」 — the sentence this whole errand exists to avoid. */
  'recall.noSearchBox': {
    zh: '這個網站沒有浮出搜尋框，所以根本沒有查成。這不等於「沒有回收」。',
    en: 'The site never surfaced a search box, so no search happened at all. That is NOT the same as "no recalls".'
  },
  'recall.budgetBeforeType': { zh: '打字之前超出動作上限（budget）。', en: 'The action budget ran out before anything could be typed.' },
  'recall.cannotType': { zh: '打不到字進去：{reason} — {detail}', en: 'Could not type into it: {reason} — {detail}' },
  'recall.budgetAfterType': { zh: '打完字之後超出動作上限（budget）。', en: 'The action budget ran out after typing.' },
  'recall.noSearchButton': {
    zh: '找不到一顆按得到的搜尋掣（type 從來不會自己按 Enter），所以查不成。',
    en: 'No clickable search button was found (typing never presses Enter by itself), so the search did not happen.'
  },
  'recall.budgetBeforeClick': { zh: '按掣之前超出動作上限（budget）。', en: 'The action budget ran out before the button could be pressed.' },
  'recall.cannotClick': { zh: '按不到搜尋掣：{reason} — {detail}', en: 'Could not press the search button: {reason} — {detail}' },
  'recall.budgetBeforeResults': { zh: '讀結果之前超出動作上限（budget）。', en: 'The action budget ran out before the results could be read.' },
  /** ⛔ THE STRUCTURE-CHANGED CASE. It must never read as zero. */
  'recall.countButNoRows': {
    zh: '這個網站說有 {total} 條結果，但我一條都認不出來 —— 即是頁面結構改了，我讀漏了東西。⛔ 不要當它是「沒有回收」。',
    en: 'The site says there are {total} results but I could not recognise a single one — the page structure has changed and I am missing rows. ⛔ Do NOT read this as "no recalls".'
  },
  'recall.none': { zh: '「{query}」{narrowing}：沒有找到相關回收。', en: '"{query}" {narrowing}: no matching recalls.' },
  'recall.siteSaysZero': { zh: '這個網站自己說明零條。', en: 'The site itself states zero.' },
  'recall.siteSaysNoResults': { zh: '這個網站顯示「no results」。', en: 'The site displays "no results".' },
  'recall.cannotTellZero': {
    zh: '我讀不到結果數目，又認不出任何一條回收紀錄，所以我不敢講「沒有回收」。（讀了 {nodes} 個節點。）',
    en: 'I could not read a result count and could not recognise a single recall row, so I will not say "no recalls". ({nodes} nodes read.)'
  },
  'recall.foundTotal': { zh: '這個網站找到 {total} 條', en: 'the site returned {total}' },
  'recall.foundFirstPage': { zh: '我在第一頁讀到 {n} 條（這個網站沒有給總數）', en: 'I read {n} on the first page (the site gave no total)' },
  'recall.shownLabel': { zh: '，顯示前 {n} 條', en: ', showing the first {n}' },
  'recall.answer': { zh: '「{query}」{narrowing}：{found}{shown}：{items}', en: '"{query}" {narrowing}: {found}{shown}: {items}' },
  'recall.detailNodes': { zh: '讀了 {nodes} 個節點。', en: '{nodes} nodes read.' },
  'recall.detailNoTotal': {
    zh: ' ⚠ 這個網站沒有給總數，可能還有下一頁。',
    en: ' ⚠ The site gave no total, so there may be another page.'
  },

  // ⛔ Interface punctuation — see punct.listSep above for why these are keys.
  'punct.colon': { zh: '：', en: ': ' }
})

module.exports = { CATALOGUE }
