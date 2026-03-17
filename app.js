(() => {
  "use strict";

  const STORAGE_KEY = "chillsplit:v1";

  const elMain = document.getElementById("main");
  const elQuickAddBtn = document.getElementById("quickAddBtn");
  const elThemeBtn = document.getElementById("themeBtn");
  const elTabs = Array.from(document.querySelectorAll(".tabbar .tab"));
  const elModalHost = document.getElementById("modalHost");
  const elToastHost = document.getElementById("toastHost");

  const now = new Date();
  const isoMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  function uid(prefix = "id") {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function formatMoney(cents) {
    const sign = cents < 0 ? "-" : "";
    const abs = Math.abs(cents);
    return `${sign}$${(abs / 100).toFixed(2)}`;
  }

  function parseMoneyToCents(str) {
    const clean = String(str || "").replace(/[^\d.]/g, "");
    if (!clean) return null;
    const num = Number(clean);
    if (!Number.isFinite(num)) return null;
    return Math.round(num * 100);
  }

  function friendlyBadge(netCents, isMe) {
    // Positive net means this person fronted more than their share.
    if (netCents === 0) return { label: "All even", kind: "good" };
    if (netCents > 0) return { label: isMe ? `You're covered ${formatMoney(netCents)}` : `Covered ${formatMoney(netCents)}`, kind: "good" };
    return { label: isMe ? `You're up ${formatMoney(-netCents)}` : `Up ${formatMoney(-netCents)}`, kind: "warn" };
  }

  function monthLabel(ym) {
    const [y, m] = ym.split("-").map((x) => Number(x));
    const dt = new Date(y, (m || 1) - 1, 1);
    return dt.toLocaleString(undefined, { month: "long", year: "numeric" });
  }

  function monthKeyFromTs(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function defaultState() {
    const members = [
      { id: "m_ava", name: "Ava", emoji: "🫶" },
      { id: "m_jules", name: "Jules", emoji: "🧃" },
      { id: "m_sam", name: "Sam", emoji: "🪩" },
    ];

    const contexts = [
      { id: "c_home", type: "home", name: "Our Place", emoji: "🏠", closed: false },
      { id: "c_trip1", type: "trip", name: "Catskills Weekend", emoji: "🌲", closed: false },
      { id: "c_trip2", type: "trip", name: "Concert Night", emoji: "🎟️", closed: true },
    ];

    const expenses = [
      {
        id: "e_1",
        contextId: "c_trip1",
        title: "Groceries + snacks",
        amountCents: 7825,
        paidBy: "m_ava",
        split: { type: "equal", participants: ["m_ava", "m_jules", "m_sam"] },
        createdAt: Date.now() - 1000 * 60 * 60 * 27,
        roundUpCents: 0,
      },
      {
        id: "e_2",
        contextId: "c_trip1",
        title: "Gas",
        amountCents: 4630,
        paidBy: "m_jules",
        split: { type: "equal", participants: ["m_ava", "m_jules", "m_sam"] },
        createdAt: Date.now() - 1000 * 60 * 60 * 18,
        roundUpCents: 0,
      },
      {
        id: "e_3",
        contextId: "c_home",
        title: "Paper towels run",
        amountCents: 1699,
        paidBy: "m_sam",
        split: { type: "equal", participants: ["m_ava", "m_jules", "m_sam"] },
        createdAt: Date.now() - 1000 * 60 * 60 * 9,
        roundUpCents: 1,
      },
    ];

    const comments = {
      e_1: [
        { id: uid("cmt"), by: "m_sam", text: "Those chips did not survive the ride 😅", at: Date.now() - 1000 * 60 * 60 * 26 },
      ],
    };

    const poolKey = `c_home:${isoMonth}`;
    const pools = {
      [poolKey]: {
        month: isoMonth,
        perPersonCents: 4500,
        contributions: { m_ava: 4500, m_jules: 4500, m_sam: 4500 },
        deductions: [
          { id: uid("d"), title: "Netflix", emoji: "📺", amountCents: 1599, at: Date.now() - 1000 * 60 * 60 * 24 * 2 },
          { id: uid("d"), title: "Spotify", emoji: "🎧", amountCents: 1199, at: Date.now() - 1000 * 60 * 60 * 24 * 1 },
        ],
      },
    };

    return {
      theme: "system", // system | light | dark
      tab: "trips",
      view: { kind: "tab" }, // tab | context
      members,
      contexts,
      expenses,
      comments,
      pools,
      sync: {
        mode: "local", // local | supabase
        supabaseUrl: "",
        supabaseAnonKey: "",
        groupId: null,
        groupName: null,
        joinCode: null,
        memberId: null,
        lastPullAt: 0,
        autoSync: true,
      },
      prefs: {
        meMemberId: members[0]?.id || null,
        roundUpToDollars: true,
        quietMode: true,
      },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      // Lightweight forward-compat merge.
      const base = defaultState();
      return {
        ...base,
        ...parsed,
        prefs: { ...base.prefs, ...(parsed.prefs || {}) },
        sync: { ...base.sync, ...(parsed.sync || {}) },
        view: parsed.view || { kind: "tab" },
      };
    } catch {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  let state = loadState();
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Cloud Sync (Supabase) -------------------------------------------------
  let supabaseClient = null;
  let supabaseClientCacheKey = null;
  let cloudPullInFlight = false;

  function hasSupabaseConfig() {
    return Boolean(state.sync.supabaseUrl && state.sync.supabaseAnonKey);
  }

  function isCloudEnabled() {
    return state.sync.mode === "supabase" && hasSupabaseConfig() && Boolean(state.sync.groupId);
  }

  function isCloudReady() {
    return isCloudEnabled() && Boolean(state.sync.memberId);
  }

  async function getSupabaseClient() {
    const url = String(state.sync.supabaseUrl || "").trim();
    const key = String(state.sync.supabaseAnonKey || "").trim();
    if (!url || !key) throw new Error("Missing Supabase URL / anon key");
    const cacheKey = `${url}::${key}`;
    if (supabaseClient && supabaseClientCacheKey === cacheKey) return supabaseClient;
    const mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    supabaseClient = mod.createClient(url, key, { auth: { persistSession: false } });
    supabaseClientCacheKey = cacheKey;
    return supabaseClient;
  }

  function randomJoinCode(len = 8) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // avoids confusing chars
    let out = "";
    for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }

  async function cloudCreateGroup(groupName, myName, myEmoji) {
    const sb = await getSupabaseClient();
    const joinCode = randomJoinCode(8);
    const groupRes = await sb
      .from("cs_groups")
      .insert({ name: groupName, join_code: joinCode })
      .select("id,name,join_code")
      .single();
    if (groupRes.error) throw groupRes.error;

    const groupId = groupRes.data.id;
    const memberRes = await sb
      .from("cs_members")
      .insert({ group_id: groupId, name: myName, emoji: myEmoji })
      .select("id")
      .single();
    if (memberRes.error) throw memberRes.error;

    const contextsRes = await sb
      .from("cs_contexts")
      .insert({ group_id: groupId, type: "home", name: "Our Place", emoji: "🏠", closed: false })
      .select("id");
    if (contextsRes.error) throw contextsRes.error;

    state.sync.mode = "supabase";
    state.sync.groupId = groupId;
    state.sync.groupName = groupRes.data.name;
    state.sync.joinCode = groupRes.data.join_code;
    state.sync.memberId = memberRes.data.id;
    state.prefs.meMemberId = memberRes.data.id;
    saveState();
    await cloudPullNow({ toastOnSuccess: true });
  }

  async function cloudJoinGroup(joinCode, myName, myEmoji) {
    const sb = await getSupabaseClient();
    const groupRes = await sb
      .from("cs_groups")
      .select("id,name,join_code")
      .eq("join_code", joinCode)
      .maybeSingle();
    if (groupRes.error) throw groupRes.error;
    if (!groupRes.data) throw new Error("No group found for that code");

    const groupId = groupRes.data.id;
    const memberRes = await sb
      .from("cs_members")
      .insert({ group_id: groupId, name: myName, emoji: myEmoji })
      .select("id")
      .single();
    if (memberRes.error) throw memberRes.error;

    // Ensure there's at least a home context.
    const ctxRes = await sb.from("cs_contexts").select("id").eq("group_id", groupId).eq("type", "home").limit(1);
    if (ctxRes.error) throw ctxRes.error;
    if (!ctxRes.data || ctxRes.data.length === 0) {
      const ins = await sb.from("cs_contexts").insert({ group_id: groupId, type: "home", name: "Our Place", emoji: "🏠", closed: false });
      if (ins.error) throw ins.error;
    }

    state.sync.mode = "supabase";
    state.sync.groupId = groupId;
    state.sync.groupName = groupRes.data.name;
    state.sync.joinCode = groupRes.data.join_code;
    state.sync.memberId = memberRes.data.id;
    state.prefs.meMemberId = memberRes.data.id;
    saveState();
    await cloudPullNow({ toastOnSuccess: true });
  }

  async function cloudPullNow(opts) {
    if (!isCloudEnabled()) return;
    if (cloudPullInFlight) return;
    cloudPullInFlight = true;
    const toastOnSuccess = opts && opts.toastOnSuccess;
    try {
      const sb = await getSupabaseClient();
      const groupId = state.sync.groupId;

      const groupRes = await sb.from("cs_groups").select("id,name,join_code").eq("id", groupId).single();
      if (groupRes.error) throw groupRes.error;

      const membersRes = await sb.from("cs_members").select("id,name,emoji,created_at").eq("group_id", groupId).order("created_at", { ascending: true });
      if (membersRes.error) throw membersRes.error;

      const contextsRes = await sb.from("cs_contexts").select("id,type,name,emoji,closed,created_at").eq("group_id", groupId).order("created_at", { ascending: true });
      if (contextsRes.error) throw contextsRes.error;

      const expensesRes = await sb
        .from("cs_expenses")
        .select("id,context_id,title,amount_cents,paid_by,split_type,participants,shares,round_up_cents,created_at")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false });
      if (expensesRes.error) throw expensesRes.error;

      const commentsRes = await sb
        .from("cs_comments")
        .select("id,expense_id,by_member_id,text,created_at")
        .eq("group_id", groupId)
        .order("created_at", { ascending: true });
      if (commentsRes.error) throw commentsRes.error;

      const poolsRes = await sb
        .from("cs_pools")
        .select("id,month,per_person_cents,created_at")
        .eq("group_id", groupId)
        .order("created_at", { ascending: true });
      if (poolsRes.error) throw poolsRes.error;

      const poolIds = (poolsRes.data || []).map((p) => p.id);
      const contribRes = poolIds.length
        ? await sb.from("cs_pool_contributions").select("pool_id,member_id,amount_cents").in("pool_id", poolIds)
        : { data: [], error: null };
      if (contribRes.error) throw contribRes.error;

      const dedRes = poolIds.length
        ? await sb.from("cs_pool_deductions").select("id,pool_id,title,emoji,amount_cents,at").in("pool_id", poolIds)
        : { data: [], error: null };
      if (dedRes.error) throw dedRes.error;

      // Apply to local state (keep local prefs/theme).
      state.sync.groupName = groupRes.data.name;
      state.sync.joinCode = groupRes.data.join_code;

      state.members = (membersRes.data || []).map((m) => ({ id: m.id, name: m.name, emoji: m.emoji || "🙂" }));
      state.contexts = (contextsRes.data || []).map((c) => ({ id: c.id, type: c.type, name: c.name, emoji: c.emoji || "🧾", closed: Boolean(c.closed) }));

      state.expenses = (expensesRes.data || []).map((e) => ({
        id: e.id,
        contextId: e.context_id,
        title: e.title,
        amountCents: Number(e.amount_cents || 0),
        paidBy: e.paid_by,
        split: {
          type: e.split_type || "equal",
          participants: Array.isArray(e.participants) ? e.participants : [],
          shares: e.shares || undefined,
        },
        createdAt: e.created_at ? Date.parse(e.created_at) : Date.now(),
        roundUpCents: Number(e.round_up_cents || 0),
        receipt: null, // receipts stay local in this test build
      }));

      const commentsMap = {};
      for (const c of (commentsRes.data || [])) {
        const expId = c.expense_id;
        if (!commentsMap[expId]) commentsMap[expId] = [];
        commentsMap[expId].push({
          id: c.id,
          by: c.by_member_id,
          text: c.text,
          at: c.created_at ? Date.parse(c.created_at) : Date.now(),
        });
      }
      state.comments = commentsMap;

      const home = state.contexts.find((c) => c.type === "home");
      const pools = {};
      if (home) {
        const byPoolIdContrib = {};
        for (const r of (contribRes.data || [])) {
          if (!byPoolIdContrib[r.pool_id]) byPoolIdContrib[r.pool_id] = {};
          byPoolIdContrib[r.pool_id][r.member_id] = Number(r.amount_cents || 0);
        }
        const byPoolIdDed = {};
        for (const r of (dedRes.data || [])) {
          if (!byPoolIdDed[r.pool_id]) byPoolIdDed[r.pool_id] = [];
          byPoolIdDed[r.pool_id].push({ id: r.id, title: r.title, emoji: r.emoji, amountCents: Number(r.amount_cents || 0), at: r.at ? Date.parse(r.at) : Date.now() });
        }
        for (const p of (poolsRes.data || [])) {
          const key = `${home.id}:${p.month}`;
          pools[key] = {
            month: p.month,
            perPersonCents: Number(p.per_person_cents || 0),
            contributions: byPoolIdContrib[p.id] || {},
            deductions: (byPoolIdDed[p.id] || []).sort((a, b) => (b.at || 0) - (a.at || 0)),
          };
        }
      }
      state.pools = pools;

      state.sync.lastPullAt = Date.now();
      saveState();
      render();
      if (toastOnSuccess) toast("Synced", "You're connected to the group.");
    } catch (e) {
      toast("Sync failed", String(e && e.message ? e.message : e));
    } finally {
      cloudPullInFlight = false;
    }
  }


  function getThemeResolved() {
    if (state.theme === "light" || state.theme === "dark") return state.theme;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme() {
    document.documentElement.dataset.theme = getThemeResolved();
  }

  function setTheme(next) {
    state.theme = next;
    saveState();
    applyTheme();
    toast(`Theme: ${next === "system" ? "auto" : next}`);
  }

  function toast(msg, small) {
    const el = document.createElement("div");
    el.className = "toast";
    const left = document.createElement("div");
    left.innerHTML = `<div class="toastMsg">${escapeHtml(msg)}</div>${small ? `<div class="toastSmall">${escapeHtml(small)}</div>` : ""}`;
    const btn = document.createElement("button");
    btn.className = "btn ghost";
    btn.type = "button";
    btn.textContent = "Ok";
    btn.addEventListener("click", () => el.remove(), { once: true });
    el.append(left, btn);
    elToastHost.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function memberById(id) {
    return state.members.find((m) => m.id === id) || null;
  }

  function contextById(id) {
    return state.contexts.find((c) => c.id === id) || null;
  }

  function contextExpenses(contextId) {
    return state.expenses
      .filter((e) => e.contextId === contextId)
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  function computeShares(expense) {
    const participants = expense.split.participants.slice();
    if (participants.length === 0) return {};

    if (expense.split.type === "custom" || expense.split.type === "balanced") {
      const shares = expense.split.shares || {};
      const out = {};
      for (const id of participants) out[id] = Math.max(0, Number(shares[id] || 0));
      return out;
    }

    // Equal split (optionally with a "round up to dollars" vibe).
    const baseTotal = expense.amountCents;
    const total = expense.roundUpCents ? baseTotal + expense.roundUpCents : baseTotal;

    const per = Math.floor(total / participants.length);
    let remainder = total - per * participants.length;
    const shares = {};
    for (const id of participants) {
      shares[id] = per + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
    }
    return shares;
  }

  function computeBalances(contextId) {
    const balances = Object.fromEntries(state.members.map((m) => [m.id, 0]));
    for (const e of state.expenses) {
      if (e.contextId !== contextId) continue;
      const shares = computeShares(e);
      balances[e.paidBy] = (balances[e.paidBy] || 0) + (e.amountCents + (e.roundUpCents || 0));
      for (const [mid, cents] of Object.entries(shares)) {
        balances[mid] = (balances[mid] || 0) - cents;
      }
    }
    return balances;
  }

  function projectToSimplexCents(vCents, sumCents) {
    // Euclidean projection onto {s >= 0, sum(s) = sumCents}. Returns integer cents.
    const n = vCents.length;
    if (n === 0) return [];
    if (sumCents <= 0) return vCents.map(() => 0);

    const u = vCents.slice().sort((a, b) => b - a);
    let cssv = 0;
    let rho = -1;
    for (let i = 0; i < n; i++) {
      cssv += u[i];
      const t = (cssv - sumCents) / (i + 1);
      if (u[i] - t > 0) rho = i;
    }
    if (rho === -1) {
      // Fallback: equal split
      const per = Math.floor(sumCents / n);
      let rem = sumCents - per * n;
      return vCents.map(() => per + (rem-- > 0 ? 1 : 0));
    }

    let cssvRho = 0;
    for (let i = 0; i <= rho; i++) cssvRho += u[i];
    const theta = (cssvRho - sumCents) / (rho + 1);

    const raw = vCents.map((x) => Math.max(0, x - theta));
    const base = raw.map((x) => Math.floor(x));
    let drift = sumCents - base.reduce((a, b) => a + b, 0);

    const order = raw
      .map((x, i) => ({ i, frac: x - Math.floor(x) }))
      .sort((a, b) => b.frac - a.frac);

    let k = 0;
    while (drift > 0 && k < order.length) {
      base[order[k].i] += 1;
      drift -= 1;
      k += 1;
      if (k >= order.length && drift > 0) k = 0;
    }

    // Defensive clamp if any negative due to numeric weirdness.
    for (let i = 0; i < base.length; i++) base[i] = Math.max(0, base[i]);

    // Fix any remaining drift (rare, but keeps sums exact).
    let sumNow = base.reduce((a, b) => a + b, 0);
    if (sumNow !== sumCents) {
      let adjust = sumCents - sumNow;
      const idxs = base.map((_, i) => i).sort((a, b) => vCents[b] - vCents[a]);
      let j = 0;
      while (adjust !== 0 && j < idxs.length * 4) {
        const idx = idxs[j % idxs.length];
        if (adjust > 0) {
          base[idx] += 1;
          adjust -= 1;
        } else if (base[idx] > 0) {
          base[idx] -= 1;
          adjust += 1;
        }
        j++;
      }
    }

    return base;
  }

  function suggestBalancedShares(contextId, totalCents, paidBy, participantIds) {
    const balances = computeBalances(contextId);
    const v = participantIds.map((mid) => (balances[mid] || 0) + (mid === paidBy ? totalCents : 0));
    const projected = projectToSimplexCents(v, totalCents);
    return Object.fromEntries(participantIds.map((mid, i) => [mid, projected[i]]));
  }

  function computeSettleTransfers(balancesById) {
    const creditors = [];
    const debtors = [];
    for (const [id, cents] of Object.entries(balancesById)) {
      const v = Number(cents || 0);
      if (v > 0) creditors.push({ id, cents: v });
      else if (v < 0) debtors.push({ id, cents: -v });
    }
    creditors.sort((a, b) => b.cents - a.cents);
    debtors.sort((a, b) => b.cents - a.cents);

    const transfers = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const d = debtors[i];
      const c = creditors[j];
      const pay = Math.min(d.cents, c.cents);
      if (pay > 0) transfers.push({ from: d.id, to: c.id, amountCents: pay });
      d.cents -= pay;
      c.cents -= pay;
      if (d.cents <= 0) i++;
      if (c.cents <= 0) j++;
    }
    return transfers;
  }

  function computeMonthlyContributedTotals(monthKey) {
    const totals = Object.fromEntries(state.members.map((m) => [m.id, 0]));

    for (const e of state.expenses) {
      if (monthKeyFromTs(e.createdAt) !== monthKey) continue;
      totals[e.paidBy] = (totals[e.paidBy] || 0) + (e.amountCents + (e.roundUpCents || 0));
    }

    // Include home pool contributions (if any) for the month.
    for (const [key, pool] of Object.entries(state.pools || {})) {
      if (!pool || pool.month !== monthKey) continue;
      const contrib = pool.contributions || {};
      for (const [mid, cents] of Object.entries(contrib)) {
        totals[mid] = (totals[mid] || 0) + Number(cents || 0);
      }
    }

    return totals;
  }

  function trophyWinnerForMonth(monthKey) {
    const totals = computeMonthlyContributedTotals(monthKey);
    const ranked = state.members
      .map((m) => ({ id: m.id, cents: totals[m.id] || 0 }))
      .sort((a, b) => (b.cents - a.cents) || String(a.id).localeCompare(String(b.id)));
    const top = ranked[0];
    if (!top || top.cents <= 0) return null;
    return top.id;
  }

  function turnSuggestion(contextId) {
    const exps = contextExpenses(contextId);
    const lastPaidAt = Object.fromEntries(state.members.map((m) => [m.id, 0]));
    for (const e of exps) {
      if (!lastPaidAt[e.paidBy]) lastPaidAt[e.paidBy] = e.createdAt;
    }
    // Pick the member with the oldest (or missing) payment as "next up".
    const ranked = state.members
      .map((m) => ({ id: m.id, at: lastPaidAt[m.id] || 0 }))
      .sort((a, b) => a.at - b.at);
    const pick = ranked[0];
    const m = pick ? memberById(pick.id) : null;
    if (!m) return null;
    const vibe = exps.length < 2 ? "Someone should get the first one." : `${m.name} might be up next.`;
    return { memberId: m.id, text: vibe };
  }

  function setTab(tab) {
    state.tab = tab;
    state.view = { kind: "tab" };
    saveState();
    render();
  }

  function openContext(contextId) {
    state.view = { kind: "context", contextId };
    saveState();
    render();
  }

  function closeContext() {
    state.view = { kind: "tab" };
    saveState();
    render();
  }

  function render() {
    applyTheme();

    for (const el of elTabs) {
      const tab = el.getAttribute("data-tab");
      if (tab === state.tab) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    }

    if (state.view.kind === "context") {
      elMain.replaceChildren(renderContextScreen(state.view.contextId));
      animateIn(elMain.firstElementChild);
      return;
    }

    if (state.tab === "trips") {
      elMain.replaceChildren(renderTripsTab());
      animateIn(elMain.firstElementChild);
      return;
    }
    if (state.tab === "roomies") {
      elMain.replaceChildren(renderRoomiesTab());
      animateIn(elMain.firstElementChild);
      return;
    }
    if (state.tab === "inbox") {
      elMain.replaceChildren(renderInboxTab());
      animateIn(elMain.firstElementChild);
      return;
    }
    elMain.replaceChildren(renderMeTab());
    animateIn(elMain.firstElementChild);
  }

  function animateIn(el) {
    if (!el || reduceMotion || !el.animate) return;
    el.animate(
      [
        { opacity: 0, transform: "translateY(8px) scale(0.995)" },
        { opacity: 1, transform: "translateY(0px) scale(1)" },
      ],
      { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  }

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "html") el.innerHTML = v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) el.setAttribute(k, "");
        else if (v === false || v == null) {
          // skip
        } else el.setAttribute(k, String(v));
      }
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      if (typeof c === "string") el.appendChild(document.createTextNode(c));
      else el.appendChild(c);
    }
    return el;
  }

  function panel(title, subtitle, actions, bodyChildren) {
    return h(
      "section",
      { class: "panel" },
      h(
        "div",
        { class: "panelHeader" },
        h(
          "div",
          null,
          h("div", { class: "panelTitle", text: title }),
          subtitle ? h("div", { class: "panelSub", text: subtitle }) : null,
        ),
        actions ? h("div", { class: "row" }, actions) : null,
      ),
      h("div", { class: "panelBody" }, bodyChildren),
    );
  }

  function renderTripsTab() {
    const trips = state.contexts.filter((c) => c.type === "trip");
    const openTrips = trips.filter((t) => !t.closed);
    const closedTrips = trips.filter((t) => t.closed);

    const gridEl = h("div", { class: "grid" }, [
      ...openTrips.map((t) => tripCard(t, false)),
      ...closedTrips.map((t) => tripCard(t, true)),
    ]);

    const addBtn = h(
      "button",
      {
        class: "btn primary",
        type: "button",
        onClick: () => openTripModal(),
      },
      "New trip",
    );

    const info = h(
      "div",
      { class: "muted", style: "font-size:12.5px; line-height:1.4;" },
      "Trips keep expenses tidy. Close one when it's settled so it stops nudging you.",
    );

    return h(
      "div",
      { class: "list" },
      panel("Trips", "Weekend away, concert night, vacation vibes.", addBtn, [
        info,
        h("div", { class: "hr" }),
        gridEl,
      ]),
    );
  }

  function tripCard(ctx, closed) {
    const exps = contextExpenses(ctx.id);
    const total = exps.reduce((sum, e) => sum + e.amountCents + (e.roundUpCents || 0), 0);
    const suggestion = turnSuggestion(ctx.id);

    const pillLeft = h("span", { class: "pill" }, `${ctx.emoji} `, h("span", { class: "mono" }, `${exps.length} items`));
    const pillRight = h("span", { class: "pill mono" }, formatMoney(total));
    const top = h("div", { class: "cardTop" }, pillLeft, pillRight);

    const status = closed ? "Closed and cozy." : suggestion ? suggestion.text : "No drama, just vibes.";

    return h(
      "div",
      {
        class: "card",
        style: "grid-column: span 6;",
        role: "button",
        tabindex: "0",
        onClick: () => openContext(ctx.id),
        onKeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") openContext(ctx.id);
        },
      },
      top,
      h("div", { class: "cardTitle", text: ctx.name }),
      h("div", { class: "cardSub", text: status }),
      closed ? h("div", { style: "margin-top:10px;" }, h("span", { class: "badge" }, "✅ settled")) : null,
    );
  }

	  function renderRoomiesTab() {
	    const home = state.contexts.find((c) => c.type === "home");
	    if (!home) return h("div", null, "Missing home context.");

    const poolKey = `${home.id}:${isoMonth}`;
    const pool = state.pools[poolKey] || {
      month: isoMonth,
      perPersonCents: 0,
      contributions: {},
      deductions: [],
    };

    // Ensure all members exist in contributions (non-destructive).
    for (const m of state.members) {
      if (pool.contributions[m.id] == null && pool.perPersonCents) pool.contributions[m.id] = pool.perPersonCents;
    }

    const contributed = Object.values(pool.contributions || {}).reduce((s, v) => s + Number(v || 0), 0);
    const spent = (pool.deductions || []).reduce((s, d) => s + Number(d.amountCents || 0), 0);
    const remaining = contributed - spent;
    const ratio = contributed > 0 ? clamp(remaining / contributed, 0, 1) : 0;

    const badge =
      contributed === 0
        ? h("span", { class: "badge warn" }, "Set a pool")
        : remaining <= Math.round(contributed * 0.15)
          ? h("span", { class: "badge warn" }, "Pool running low")
          : h("span", { class: "badge good" }, "Pool looks chill");

    const actions = h(
      "div",
      { class: "row" },
      h(
        "button",
        { class: "btn primary", type: "button", onClick: () => openPoolModal(home.id, isoMonth) },
        "Adjust pool",
      ),
      h("button", { class: "btn", type: "button", onClick: () => openContext(home.id) }, "See expenses"),
    );

    const progress = h("div", { class: "progress", "aria-label": "Pool remaining" }, h("div", { class: "progressBar" }));
    requestAnimationFrame(() => {
      const bar = progress.querySelector(".progressBar");
      if (bar) bar.style.width = `${Math.round(ratio * 100)}%`;
    });

	    const quick = h(
      "div",
      { class: "list" },
      h(
        "div",
        { class: "item" },
        h("div", { class: "itemTop" }, h("div", { class: "itemTitle" }, `${monthLabel(isoMonth)} pool`), badge),
        h("div", { class: "row" }, h("div", { class: "itemMeta mono" }, `Left: ${formatMoney(Math.max(0, remaining))}`), h("div", { class: "itemMeta mono" }, `Spent: ${formatMoney(spent)}`)),
        progress,
      ),
      h(
        "div",
        { class: "item" },
        h("div", { class: "itemTop" }, h("div", { class: "itemTitle" }, "Auto-deductions"), h("div", { class: "itemMeta" }, "Subscriptions + utilities")),
        h(
          "div",
          { class: "list" },
          ...(pool.deductions || [])
            .slice()
            .sort((a, b) => (b.at || 0) - (a.at || 0))
            .slice(0, 6)
            .map((d) =>
              h(
                "div",
                { class: "row" },
                h("div", null, h("span", { class: "kbd" }, d.emoji || "🧾"), " ", h("span", { class: "itemTitle" }, d.title)),
                h("div", { class: "itemMeta mono" }, `-${formatMoney(d.amountCents)}`),
              ),
            ),
        ),
        h("div", { class: "row" }, h("div", { class: "itemMeta" }, "Add a deduction whenever something hits."), h("button", { class: "btn", type: "button", onClick: () => openAddDeductionModal(home.id, isoMonth) }, "Add")),
      ),
	    );

	    const totals = computeMonthlyContributedTotals(isoMonth);
	    const winnerId = trophyWinnerForMonth(isoMonth);
	    const ranked = state.members
	      .map((m) => ({ m, cents: totals[m.id] || 0 }))
	      .sort((a, b) => (b.cents - a.cents) || a.m.name.localeCompare(b.m.name));

	    const leaderboard = h(
	      "div",
	      { class: "item" },
	      h(
	        "div",
	        { class: "itemTop" },
	        h("div", { class: "itemTitle" }, "Leaderboard"),
	        h("div", { class: "itemMeta" }, monthLabel(isoMonth)),
	      ),
	      h(
	        "div",
	        { class: "list" },
	        ...ranked.slice(0, 3).map((row, idx) => {
	          const crown = row.m.id === winnerId ? "🏆" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "";
	          return h(
	            "div",
	            { class: "row" },
	            h("div", null, h("span", { class: "kbd" }, `${crown || "•"}`), " ", h("span", { class: "itemTitle" }, `${row.m.emoji} ${row.m.name}`)),
	            h("div", { class: "itemMeta mono" }, formatMoney(row.cents)),
	          );
	        }),
	      ),
	      h("div", { class: "itemMeta" }, winnerId ? "Trophy passes automatically each month to whoever covered the most." : "Add some expenses and the trophy will find a home."),
	    );

	    return h(
	      "div",
	      { class: "list" },
	      panel("Roomies", "A monthly pool for the boring stuff (but make it gentle).", actions, [
	        h("div", { class: "muted", style: "font-size:12.5px; line-height:1.4;" }, "Everyone tosses in a set amount at the start of the month. Netflix, Hulu, utilities chip away automatically."),
	        h("div", { class: "hr" }),
	        leaderboard,
	        quick,
	      ]),
	    );
	  }

  function renderInboxTab() {
    const nudges = [];
    for (const c of state.contexts) {
      if (c.closed) continue;
      const suggestion = turnSuggestion(c.id);
      if (!suggestion) continue;
      const m = memberById(suggestion.memberId);
      nudges.push({
        id: `${c.id}:${suggestion.memberId}`,
        text: `${c.emoji} ${c.name}: ${m ? `${m.emoji} ${m.name}` : "Someone"} might be up next.`,
        kind: "soft",
      });
    }

    const items = nudges.length
      ? nudges.map((n) => h("div", { class: "item" }, h("div", { class: "itemTitle" }, "A tiny nudge"), h("div", { class: "itemMeta" }, n.text)))
      : [h("div", { class: "item" }, h("div", { class: "itemTitle" }, "Quiet mode"), h("div", { class: "itemMeta" }, "No spam. If you're settled, you're settled."))];

    return h("div", { class: "list" }, panel("Notes", "Playful nudges, never demands.", null, items));
  }

  function renderMeTab() {
    const resolved = getThemeResolved();
    const themeLabel = state.theme === "system" ? `Auto (${resolved})` : state.theme;

    const mePick = h(
      "div",
      { class: "item" },
      h("div", { class: "itemTop" }, h("div", { class: "itemTitle" }, "Me"), h("div", { class: "itemMeta" }, "For friendlier copy")),
      h(
        "div",
        { class: "field" },
        h("div", { class: "label" }, "I am"),
        h(
          "select",
          {
            id: "meSelect",
            onChange: (e) => {
              state.prefs.meMemberId = e.target.value;
              saveState();
              toast("Updated", "Now the app knows which line is 'you'.");
              render();
            },
          },
          ...state.members.map((m) => h("option", { value: m.id, selected: m.id === state.prefs.meMemberId }, `${m.emoji} ${m.name}`)),
        ),
      ),
    );

    const groupCard = (() => {
      const urlVal = String(state.sync.supabaseUrl || "");
      const keyVal = String(state.sync.supabaseAnonKey || "");

      const urlInput = h("input", { id: "sbUrl", placeholder: "Supabase Project URL", value: urlVal });
      const keyInput = h("input", { id: "sbKey", placeholder: "Supabase anon public key", value: keyVal });

      const yourName = h("input", { id: "grpName", placeholder: "Your name (Ava)", value: "" });
      const yourEmoji = h("input", { id: "grpEmoji", placeholder: "Emoji", value: "🙂" });
      const groupName = h("input", { id: "newGroupName", placeholder: "Group name (Roommates, Trip Crew...)", value: "" });
      const joinCode = h("input", { id: "joinCode", placeholder: "Join code", value: "" });

      const connected = hasSupabaseConfig();
      const inGroup = Boolean(state.sync.groupId);

      const body = [];
      body.push(h("div", { class: "itemMeta" }, "Multi-person groups need a backend. For this test build, we use Supabase (free tier) and a join code."));

      body.push(
        h("div", { class: "field" }, h("div", { class: "label" }, "Supabase URL"), urlInput),
        h("div", { class: "field" }, h("div", { class: "label" }, "Supabase anon key"), keyInput),
        h(
          "div",
          { class: "row" },
          h(
            "button",
            {
              class: "btn",
              type: "button",
              onClick: () => {
                state.sync.mode = "supabase";
                state.sync.supabaseUrl = urlInput.value.trim();
                state.sync.supabaseAnonKey = keyInput.value.trim();
                saveState();
                toast("Saved", "Supabase config stored on this device.");
                render();
              },
            },
            "Save config",
          ),
          inGroup
            ? h(
                "button",
                {
                  class: "btn",
                  type: "button",
                  onClick: async () => {
                    await cloudPullNow({ toastOnSuccess: true });
                  },
                },
                "Sync now",
              )
            : null,
        ),
      );

      if (!connected) {
        body.push(h("div", { class: "itemMeta" }, "Add your Supabase URL + anon key above, then create or join a group."));
        return h("div", { class: "item" }, h("div", { class: "itemTop" }, h("div", { class: "itemTitle" }, "Group sync (beta)"), h("div", { class: "itemMeta" }, "Not connected")), ...body);
      }

      if (!inGroup) {
        body.push(h("div", { class: "hr" }));
        body.push(h("div", { class: "itemTitle" }, "Create or join"));
        body.push(h("div", { class: "field" }, h("div", { class: "label" }, "Your name"), yourName));
        body.push(h("div", { class: "field" }, h("div", { class: "label" }, "Your emoji"), yourEmoji));
        body.push(h("div", { class: "field" }, h("div", { class: "label" }, "New group name"), groupName));
        body.push(
          h(
            "button",
            {
              class: "btn primary",
              type: "button",
              onClick: async () => {
                const n = yourName.value.trim();
                const e = (yourEmoji.value || "🙂").trim();
                const gn = groupName.value.trim();
                if (!n) return toast("Add your name", "So friends know it's you.");
                if (!gn) return toast("Name the group", "Like 'Roomies' or 'Trip crew'.");
                try {
                  await cloudCreateGroup(gn, n, e);
                } catch (err) {
                  toast("Couldn't create group", String(err && err.message ? err.message : err));
                }
              },
            },
            "Create group",
          ),
        );
        body.push(h("div", { class: "field" }, h("div", { class: "label" }, "Join code"), joinCode));
        body.push(
          h(
            "button",
            {
              class: "btn",
              type: "button",
              onClick: async () => {
                const n = yourName.value.trim();
                const e = (yourEmoji.value || "🙂").trim();
                const code = joinCode.value.trim().toUpperCase();
                if (!n) return toast("Add your name", "So friends know it's you.");
                if (!code) return toast("Add a code", "Ask your friend for the join code.");
                try {
                  await cloudJoinGroup(code, n, e);
                } catch (err) {
                  toast("Couldn't join", String(err && err.message ? err.message : err));
                }
              },
            },
            "Join group",
          ),
        );
        return h("div", { class: "item" }, h("div", { class: "itemTop" }, h("div", { class: "itemTitle" }, "Group sync (beta)"), h("div", { class: "itemMeta" }, "Ready")), ...body);
      }

      body.push(h("div", { class: "hr" }));
      body.push(h("div", { class: "itemTitle" }, `Group: ${state.sync.groupName || "Your group"}`));
      body.push(h("div", { class: "itemMeta" }, `Join code: ${state.sync.joinCode || "(pull to sync)"}`));
      body.push(
        h(
          "div",
          { class: "row" },
          h(
            "button",
            {
              class: "btn",
              type: "button",
              onClick: async () => {
                try {
                  await navigator.clipboard.writeText(String(state.sync.joinCode || ""));
                  toast("Copied", "Send that code to friends so they can join.");
                } catch {
                  toast("Copy didn't work", "Your browser may block clipboard access.");
                }
              },
            },
            "Copy code",
          ),
          h(
            "button",
            {
              class: "btn ghost",
              type: "button",
              onClick: () => {
                const base = defaultState();
                const keepTheme = state.theme;
                const keepPrefs = state.prefs;
                const keepSync = { ...state.sync, groupId: null, groupName: null, joinCode: null, memberId: null };
                state = { ...base, theme: keepTheme, prefs: keepPrefs, sync: keepSync };
                saveState();
                render();
                toast("Left group", "You're back to local-only mode.");
              },
            },
            "Leave group",
          ),
        ),
      );
      body.push(h("div", { class: "itemMeta" }, "Anyone with the join code can join this test group."));

      return h("div", { class: "item" }, h("div", { class: "itemTop" }, h("div", { class: "itemTitle" }, "Group sync (beta)"), h("div", { class: "itemMeta" }, "Connected")), ...body);
    })();

    const themeRow = h(
      "div",
      { class: "item" },
      h("div", { class: "itemTop" }, h("div", { class: "itemTitle" }, "Theme"), h("div", { class: "itemMeta" }, themeLabel)),
      h(
        "div",
        { class: "row" },
        h("button", { class: "btn", type: "button", onClick: () => setTheme("system") }, "Auto"),
        h("button", { class: "btn", type: "button", onClick: () => setTheme("light") }, "Light"),
        h("button", { class: "btn", type: "button", onClick: () => setTheme("dark") }, "Dark"),
      ),
    );

    const quietToggle = toggleRow(
      "Quiet mode",
      "Minimal notifications. No pressure.",
      Boolean(state.prefs.quietMode),
      (on) => {
        state.prefs.quietMode = on;
        saveState();
        toast(on ? "Quiet mode on" : "Quiet mode off");
      },
    );

    const roundUpToggle = toggleRow(
      "Round up totals",
      "Avoid penny-pinching by rounding to whole dollars.",
      Boolean(state.prefs.roundUpToDollars),
      (on) => {
        state.prefs.roundUpToDollars = on;
        saveState();
        toast(on ? "Rounding on" : "Rounding off");
      },
    );

    const paymentsInfo = h(
      "div",
      { class: "item" },
      h("div", { class: "itemTop" }, h("div", { class: "itemTitle" }, "Payments (realistic check)"), h("div", { class: "itemMeta" }, "Prototype")),
      h("div", { class: "itemMeta" }, "This web app can't read Apple Pay/Apple Cash transactions, and it doesn't move money. 'Settle' just opens Venmo/PayPal/Zelle or copies a message."),
    );

    const reset = h(
      "div",
      { class: "item" },
      h("div", { class: "itemTop" }, h("div", { class: "itemTitle" }, "Demo data"), h("div", { class: "itemMeta" }, "Local only")),
      h("div", { class: "itemMeta" }, "This prototype stores everything in your browser. Reset any time."),
      h(
        "div",
        { class: "row" },
        h(
          "button",
          {
            class: "btn",
            type: "button",
            onClick: () => {
              state = defaultState();
              saveState();
              render();
              toast("Fresh start", "Sample data restored.");
            },
          },
          "Reset",
        ),
      ),
    );

    return h("div", { class: "list" }, panel("Me", "A little control, no fuss.", null, [mePick, groupCard, themeRow, quietToggle, roundUpToggle, paymentsInfo, reset]));
  }

  function toggleRow(title, subtitle, initialOn, onChange) {
    const toggle = h(
      "button",
      { class: "toggle", type: "button", "data-on": initialOn ? "true" : "false", "aria-pressed": initialOn ? "true" : "false" },
      h("div", { class: "toggleKnob" }),
    );
    toggle.addEventListener("click", () => {
      const on = toggle.getAttribute("data-on") !== "true";
      toggle.setAttribute("data-on", on ? "true" : "false");
      toggle.setAttribute("aria-pressed", on ? "true" : "false");
      onChange(on);
    });
    return h("div", { class: "switch" }, h("div", { class: "switchLeft" }, h("div", { class: "switchTitle" }, title), h("div", { class: "switchSub" }, subtitle)), toggle);
  }

  function renderContextScreen(contextId) {
    const ctx = contextById(contextId);
    if (!ctx) return h("div", null, "Missing context.");

    const balances = computeBalances(ctx.id);
    const meId = state.prefs.meMemberId;
    const trophyId = trophyWinnerForMonth(isoMonth);
    const suggestion = ctx.closed ? null : turnSuggestion(ctx.id);

    const head = h(
      "div",
      { class: "row", style: "margin-bottom:12px;" },
      h("button", { class: "btn", type: "button", onClick: () => closeContext() }, "Back"),
      h(
        "div",
        { class: "row" },
        h("button", { class: "btn", type: "button", onClick: () => exportContext(ctx.id) }, "Export"),
        h(
          "button",
          {
            class: "btn primary",
            type: "button",
            onClick: () => {
              if (ctx.closed) return toast("This one's closed", "Re-open it to add new stuff.");
              openAddExpenseModal(ctx.id);
            },
          },
          "Add",
        ),
      ),
    );

    const sub = ctx.type === "trip" ? (ctx.closed ? "Closed. No more pings." : "Keep it light. Settle when you're ready.") : "Home stuff: errands, staples, utilities.";

    const balancesList = h(
      "div",
      { class: "list" },
      ...state.members.map((m) => {
        const fr = friendlyBadge(balances[m.id] || 0, m.id === state.prefs.meMemberId);
        return h(
          "div",
          { class: "item" },
          h("div", { class: "itemTop" }, h("div", { class: "itemTitle" }, `${m.emoji} ${m.name}${m.id === trophyId ? " 🏆" : ""}`), h("span", { class: `badge ${fr.kind}` }, fr.label)),
          h(
            "div",
            { class: "row" },
            h("div", { class: "itemMeta" }, "Settle whenever it feels right."),
            h("button", { class: "btn", type: "button", onClick: () => openSettleModal(ctx.id, m.id, balances[m.id] || 0) }, "Settle"),
          ),
        );
      }),
    );

    const hint = suggestion
      ? h("div", { class: "item" }, h("div", { class: "itemTitle" }, "Turn-taking suggestion"), h("div", { class: "itemMeta" }, suggestion.text))
      : h("div", { class: "item" }, h("div", { class: "itemTitle" }, "Vibe check"), h("div", { class: "itemMeta" }, "No nudges right now."));

    const transfers = computeSettleTransfers(balances);
    const myTransfers = meId ? transfers.filter((t) => t.from === meId || t.to === meId) : [];

    const settleBody = !meId
      ? h("div", { class: "item" }, h("div", { class: "itemTitle" }, "Pick who you are"), h("div", { class: "itemMeta" }, "Go to the Me tab so ChillSplit can say what's up in plain English."))
      : myTransfers.length === 0
        ? h("div", { class: "item" }, h("div", { class: "itemTitle" }, "Nothing to settle"), h("div", { class: "itemMeta" }, "Looks even. You're good."))
        : h(
            "div",
            { class: "list" },
            ...myTransfers.map((t) => {
              const otherId = t.from === meId ? t.to : t.from;
              const other = memberById(otherId);
              const direction = t.from === meId ? "send" : "ask";
              const title = direction === "send" ? `Send ${formatMoney(t.amountCents)}` : `Ask for ${formatMoney(t.amountCents)}`;
              const sub =
                direction === "send"
                  ? `To ${other ? `${other.emoji} ${other.name}` : otherId}`
                  : `From ${other ? `${other.emoji} ${other.name}` : otherId}`;
              return h(
                "div",
                { class: "item" },
                h("div", { class: "itemTop" }, h("div", { class: "itemTitle" }, title), h("div", { class: "itemMeta" }, sub)),
                h(
                  "div",
                  { class: "row" },
                  h("div", { class: "itemMeta" }, "Optional. Any method works."),
                  h("button", { class: "btn primary", type: "button", onClick: () => openTransferModal(ctx.id, otherId, t.amountCents, direction) }, "Settle"),
                ),
              );
            }),
          );

    const exps = contextExpenses(ctx.id);
    const expList = exps.length
      ? h("div", { class: "list" }, ...exps.map((e) => expenseRow(e)))
      : h("div", { class: "item" }, h("div", { class: "itemTitle" }, "No expenses yet"), h("div", { class: "itemMeta" }, "Add the first one and the app will handle the math."));

    const closeSwitch = ctx.type === "trip"
      ? toggleRow(
          ctx.closed ? "Trip is closed" : "Trip is open",
          ctx.closed ? "Re-open if you need to add something." : "Close it when everyone's settled.",
          ctx.closed,
          async (on) => {
            ctx.closed = on;
            if (isCloudEnabled()) {
              try {
                const sb = await getSupabaseClient();
                const up = await sb.from("cs_contexts").update({ closed: on }).eq("group_id", state.sync.groupId).eq("id", ctx.id);
                if (up.error) throw up.error;
                await cloudPullNow();
                toast(on ? "Trip closed" : "Trip re-opened");
              } catch (e) {
                toast("Couldn't update trip", String(e && e.message ? e.message : e));
              }
              return;
            }
            saveState();
            render();
            toast(on ? "Trip closed" : "Trip re-opened");
          },
        )
      : null;

    return h(
      "div",
      { class: "list" },
      head,
      panel(`${ctx.emoji} ${ctx.name}`, sub, null, [hint, balancesList]),
      panel("Settle plan (optional)", "A simple suggestion for who pays who. No pressure.", null, [settleBody]),
      panel("Expenses", "Friendly ledger. No shame, no alarms.", null, [expList]),
      closeSwitch ? panel("Trip status", null, null, [closeSwitch]) : null,
    );
  }

  function expenseRow(expense) {
    const payer = memberById(expense.paidBy);
    const created = new Date(expense.createdAt);
    const meta = `${payer ? `${payer.emoji} ${payer.name}` : "Someone"} grabbed it · ${created.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
    const commentCount = (state.comments[expense.id] || []).length;
    const rounded = expense.roundUpCents ? ` (+${formatMoney(expense.roundUpCents)} round up)` : "";

    return h(
      "div",
      { class: "item" },
      h(
        "div",
        { class: "itemTop" },
        h("div", null, h("div", { class: "itemTitle" }, expense.title), h("div", { class: "itemMeta" }, `${meta}${rounded}`)),
        h("div", { class: "itemMeta mono" }, formatMoney(expense.amountCents + (expense.roundUpCents || 0))),
      ),
      h(
        "div",
        { class: "row" },
        h(
          "div",
          { class: "itemMeta" },
          `${expense.split.type === "equal" ? "Split equally" : expense.split.type === "balanced" ? "Balance it" : "Custom split"} · ${expense.split.participants.length} pals`,
        ),
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn", type: "button", onClick: () => openCommentsModal(expense.id) }, commentCount ? `Comments (${commentCount})` : "Comment"),
          h("button", { class: "btn", type: "button", onClick: () => openEditExpenseModal(expense.id) }, "Edit"),
        ),
      ),
    );
  }

  function exportContext(contextId) {
    const ctx = contextById(contextId);
    if (!ctx) return;
    const rows = [];
    rows.push(["context", ctx.name]);
    rows.push(["generated_at", new Date().toISOString()]);
    rows.push([]);
    rows.push(["title", "amount", "paid_by", "split", "created_at"]);
    for (const e of contextExpenses(contextId).slice().reverse()) {
      const payer = memberById(e.paidBy);
      rows.push([
        e.title,
        ((e.amountCents + (e.roundUpCents || 0)) / 100).toFixed(2),
        payer ? payer.name : e.paidBy,
        e.split.type,
        new Date(e.createdAt).toISOString(),
      ]);
    }
    rows.push([]);
    rows.push(["balances"]);
    const balances = computeBalances(contextId);
    for (const m of state.members) {
      rows.push([m.name, (balances[m.id] || 0) / 100]);
    }

    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `chillsplit_${ctx.type}_${ctx.name.replaceAll(/\s+/g, "_").toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast("Exported", "Downloaded a CSV summary.");
  }

  function csvCell(v) {
    if (v == null) return "";
    const s = String(v);
    if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replaceAll('"', '""')}"`;
    return s;
  }

  function allContextsForQuickAdd() {
    const tripsOpen = state.contexts.filter((c) => c.type === "trip" && !c.closed);
    const home = state.contexts.filter((c) => c.type === "home");
    const tripsClosed = state.contexts.filter((c) => c.type === "trip" && c.closed);
    return [...tripsOpen, ...home, ...tripsClosed];
  }

  function openQuickAddModal() {
    let step = 1;
    let withFriends = true;
    let receiptDataUrl = null;
    let extractedTotal = null;

    const title = h("input", { id: "qaTitle", placeholder: "Coffee run, dinner, tickets..." });
    const amount = h("input", { id: "qaAmount", inputmode: "decimal", placeholder: "0.00" });
    const ctxSelect = h(
      "select",
      { id: "qaContext" },
      ...allContextsForQuickAdd().map((c) => h("option", { value: c.id }, `${c.emoji} ${c.name}${c.closed ? " (closed)" : ""}`)),
    );

    const receipt = h("input", { id: "qaReceipt", type: "file", accept: "image/*" });
    const preview = h("div", { class: "preview", id: "qaPreview" }, h("div", { class: "itemMeta" }, "Optional: add a receipt. We'll try to find the total."));

    receipt.addEventListener("change", async () => {
      const file = receipt.files && receipt.files[0];
      if (!file) return;
      receiptDataUrl = await fileToDataUrl(file);
      preview.replaceChildren(
        h("img", { src: receiptDataUrl, alt: "Receipt preview" }),
        h(
          "div",
          { class: "row" },
          h("div", { class: "itemMeta" }, "Want help finding the total?"),
          h("button", { class: "btn", type: "button", onClick: () => scanReceiptTotal() }, "Scan total"),
        ),
      );
    });

    async function scanReceiptTotal() {
      if (!receiptDataUrl) return;
      toast("Reading receipt", "This can take a moment on first load.");
      try {
        await ensureTesseract();
        const result = await window.Tesseract.recognize(receiptDataUrl, "eng", { logger: () => {} });
        const text = (result && result.data && result.data.text) ? result.data.text : "";
        const cents = pickTotalFromOcrText(text);
        if (!cents) return toast("Couldn't find a total", "Try typing it in instead.");
        extractedTotal = cents;
        amount.value = (cents / 100).toFixed(2);
        toast("Found a total", formatMoney(cents));
      } catch {
        toast("OCR couldn't run", "No worries, manual entry is fastest.");
      }
    }

    const withFriendsRow = toggleRow(
      "With friends?",
      "If yes, we'll help you split it. If no, we'll just track it.",
      true,
      (on) => {
        withFriends = on;
      },
    );

    const body = h("div", { class: "modalBody" });
    function renderBody() {
      body.replaceChildren();
      if (step === 1) {
        body.append(
          h("div", { class: "itemMeta" }, "Quick add keeps things light: amount first, details later."),
          h("div", { class: "field" }, h("div", { class: "label" }, "What was it?"), title),
          h("div", { class: "field" }, h("div", { class: "label" }, "How much?"), amount),
          h("div", { class: "field" }, h("div", { class: "label" }, "Receipt (optional)"), receipt),
          preview,
          withFriendsRow,
        );
        return;
      }
      body.append(
        h("div", { class: "itemMeta" }, withFriends ? "Nice. Where should this live?" : "All good. Where should we save it?"),
        h("div", { class: "field" }, h("div", { class: "label" }, "Context"), ctxSelect),
        h("div", { class: "itemMeta" }, "Tip: trips can be closed later when you're settled."),
      );
    }

    function nextEnabled() {
      const cents = parseMoneyToCents(amount.value);
      if (!cents || cents <= 0) return false;
      if (!title.value.trim()) return false;
      return true;
    }

    async function finish() {
      const t = title.value.trim();
      const cents = parseMoneyToCents(amount.value);
      const contextId = ctxSelect.value;
      if (!t || !cents) return;

      closeModal();

      // If it's not a friend thing, just save it as a solo expense (fast path).
      if (!withFriends) {
        const me = state.prefs.meMemberId || state.members[0]?.id;
        if (!me) return;
        if (isCloudEnabled()) {
          try {
            const sb = await getSupabaseClient();
            const ins = await sb.from("cs_expenses").insert({
              group_id: state.sync.groupId,
              context_id: contextId,
              title: t,
              amount_cents: cents,
              paid_by: me,
              split_type: "equal",
              participants: [me],
              shares: null,
              round_up_cents: 0,
            });
            if (ins.error) throw ins.error;
            await cloudPullNow();
            toast("Added", "Tracked. Shared with the group.");
          } catch (e) {
            toast("Couldn't add", String(e && e.message ? e.message : e));
          }
          return;
        }
        state.expenses.push({
          id: uid("e"),
          contextId,
          title: t,
          amountCents: cents,
          paidBy: me,
          split: { type: "equal", participants: [me] },
          createdAt: Date.now(),
          roundUpCents: 0,
          receipt: receiptDataUrl ? { dataUrl: receiptDataUrl, ocrTotalCents: extractedTotal } : null,
        });
        saveState();
        render();
        toast("Added", "Tracked. No split needed.");
        return;
      }

      // Friend mode: prefill the full add-expense modal so you can tweak payer/split if you want.
      openAddExpenseModal(contextId, {
        prefill: {
          title: t,
          amountCents: cents,
          receipt: receiptDataUrl ? { dataUrl: receiptDataUrl, ocrTotalCents: extractedTotal } : null,
        },
      });
    }

    function renderActions() {
      return [
        {
          label: step === 1 ? "Close" : "Back",
          kind: "ghost",
          onClick: () => {
            if (step === 1) closeModal();
            else {
              step = 1;
              renderBody();
              openModal("Quick add", body, renderActions());
            }
          },
        },
        {
          label: step === 1 ? "Next" : "Save",
          kind: "primary",
          onClick: () => {
            if (step === 1) {
              if (!nextEnabled()) return toast("Add a title + amount", "Even quick adds need the basics.");
              step = 2;
              renderBody();
              openModal("Quick add", body, renderActions());
              return;
            }
            finish();
          },
        },
      ];
    }

    renderBody();
    openModal("Quick add", body, renderActions());
  }

  function openTripModal() {
    const content = h(
      "div",
      { class: "modalBody" },
      h("div", { class: "field" }, h("div", { class: "label" }, "Trip name"), h("input", { id: "tripName", placeholder: "Beach weekend, festival, etc." })),
      h("div", { class: "field" }, h("div", { class: "label" }, "Emoji"), h("input", { id: "tripEmoji", placeholder: "🧳", value: "🧳" })),
      h("div", { class: "itemMeta" }, "Tip: Keep it short so it looks cute in cards."),
    );

    openModal("New trip", content, [
      {
        label: "Cancel",
        kind: "ghost",
        onClick: () => closeModal(),
      },
      {
        label: "Create",
        kind: "primary",
        onClick: async () => {
          const name = document.getElementById("tripName").value.trim();
          const emoji = document.getElementById("tripEmoji").value.trim() || "🧳";
          if (!name) return toast("Name it", "Something like 'Catskills Weekend'.");
          if (isCloudEnabled()) {
            try {
              const sb = await getSupabaseClient();
              const ins = await sb.from("cs_contexts").insert({ group_id: state.sync.groupId, type: "trip", name, emoji, closed: false });
              if (ins.error) throw ins.error;
              closeModal();
              await cloudPullNow();
              toast("Trip created", "Invite friends whenever.");
            } catch (e) {
              toast("Couldn't create trip", String(e && e.message ? e.message : e));
            }
            return;
          }
          state.contexts.push({ id: uid("c"), type: "trip", name, emoji, closed: false });
          saveState();
          closeModal();
          render();
          toast("Trip created", "Invite friends whenever.");
        },
      },
    ]);
  }

  function openPoolModal(homeId, month) {
    const key = `${homeId}:${month}`;
    const pool = state.pools[key] || { month, perPersonCents: 0, contributions: {}, deductions: [] };
    const per = pool.perPersonCents ? (pool.perPersonCents / 100).toFixed(2) : "";

    const perField = h("div", { class: "field" }, h("div", { class: "label" }, "Per-person monthly amount"), h("input", { id: "poolPer", inputmode: "decimal", placeholder: "45.00", value: per }));

    const membersGrid = h(
      "div",
      { class: "list" },
      ...state.members.map((m) => {
        const val = pool.contributions[m.id] != null ? (Number(pool.contributions[m.id]) / 100).toFixed(2) : per;
        return h(
          "div",
          { class: "field" },
          h("div", { class: "label" }, `${m.emoji} ${m.name}`),
          h("input", { id: `pool_${m.id}`, inputmode: "decimal", placeholder: per || "0.00", value: val }),
        );
      }),
    );

    const content = h(
      "div",
      { class: "modalBody" },
      h("div", { class: "itemMeta" }, `Month: ${monthLabel(month)}`),
      perField,
      h("div", { class: "itemMeta" }, "You can keep it equal, or nudge individual amounts."),
      membersGrid,
    );

    openModal("Adjust pool", content, [
      { label: "Cancel", kind: "ghost", onClick: () => closeModal() },
      {
        label: "Save",
        kind: "primary",
        onClick: async () => {
          const perCents = parseMoneyToCents(document.getElementById("poolPer").value) || 0;
          const next = { month, perPersonCents: perCents, contributions: {}, deductions: pool.deductions || [] };
          for (const m of state.members) {
            const v = parseMoneyToCents(document.getElementById(`pool_${m.id}`).value);
            next.contributions[m.id] = v != null ? v : perCents;
          }
          if (isCloudEnabled()) {
            try {
              const sb = await getSupabaseClient();
              const up = await sb
                .from("cs_pools")
                .upsert({ group_id: state.sync.groupId, month, per_person_cents: perCents }, { onConflict: "group_id,month" })
                .select("id")
                .single();
              if (up.error) throw up.error;
              const poolId = up.data.id;
              for (const [mid, cents] of Object.entries(next.contributions)) {
                const res = await sb
                  .from("cs_pool_contributions")
                  .upsert({ pool_id: poolId, member_id: mid, amount_cents: Number(cents || 0) }, { onConflict: "pool_id,member_id" });
                if (res.error) throw res.error;
              }
              closeModal();
              await cloudPullNow();
              toast("Pool updated", "Auto-deductions will nibble from this.");
            } catch (e) {
              toast("Couldn't save pool", String(e && e.message ? e.message : e));
            }
            return;
          }
          state.pools[key] = next;
          saveState();
          closeModal();
          render();
          toast("Pool updated", "Auto-deductions will nibble from this.");
        },
      },
    ]);
  }

  function openAddDeductionModal(homeId, month) {
    const content = h(
      "div",
      { class: "modalBody" },
      h("div", { class: "field" }, h("div", { class: "label" }, "What was it?"), h("input", { id: "dedTitle", placeholder: "Netflix, electric, Hulu..." })),
      h("div", { class: "field" }, h("div", { class: "label" }, "Emoji"), h("input", { id: "dedEmoji", placeholder: "📺", value: "🧾" })),
      h("div", { class: "field" }, h("div", { class: "label" }, "Amount"), h("input", { id: "dedAmount", inputmode: "decimal", placeholder: "15.99" })),
    );

    openModal("Add deduction", content, [
      { label: "Cancel", kind: "ghost", onClick: () => closeModal() },
      {
        label: "Add",
        kind: "primary",
        onClick: async () => {
          const title = document.getElementById("dedTitle").value.trim();
          const emoji = document.getElementById("dedEmoji").value.trim() || "🧾";
          const amountCents = parseMoneyToCents(document.getElementById("dedAmount").value);
          if (!title) return toast("Name it", "Netflix, utilities, etc.");
          if (!amountCents || amountCents <= 0) return toast("Add an amount", "Like 15.99");
          const key = `${homeId}:${month}`;
          const pool = state.pools[key] || { month, perPersonCents: 0, contributions: {}, deductions: [] };
          if (isCloudEnabled()) {
            try {
              const sb = await getSupabaseClient();
              const up = await sb
                .from("cs_pools")
                .upsert({ group_id: state.sync.groupId, month, per_person_cents: Number(pool.perPersonCents || 0) }, { onConflict: "group_id,month" })
                .select("id")
                .single();
              if (up.error) throw up.error;
              const ins = await sb
                .from("cs_pool_deductions")
                .insert({ pool_id: up.data.id, title, emoji, amount_cents: amountCents, at: new Date().toISOString() });
              if (ins.error) throw ins.error;
              closeModal();
              await cloudPullNow();
              toast("Deducted", `${emoji} ${title} subtracted from the pool.`);
            } catch (e) {
              toast("Couldn't add deduction", String(e && e.message ? e.message : e));
            }
            return;
          }
          pool.deductions = pool.deductions || [];
          pool.deductions.push({ id: uid("d"), title, emoji, amountCents, at: Date.now() });
          state.pools[key] = pool;
          saveState();
          closeModal();
          render();
          toast("Deducted", `${emoji} ${title} subtracted from the pool.`);
        },
      },
    ]);
  }

  function openAddExpenseModal(contextId, opts) {
    const ctx = contextById(contextId);
    if (!ctx) return;

    const prefill = opts && opts.prefill ? opts.prefill : null;

    const participants = state.members.map((m) => m.id);
    let splitType = "equal";
    let selected = new Set(participants);
    let receiptDataUrl = null;
    let extractedTotal = null;
    let roundUpDisabled = false;

    const title = h("input", { id: "exTitle", placeholder: "Dinner, groceries, tickets..." });
    const amount = h("input", { id: "exAmount", inputmode: "decimal", placeholder: "0.00" });
    const payer = h(
      "select",
      { id: "exPayer" },
      ...state.members.map((m) => h("option", { value: m.id }, `${m.emoji} ${m.name}`)),
    );

    if (state.prefs.meMemberId) payer.value = state.prefs.meMemberId;
    if (prefill) {
      if (prefill.title) title.value = String(prefill.title);
      if (prefill.amountCents != null) amount.value = (Number(prefill.amountCents) / 100).toFixed(2);
    }

    const splitSel = h(
      "select",
      {
        id: "exSplit",
        onChange: (e) => {
          splitType = e.target.value;
          if (splitType === "custom" || splitType === "balanced") {
            // Non-equal splits are exact; keep rounding for equal splits only.
            roundUpDisabled = true;
            roundUpToggle.setAttribute("data-on", "false");
            roundUpToggle.setAttribute("aria-disabled", "true");
          } else {
            roundUpDisabled = false;
            roundUpToggle.removeAttribute("aria-disabled");
            roundUpToggle.setAttribute("data-on", state.prefs.roundUpToDollars ? "true" : "false");
          }
          renderCustom();
        },
      },
      h("option", { value: "equal" }, "Split equally"),
      h("option", { value: "balanced" }, "Balance it (suggested)"),
      h("option", { value: "custom" }, "Custom amounts"),
    );

    const customWrap = h("div", { id: "customWrap" });
    const roundUpToggle = h("div", { class: "toggle", type: "button", "data-on": state.prefs.roundUpToDollars ? "true" : "false" }, h("div", { class: "toggleKnob" }));
    const roundUpRow = h(
      "div",
      { class: "switch" },
      h("div", { class: "switchLeft" }, h("div", { class: "switchTitle" }, "Round up"), h("div", { class: "switchSub" }, "Whole dollars. Less penny talk.")),
      roundUpToggle,
    );
    roundUpToggle.addEventListener("click", () => {
      if (roundUpDisabled) return;
      const on = roundUpToggle.getAttribute("data-on") !== "true";
      roundUpToggle.setAttribute("data-on", on ? "true" : "false");
    });

    const receipt = h("input", { id: "exReceipt", type: "file", accept: "image/*" });
    const preview = h("div", { class: "preview", id: "receiptPreview" }, h("div", { class: "itemMeta" }, "Receipt preview will show up here."));
    receipt.addEventListener("change", async () => {
      const file = receipt.files && receipt.files[0];
      if (!file) return;
      receiptDataUrl = await fileToDataUrl(file);
      preview.replaceChildren(
        h("img", { src: receiptDataUrl, alt: "Receipt preview" }),
        h("div", { class: "row" }, h("div", { class: "itemMeta" }, "Want help finding the total?"), h("button", { class: "btn", type: "button", onClick: () => scanReceiptTotal() }, "Scan total")),
      );
    });

    if (prefill && prefill.receipt && prefill.receipt.dataUrl) {
      receiptDataUrl = prefill.receipt.dataUrl;
      extractedTotal = prefill.receipt.ocrTotalCents || null;
      preview.replaceChildren(
        h("img", { src: receiptDataUrl, alt: "Receipt preview" }),
        h("div", { class: "itemMeta" }, extractedTotal ? `OCR guess: ${formatMoney(extractedTotal)} (you can re-scan)` : "Receipt attached."),
      );
    }

    async function scanReceiptTotal() {
      if (!receiptDataUrl) return;
      toast("Reading receipt", "This can take a moment on first load.");
      try {
        await ensureTesseract();
        const result = await window.Tesseract.recognize(receiptDataUrl, "eng", { logger: () => {} });
        const text = (result && result.data && result.data.text) ? result.data.text : "";
        const cents = pickTotalFromOcrText(text);
        if (!cents) return toast("Couldn't find a total", "Try typing it in instead.");
        extractedTotal = cents;
        amount.value = (cents / 100).toFixed(2);
        toast("Found a total", formatMoney(cents));
      } catch (e) {
        toast("OCR couldn't run", "No worries, manual entry is fastest.");
      }
    }

    function renderCustom() {
      if (splitType !== "custom" && splitType !== "balanced") {
        customWrap.replaceChildren();
        return;
      }
      const cents = parseMoneyToCents(amount.value);
      const ids = Array.from(selected);
      const paidBy = payer.value;

      if (!cents || cents <= 0 || ids.length < 1) {
        customWrap.replaceChildren(h("div", { class: "itemMeta" }, "Add an amount and pick who's in, then we'll fill this in."));
        return;
      }

      let preset = null;
      if (splitType === "balanced") {
        preset = suggestBalancedShares(contextId, cents, paidBy, ids);
      }

      const per = Math.floor(cents / ids.length);
      let rem = cents - per * ids.length;

      const fields = ids.map((mid) => {
        const m = memberById(mid);
        const v = preset ? preset[mid] : per + (rem-- > 0 ? 1 : 0);
        return h(
          "div",
          { class: "field" },
          h("div", { class: "label" }, `${m ? `${m.emoji} ${m.name}` : mid}`),
          h("input", { id: `share_${mid}`, inputmode: "decimal", placeholder: "0.00", value: (v / 100).toFixed(2) }),
        );
      });

      const blurb =
        splitType === "balanced"
          ? "Balance it is a suggestion: it shifts shares a bit so everyone stays even over time."
          : "Custom splits are gentle: type what feels right.";
      customWrap.replaceChildren(h("div", { class: "itemMeta" }, blurb), ...fields);
    }

    const pals = h(
      "div",
      { class: "list" },
      ...state.members.map((m) => {
        const row = h(
          "div",
          { class: "row" },
          h("div", null, h("span", { class: "kbd" }, m.emoji), " ", h("span", { class: "itemTitle" }, m.name)),
          h("button", { class: "btn", type: "button" }, "In"),
        );
        const btn = row.querySelector("button");
        btn.addEventListener("click", () => {
          if (selected.has(m.id)) selected.delete(m.id);
          else selected.add(m.id);
          btn.textContent = selected.has(m.id) ? "In" : "Out";
          btn.className = selected.has(m.id) ? "btn" : "btn ghost";
          renderCustom();
        });
        btn.textContent = selected.has(m.id) ? "In" : "Out";
        btn.className = selected.has(m.id) ? "btn" : "btn ghost";
        return h("div", { class: "item" }, row);
      }),
    );

    const content = h(
      "div",
      { class: "modalBody" },
      h("div", { class: "itemMeta" }, `Context: ${ctx.emoji} ${ctx.name}`),
      h("div", { class: "field" }, h("div", { class: "label" }, "What was it?"), title),
      h("div", { class: "field" }, h("div", { class: "label" }, "How much?"), amount),
      h("div", { class: "field" }, h("div", { class: "label" }, "Who paid?"), payer),
      h("div", { class: "field" }, h("div", { class: "label" }, "Split"), splitSel),
      h("div", { class: "field" }, h("div", { class: "label" }, "Who's in?"), pals),
      customWrap,
      roundUpRow,
      h("div", { class: "field" }, h("div", { class: "label" }, "Receipt (optional)"), receipt),
      preview,
    );

    openModal("Add expense", content, [
      { label: "Cancel", kind: "ghost", onClick: () => closeModal() },
      {
        label: "Add",
        kind: "primary",
        onClick: async () => {
          const t = title.value.trim();
          const amountCents = parseMoneyToCents(amount.value);
          if (!t) return toast("Add a title", "Like 'Dinner' or 'Groceries'.");
          if (!amountCents || amountCents <= 0) return toast("Add an amount", "Like 42.50");
          const ids = Array.from(selected);
          if (ids.length < 1) return toast("Pick at least one pal", "Someone has to be 'in'.");

          const paidBy = payer.value;
          const roundOn = roundUpToggle.getAttribute("data-on") === "true";
          const roundUpCents =
            splitType === "equal" && roundOn && state.prefs.roundUpToDollars
              ? (Math.ceil(amountCents / 100) * 100) - amountCents
              : 0;

          const exp = {
            id: uid("e"),
            contextId,
            title: t,
            amountCents,
            paidBy,
            split: { type: splitType, participants: ids },
            createdAt: Date.now(),
            roundUpCents,
            receipt: receiptDataUrl ? { dataUrl: receiptDataUrl, ocrTotalCents: extractedTotal } : null,
          };

          if (splitType === "custom" || splitType === "balanced") {
            const shares = {};
            let sum = 0;
            for (const mid of ids) {
              const v = parseMoneyToCents(document.getElementById(`share_${mid}`)?.value);
              const cents = v != null ? v : 0;
              shares[mid] = cents;
              sum += cents;
            }
            if (sum !== amountCents) {
              return toast("Split doesn't match", `Expected ${formatMoney(amountCents)} total.`);
            }
            exp.split.shares = shares;
          }

          const persist = async () => {
            if (isCloudEnabled()) {
              try {
                const sb = await getSupabaseClient();
                const ins = await sb.from("cs_expenses").insert({
                  group_id: state.sync.groupId,
                  context_id: exp.contextId,
                  title: exp.title,
                  amount_cents: exp.amountCents,
                  paid_by: exp.paidBy,
                  split_type: exp.split.type,
                  participants: exp.split.participants,
                  shares: exp.split.shares || null,
                  round_up_cents: exp.roundUpCents || 0,
                });
                if (ins.error) throw ins.error;
                closeModal();
                await cloudPullNow();
                toast("Added", "Saved to the group.");
              } catch (e) {
                toast("Couldn't add expense", String(e && e.message ? e.message : e));
              }
              return;
            }
            state.expenses.push(exp);
            saveState();
            closeModal();
            render();
            toast("Added", "No pressure. It's just noted.");
          };

          const me = state.prefs.meMemberId;
          if (me && exp.paidBy === me && shouldNudgePayer(contextId, me)) {
            openPayerNudgeModal(
              contextId,
              me,
              (nextPayerId) => {
                exp.paidBy = nextPayerId;
                if (exp.split.type === "balanced") {
                  exp.split.shares = suggestBalancedShares(contextId, exp.amountCents, exp.paidBy, exp.split.participants);
                }
                persist();
              },
              () => persist(),
            );
            return;
          }

          await persist();
        },
      },
    ]);

    amount.addEventListener("input", () => renderCustom());
    payer.addEventListener("change", () => renderCustom());
  }

  function shouldNudgePayer(contextId, payerId) {
    const balances = computeBalances(contextId);
    const coveredCents = balances[payerId] || 0;
    const recent = contextExpenses(contextId).slice(0, 5);
    let streak = 0;
    for (const e of recent) {
      if (e.paidBy === payerId) streak += 1;
      else break;
    }
    // Covered by $25+ OR paid the last 2 in a row.
    return coveredCents >= 2500 || streak >= 2;
  }

  function openPayerNudgeModal(contextId, currentPayerId, onChoose, onKeep) {
    const ctx = contextById(contextId);
    const me = memberById(currentPayerId);
    const suggested = turnSuggestion(contextId);
    const suggestedId = suggested ? suggested.memberId : null;

    const choices = state.members
      .filter((m) => m.id !== currentPayerId)
      .sort((a, b) => (a.id === suggestedId ? -1 : b.id === suggestedId ? 1 : 0))
      .map((m) =>
        h(
          "button",
          { class: m.id === suggestedId ? "btn primary" : "btn", type: "button", onClick: () => { closeModal(); onChoose(m.id); } },
          `${m.emoji} ${m.name}`,
        ),
      );

    const content = h(
      "div",
      { class: "modalBody" },
      h("div", { class: "itemMeta" }, `Context: ${ctx ? `${ctx.emoji} ${ctx.name}` : "this group"}`),
      h(
        "div",
        { class: "item" },
        h("div", { class: "itemTitle" }, "Tiny vibe check"),
        h("div", { class: "itemMeta" }, `${me ? me.name : "You"}'ve been picking up a lot lately. Want someone else to grab this one?`),
      ),
      h("div", { class: "list" }, ...choices),
      h("div", { class: "itemMeta" }, "No pressure. It's always your call."),
    );

    openModal("Switch payer?", content, [
      { label: "Keep me", kind: "primary", onClick: () => { closeModal(); onKeep(); } },
    ]);
  }

  function openEditExpenseModal(expenseId) {
    const expense = state.expenses.find((e) => e.id === expenseId);
    if (!expense) return;

    const title = h("input", { id: "edTitle", value: expense.title });
    const amount = h("input", { id: "edAmount", inputmode: "decimal", value: (expense.amountCents / 100).toFixed(2) });

    const content = h(
      "div",
      { class: "modalBody" },
      h("div", { class: "field" }, h("div", { class: "label" }, "Title"), title),
      h("div", { class: "field" }, h("div", { class: "label" }, "Amount"), amount),
      h("div", { class: "itemMeta" }, "Editing is normal. We're chill."),
    );

    openModal("Edit expense", content, [
      { label: "Cancel", kind: "ghost", onClick: () => closeModal() },
      {
        label: "Delete",
        kind: "ghost",
        onClick: async () => {
          if (isCloudEnabled()) {
            try {
              const sb = await getSupabaseClient();
              await sb.from("cs_comments").delete().eq("group_id", state.sync.groupId).eq("expense_id", expenseId);
              const del = await sb.from("cs_expenses").delete().eq("group_id", state.sync.groupId).eq("id", expenseId);
              if (del.error) throw del.error;
              closeModal();
              await cloudPullNow();
              toast("Removed", "Deleted from the group.");
            } catch (e) {
              toast("Couldn't delete", String(e && e.message ? e.message : e));
            }
            return;
          }
          state.expenses = state.expenses.filter((e) => e.id !== expenseId);
          delete state.comments[expenseId];
          saveState();
          closeModal();
          render();
          toast("Removed", "It's like it never happened.");
        },
      },
      {
        label: "Save",
        kind: "primary",
        onClick: async () => {
          const t = title.value.trim();
          const amountCents = parseMoneyToCents(amount.value);
          if (!t) return toast("Needs a title", "Quick + clear.");
          if (!amountCents || amountCents <= 0) return toast("Needs an amount", "Like 12.00");
          if (isCloudEnabled()) {
            try {
              const sb = await getSupabaseClient();
              const roundUpCents = expense.roundUpCents ? (Math.ceil(amountCents / 100) * 100) - amountCents : 0;
              const up = await sb
                .from("cs_expenses")
                .update({ title: t, amount_cents: amountCents, round_up_cents: roundUpCents })
                .eq("group_id", state.sync.groupId)
                .eq("id", expenseId);
              if (up.error) throw up.error;
              closeModal();
              await cloudPullNow();
              toast("Updated", "Saved to the group.");
            } catch (e) {
              toast("Couldn't save", String(e && e.message ? e.message : e));
            }
            return;
          }
          expense.title = t;
          expense.amountCents = amountCents;
          // If the amount changed, re-evaluate round-up.
          if (expense.roundUpCents) expense.roundUpCents = (Math.ceil(amountCents / 100) * 100) - amountCents;
          saveState();
          closeModal();
          render();
          toast("Updated", "Nice.");
        },
      },
    ]);
  }

  function openCommentsModal(expenseId) {
    const list = state.comments[expenseId] || [];
    const expense = state.expenses.find((e) => e.id === expenseId);
    const title = expense ? expense.title : "Expense";

    const items = h(
      "div",
      { class: "list", id: "cmtList" },
      ...(list.length
        ? list
            .slice()
            .sort((a, b) => (a.at || 0) - (b.at || 0))
            .map((c) => {
              const m = memberById(c.by);
              return h(
                "div",
                { class: "item" },
                h("div", { class: "itemTop" }, h("div", { class: "itemTitle" }, `${m ? `${m.emoji} ${m.name}` : "Someone"}`), h("div", { class: "itemMeta" }, new Date(c.at).toLocaleString())),
                h("div", { class: "itemMeta" }, c.text),
              );
            })
        : [h("div", { class: "item" }, h("div", { class: "itemTitle" }, "No comments yet"), h("div", { class: "itemMeta" }, "Drop a note like 'I tipped $5' or 'Thanks!'."))]),
    );

    const input = h("input", { id: "cmtInput", placeholder: "Say something nice..." });
    const by = h("select", { id: "cmtBy" }, ...state.members.map((m) => h("option", { value: m.id }, `${m.emoji} ${m.name}`)));

    const content = h(
      "div",
      { class: "modalBody" },
      h("div", { class: "itemMeta" }, `On: ${title}`),
      items,
      h("div", { class: "field" }, h("div", { class: "label" }, "From"), by),
      h("div", { class: "field" }, h("div", { class: "label" }, "Comment"), input),
    );

    openModal("Comments", content, [
      { label: "Close", kind: "ghost", onClick: () => closeModal() },
      {
        label: "Post",
        kind: "primary",
        onClick: async () => {
          const text = input.value.trim();
          if (!text) return toast("Type something", "Even a single emoji counts.");
          if (isCloudEnabled()) {
            try {
              const sb = await getSupabaseClient();
              const ins = await sb.from("cs_comments").insert({
                group_id: state.sync.groupId,
                expense_id: expenseId,
                by_member_id: by.value,
                text,
                created_at: new Date().toISOString(),
              });
              if (ins.error) throw ins.error;
              closeModal();
              await cloudPullNow();
              toast("Posted", "Shared with the group.");
            } catch (e) {
              toast("Couldn't post", String(e && e.message ? e.message : e));
            }
            return;
          }
          const c = { id: uid("cmt"), by: by.value, text, at: Date.now() };
          state.comments[expenseId] = [...(state.comments[expenseId] || []), c];
          saveState();
          closeModal();
          render();
          toast("Posted", "Keeping it human.");
        },
      },
    ]);
  }

  function openTransferModal(contextId, otherId, amountCents, direction) {
    const ctx = contextById(contextId);
    const other = memberById(otherId);
    if (!ctx) return;
    const note = `ChillSplit: ${ctx.name}`;
    const amount = amountCents / 100;
    const title =
      direction === "send"
        ? `Send ${formatMoney(amountCents)}`
        : `Ask for ${formatMoney(amountCents)}`;

    const message =
      direction === "send"
        ? `Sending ${formatMoney(amountCents)} to ${other ? other.name : "a friend"} for ${ctx.name}.`
        : `Hey ${other ? other.name : "friend"}! Can you send ${formatMoney(amountCents)} to even up for ${ctx.name}?`;

    const buttons =
      direction === "send"
        ? h(
            "div",
            { class: "list" },
            h("button", { class: "btn primary", type: "button", onClick: () => openSettleLink("venmo", amount, note) }, "Pay with Venmo"),
            h("button", { class: "btn", type: "button", onClick: () => openSettleLink("paypal", amount, note) }, "Pay with PayPal"),
            h("button", { class: "btn", type: "button", onClick: () => openSettleLink("zelle", amount, note) }, "Pay with Zelle"),
          )
        : h(
            "div",
            { class: "list" },
            h("button", { class: "btn primary", type: "button", onClick: () => openPaymentApp("venmo") }, "Open Venmo"),
            h("button", { class: "btn", type: "button", onClick: () => openPaymentApp("paypal") }, "Open PayPal"),
            h("button", { class: "btn", type: "button", onClick: () => openPaymentApp("zelle") }, "Open Zelle"),
          );

    const content = h(
      "div",
      { class: "modalBody" },
      h("div", { class: "itemMeta" }, `${ctx.emoji} ${ctx.name}`),
      h(
        "div",
        { class: "item" },
        h("div", { class: "itemTitle" }, other ? `${other.emoji} ${other.name}` : "Friend"),
        h("div", { class: "itemMeta" }, direction === "send" ? "This would make things even." : "A friendly ask. No pressure."),
      ),
      buttons,
      h(
        "div",
        { class: "item" },
        h("div", { class: "itemTitle" }, "Copy message"),
        h("div", { class: "itemMeta" }, message),
        h(
          "div",
          { class: "row" },
          h(
            "button",
            {
              class: "btn",
              type: "button",
              onClick: async () => {
                try {
                  await navigator.clipboard.writeText(`${message}\n${note}`);
                  toast("Copied", "Paste it in chat or your payment app.");
                } catch {
                  toast("Copy didn't work", "Your browser may block clipboard access.");
                }
              },
            },
            "Copy",
          ),
        ),
      ),
    );

    openModal(title, content, [{ label: "Close", kind: "primary", onClick: () => closeModal() }]);
  }

  function openSettleModal(contextId, memberId, netCents) {
    const ctx = contextById(contextId);
    const m = memberById(memberId);
    if (!ctx || !m) return;

    const info = friendlyBadge(netCents, memberId === state.prefs.meMemberId);
    const note = `ChillSplit: ${ctx.name}`;
    const amount = Math.abs(netCents) / 100;

    const content = h(
      "div",
      { class: "modalBody" },
      h("div", { class: "item" }, h("div", { class: "itemTitle" }, `${m.emoji} ${m.name}`), h("div", { class: `itemMeta mono` }, info.label)),
      h("div", { class: "itemMeta" }, "Settlement is optional. Use your favorite app, or just call it even."),
      h(
        "div",
        { class: "list" },
        h("button", { class: "btn primary", type: "button", onClick: () => openSettleLink("venmo", amount, note) }, "Venmo"),
        h("button", { class: "btn", type: "button", onClick: () => openSettleLink("paypal", amount, note) }, "PayPal"),
        h("button", { class: "btn", type: "button", onClick: () => openSettleLink("zelle", amount, note) }, "Zelle"),
      ),
      h(
        "div",
        { class: "item" },
        h("div", { class: "itemTitle" }, "Copy note"),
        h("div", { class: "itemMeta" }, note),
        h(
          "div",
          { class: "row" },
          h(
            "button",
            {
              class: "btn",
              type: "button",
              onClick: async () => {
                try {
                  await navigator.clipboard.writeText(note);
                  toast("Copied", "Paste it in Venmo/PayPal/Zelle.");
                } catch {
                  toast("Copy didn't work", "Your browser may block clipboard access.");
                }
              },
            },
            "Copy",
          ),
        ),
      ),
    );

    openModal("Settle (optional)", content, [{ label: "Close", kind: "primary", onClick: () => closeModal() }]);
  }

  function openSettleLink(kind, amount, note) {
    if (!amount || amount <= 0) return toast("No settlement needed", "Looks even.");
    let url = null;
    if (kind === "venmo") {
      url = `https://venmo.com/?txn=pay&audience=friends&amount=${encodeURIComponent(amount.toFixed(2))}&note=${encodeURIComponent(note)}`;
    } else if (kind === "paypal") {
      url = `https://www.paypal.com/paypalme/`;
    } else if (kind === "zelle") {
      url = `https://www.zellepay.com/`;
    }
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
    toast("Opened settlement", "Totally optional.");
  }

  function openPaymentApp(kind) {
    let url = null;
    if (kind === "venmo") url = "https://venmo.com/";
    else if (kind === "paypal") url = "https://www.paypal.com/";
    else if (kind === "zelle") url = "https://www.zellepay.com/";
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
    toast("Opened", "Use any method you like.");
  }

  function openModal(title, bodyEl, actions) {
    elModalHost.innerHTML = "";
    elModalHost.setAttribute("data-open", "true");
    elModalHost.setAttribute("aria-hidden", "false");

    const backdrop = h("div", { class: "modalBackdrop", onClick: () => closeModal() });
    const head = h(
      "div",
      { class: "modalHead" },
      h("div", null, h("div", { class: "modalTitle" }, title), h("div", { class: "panelSub" }, "Friendly, not transactional.")),
      h("button", { class: "iconBtn", type: "button", onClick: () => closeModal(), "aria-label": "Close" }, h("span", { class: "icon" }, "✕")),
    );

    const actionRow = h(
      "div",
      { class: "modalActions" },
      ...(actions || []).map((a) => {
        const cls = a.kind === "primary" ? "btn primary" : a.kind === "ghost" ? "btn ghost" : "btn";
        return h("button", { class: cls, type: "button", onClick: a.onClick }, a.label);
      }),
    );

    const modal = h("div", { class: "modal", role: "dialog", "aria-modal": "true" }, head, bodyEl, actionRow);
    elModalHost.append(backdrop, modal);

    document.addEventListener("keydown", onEscClose, { once: true });
    function onEscClose(e) {
      if (e.key === "Escape") closeModal();
      else document.addEventListener("keydown", onEscClose, { once: true });
    }

    const first = modal.querySelector("input,select,textarea,button");
    if (first) setTimeout(() => first.focus(), 40);
  }

  function closeModal() {
    elModalHost.setAttribute("data-open", "false");
    elModalHost.setAttribute("aria-hidden", "true");
    // Allow exit transition.
    setTimeout(() => (elModalHost.innerHTML = ""), 180);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  }

  function pickTotalFromOcrText(text) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const needles = ["total", "amount due", "balance due", "grand total"];
    const candidates = [];
    for (const line of lines) {
      const lower = line.toLowerCase();
      const hasNeedle = needles.some((n) => lower.includes(n));
      if (!hasNeedle) continue;
      const match = line.match(/(\d+[.,]\d{2})/);
      if (match) candidates.push(match[1]);
    }
    const last = candidates[candidates.length - 1];
    const cents = parseMoneyToCents(last || "");
    return cents && cents > 0 ? cents : null;
  }

  async function ensureTesseract() {
    if (window.Tesseract) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://unpkg.com/tesseract.js@5.0.4/dist/tesseract.min.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load tesseract"));
      document.head.appendChild(s);
    });
  }

  // Events
  for (const el of elTabs) {
    el.addEventListener("click", () => setTab(el.getAttribute("data-tab")));
  }

  elQuickAddBtn?.addEventListener("click", () => openQuickAddModal());

  elThemeBtn.addEventListener("click", () => {
    const next = state.theme === "system" ? "light" : state.theme === "light" ? "dark" : "system";
    setTheme(next);
  });

  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener?.("change", () => {
      if (state.theme === "system") applyTheme();
    });
  }

  // Initial render
  applyTheme();
  render();

  // If cloud sync is configured, pull once on boot and then poll occasionally (simple, works everywhere).
  if (isCloudEnabled()) {
    cloudPullNow();
    setInterval(() => {
      if (state.sync.autoSync && isCloudEnabled()) cloudPullNow();
    }, 8000);
  }

  // PWA: best-effort service worker registration (works on https/localhost).
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {
        // Non-fatal in dev.
      });
    });
  }

  // Expose for quick debugging in console.
  window.__chillsplit = { get state() { return state; } };
})();
