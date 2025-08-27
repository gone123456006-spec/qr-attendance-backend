// SERVER/Server.js — SIMPLE: no API key, just Nodemailer + PDFKit
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();

/* ========== Config (.env) ========== */
const PORT        = process.env.PORT || 3000;
const SMTP_USER   = process.env.SMTP_USER;            // set in Render → Environment
const SMTP_PASS   = process.env.SMTP_PASS;            // set in Render → Environment
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const DRY_RUN     = String(process.env.DRY_RUN || "false").toLowerCase() === "true";

const REPORT_DIR = path.join(__dirname, "reports");
fs.mkdirSync(REPORT_DIR, { recursive: true });

/* ========== Middleware ========== */
app.use(cors({ origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

/* ========== Utilities ========== */
const isEmail = (s = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
function formatIST(isoOrDate = new Date()) {
  const d = new Date(isoOrDate);
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(d);
}

/* ========== Mailer ========== */
let transporter = null;
if (!DRY_RUN) {
  if (!SMTP_USER || !SMTP_PASS) {
    console.log("⚠️  Set SMTP_USER and SMTP_PASS in environment variables (or use DRY_RUN=true).");
  } else {
    transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    transporter.verify()
      .then(() => console.log("✅ SMTP ready"))
      .catch(err => console.log("⚠️ SMTP verify failed:", err?.message || err));
  }
}

/* ========== Email content builders ========== */
function buildAttendanceEmail({ studentId, studentName, whenISO }) {
  const whenStr = formatIST(whenISO);
  const text = `Dear Parent,

Your child ${studentName} (ID: ${studentId}) is marked PRESENT at Saamarthya Academy.

Date & Time: ${whenStr}

Best regards,
Saamarthya Academy`;

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;line-height:1.6">
    <p>Dear Parent,</p>
    <p>
      Your child <strong>${studentName}</strong> (ID: <strong>${studentId}</strong>) is marked
      <span style="display:inline-block;padding:4px 10px;border-radius:9999px;background:#d1fae5;color:#065f46;border:1px solid #a7f3d0;font-weight:700;">
        PRESENT
      </span>
      at Saamarthya Academy.
    </p>
    <p style="margin:12px 0 0 0;"><strong>Date &amp; Time:</strong> ${whenStr}</p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />
    <p style="margin:0">Best regards,</p>
    <p style="margin:0"><strong>Saamarthya Academy</strong></p>
  </div>`;

  return { subject: "Attendance: Present ✔️", text, html };
}

/* ========== Routes ========== */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, dryRun: DRY_RUN, time: new Date().toISOString() });
});

app.post("/api/send-email", async (req, res) => {
  try {
    const { studentId, studentName, parentEmail, timestamp } = req.body || {};
    if (!studentId || !studentName || !parentEmail) {
      return res.status(400).json({ ok: false, message: "Missing fields" });
    }
    if (!isEmail(parentEmail)) {
      return res.status(400).json({ ok: false, message: "Invalid parentEmail" });
    }

    const when = timestamp ? new Date(timestamp) : new Date();
    const { subject, text, html } = buildAttendanceEmail({
      studentId, studentName, whenISO: when.toISOString(),
    });

    if (DRY_RUN || !transporter) {
      console.log("📧 [DRY_RUN] Would send to:", parentEmail, "|", subject);
      return res.json({ ok: true, emailSent: true });
    }

    const info = await transporter.sendMail({
      from: `"Saamarthya Academy" <${SMTP_USER}>`,
      to: parentEmail,
      subject,
      text,
      html,
    });
    console.log("✅ Email sent:", info.messageId || info.response);
    res.json({ ok: true, emailSent: true });
  } catch (err) {
    console.error("❌ /api/send-email:", err?.message || err);
    res.status(500).json({ ok: false, message: "Internal error" });
  }
});

app.post("/api/send-pdf-email", async (req, res) => {
  try {
    const { studentName, parentEmail, reportData } = req.body || {};
    if (!studentName || !parentEmail || !reportData) {
      return res.status(400).json({ ok: false, message: "Missing fields" });
    }
    if (!isEmail(parentEmail)) {
      return res.status(400).json({ ok: false, message: "Invalid parentEmail" });
    }

    const safe = String(studentName || "student").replace(/[^\w\-]+/g, "_");
    const pdfPath = path.join(REPORT_DIR, `${safe}_monthly_${Date.now()}.pdf`);
    await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40 });
      const out = fs.createWriteStream(pdfPath);
      doc.pipe(out);

      doc.fontSize(20).text("📘 Monthly Attendance Report", { align: "center" });
      doc.moveDown();
      doc.fontSize(12).text(`Student: ${studentName}`);
      doc.text(`Generated On: ${formatIST(new Date())}`);
      doc.moveDown();
      doc.fontSize(14).text("Attendance Records:", { underline: true });
      doc.moveDown(0.5);
      const lines = Array.isArray(reportData) ? reportData : String(reportData).split("\n");
      if (!lines.length) doc.fontSize(12).text("No records provided.");
      else lines.forEach((line, i) => doc.fontSize(12).text(`${i + 1}. ${line}`));

      doc.moveDown();
      doc.fontSize(12).text("Best regards,\nSaamarthya Academy");

      doc.end();
      out.on("finish", resolve);
      out.on("error", reject);
    });

    if (DRY_RUN || !transporter) {
      console.log("📎 [DRY_RUN] Would email PDF to:", parentEmail, "file:", pdfPath);
      try { fs.unlinkSync(pdfPath); } catch {}
      return res.json({ ok: true, emailSent: true });
    }

    try {
      const info = await transporter.sendMail({
        from: `"Saamarthya Academy" <${SMTP_USER}>`,
        to: parentEmail,
        subject: "Monthly Attendance Report",
        text: "Attached is your child's monthly attendance report.\n\nBest regards,\nSaamarthya Academy",
        html: `<p>Attached is your child's monthly attendance report.</p><p>Best regards,<br><strong>Saamarthya Academy</strong></p>`,
        attachments: [{ filename: path.basename(pdfPath), path: pdfPath }],
      });
      console.log("✅ Report email sent:", info.messageId || info.response);
    } finally {
      try { fs.unlinkSync(pdfPath); } catch {}
    }

    res.json({ ok: true, emailSent: true });
  } catch (err) {
    console.error("❌ /api/send-pdf-email:", err?.message || err);
    res.status(500).json({ ok: false, message: "Internal error" });
  }
});

/* ========== Start ========== */
/* ========== Start ========== */
if (!process.env.VERCEL) {
  // Local/Render/Railway: start a real server
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`   DRY_RUN=${DRY_RUN ? "true" : "false"}`);
  });
}
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`   DRY_RUN=${DRY_RUN ? "true" : "false"}`);
  });
}
module.exports = app;

app.get("/", (_req, res) => {
  res.json({ ok: true, message: "Saamarthya Mailer API. Try /api/health" });
});


// Export for Vercel's serverless function runtime
module.exports = app;

