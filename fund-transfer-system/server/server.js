const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const STORE_PATH = path.join(ROOT_DIR, "data", "store.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8"
};

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}

function transactionId() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(2, 14);
  return `TXN${stamp}${Math.floor(100 + Math.random() * 900)}`;
}

function readStore() {
  return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
}

function writeStore(store) {
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, payload, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(payload);
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function parseUrl(req) {
  return new URL(req.url, `http://${req.headers.host || "localhost"}`);
}

function amountUsedToday(store, method) {
  const today = new Date().toISOString().slice(0, 10);
  return store.transactions
    .filter(tx => tx.method === method && tx.createdAt.slice(0, 10) === today)
    .filter(tx => !["Rejected", "Failed", "Cancelled"].includes(tx.status))
    .reduce((sum, tx) => sum + Number(tx.amount), 0);
}

function enrichedLimits(store) {
  return Object.fromEntries(
    Object.entries(store.limits).map(([method, limit]) => {
      const usedToday = amountUsedToday(store, method);
      return [
        method,
        {
          ...limit,
          usedToday,
          availableToday: Math.max(0, Number(limit.daily) - usedToday)
        }
      ];
    })
  );
}

function addNotification(store, type, title, message) {
  const note = {
    id: randomId("note"),
    type,
    title,
    message,
    read: false,
    createdAt: nowIso()
  };
  store.notifications.unshift(note);
  return note;
}

function addAudit(store, actor, action) {
  store.auditLogs.unshift({
    id: randomId("audit"),
    actor,
    action,
    createdAt: nowIso()
  });
}

function publicTransaction(tx) {
  return {
    ...tx,
    printableTotal: Number(tx.amount) + Number(tx.fee || 0)
  };
}

function validateBeneficiary(input) {
  const required = ["name", "nickname", "bank", "accountNumber", "ifsc", "type"];
  const missing = required.filter(key => !String(input[key] || "").trim());
  if (missing.length) return `Missing required fields: ${missing.join(", ")}`;
  if (!/^[0-9]{8,18}$/.test(String(input.accountNumber))) {
    return "Account number must contain 8 to 18 digits.";
  }
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(input.ifsc).toUpperCase())) {
    return "IFSC must follow the format ABCD0123456.";
  }
  return null;
}

function validateTransfer(store, input) {
  const method = String(input.method || "").toUpperCase();
  const amount = Number(input.amount);
  const beneficiary = store.beneficiaries.find(item => item.id === input.beneficiaryId);
  const limits = enrichedLimits(store)[method];

  if (!beneficiary) return "Select a valid beneficiary.";
  if (beneficiary.status !== "Active") return "Beneficiary must be active before transfer.";
  if (!limits) return "Select NEFT, RTGS, or IMPS.";
  if (!Number.isFinite(amount) || amount <= 0) return "Enter a valid transfer amount.";
  if (amount > limits.perTransaction) {
    return `${method} per-transaction limit is INR ${limits.perTransaction.toLocaleString("en-IN")}.`;
  }
  if (amount > limits.availableToday) {
    return `${method} daily available limit is INR ${limits.availableToday.toLocaleString("en-IN")}.`;
  }
  if (method === "RTGS" && amount < 200000) {
    return "RTGS requires a minimum transfer amount of INR 2,00,000.";
  }
  const account = store.accounts[0];
  if (amount + Number(limits.fee) > account.balance) {
    return "Insufficient account balance including transfer fee.";
  }
  return null;
}

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function buildTransactionsCsv(transactions) {
  const headers = [
    "Transaction ID",
    "Beneficiary",
    "Method",
    "Amount",
    "Fee",
    "Status",
    "UTR",
    "Remarks",
    "Created At"
  ];
  const rows = transactions.map(tx => [
    tx.id,
    tx.beneficiaryName,
    tx.method,
    tx.amount,
    tx.fee,
    tx.status,
    tx.utr || "",
    tx.remarks,
    tx.createdAt
  ]);
  return [headers, ...rows].map(row => row.map(csvEscape).join(",")).join("\n");
}

