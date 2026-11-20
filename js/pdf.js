// Builds the inspection PDF with jsPDF, laid out like the paper
// "Weekly Tool Trailer Inventory & Inspection Sheet".
//
// File name format:  <Tool Trailer #>-<YYMMDD> <Inspector Name>.pdf
// e.g.               TT-14-261119 Jose Garcia.pdf
// ---------- data stamp ----------
// A copy of the key results is stored (base64 JSON) in the PDF's Keywords field
// so anyone can load last week's PDF into the app, even from another phone.
const STX_STAMP_PREFIX = "STXTTI1:";
window.STX_stampPayload = function (data) {
  const flagged = data.rows.concat(data.others)
    .filter((r) => r.status === "REPAIR" || r.status === "NEED")
    .map((r) => ({ name: r.name, status: r.status, method: r.method || "", urgency: r.urgency || "",
      repeat: r.repeat || "", ordered: r.ordered || "", eta: r.eta || "", qty: r.qty || "", notes: r.notes || "" }));
  return { v: 1, trailerId: data.trailerId, job: data.job, date: data.date, inspector: data.inspector, flagged };
};
window.STX_encodeStamp = function (data) {
  const bytes = new TextEncoder().encode(JSON.stringify(window.STX_stampPayload(data)));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return STX_STAMP_PREFIX + btoa(bin);
};
// The built-in PDF fonts only cover Windows-1252 characters (English + Spanish
// accents etc.). Replace anything else (emoji, other scripts) so text never garbles.
const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function pdfSafe(str) {
  return String(str ?? "")
    .replace(/[\u200B-\u200D\uFE0F]/g, "")
    .replace(/[\r\t]/g, " ")
    .replace(/[^\n\x20-\x7E\xA0-\xFF]/gu, (ch) => (WINANSI_EXTRA.includes(ch) ? ch : "?"))
    .replace(/\?{2,}/g, "?");
}
window.STX_pdfSafe = pdfSafe;
window.STX_readStamp = function (arrayBuffer) {
  // Read the raw PDF text and find the stamp
  const u8 = new Uint8Array(arrayBuffer);
  let text = "";
  for (let i = 0; i < u8.length; i += 65536) text += String.fromCharCode.apply(null, u8.subarray(i, i + 65536));
  const m = text.match(/STXTTI1:([A-Za-z0-9+\/=]+)/);
  if (!m) return null;
  const bin = atob(m[1]);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
};

