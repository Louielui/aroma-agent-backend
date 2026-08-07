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
  // ── the plainest case: no data at all ──
  'briefing.nothingWaiting': {
    zh: '沒有需要你決定的事。',
    en: 'Nothing waiting on you.'
  },
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

  // ⛔ Interface punctuation — see punct.listSep above for why these are keys.
  'punct.colon': { zh: '：', en: ': ' }
})

module.exports = { CATALOGUE }