function pdfEscape(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function createReceiptPdf(tx, account, beneficiary) {
  const lines = [
    "Nova Bank Fund Transfer Receipt",
    `Transaction ID: ${tx.id}`,
    `UTR: ${tx.utr || "Pending"}`,
    `Status: ${tx.status}`,
    `Transfer Mode: ${tx.method}`,
    `Amount: INR ${Number(tx.amount).toLocaleString("en-IN")}`,
    `Fee: INR ${Number(tx.fee || 0).toLocaleString("en-IN")}`,
    `Total Debit: INR ${(Number(tx.amount) + Number(tx.fee || 0)).toLocaleString("en-IN")}`,
    `From: ${account.name} - ${account.accountNumber}`,
    `To: ${tx.beneficiaryName} - ${beneficiary?.accountNumber || "Saved beneficiary"}`,
    `IFSC: ${beneficiary?.ifsc || "N/A"}`,
    `Remarks: ${tx.remarks || "N/A"}`,
    `Created: ${new Date(tx.createdAt).toLocaleString("en-IN")}`
  ];
  const text = lines
    .map((line, index) => `BT /F1 ${index === 0 ? 18 : 11} Tf 54 ${770 - index * 34} Td (${pdfEscape(line)}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function progressTransaction(store, tx) {
  const timestamp = nowIso();
  if (tx.status === "OTP Pending") return tx;
  const ageMs = Date.now() - new Date(tx.updatedAt).getTime();
  if (tx.status === "Processing" && ageMs > 15_000) {
    tx.status = tx.method === "IMPS" ? "Settled" : "Bank Processing";
    tx.updatedAt = timestamp;
    tx.timeline.push({ label: tx.status, time: timestamp });
  } else if (tx.status === "Bank Processing" && ageMs > 30_000) {
    tx.status = "Settled";
    tx.updatedAt = timestamp;
    tx.timeline.push({ label: "Settled", time: timestamp });
    addNotification(store, "success", "Transfer settled", `${tx.method} ${tx.id} was settled successfully.`);
  }
  return tx;
}

function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return true;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

async function handleApi(req, res, url) {
  const method = req.method || "GET";
  const parts = url.pathname.split("/").filter(Boolean);
  const store = readStore();

  try {
    if (method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true, service: "Fund Transfer System", time: nowIso() });
      return;
    }

    if (method === "GET" && url.pathname === "/api/dashboard") {
      const limits = enrichedLimits(store);
      const unreadCount = store.notifications.filter(note => !note.read).length;
      sendJson(res, 200, {
        account: store.accounts[0],
        limits,
        beneficiaries: store.beneficiaries,
        transactions: store.transactions.map(publicTransaction),
        notifications: store.notifications,
        unreadCount,
        auditLogs: store.auditLogs
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/limits") {
      sendJson(res, 200, enrichedLimits(store));
      return;
    }

    if (method === "PATCH" && url.pathname.startsWith("/api/limits/")) {
      const transferMethod = parts[2]?.toUpperCase();
      const body = await parseBody(req);
      if (!store.limits[transferMethod]) {
        sendJson(res, 404, { error: "Unknown transfer method" });
        return;
      }
      ["perTransaction", "daily", "fee"].forEach(key => {
        if (body[key] !== undefined && Number.isFinite(Number(body[key]))) {
          store.limits[transferMethod][key] = Number(body[key]);
        }
      });
      addAudit(store, "admin", `Updated ${transferMethod} transfer limits`);
      writeStore(store);
      sendJson(res, 200, enrichedLimits(store));
      return;
    }

    if (method === "GET" && url.pathname === "/api/beneficiaries") {
      sendJson(res, 200, store.beneficiaries);
      return;
    }

    if (method === "POST" && url.pathname === "/api/beneficiaries") {
      const body = await parseBody(req);
      const error = validateBeneficiary(body);
      if (error) {
        sendJson(res, 422, { error });
        return;
      }
      const beneficiary = {
        id: randomId("ben"),
        name: body.name.trim(),
        nickname: body.nickname.trim(),
        bank: body.bank.trim(),
        accountNumber: String(body.accountNumber).trim(),
        ifsc: String(body.ifsc).trim().toUpperCase(),
        type: body.type,
        status: body.status || "Active",
        createdAt: nowIso()
      };
      store.beneficiaries.unshift(beneficiary);
      addNotification(store, "success", "Beneficiary added", `${beneficiary.nickname} is ready for transfers.`);
      addAudit(store, "customer", `Added beneficiary ${beneficiary.nickname}`);
      writeStore(store);
      sendJson(res, 201, beneficiary);
      return;
    }

    if (method === "PATCH" && parts[0] === "api" && parts[1] === "beneficiaries" && parts[2]) {
      const beneficiary = store.beneficiaries.find(item => item.id === parts[2]);
      if (!beneficiary) {
        sendJson(res, 404, { error: "Beneficiary not found" });
        return;
      }
      const body = await parseBody(req);
      ["name", "nickname", "bank", "accountNumber", "ifsc", "type", "status"].forEach(key => {
        if (body[key] !== undefined) beneficiary[key] = String(body[key]).trim();
      });
      beneficiary.ifsc = beneficiary.ifsc.toUpperCase();
      addAudit(store, "admin", `Updated beneficiary ${beneficiary.nickname}`);
      writeStore(store);
      sendJson(res, 200, beneficiary);
      return;
    }

    if (method === "DELETE" && parts[0] === "api" && parts[1] === "beneficiaries" && parts[2]) {
      const index = store.beneficiaries.findIndex(item => item.id === parts[2]);
      if (index === -1) {
        sendJson(res, 404, { error: "Beneficiary not found" });
        return;
      }
      const [removed] = store.beneficiaries.splice(index, 1);
      addAudit(store, "customer", `Deleted beneficiary ${removed.nickname}`);
      writeStore(store);
      sendJson(res, 200, removed);
      return;
    }

    if (method === "POST" && url.pathname === "/api/transfers/initiate") {
      const body = await parseBody(req);
      body.method = String(body.method || "").toUpperCase();
      const error = validateTransfer(store, body);
      if (error) {
        sendJson(res, 422, { error });
        return;
      }
      const beneficiary = store.beneficiaries.find(item => item.id === body.beneficiaryId);
      const limits = enrichedLimits(store)[body.method];
      const id = transactionId();
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const tx = {
        id,
        fromAccountId: store.accounts[0].id,
        beneficiaryId: beneficiary.id,
        beneficiaryName: beneficiary.name,
        method: body.method,
        amount: Number(body.amount),
        fee: Number(limits.fee),
        remarks: String(body.remarks || "").trim(),
        status: "OTP Pending",
        utr: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        timeline: [{ label: "Transfer Created", time: nowIso() }]
      };
      store.transactions.unshift(tx);
      store.otps[id] = {
        code: otp,
        expiresAt: Date.now() + 5 * 60 * 1000,
        attempts: 0
      };
      addNotification(store, "info", "OTP generated", `Mock OTP for ${id} is ${otp}.`);
      addAudit(store, "customer", `Initiated ${body.method} transfer ${id}`);
      writeStore(store);
      sendJson(res, 201, {
        transaction: publicTransaction(tx),
        otp,
        expiresInSeconds: 300,
        message: "Mock OTP generated. Use it to verify the transfer."
      });
      return;
    }

    if (method === "POST" && parts[0] === "api" && parts[1] === "transfers" && parts[2] && parts[3] === "verify-otp") {
      const tx = store.transactions.find(item => item.id === parts[2]);
      if (!tx) {
        sendJson(res, 404, { error: "Transaction not found" });
        return;
      }
      const body = await parseBody(req);
      const otp = store.otps[tx.id];
      if (!otp) {
        sendJson(res, 410, { error: "OTP is no longer available. Start a new transfer." });
        return;
      }
      otp.attempts += 1;
      if (Date.now() > otp.expiresAt) {
        tx.status = "Rejected";
        tx.timeline.push({ label: "OTP Expired", time: nowIso() });
        delete store.otps[tx.id];
        writeStore(store);
        sendJson(res, 410, { error: "OTP expired. Transfer rejected.", transaction: publicTransaction(tx) });
        return;
      }
      if (String(body.otp) !== otp.code) {
        if (otp.attempts >= 3) {
          tx.status = "Rejected";
          tx.updatedAt = nowIso();
          tx.timeline.push({ label: "OTP Failed", time: nowIso() });
          delete store.otps[tx.id];
          addNotification(store, "danger", "Transfer rejected", `${tx.id} failed OTP verification.`);
        }
        writeStore(store);
        sendJson(res, 422, { error: "Invalid OTP", attemptsLeft: Math.max(0, 3 - otp.attempts) });
        return;
      }
      tx.status = "Processing";
      tx.utr = `${tx.method}${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
      tx.updatedAt = nowIso();
      tx.timeline.push({ label: "OTP Verified", time: nowIso() });
      tx.timeline.push({ label: "Processing", time: nowIso() });
      store.accounts[0].balance -= Number(tx.amount) + Number(tx.fee || 0);
      delete store.otps[tx.id];
      addNotification(store, "success", "OTP verified", `${tx.id} is now processing.`);
      addAudit(store, "customer", `Verified OTP for transfer ${tx.id}`);
      writeStore(store);
      sendJson(res, 200, { transaction: publicTransaction(tx) });
      return;
    }

    if (method === "GET" && url.pathname === "/api/transactions") {
      const search = String(url.searchParams.get("q") || "").toLowerCase();
      const status = String(url.searchParams.get("status") || "");
      let transactions = store.transactions;
      if (search) {
        transactions = transactions.filter(tx =>
          [tx.id, tx.beneficiaryName, tx.method, tx.utr, tx.remarks]
            .filter(Boolean)
            .some(value => String(value).toLowerCase().includes(search))
        );
      }
      if (status) {
        transactions = transactions.filter(tx => tx.status === status);
      }
      sendJson(res, 200, transactions.map(publicTransaction));
      return;
    }

    if (method === "GET" && url.pathname === "/api/transactions.csv") {
      sendText(res, 200, buildTransactionsCsv(store.transactions), "text/csv; charset=utf-8");
      return;
    }

    if (method === "GET" && parts[0] === "api" && parts[1] === "transactions" && parts[2] && !parts[3]) {
      const tx = store.transactions.find(item => item.id === parts[2]);
      if (!tx) {
        sendJson(res, 404, { error: "Transaction not found" });
        return;
      }
      progressTransaction(store, tx);
      writeStore(store);
      sendJson(res, 200, publicTransaction(tx));
      return;
    }

    if (method === "PATCH" && parts[0] === "api" && parts[1] === "transactions" && parts[2] && parts[3] === "status") {
      const tx = store.transactions.find(item => item.id === parts[2]);
      if (!tx) {
        sendJson(res, 404, { error: "Transaction not found" });
        return;
      }
      const body = await parseBody(req);
      const nextStatus = String(body.status || "").trim();
      if (!nextStatus) {
        sendJson(res, 422, { error: "Status is required" });
        return;
      }
      tx.status = nextStatus;
      tx.updatedAt = nowIso();
      tx.timeline.push({ label: nextStatus, time: nowIso() });
      addAudit(store, "admin", `Changed ${tx.id} status to ${nextStatus}`);
      writeStore(store);
      sendJson(res, 200, publicTransaction(tx));
      return;
    }

    if (method === "GET" && parts[0] === "api" && parts[1] === "transactions" && parts[2] && parts[3] === "receipt.pdf") {
      const tx = store.transactions.find(item => item.id === parts[2]);
      if (!tx) {
        sendJson(res, 404, { error: "Transaction not found" });
        return;
      }
      const beneficiary = store.beneficiaries.find(item => item.id === tx.beneficiaryId);
      const pdf = createReceiptPdf(tx, store.accounts[0], beneficiary);
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${tx.id}-receipt.pdf"`,
        "Content-Length": pdf.length
      });
      res.end(pdf);
      return;
    }

    if (method === "GET" && url.pathname === "/api/notifications") {
      sendJson(res, 200, store.notifications);
      return;
    }

    if (method === "PATCH" && parts[0] === "api" && parts[1] === "notifications" && parts[2] === "read-all") {
      store.notifications.forEach(note => {
        note.read = true;
      });
      writeStore(store);
      sendJson(res, 200, store.notifications);
      return;
    }

    if (method === "GET" && url.pathname === "/api/admin/audit") {
      sendJson(res, 200, store.auditLogs);
      return;
    }

    notFound(res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = parseUrl(req);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }
  if (!serveStatic(req, res, url)) {
    serveStatic({ ...req, url: "/" }, res, new URL("/", `http://${req.headers.host || "localhost"}`));
  }
});

server.listen(PORT, () => {
  console.log(`Fund Transfer System running at http://localhost:${PORT}`);
});