window.STX_buildPdf = function (rawData) {
  const { jsPDF } = window.jspdf;
  // Clean every string that gets drawn; the hidden stamp keeps the original text.
  const data = { ...rawData,
    trailerId: pdfSafe(rawData.trailerId), job: pdfSafe(rawData.job), inspector: pdfSafe(rawData.inspector),
    requests: pdfSafe(rawData.requests),
    rows: rawData.rows.map((r) => ({ ...r, name: pdfSafe(r.name), notes: pdfSafe(r.notes), qty: pdfSafe(r.qty) })),
    others: rawData.others.map((r) => ({ ...r, name: pdfSafe(r.name), notes: pdfSafe(r.notes), qty: pdfSafe(r.qty) })),
  };
  const doc = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });

  const W = 612, H = 792, M = 30, CW = W - M * 2;
  const NAVY = [31, 56, 100], NAVY2 = [47, 84, 150], TINT = [220, 230, 241], ALT = [244, 247, 251];
  const GOOD = [30, 142, 62], REPAIR = [199, 119, 0], NEED = [198, 40, 40];
  const GRAY = [110, 118, 130], LINE = [190, 200, 212], INK = [27, 36, 48];
  const STATUS_COLOR = { GOOD, REPAIR, NEED };
  const METHODS = window.STX_METHODS;

  // ---------- helpers ----------
  const fill = (c) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c) => doc.setDrawColor(c[0], c[1], c[2]);
  const color = (c) => doc.setTextColor(c[0], c[1], c[2]);
  const font = (style, size) => { doc.setFont("helvetica", style); doc.setFontSize(size); };

  function fmtDate(iso) {
    const [y, m, d] = iso.split("-");
    return `${m}/${d}/${y}`;
  }
  function fmtDateTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function yymmdd(iso) {
    const [y, m, d] = iso.split("-");
    return `${y.slice(2)}${m}${d}`;
  }
  function fit(text, width) {
    text = String(text || "");
    if (doc.getTextWidth(text) <= width) return text;
    while (text.length && doc.getTextWidth(text + "…") > width) text = text.slice(0, -1);
    return text + "…";
  }
  function sectionBar(y, title, right) {
    fill(NAVY); doc.rect(M, y, CW, 18, "F");
    font("bold", 10); color([255, 255, 255]); doc.text(title, M + 8, y + 12.5);
    if (right) { font("italic", 7.5); doc.text(right, W - M - 8, y + 12.2, { align: "right" }); }
    return y + 18;
  }
  function checkbox(x, y, status, colStatus) {
    const s = 9;
    if (status === colStatus) {
      fill(STATUS_COLOR[colStatus]); doc.roundedRect(x - s / 2, y - s / 2, s, s, 1.2, 1.2, "F");
      doc.setDrawColor(255, 255, 255); doc.setLineWidth(1.2);
      if (colStatus === "GOOD") {
        doc.line(x - 2.4, y + 0.2, x - 0.6, y + 2.1); doc.line(x - 0.6, y + 2.1, x + 2.6, y - 2.2);
      } else {
        doc.line(x - 2.2, y - 2.2, x + 2.2, y + 2.2); doc.line(x + 2.2, y - 2.2, x - 2.2, y + 2.2);
      }
      doc.setLineWidth(0.5);
    } else {
      stroke(LINE); doc.setLineWidth(0.6); doc.rect(x - s / 2, y - s / 2, s, s, "S");
    }
  }

  // ---------- counts ----------
  const all = data.rows.concat(data.others);
  const counts = { GOOD: 0, REPAIR: 0, NEED: 0, OVERNIGHT: 0, REPEAT: 0 };
  const isFlagged = (r) => r.status === "REPAIR" || r.status === "NEED";
  all.forEach((r) => {
    if (counts[r.status] !== undefined) counts[r.status]++;
    if (isFlagged(r) && r.method === "YARD" && r.urgency === "OVERNIGHT") counts.OVERNIGHT++;
    if (isFlagged(r) && r.repeat === "YES") counts.REPEAT++;
  });
  const PURPLE = [94, 53, 177], DARKRED = [140, 20, 20];

  // ---------- page 1 header ----------
  function header() {
    if (window.STX_LOGO) doc.addImage(window.STX_LOGO, "JPEG", M, 22, 135, 44);
    font("bold", 17); color(NAVY);
    doc.text("WEEKLY TOOL TRAILER INVENTORY", W - M, 40, { align: "right" });
    font("bold", 10.5); doc.text("& INSPECTION SHEET", W - M, 54, { align: "right" });
    font("normal", 7.5); color(GRAY);
    doc.text(`Submitted from STX Tool Trailer Inspection app  |  ${fmtDateTime(data.submittedAt)}`, W - M, 65, { align: "right" });
  }
  header();

  // Info box
  let y = 76;
  fill(TINT); doc.rect(M, y, CW, 40, "F");
  const splitX = M + 205; // left block narrower, right block (job) wider
  const info = [
    ["TRAILER ID:", data.trailerId, M + 10, y + 15, splitX - 12, 58],
    ["JOB / LOCATION:", data.job, splitX + 4, y + 15, W - M - 10, 72],
    ["INSPECTOR:", data.inspector, M + 10, y + 32, splitX - 12, 58],
    ["DATE:", fmtDate(data.date), splitX + 4, y + 32, W - M - 10, 72],
  ];
  info.forEach(([label, val, x, yy, xEnd, lw]) => {
    font("bold", 8); color(GRAY); doc.text(label, x, yy);
    const avail = xEnd - (x + lw) - 2;
    let size = 10;
    font("bold", size);
    while (size > 7.5 && doc.getTextWidth(String(val)) > avail) { size -= 0.5; font("bold", size); }
    color(INK); doc.text(fit(val, avail), x + lw, yy);
    stroke(LINE); doc.setLineWidth(0.5); doc.line(x + lw - 2, yy + 3, xEnd, yy + 3);
  });
  y += 46;

  // Summary strip
  const chips = [["GOOD", counts.GOOD, GOOD], ["REPAIR", counts.REPAIR, REPAIR], ["NEED", counts.NEED, NEED],
    ["OVERNIGHT", counts.OVERNIGHT, counts.OVERNIGHT ? DARKRED : [170, 176, 186]],
    ["REPEAT", counts.REPEAT, counts.REPEAT ? PURPLE : [170, 176, 186]]];
  let cx = M;
  chips.forEach(([label, n, c]) => {
    const w = label === "OVERNIGHT" ? 80 : 64;
    fill(c); doc.roundedRect(cx, y, w, 15, 3, 3, "F");
    font("bold", 8); color([255, 255, 255]); doc.text(`${label}: ${n}`, cx + w / 2, y + 10.5, { align: "center" });
    cx += w + 5;
  });
  // (summary text is written at the end, once the photo page number is known)
  const summaryTextY = y + 10.5, summaryTextX = cx + 6;
  y += 21;

  // ---------- inventory table ----------
  y = sectionBar(y, "TRAILER INVENTORY", "Replacement method shown in Notes: Site Sup. = Site Supervisor, Yard / CM = Delivery from Yard / Consumable Manager");
  const colW = (CW - 8) / 2;
  const cols = { name: 112, good: 26, repair: 32, need: 26 };
  cols.notes = colW - cols.name - cols.good - cols.repair - cols.need;
  const left = data.rows.slice(0, window.STX_LEFT_COLUMN_COUNT);
  const right = data.rows.slice(window.STX_LEFT_COLUMN_COUNT).concat(data.others);
  const nRows = Math.max(left.length, right.length);
  // Page 1 holds only the inventory, so size rows to fill the page
  const rowH = Math.min(17.5, (H - 40 - 24 - (y + 16)) / nRows);
  const fs = Math.min(8.6, rowH * 0.52); // item name font size

  function tableHeader(x, yy) {
    fill(NAVY2); doc.rect(x, yy, colW, 13, "F");
    font("bold", 7.2); color([255, 255, 255]);
    let xx = x + 4;
    doc.text("ITEM", xx, yy + 9); xx = x + cols.name;
    doc.text("GOOD", xx + cols.good / 2, yy + 9, { align: "center" }); xx += cols.good;
    doc.text("REPAIR", xx + cols.repair / 2, yy + 9, { align: "center" }); xx += cols.repair;
    doc.text("NEED", xx + cols.need / 2, yy + 9, { align: "center" }); xx += cols.need;
    doc.text("NOTES / QTY", xx + 3, yy + 9);
  }
  function noteText(r) {
    if (r.status !== "REPAIR" && r.status !== "NEED") return "";
    const parts = [];
    if (r.method && METHODS[r.method]) parts.push(METHODS[r.method].short);
    if (r.method === "YARD" && r.urgency === "OVERNIGHT") parts.push("OVERNIGHT");
    if (r.repeat === "YES") parts.push(r.ordered === "YES" ? "Repeat-ordered" : "REPEAT");
    if (r.qty) parts.push(`Qty ${r.qty}`);
    if (r.notes) parts.push(r.notes);
    return parts.join(" · ");
  }
  function tableRow(x, yy, r, i) {
    if (i % 2 === 1) { fill(ALT); doc.rect(x, yy, colW, rowH, "F"); }
    if (!r) return;
    const mid = yy + rowH / 2;
    font(r.name.startsWith("Other:") ? "italic" : "normal", fs); color(INK);
    doc.text(fit(r.name, cols.name - 6), x + 4, mid + fs * 0.35);
    let xx = x + cols.name;
    checkbox(xx + cols.good / 2, mid, r.status, "GOOD"); xx += cols.good;
    checkbox(xx + cols.repair / 2, mid, r.status, "REPAIR"); xx += cols.repair;
    checkbox(xx + cols.need / 2, mid, r.status, "NEED"); xx += cols.need;
    const n = noteText(r);
    if (n) { font("bold", fs - 1.4); color(STATUS_COLOR[r.status]); doc.text(fit(n, cols.notes - 6), xx + 3, mid + (fs - 1.4) * 0.35); }
  }

  const xL = M, xR = M + colW + 8;
  tableHeader(xL, y + 4); tableHeader(xR, y + 4);
  let ty = y + 17;
  for (let i = 0; i < nRows; i++) {
    tableRow(xL, ty, left[i], i);
    tableRow(xR, ty, right[i], i);
    ty += rowH;
  }
  stroke(LINE); doc.setLineWidth(0.5);
  doc.rect(xL, y + 4, colW, ty - y - 4, "S"); doc.rect(xR, y + 4, colW, ty - y - 4, "S");
  y = ty + 6;

  // Condition key
  fill([253, 246, 227]); doc.rect(M, y, CW, 15, "F");
  font("bold", 7.5); color(INK); doc.text("CONDITION KEY:", M + 8, y + 10);
  font("normal", 7.5);
  doc.text("GOOD = Present / Operational        REPAIR = Needs Repair        NEED = Not On Trailer / Needs Replacing", M + 92, y + 10);
  y += 22;

  // ---------- page 2: requests, comments, signature ----------
  const bottomLimit = H - 40;
  function infoStrip(title) {
    // compact repeat of the trailer info at the top of later pages
    let yy = 26;
    if (window.STX_LOGO) doc.addImage(window.STX_LOGO, "JPEG", M, yy, 80, 26);
    font("bold", 13); color(NAVY); doc.text(title, W - M, yy + 12, { align: "right" });
    font("normal", 8); color(GRAY);
    const tail = `  |  ${fmtDate(data.date)}  |  ${data.inspector}`;
    const jobFit = fit(data.job, CW - 100 - doc.getTextWidth(`${data.trailerId}  |  ${tail}`));
    doc.text(`${data.trailerId}  |  ${jobFit}${tail}`, W - M, yy + 24, { align: "right" });
    return yy + 36;
  }
  function newPage() {
    doc.addPage();
    return infoStrip("REQUESTS & SIGN-OFF (cont.)");
  }
  function ensure(h) { if (y + h > bottomLimit) y = newPage(); }

  doc.addPage();
  y = infoStrip("REQUESTS & SIGN-OFF");

  const flagged = all.filter(isFlagged);
  y = sectionBar(y, "TOOL / CONSUMABLE REQUESTS", "Items needed to bring REPAIR or NEED back to GOOD  —  most urgent first");

  const rc = [
    { t: "ITEM", w: 106 },
    { t: "STATUS", w: 42 },
    { t: "QTY", w: 24 },
    { t: "REPLACED BY", w: 110 },
    { t: "PRIORITY", w: 62 },
    { t: "REPEAT / ORDER STATUS", w: 102 },
    { t: "NOTES", w: CW - 446 },
  ];
  function reqHeader() {
    fill(TINT); doc.rect(M, y, CW, 15, "F");
    font("bold", 7.2); color(NAVY);
    let x = M;
    rc.forEach((c) => { doc.text(c.t, x + 4, y + 10); x += c.w; });
    y += 15;
  }
  const BYLABEL = { SUPERVISOR: "Site Supervisor", YARD: "Yard / Consumable Mgr" };
  function cells(r) {
    const overnight = r.method === "YARD" && r.urgency === "OVERNIGHT";
    let rep, repColor = GRAY, repStyle = "normal";
    if (r.repeat === "YES") {
      if (r.ordered === "YES") {
        rep = `Repeat – ordered\nETA ${r.eta ? fmtDate(r.eta) : "unknown"}`;
        repColor = PURPLE; repStyle = "bold";
      } else { rep = "REPEAT – NOT ordered"; repColor = NEED; repStyle = "bold"; }
    } else rep = "New this week";
    return [
      { text: r.name, c: INK, s: "normal" },
      { text: r.status, c: STATUS_COLOR[r.status], s: "bold" },
      { text: r.qty ? String(r.qty) : "—", c: INK, s: "normal" },
      { text: BYLABEL[r.method] || "—", c: NAVY, s: "bold" },
      overnight ? { text: "OVERNIGHT", c: DARKRED, s: "bold" }
        : { text: r.method === "YARD" ? "As time allows" : "—", c: INK, s: "normal" },
      { text: rep, c: repColor, s: repStyle },
      { text: r.notes || "—", c: INK, s: "normal" },
    ];
  }

  if (!flagged.length) {
    font("italic", 9); color(GOOD);
    doc.text("No repairs or replacements needed — every item marked GOOD.", M + 8, y + 16);
    y += 26;
  } else {
    reqHeader();
    // Most urgent first: overnight yard deliveries, then site supervisor, then yard as time allows
    const rank = (r) => (r.method === "YARD" && r.urgency === "OVERNIGHT" ? 0 : r.method === "SUPERVISOR" ? 1 : 2);
    flagged.sort((a, b) => rank(a) - rank(b));
    flagged.forEach((r, i) => {
      const cs = cells(r);
      const lines = cs.map((c, k) => { font(c.s, 8.6); return doc.splitTextToSize(c.text, rc[k].w - 8); });
      const h = Math.max(...lines.map((l) => l.length)) * 10.6 + 10;
      if (y + h > bottomLimit) { y = newPage(); reqHeader(); }
      if (rank(r) === 0) { fill([253, 236, 234]); doc.rect(M, y, CW, h, "F"); }
      else if (i % 2 === 1) { fill(ALT); doc.rect(M, y, CW, h, "F"); }
      let x = M;
      cs.forEach((c, k) => {
        font(c.s, 8.6); color(c.c); doc.text(lines[k], x + 4, y + 12, { lineHeightFactor: 1.23 });
        x += rc[k].w;
      });
      stroke([228, 233, 240]); doc.setLineWidth(0.4); doc.line(M, y + h, M + CW, y + h);
      y += h;
    });
    y += 6;
  }

  // Other requests / comments
  {
    font("normal", 9.5);
    const text = data.requests || "None.";
    const lines = doc.splitTextToSize(text, CW - 20);
    const h = lines.length * 12.5 + 14;
    ensure(h + 30);
    y += 8;
    y = sectionBar(y, "OTHER REQUESTS / COMMENTS", "Anything else the crew needs that isn't on the list");
    stroke(LINE); doc.setLineWidth(0.5); doc.rect(M, y, CW, h, "S");
    font(data.requests ? "normal" : "italic", 9.5); color(data.requests ? INK : GRAY);
    doc.text(lines, M + 10, y + 15, { lineHeightFactor: 1.3 });
    y += h;
  }

  // ---------- trailer photos, then sign-off under them ----------
  const sigH = 96;            // sign-off block incl. its title bar
  const capH = 14, barH = 18, gap = 12;
  const photoW = (CW - 10) / 2;
  const photoSpace = () => bottomLimit - (y + gap) - barH - 6 - capH - (gap + sigH);
  let avail = photoSpace();
  if (avail < 140) { y = newPage(); avail = photoSpace(); }
  const photoPage = doc.getNumberOfPages();
  y += gap;
  y = sectionBar(y, "TRAILER CLEANLINESS PHOTOS", "Taken by the inspector during this inspection");
  y += 6;
  const boxH = Math.min(avail, photoW);
  data.photos.forEach((p, i) => {
    if (!p) return;
    const bx = M + i * (photoW + 10);
    const scale = Math.min(photoW / p.w, boxH / p.h);
    const w = p.w * scale, h = p.h * scale;
    fill([245, 247, 250]); doc.rect(bx, y, photoW, boxH, "F");
    doc.addImage(p.dataUrl, "JPEG", bx + (photoW - w) / 2, y + (boxH - h) / 2, w, h);
    font("bold", 8); color(NAVY);
    doc.text(`Photo ${i + 1} of 2`, bx, y + boxH + 10);
    font("normal", 7.5); color(GRAY);
    doc.text(`Taken ${fmtDateTime(p.takenAt)}`, bx + photoW, y + boxH + 10, { align: "right" });
  });
  y += boxH + capH;

  // ---------- sign-off ----------
  y += gap;
  y = sectionBar(y, "SIGN-OFF", "I confirm I inspected this trailer and the information above is accurate.");
  fill(TINT); doc.rect(M, y, CW, sigH - 18, "F");
  const lineY = y + 56;
  if (data.signature) {
    const sg = typeof data.signature === "string" ? { url: data.signature } : data.signature;
    let sw = sg.w, sh = sg.h;
    if (!sw || !sh) { try { const pr = doc.getImageProperties(sg.url); sw = pr.width; sh = pr.height; } catch (e) { sw = 4; sh = 1; } }
    const k = Math.min(225 / sw, 52 / sh);
    doc.addImage(sg.url, "PNG", M + 20, lineY - 4 - sh * k, sw * k, sh * k);
  }
  stroke(INK); doc.setLineWidth(0.8);
  doc.line(M + 12, lineY, M + 250, lineY);
  doc.line(M + 272, lineY, M + 430, lineY);
  doc.line(M + 476, lineY, M + CW - 10, lineY);
  font("bold", 12); color(INK);
  doc.text("X", M + 4, lineY - 3); doc.text("X", M + 264, lineY - 3);
  font("normal", 7.5); color(GRAY);
  doc.text(`Inspector Signature — ${data.inspector}`, M + 14, lineY + 11);
  doc.text("Supervisor Review", M + 274, lineY + 11);
  font("bold", 8); color(GRAY); doc.text("DATE:", M + 442, lineY - 3);
  font("bold", 10); color(INK); doc.text(fmtDate(data.date), M + 480, lineY - 4);

  // Fill in the page reference on page 1
  doc.setPage(1);
  font("normal", 8); color(GRAY);
  doc.text(photoPage === 2 ? "Requests, sign-off & photos: page 2" : `Requests & sign-off: page 2  •  Photos: page ${photoPage}`, summaryTextX, summaryTextY);

  // ---------- footers ----------
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    stroke(LINE); doc.setLineWidth(0.5); doc.line(M, H - 28, W - M, H - 28);
    font("normal", 7); color(GRAY);
    doc.text(`STX Corp. | Railroad Construction & Track Maintenance | Trailer ${data.trailerId} | Inspected ${fmtDate(data.date)} by ${data.inspector}`, M, H - 18);
    doc.text(`Page ${p} of ${total}`, W - M, H - 18, { align: "right" });
  }

  // ---------- file name ----------
  const clean = (s) => String(s).replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, "").replace(/\s+/g, " ").trim();
  const filename = `${clean(data.trailerId)}-${yymmdd(data.date)} ${clean(data.inspector)}.pdf`;
  doc.setProperties({
    title: filename.replace(/\.pdf$/, ""),
    subject: "Weekly Tool Trailer Inventory & Inspection",
    author: data.inspector,
    creator: "STX Tool Trailer Inspection app",
    keywords: window.STX_encodeStamp(rawData),
  });

  return { doc, filename, counts };
};
