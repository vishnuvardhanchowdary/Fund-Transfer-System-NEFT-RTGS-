const app = document.querySelector("#app");
const toastRoot = document.querySelector("#toast-root");

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
  { id: "transfer", label: "Transfer", icon: "send" },
  { id: "beneficiaries", label: "Beneficiaries", icon: "users" },
  { id: "tracker", label: "Status Tracker", icon: "route" },
  { id: "history", label: "History", icon: "receipt" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "admin", label: "Admin Panel", icon: "shield" }
];

const statusTone = {
  Settled: "success",
  Processing: "info",
  "Bank Processing": "info",
  "OTP Pending": "warning",
  Rejected: "danger",
  Failed: "danger",
  Active: "success",
  Pending: "warning"
};

const state = {
  activeTab: localStorage.getItem("activeTab") || "dashboard",
  dashboard: null,
  search: "",
  transactionSearch: "",
  selectedTrackerId: localStorage.getItem("lastTransactionId") || "",
  otpSession: null,
  busy: false
};

const transferDraftDefaults = {
  beneficiaryId: "",
  method: "IMPS",
  amount: "",
  remarks: ""
};

let transferDraft = {
  ...transferDraftDefaults,
  ...safeJson(localStorage.getItem("transferDraft"), {})
};

let renderTimer = null;

function safeJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function icon(name) {
  const paths = {
    "layout-dashboard":
      '<path d="M3 13h8V3H3v10Z"/><path d="M13 21h8V11h-8v10Z"/><path d="M13 3v6h8V3h-8Z"/><path d="M3 21h8v-6H3v6Z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>',
    users:
      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    route:
      '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M6 16V8a3 3 0 0 1 3-3h6"/><path d="M18 8v8a3 3 0 0 1-3 3H9"/>',
    receipt:
      '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2-3-2Z"/><path d="M8 12h8"/><path d="M8 8h8"/><path d="M8 16h5"/>',
    bell:
      '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    shield:
      '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z"/><path d="m9 12 2 2 4-5"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    print: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><rect x="2" y="2" width="13" height="13" rx="2"/>'
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.check}</svg>`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function money(value) {
  return `INR ${Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2
  })}`;
}

function dateTime(value) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  toastRoot.appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

function setTab(tab) {
  state.activeTab = tab;
  localStorage.setItem("activeTab", tab);
  render();
}

async function loadDashboard(silent = false) {
  try {
    state.dashboard = await api("/api/dashboard");
    if (!state.selectedTrackerId && state.dashboard.transactions[0]) {
      state.selectedTrackerId = state.dashboard.transactions[0].id;
    }
    render();
  } catch (error) {
    if (!silent) toast(error.message);
  }
}

function saveDraft() {
  localStorage.setItem("transferDraft", JSON.stringify(transferDraft));
}

function appLayout(content) {
  const active = navItems.find(item => item.id === state.activeTab) || navItems[0];
  return `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">NB</div>
          <div class="brand-text">
            <strong>Nova Bank</strong>
            <span>Secure Transfer Desk</span>
          </div>
        </div>
        <nav class="nav">
          ${navItems
            .map(
              item => `
                <button class="${item.id === state.activeTab ? "active" : ""}" data-tab="${item.id}">
                  ${icon(item.icon)}
                  <span>${item.label}</span>
                </button>
              `
            )
            .join("")}
        </nav>
        <div class="sidebar-footer">
          NEFT, RTGS, IMPS<br />
          Mock OTP and REST API enabled
        </div>
      </aside>
      <main class="workspace">
        <div class="mobile-nav">
          <select data-mobile-tab aria-label="Section">
            ${navItems.map(item => `<option value="${item.id}" ${item.id === state.activeTab ? "selected" : ""}>${item.label}</option>`).join("")}
          </select>
        </div>
        <div class="topbar">
          <div>
            <p class="eyebrow">Problem 250</p>
            <h1>${active.label}</h1>
            <p class="subtle">Fund Transfer System for NEFT, RTGS, and IMPS</p>
          </div>
          <div class="top-actions">
            <label class="search-field">
              ${icon("search")}
              <input data-global-search placeholder="Search transactions, beneficiaries, UTR" value="${escapeHtml(state.search)}" />
            </label>
            <button class="btn" data-refresh>${icon("refresh")} Refresh</button>
          </div>
        </div>
        ${content}
      </main>
    </div>
    ${state.otpSession ? renderOtpDialog() : ""}
  `;
}

function render() {
  if (!state.dashboard) {
    app.innerHTML = `
      <div class="boot-screen">
        <div class="brand-mark">NB</div>
        <p>Loading secure transfer desk...</p>
      </div>
    `;
    return;
  }

  const views = {
    dashboard: renderDashboard,
    transfer: renderTransfer,
    beneficiaries: renderBeneficiaries,
    tracker: renderTracker,
    history: renderHistory,
    notifications: renderNotifications,
    admin: renderAdmin
  };

  app.innerHTML = appLayout((views[state.activeTab] || renderDashboard)());
  bindEvents();
}

function scheduleRender(focusSelector, cursorPosition) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    render();
    if (!focusSelector) return;
    const target = document.querySelector(focusSelector);
    if (!target) return;
    target.focus();
    if (typeof cursorPosition === "number" && typeof target.setSelectionRange === "function") {
      const cursor = Math.min(cursorPosition, target.value.length);
      target.setSelectionRange(cursor, cursor);
    }
  }, 140);
}

function renderDashboard() {
  const { account, transactions, beneficiaries, unreadCount } = state.dashboard;
  const settled = transactions.filter(tx => tx.status === "Settled");
  const pending = transactions.filter(tx => ["OTP Pending", "Processing", "Bank Processing"].includes(tx.status));
  const totalSent = settled.reduce((sum, tx) => sum + Number(tx.amount), 0);
  return `
    <section class="account-strip">
      <div class="account-card">
        <div class="row">
          <div>
            <div class="minor">Primary savings account</div>
            <strong>${escapeHtml(account.name)}</strong>
          </div>
          <div class="minor">${escapeHtml(account.branch)}</div>
        </div>
        <div class="number">${maskAccount(account.accountNumber)}</div>
        <div class="row">
          <div>
            <div class="minor">Available balance</div>
            <strong>${money(account.balance)}</strong>
          </div>
          <div>
            <div class="minor">IFSC</div>
            <strong>${escapeHtml(account.ifsc)}</strong>
          </div>
        </div>
      </div>
      <div class="grid two quick-status">
        ${metric("Beneficiaries", beneficiaries.length, "Active payees saved")}
        ${metric("Unread alerts", unreadCount, "Notifications center")}
      </div>
    </section>
    <section class="grid four">
      ${metric("Settled value", money(totalSent), `${settled.length} completed transfers`)}
      ${metric("Pending transfers", pending.length, "OTP or bank processing")}
      ${metric("Total transfers", transactions.length, "All modes combined")}
      ${metric("Last transaction", transactions[0]?.id || "None", transactions[0]?.status || "No transfer yet")}
    </section>
    <section class="grid two" style="margin-top:16px">
      <div class="panel">
        <div class="panel-header">
          <h2>Transfer Limits</h2>
          <button class="btn" data-tab="transfer">${icon("send")} New Transfer</button>
        </div>
        <div class="panel-body grid three">
          ${renderLimitCards()}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <h2>Recent Activity</h2>
          <button class="btn" data-tab="history">${icon("receipt")} History</button>
        </div>
        <div class="panel-body">
          ${renderRecentTransactions(transactions.slice(0, 5))}
        </div>
      </div>
    </section>
  `;
}

function metric(label, value, hint) {
  return `
    <div class="panel metric">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(String(value))}</div>
      <div class="trend">${icon("check")} ${escapeHtml(hint)}</div>
    </div>
  `;
}

function renderLimitCards() {
  return Object.entries(state.dashboard.limits)
    .map(([method, limit]) => {
      const usedPercent = Math.min(100, (Number(limit.usedToday) / Number(limit.daily || 1)) * 100);
      return `
        <article class="limit-card panel">
          <div class="limit-top">
            <div>
              <div class="limit-name">${method}</div>
              <div class="subtle">${escapeHtml(limit.window)}</div>
            </div>
            <span class="method-chip">${money(limit.fee)} fee</span>
          </div>
          <div class="bar" aria-label="${method} used today">
            <span style="width:${usedPercent}%"></span>
          </div>
          <div class="limit-meta">
            <span>Available<strong>${money(limit.availableToday)}</strong></span>
            <span>Per transfer<strong>${money(limit.perTransaction)}</strong></span>
            <span>Used today<strong>${money(limit.usedToday)}</strong></span>
            <span>Daily cap<strong>${money(limit.daily)}</strong></span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderRecentTransactions(transactions) {
  if (!transactions.length) return `<div class="empty">No transactions yet.</div>`;
  return `
    <div class="beneficiary-list">
      ${transactions
        .map(
          tx => `
            <article class="beneficiary-card">
              <div>
                <div class="beneficiary-name">${escapeHtml(tx.beneficiaryName)}</div>
                <div class="beneficiary-meta">${tx.id} | ${tx.method} | ${dateTime(tx.createdAt)}</div>
              </div>
              <div>
                <strong>${money(tx.amount)}</strong><br />
                ${status(tx.status)}
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderTransfer() {
  const fee = currentTransferFee();
  const total = Number(transferDraft.amount || 0) + fee;
  return `
    <section class="grid two">
      <div class="panel">
        <div class="panel-header">
          <h2>Transfer Form</h2>
          <span class="status-chip info">OTP secured</span>
        </div>
        <div class="panel-body">
          <form class="form-grid" data-transfer-form>
            <label class="field">
              <span>Beneficiary</span>
              <select name="beneficiaryId" required>
                <option value="">Select beneficiary</option>
                ${state.dashboard.beneficiaries
                  .map(
                    ben => `<option value="${ben.id}" ${ben.id === transferDraft.beneficiaryId ? "selected" : ""}>${escapeHtml(ben.nickname)} - ${escapeHtml(ben.bank)}</option>`
                  )
                  .join("")}
              </select>
            </label>
            <label class="field">
              <span>Transfer mode</span>
              <select name="method" required>
                ${["IMPS", "NEFT", "RTGS"]
                  .map(method => `<option value="${method}" ${method === transferDraft.method ? "selected" : ""}>${method}</option>`)
                  .join("")}
              </select>
            </label>
            <label class="field">
              <span>Amount</span>
              <input name="amount" type="number" min="1" step="1" placeholder="50000" value="${escapeHtml(transferDraft.amount)}" required />
            </label>
            <label class="field">
              <span>Remarks</span>
              <input name="remarks" maxlength="80" placeholder="Invoice, rent, family support" value="${escapeHtml(transferDraft.remarks)}" />
            </label>
            <div class="field full">
              <div class="summary-box">
                <div class="summary-row"><span>Transfer amount</span><strong>${money(transferDraft.amount || 0)}</strong></div>
                <div class="summary-row"><span>Bank fee</span><strong>${money(fee)}</strong></div>
                <div class="summary-row"><span>Total debit</span><strong>${money(total)}</strong></div>
                <div class="summary-row"><span>Available limit</span><strong>${money(currentLimit()?.availableToday || 0)}</strong></div>
              </div>
            </div>
            <div class="field full actions">
              <button class="btn primary" type="submit" ${state.busy ? "disabled" : ""}>${icon("send")} Initiate Transfer</button>
              <button class="btn" type="button" data-clear-draft>${icon("x")} Clear</button>
              <button class="btn" type="button" data-tab="beneficiaries">${icon("plus")} Beneficiary</button>
            </div>
          </form>
        </div>
      </div>
      <div class="grid">
        <div class="panel">
          <div class="panel-header"><h2>Limit Display</h2></div>
          <div class="panel-body grid">
            ${renderLimitCards()}
          </div>
        </div>
      </div>
    </section>
  `;
}

function currentLimit() {
  return state.dashboard.limits[transferDraft.method] || state.dashboard.limits.IMPS;
}

function currentTransferFee() {
  return Number(currentLimit()?.fee || 0);
}

function renderOtpDialog() {
  const { transaction, otp } = state.otpSession;
  return `
    <div class="otp-overlay" role="dialog" aria-modal="true" aria-labelledby="otp-title">
      <div class="otp-dialog">
        <h2 id="otp-title">OTP Verification</h2>
        <p class="subtle">${transaction.id} | ${transaction.method} | ${money(transaction.amount)} to ${escapeHtml(transaction.beneficiaryName)}</p>
        <div class="otp-code">
          <span>Mock OTP</span>
          <strong>${escapeHtml(otp)}</strong>
          <button class="btn icon-only" data-copy-otp title="Copy OTP">${icon("copy")}</button>
        </div>
        <form class="form-grid" data-otp-form>
          <label class="field full">
            <span>Enter OTP</span>
            <input name="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required />
          </label>
          <div class="field full actions">
            <button class="btn primary" type="submit">${icon("check")} Verify</button>
            <button class="btn" type="button" data-close-otp>${icon("x")} Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderBeneficiaries() {
  const items = filteredBeneficiaries();
  return `
    <section class="grid two">
      <div class="panel">
        <div class="panel-header">
          <h2>Beneficiary Add</h2>
          <span class="status-chip success">Active validation</span>
        </div>
        <div class="panel-body">
          <form class="form-grid" data-beneficiary-form>
            <label class="field">
              <span>Full name</span>
              <input name="name" placeholder="Riya Kapoor" required />
            </label>
            <label class="field">
              <span>Nickname</span>
              <input name="nickname" placeholder="Riya Home" required />
            </label>
            <label class="field">
              <span>Bank</span>
              <input name="bank" placeholder="Axis Bank" required />
            </label>
            <label class="field">
              <span>Account number</span>
              <input name="accountNumber" inputmode="numeric" placeholder="910020003333" required />
            </label>
            <label class="field">
              <span>IFSC</span>
              <input name="ifsc" placeholder="UTIB0001234" required />
            </label>
            <label class="field">
              <span>Account type</span>
              <select name="type">
                <option>Savings</option>
                <option>Current</option>
                <option>Salary</option>
              </select>
            </label>
            <div class="field full actions">
              <button class="btn primary" type="submit">${icon("plus")} Add Beneficiary</button>
            </div>
          </form>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <h2>Saved Beneficiaries</h2>
          <span class="status-chip info">${items.length} visible</span>
        </div>
        <div class="panel-body">
          ${
            items.length
              ? `<div class="beneficiary-list">${items.map(renderBeneficiaryCard).join("")}</div>`
              : `<div class="empty">No beneficiaries match the search.</div>`
          }
        </div>
      </div>
    </section>
  `;
}

function renderBeneficiaryCard(ben) {
  return `
    <article class="beneficiary-card">
      <div>
        <div class="beneficiary-name">${escapeHtml(ben.nickname)} <span class="subtle">(${escapeHtml(ben.name)})</span></div>
        <div class="beneficiary-meta">${escapeHtml(ben.bank)} | ${escapeHtml(ben.accountNumber)} | ${escapeHtml(ben.ifsc)}</div>
      </div>
      <div class="actions">
        ${status(ben.status)}
        <button class="btn icon-only danger" data-delete-beneficiary="${ben.id}" title="Delete beneficiary">${icon("trash")}</button>
      </div>
    </article>
  `;
}

function renderTracker() {
  const selected =
    state.dashboard.transactions.find(tx => tx.id === state.selectedTrackerId) ||
    state.dashboard.transactions[0];
  return `
    <section class="grid two">
      <div class="panel">
        <div class="panel-header">
          <h2>Status Tracker</h2>
          <button class="btn" data-refresh-transaction>${icon("refresh")} Update</button>
        </div>
        <div class="panel-body">
          <label class="field">
            <span>Transaction ID</span>
            <select data-tracker-select>
              ${state.dashboard.transactions
                .map(tx => `<option value="${tx.id}" ${selected?.id === tx.id ? "selected" : ""}>${tx.id} - ${tx.beneficiaryName}</option>`)
                .join("")}
            </select>
          </label>
          <div style="height:14px"></div>
          ${selected ? renderTrackerCard(selected) : `<div class="empty">No transfer available for tracking.</div>`}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><h2>Receipt PDF</h2></div>
        <div class="panel-body">
          ${
            selected
              ? `
                <div class="summary-box">
                  <div class="summary-row"><span>Transaction</span><strong>${selected.id}</strong></div>
                  <div class="summary-row"><span>Status</span><strong>${selected.status}</strong></div>
                  <div class="summary-row"><span>UTR</span><strong>${selected.utr || "Pending"}</strong></div>
                  <div class="summary-row"><span>Total debit</span><strong>${money(selected.printableTotal)}</strong></div>
                </div>
                <div class="actions" style="margin-top:14px">
                  <a class="btn primary" href="/api/transactions/${selected.id}/receipt.pdf" target="_blank" rel="noreferrer">${icon("download")} Download PDF</a>
                  <button class="btn" data-print>${icon("print")} Print</button>
                </div>
              `
              : `<div class="empty">Create a transfer to generate a receipt.</div>`
          }
        </div>
      </div>
    </section>
  `;
}

function renderTrackerCard(tx) {
  return `
    <article class="tracker-card">
      <div class="summary-row">
        <span>${escapeHtml(tx.beneficiaryName)} | ${tx.method}</span>
        ${status(tx.status)}
      </div>
      <div class="summary-row"><span>Amount</span><strong>${money(tx.amount)}</strong></div>
      <div class="summary-row"><span>UTR</span><strong>${tx.utr || "Pending"}</strong></div>
      <div class="timeline">
        ${tx.timeline
          .map(
            item => `
              <div class="timeline-item">
                <div class="timeline-dot"></div>
                <div class="timeline-copy">
                  <strong>${escapeHtml(item.label)}</strong>
                  <span>${dateTime(item.time)}</span>
                </div>
              </div>
            `
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderHistory() {
  const rows = filteredTransactions();
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>Transaction History</h2>
        <div class="actions">
          <label class="search-field">
            ${icon("search")}
            <input data-transaction-search placeholder="Filter history" value="${escapeHtml(state.transactionSearch)}" />
          </label>
          <a class="btn" href="/api/transactions.csv">${icon("download")} CSV</a>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Transaction</th>
              <th>Beneficiary</th>
              <th>Mode</th>
              <th>Amount</th>
              <th>Status</th>
              <th>UTR</th>
              <th>Receipt</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows
                    .map(
                      tx => `
                        <tr>
                          <td><strong>${tx.id}</strong><br /><span class="subtle">${dateTime(tx.createdAt)}</span></td>
                          <td>${escapeHtml(tx.beneficiaryName)}<br /><span class="subtle">${escapeHtml(tx.remarks || "No remarks")}</span></td>
                          <td><span class="method-chip">${tx.method}</span></td>
                          <td><strong>${money(tx.amount)}</strong><br /><span class="subtle">Fee ${money(tx.fee)}</span></td>
                          <td>${status(tx.status)}</td>
                          <td>${escapeHtml(tx.utr || "Pending")}</td>
                          <td><a class="btn icon-only" href="/api/transactions/${tx.id}/receipt.pdf" title="Download PDF">${icon("download")}</a></td>
                        </tr>
                      `
                    )
                    .join("")
                : `<tr><td colspan="7"><div class="empty">No matching transaction found.</div></td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderNotifications() {
  const notes = state.dashboard.notifications;
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>Notifications</h2>
        <button class="btn" data-read-all>${icon("check")} Mark Read</button>
      </div>
      <div class="panel-body">
        <div class="notification-list">
          ${notes.map(renderNotification).join("") || `<div class="empty">No notifications.</div>`}
        </div>
      </div>
    </section>
  `;
}

function renderNotification(note) {
  return `
    <article class="notification ${note.type} ${note.read ? "" : "unread"}">
      <div class="note-pin"></div>
      <div>
        <strong>${escapeHtml(note.title)}</strong>
        <p class="subtle" style="margin:4px 0 6px">${escapeHtml(note.message)}</p>
        <span>${dateTime(note.createdAt)}</span>
      </div>
    </article>
  `;
}

function renderAdmin() {
  return `
    <section class="grid two">
      <div class="panel">
        <div class="panel-header"><h2>Admin Limit Controls</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-limit-form>
            <label class="field">
              <span>Mode</span>
              <select name="method">
                ${Object.keys(state.dashboard.limits).map(method => `<option>${method}</option>`).join("")}
              </select>
            </label>
            <label class="field">
              <span>Per transaction</span>
              <input name="perTransaction" type="number" min="1" placeholder="200000" />
            </label>
            <label class="field">
              <span>Daily limit</span>
              <input name="daily" type="number" min="1" placeholder="500000" />
            </label>
            <label class="field">
              <span>Fee</span>
              <input name="fee" type="number" min="0" step="0.5" placeholder="5" />
            </label>
            <div class="field full actions">
              <button class="btn primary" type="submit">${icon("shield")} Update Limits</button>
            </div>
          </form>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><h2>Transaction Control</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-status-form>
            <label class="field">
              <span>Transaction</span>
              <select name="transactionId">
                ${state.dashboard.transactions.map(tx => `<option value="${tx.id}">${tx.id} - ${tx.status}</option>`).join("")}
              </select>
            </label>
            <label class="field">
              <span>Status</span>
              <select name="status">
                <option>Processing</option>
                <option>Bank Processing</option>
                <option>Settled</option>
                <option>Rejected</option>
                <option>Failed</option>
              </select>
            </label>
            <div class="field full actions">
              <button class="btn primary" type="submit">${icon("check")} Apply Status</button>
            </div>
          </form>
        </div>
      </div>
      <div class="panel" style="grid-column:1/-1">
        <div class="panel-header"><h2>Audit Log</h2></div>
        <div class="panel-body">
          <div class="audit-list">
            ${state.dashboard.auditLogs
              .map(
                item => `
                  <article class="audit-item">
                    <strong>${escapeHtml(item.action)}</strong>
                    <span>${escapeHtml(item.actor)} | ${dateTime(item.createdAt)}</span>
                  </article>
                `
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function status(value) {
  const tone = statusTone[value] || "info";
  return `<span class="status-chip ${tone}">${escapeHtml(value)}</span>`;
}

function filteredBeneficiaries() {
  const query = state.search.toLowerCase();
  if (!query) return state.dashboard.beneficiaries;
  return state.dashboard.beneficiaries.filter(ben =>
    [ben.name, ben.nickname, ben.bank, ben.accountNumber, ben.ifsc].some(value =>
      String(value).toLowerCase().includes(query)
    )
  );
}

function filteredTransactions() {
  const query = (state.transactionSearch || state.search).toLowerCase();
  if (!query) return state.dashboard.transactions;
  return state.dashboard.transactions.filter(tx =>
    [tx.id, tx.beneficiaryName, tx.method, tx.status, tx.utr, tx.remarks].some(value =>
      String(value || "").toLowerCase().includes(query)
    )
  );
}

function maskAccount(value) {
  const text = String(value || "");
  return `${text.slice(0, 4)} ${text.slice(4, 8)} ${text.slice(8, 10)}XX`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach(button => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });

  document.querySelector("[data-mobile-tab]")?.addEventListener("change", event => {
    setTab(event.target.value);
  });

  document.querySelector("[data-refresh]")?.addEventListener("click", () => loadDashboard());

  document.querySelector("[data-global-search]")?.addEventListener("input", event => {
    state.search = event.target.value;
    scheduleRender("[data-global-search]", event.target.selectionStart);
  });

  document.querySelector("[data-transaction-search]")?.addEventListener("input", event => {
    state.transactionSearch = event.target.value;
    scheduleRender("[data-transaction-search]", event.target.selectionStart);
  });

  const transferForm = document.querySelector("[data-transfer-form]");
  transferForm?.addEventListener("input", () => {
    const active = document.activeElement;
    transferDraft = { ...transferDraft, ...formData(transferForm) };
    saveDraft();
    scheduleRender(`[data-transfer-form] [name="${active?.name || "amount"}"]`, active?.selectionStart);
  });
  transferForm?.addEventListener("submit", handleTransfer);

  document.querySelector("[data-clear-draft]")?.addEventListener("click", () => {
    transferDraft = { ...transferDraftDefaults };
    saveDraft();
    render();
  });

  document.querySelector("[data-beneficiary-form]")?.addEventListener("submit", handleBeneficiary);

  document.querySelectorAll("[data-delete-beneficiary]").forEach(button => {
    button.addEventListener("click", () => deleteBeneficiary(button.dataset.deleteBeneficiary));
  });

  document.querySelector("[data-otp-form]")?.addEventListener("submit", handleOtp);
  document.querySelector("[data-close-otp]")?.addEventListener("click", () => {
    state.otpSession = null;
    render();
  });
  document.querySelector("[data-copy-otp]")?.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(state.otpSession.otp);
    toast("OTP copied");
  });

  document.querySelector("[data-tracker-select]")?.addEventListener("change", event => {
    state.selectedTrackerId = event.target.value;
    localStorage.setItem("lastTransactionId", state.selectedTrackerId);
    render();
  });

  document.querySelector("[data-refresh-transaction]")?.addEventListener("click", refreshTrackedTransaction);
  document.querySelector("[data-print]")?.addEventListener("click", () => window.print());
  document.querySelector("[data-read-all]")?.addEventListener("click", markRead);
  document.querySelector("[data-limit-form]")?.addEventListener("submit", handleLimitUpdate);
  document.querySelector("[data-status-form]")?.addEventListener("submit", handleStatusUpdate);
}

async function handleTransfer(event) {
  event.preventDefault();
  state.busy = true;
  render();
  try {
    const payload = formData(event.target);
    const result = await api("/api/transfers/initiate", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.otpSession = result;
    state.selectedTrackerId = result.transaction.id;
    localStorage.setItem("lastTransactionId", result.transaction.id);
    await loadDashboard(true);
    render();
    toast("Mock OTP generated");
  } catch (error) {
    toast(error.message);
  } finally {
    state.busy = false;
    render();
  }
}

async function handleOtp(event) {
  event.preventDefault();
  try {
    const { otp } = formData(event.target);
    const txId = state.otpSession.transaction.id;
    await api(`/api/transfers/${txId}/verify-otp`, {
      method: "POST",
      body: JSON.stringify({ otp })
    });
    state.otpSession = null;
    transferDraft = { ...transferDraftDefaults };
    saveDraft();
    await loadDashboard(true);
    state.activeTab = "tracker";
    localStorage.setItem("activeTab", "tracker");
    render();
    toast("Transfer moved to processing");
  } catch (error) {
    toast(error.message);
  }
}

async function handleBeneficiary(event) {
  event.preventDefault();
  try {
    await api("/api/beneficiaries", {
      method: "POST",
      body: JSON.stringify(formData(event.target))
    });
    event.target.reset();
    await loadDashboard(true);
    toast("Beneficiary added");
  } catch (error) {
    toast(error.message);
  }
}

async function deleteBeneficiary(id) {
  try {
    await api(`/api/beneficiaries/${id}`, { method: "DELETE" });
    await loadDashboard(true);
    toast("Beneficiary deleted");
  } catch (error) {
    toast(error.message);
  }
}

async function refreshTrackedTransaction() {
  if (!state.selectedTrackerId) return;
  try {
    await api(`/api/transactions/${state.selectedTrackerId}`);
    await loadDashboard(true);
    toast("Transaction updated");
  } catch (error) {
    toast(error.message);
  }
}

async function markRead() {
  try {
    await api("/api/notifications/read-all", { method: "PATCH" });
    await loadDashboard(true);
    toast("Notifications marked read");
  } catch (error) {
    toast(error.message);
  }
}

async function handleLimitUpdate(event) {
  event.preventDefault();
  const payload = formData(event.target);
  const method = payload.method;
  delete payload.method;
  Object.keys(payload).forEach(key => {
    if (payload[key] === "") delete payload[key];
  });
  try {
    await api(`/api/limits/${method}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    event.target.reset();
    await loadDashboard(true);
    toast("Limits updated");
  } catch (error) {
    toast(error.message);
  }
}

async function handleStatusUpdate(event) {
  event.preventDefault();
  const payload = formData(event.target);
  try {
    await api(`/api/transactions/${payload.transactionId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: payload.status })
    });
    state.selectedTrackerId = payload.transactionId;
    await loadDashboard(true);
    toast("Transaction status updated");
  } catch (error) {
    toast(error.message);
  }
}

loadDashboard();
