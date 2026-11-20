# STX Tool Trailer Inspection

A phone app (installable web app) for the **Weekly Tool Trailer Inventory & Inspection**. It replaces the paper sheet (RV2) with a signed PDF. There's no app store, no login and no server.

## How it works on the phone
The app opens to a **home screen**, then walks through 5 steps. A header bar at the top has a **back** button, the step title, "Step X of 5 · trailer #", and a **settings** (gear) button. A **Next** button stays fixed at the bottom. The phone's own back button or swipe works too.

1. **Trailer & Inspector:** Tool Trailer #, date, job/location and inspector name (pre-filled from Settings). This step also shows the last inspection on file for that trailer.
2. **Inventory:** all **62 items** from the paper sheet, in the same order and grouped by section, with a progress bar. Each item is GOOD / REPAIR / NEED. REPAIR or NEED opens these required follow-ups:
   - **How will this be replaced?** Site Supervisor, or Delivery from Yard / Consumable Manager.
   - If Yard: **Immediate – overnight it** or **As time allows**.
   - **Was this on last week's inspection too?** If yes: **Has it been ordered?** If yes: **Expected delivery date** (or "Don't know yet").
   - Qty and notes (optional).
   - Up to 10 **Other** items can be added or removed.
3. **Other Requests:** optional free text.
4. **Trailer Photos:** 2 required, taken with the camera, showing how clean the trailer is.
5. **Review & Sign:** a summary of totals, overnight and repeat items, then the inspector's signature.

**Finish & create PDF** leads to **Share / Send PDF** (email, text, Teams, and so on) or **Save PDF to phone**.

You can't move to the next step until the current one is complete. A red box lists what's missing, and each entry jumps to the problem.

**Autosave:** progress is saved on the phone after every tap. If the app is closed, the home screen shows **Continue inspection**.

**Offline:** after the first visit the app works with no signal.

**Settings (gear):** your name (fills in new inspections), the last inspections saved on this phone (you can remove them), Load last inspection PDF, Discard current inspection, and install tips.

### Repeat items and loading last week's PDF
Every PDF the app creates carries a hidden copy of its results. Anyone can tap **Load last inspection PDF** on the home screen, the Step 1 screen or Settings, and pick last week's PDF, even if it was made on someone else's phone and emailed or texted to them. The app then knows what was flagged last week, what was ordered, and the ETAs. Items flagged again show "Also flagged … on 11/12" and are pre-answered as repeats. The phone also remembers the last inspection of each trailer it finishes. It only reads PDFs this app created.

## PDF output
File name: **`<Tool Trailer #>-<YYMMDD> <Inspector Name>.pdf`**. For example, `TT-14-261119 Jose Garcia.pdf`.

- **Page 1:** the header, totals (GOOD / REPAIR / NEED / OVERNIGHT / REPEAT), and the full inventory table.
- **Page 2:** in order, the **Tool / Consumable Requests** table (most urgent first: overnight items highlighted, then Site Supervisor items, then yard items that can come as time allows), **Other Requests / Comments**, both **trailer photos**, and the **sign-off** (inspector signature, a blank Supervisor Review line, and the date).
- **Long request lists** continue onto more pages, and the photos and sign-off stay together at the end.
- **Text cleanup:** characters the PDF fonts can't show, such as emoji, are replaced with "?". Spanish accents print normally.

## Put it on GitHub (free hosting with GitHub Pages)
1. Create a repository, for example `stx-tool-trailer-inspection`, and upload every file in this folder, keeping the folders as they are.
2. Go to **Settings → Pages**. Set the source to **Deploy from a branch** and choose **main / (root)**.
3. After about a minute the app is live at `https://<your-org>.github.io/stx-tool-trailer-inspection/`. Text the link to crews and have them add it to their home screen: on iPhone, Share → **Add to Home Screen**; on Android, ⋮ → **Add to Home screen**. It then opens full-screen like a normal app.

> If the repo is private, GitHub Pages needs a paid GitHub plan. The app holds no company data, so a public repo is fine.

## Home screen icon
The icon is a chrome-silver, forward-slanted “STX” on STX blue (#28456F), with a spike maul forming the T. The S and X are traced from the Archivo Black font (SIL Open Font License). The source is `assets/icon.svg`. It uses SVG filters, so re-export the PNGs in Chrome. If you change the icon, re-export `icon-180.png` (iPhone), `icon-192.png`, `icon-512.png` and `icon-maskable-512.png` (Android).
> iPhones save the icon when the app is added to the home screen. Anyone who added it before an icon change needs to delete it from the home screen and add it again.

## Making changes
| To change… | Edit |
|---|---|
| Tool list | `js/items.js` |
| Follow-up answer choices | `STX_METHODS` in `js/items.js` (the other questions are in `js/app.js`) |
| PDF layout or file name | `js/pdf.js` |
| Colors and look | `css/style.css` |

After any change, bump `VERSION` in `sw.js` so phones load the new version.

## Tests
`tests/test_app.py` runs the real app in a phone-sized browser. It has 28 end-to-end tests covering navigation and back buttons, validation on every step, the follow-up questions, Other items, photos and signature, autosave and restore, PDF content and page order, long and overflowing request lists, accented names and emoji, file-name cleanup, PDF import from another phone, Settings, and double-tap protection.
```bash
pip install pytest playwright pypdf
python -m playwright install chromium
pytest tests -q
```

## Files
```
index.html               app screens
css/style.css            styles
js/items.js              inventory list + follow-up choices
js/app.js                screens, navigation, validation, photos, autosave, import, settings
js/signature.js          signature pad
js/pdf.js                PDF builder + data stamp
vendor/jspdf.umd.min.js  PDF library (jsPDF, MIT license)
assets/                  logo + app icons (icon.svg is the editable source)
sw.js, manifest.webmanifest  offline / home-screen app support
tests/                   automated tests + fixtures
examples/                sample PDFs and screenshots
```
