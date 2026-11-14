#!/usr/bin/env python3
"""Generate Private Pilot Checkride Airworthiness Study Guide for Cessna 172L N9858G."""

from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    CondPageBreak,
    Flowable,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    HRFlowable,
)

OUT = Path(__file__).resolve().parent / "C172L_Private_Pilot_Airworthiness_Checkride_Guide.pdf"

NAVY = colors.HexColor("#0B1F33")
STEEL = colors.HexColor("#1F4E6B")
SKY = colors.HexColor("#D6E6F2")
AMBER = colors.HexColor("#C47A1A")
INK = colors.HexColor("#1A1F24")
MUTED = colors.HexColor("#5A6570")
RULE = colors.HexColor("#B8C4CE")
SOFT = colors.HexColor("#F3F6F8")
OK = colors.HexColor("#1F6B4A")
WARN = colors.HexColor("#8A3B12")


class AccentBar(Flowable):
    def __init__(self, width, height=4, color=AMBER):
        super().__init__()
        self.width = width
        self.height = height
        self.color = color

    def draw(self):
        self.canv.setFillColor(self.color)
        self.canv.rect(0, 0, self.width, self.height, fill=1, stroke=0)


class CalloutBox(Flowable):
    def __init__(self, title, body, width, border=STEEL, fill=SOFT):
        super().__init__()
        self.title = title
        self.body = body
        self.box_width = width
        self.border = border
        self.fill = fill
        self._story = None
        self.height = 0

    def wrap(self, availWidth, availHeight):
        styles = _styles()
        data = [[Paragraph(f"<b>{self.title}</b>", styles["CalloutTitle"])],
                [Paragraph(self.body, styles["CalloutBody"])]]
        t = Table(data, colWidths=[self.box_width - 16])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), self.fill),
            ("BOX", (0, 0), (-1, -1), 1.2, self.border),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (0, 0), 8),
            ("BOTTOMPADDING", (0, -1), (-1, -1), 8),
            ("TOPPADDING", (0, 1), (-1, 1), 2),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        self._story = t
        w, h = t.wrap(self.box_width, availHeight)
        self.height = h
        return self.box_width, h

    def draw(self):
        self._story.drawOn(self.canv, 0, 0)


_STYLE_CACHE = None


def _styles():
    global _STYLE_CACHE
    if _STYLE_CACHE:
        return _STYLE_CACHE
    base = getSampleStyleSheet()
    s = {
        "CoverBrand": ParagraphStyle(
            "CoverBrand", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=11, textColor=AMBER, tracking=1.5, spaceAfter=6,
        ),
        "CoverTitle": ParagraphStyle(
            "CoverTitle", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=26, leading=30, textColor=NAVY, spaceAfter=10,
        ),
        "CoverSub": ParagraphStyle(
            "CoverSub", parent=base["Normal"], fontName="Helvetica",
            fontSize=12, leading=16, textColor=STEEL, spaceAfter=6,
        ),
        "CoverMeta": ParagraphStyle(
            "CoverMeta", parent=base["Normal"], fontName="Helvetica",
            fontSize=9, leading=12, textColor=MUTED,
        ),
        "H1": ParagraphStyle(
            "H1", parent=base["Heading1"], fontName="Helvetica-Bold",
            fontSize=16, leading=20, textColor=NAVY, spaceBefore=4, spaceAfter=8,
        ),
        "H2": ParagraphStyle(
            "H2", parent=base["Heading2"], fontName="Helvetica-Bold",
            fontSize=12.5, leading=16, textColor=STEEL, spaceBefore=12, spaceAfter=6,
        ),
        "H3": ParagraphStyle(
            "H3", parent=base["Heading3"], fontName="Helvetica-Bold",
            fontSize=10.5, leading=13, textColor=NAVY, spaceBefore=8, spaceAfter=4,
        ),
        "Body": ParagraphStyle(
            "Body", parent=base["Normal"], fontName="Helvetica",
            fontSize=9.5, leading=13, textColor=INK, alignment=TA_JUSTIFY, spaceAfter=6,
        ),
        "BodyLeft": ParagraphStyle(
            "BodyLeft", parent=base["Normal"], fontName="Helvetica",
            fontSize=9.5, leading=13, textColor=INK, alignment=TA_LEFT, spaceAfter=5,
        ),
        "Small": ParagraphStyle(
            "Small", parent=base["Normal"], fontName="Helvetica",
            fontSize=8.5, leading=11, textColor=MUTED, spaceAfter=4,
        ),
        "Ref": ParagraphStyle(
            "Ref", parent=base["Normal"], fontName="Helvetica-Oblique",
            fontSize=8, leading=10, textColor=STEEL, spaceAfter=2,
        ),
        "Q": ParagraphStyle(
            "Q", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=9.5, leading=12.5, textColor=NAVY, spaceBefore=4, spaceAfter=2,
        ),
        "A": ParagraphStyle(
            "A", parent=base["Normal"], fontName="Helvetica",
            fontSize=9.2, leading=12.2, textColor=INK, spaceAfter=3,
        ),
        "Bullet": ParagraphStyle(
            "Bullet", parent=base["Normal"], fontName="Helvetica",
            fontSize=9.2, leading=12, textColor=INK, leftIndent=12, spaceAfter=2,
        ),
        "TOC": ParagraphStyle(
            "TOC", parent=base["Normal"], fontName="Helvetica",
            fontSize=10, leading=16, textColor=INK, spaceAfter=2,
        ),
        "Footer": ParagraphStyle(
            "Footer", parent=base["Normal"], fontName="Helvetica",
            fontSize=7.5, textColor=MUTED,
        ),
        "TableCell": ParagraphStyle(
            "TableCell", parent=base["Normal"], fontName="Helvetica",
            fontSize=8.2, leading=10.5, textColor=INK,
        ),
        "TableHead": ParagraphStyle(
            "TableHead", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=8.2, leading=10.5, textColor=colors.white,
        ),
        "CalloutTitle": ParagraphStyle(
            "CalloutTitle", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=9, leading=11, textColor=STEEL,
        ),
        "CalloutBody": ParagraphStyle(
            "CalloutBody", parent=base["Normal"], fontName="Helvetica",
            fontSize=8.5, leading=11, textColor=INK,
        ),
        "PAVEHead": ParagraphStyle(
            "PAVEHead", parent=base["Normal"], fontName="Helvetica-Bold",
            fontSize=11, leading=14, textColor=colors.white, alignment=TA_CENTER,
        ),
        "Center": ParagraphStyle(
            "Center", parent=base["Normal"], fontName="Helvetica",
            fontSize=9, leading=12, textColor=MUTED, alignment=TA_CENTER,
        ),
    }
    _STYLE_CACHE = s
    return s


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.6)
    y = 0.55 * inch
    canvas.line(0.7 * inch, y + 10, letter[0] - 0.7 * inch, y + 10)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(0.7 * inch, y, "C172L N9858G · Private Pilot Airworthiness Checkride Guide")
    canvas.drawRightString(letter[0] - 0.7 * inch, y, f"Page {doc.page}")
    canvas.restoreState()


def cover_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, letter[0], 0.9 * inch, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica", 8)
    canvas.drawCentredString(
        letter[0] / 2, 0.4 * inch,
        "Study aid only — always verify current FARs, ACS, ADs, and aircraft records before flight.",
    )
    canvas.restoreState()


def qa(q, a, refs, width=None):
    s = _styles()
    blocks = [
        Paragraph(f"Q. {q}", s["Q"]),
        Paragraph(f"<b>A.</b> {a}", s["A"]),
        Paragraph(f"Official refs: {refs}", s["Ref"]),
        Spacer(1, 4),
        HRFlowable(width="100%", thickness=0.4, color=RULE, spaceAfter=4),
    ]
    return KeepTogether(blocks)


def section_title(text):
    s = _styles()
    return KeepTogether([
        Paragraph(text, s["H1"]),
        AccentBar(1.4 * inch, 3, AMBER),
        Spacer(1, 8),
    ])


def bullet(text):
    return Paragraph(f"• {text}", _styles()["Bullet"])


def make_table(headers, rows, col_widths):
    s = _styles()
    data = [[Paragraph(h, s["TableHead"]) for h in headers]]
    for row in rows:
        data.append([Paragraph(c, s["TableCell"]) for c in row])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]),
        ("BOX", (0, 0), (-1, -1), 0.7, RULE),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def build():
    s = _styles()
    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=letter,
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        topMargin=0.65 * inch,
        bottomMargin=0.75 * inch,
        title="C172L N9858G Private Pilot Airworthiness Checkride Guide",
        author="Checkride Study Aid",
    )
    W = doc.width
    story = []

    # -------- COVER --------
    story.append(Spacer(1, 0.6 * inch))
    story.append(Paragraph("PRIVATE PILOT PRACTICAL TEST · FAA-S-ACS-6C", s["CoverBrand"]))
    story.append(AccentBar(2.2 * inch, 4, AMBER))
    story.append(Spacer(1, 14))
    story.append(Paragraph("Airworthiness &amp; Required Documents", s["CoverTitle"]))
    story.append(Paragraph(
        "Full oral-exam breakdown for a Cessna 172L checkride — AROW, AV1ATE, MEL vs §91.213(d), "
        "PAVE, and DPE-style scenarios with FAR/AIM/ACS citations beside every topic.",
        s["CoverSub"],
    ))
    story.append(Spacer(1, 18))
    cover_meta = [
        ["Aircraft", "1971 Cessna 172L · N9858G · S/N 17259758"],
        ["Type Certificate", "TCDS 3A12 (Rev. 74) · Model 172L"],
        ["Engine / Prop", "Lycoming O-320-E2D 150 hp · McCauley 1C172 family"],
        ["ACS Task", "Area of Operation I, Task B — Airworthiness Requirements"],
        ["Primary regs", "14 CFR parts 39, 43, 91 · AIM · PHAK / AFH / Risk Mgmt Handbook"],
        ["Built for", "Private Pilot Airplane (ASEL) oral — DPE / FAA checkride"],
    ]
    meta_tbl = Table(
        [[Paragraph(f"<b>{a}</b>", s["Small"]), Paragraph(b, s["BodyLeft"])] for a, b in cover_meta],
        colWidths=[1.35 * inch, W - 1.35 * inch],
    )
    meta_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SOFT),
        ("BOX", (0, 0), (-1, -1), 1, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
    ]))
    story.append(meta_tbl)
    story.append(Spacer(1, 20))
    story.append(CalloutBox(
        "How to use this guide on the oral",
        "Say the regulation number, then explain the decision in plain English. DPEs want to hear "
        "§91.7, §91.203, §91.205, §91.213, and the inspection cascade (AV1ATE) without hunting. "
        "For inop gear, walk the §91.213(d) four-gate flow out loud. Tie answers to N9858G’s actual "
        "documents, logs, and TCDS 3A12.",
        W, border=AMBER, fill=colors.HexColor("#FBF4EA"),
    ))
    story.append(PageBreak())

    # -------- TOC --------
    story.append(section_title("Contents"))
    toc = [
        "1. How the airworthiness oral actually runs (ACS + DPE expectations)",
        "2. N9858G / Cessna 172L airplane identity (TCDS &amp; POH facts)",
        "3. Required documents — AROW / ARROW deep dive",
        "4. What “airworthy” means — §91.7 PIC responsibility",
        "5. Inspections &amp; records — AV1ATE",
        "6. Airworthiness Directives &amp; SAIBs",
        "7. Special flight permits",
        "8. Day / night VFR required equipment — §91.205",
        "9. MEL, MMEL, KOEL — does your airplane have an MEL?",
        "10. Flying with inoperative equipment — §91.213(d) flow",
        "11. Scenario: broken landing light — can you depart?",
        "12. Full PAVE checklist for a checkride flight",
        "13. DPE question bank (with FAR/AIM/ACS next to each)",
        "14. Rapid-fire mnemonic sheet",
        "15. Sources &amp; verification checklist",
    ]
    for line in toc:
        story.append(Paragraph(line, s["TOC"]))
    story.append(Spacer(1, 10))
    story.append(CalloutBox(
        "ACS source used",
        "Private Pilot for Airplane Category ACS, FAA-S-ACS-6C (November 2023; effective May 31, 2024 "
        "per FAA ACS listing). Task B references: 14 CFR parts 39, 43, 91; FAA-H-8083-2, -3, -25.",
        W,
    ))
    story.append(PageBreak())

    # -------- 1 HOW ORAL RUNS --------
    story.append(section_title("1. How the airworthiness oral actually runs"))
    story.append(Paragraph(
        "On a Private Pilot Airplane practical test, airworthiness sits in <b>Area of Operation I — "
        "Preflight Preparation, Task B — Airworthiness Requirements</b>. The DPE is not looking for "
        "memorized poems alone. You must locate documents, apply a scenario, and decide go / no-go "
        "with the correct regulation path.",
        s["Body"],
    ))
    story.append(Paragraph("ACS knowledge elements (PA.I.B)", s["H2"]))
    story.append(make_table(
        ["ACS code", "What you must understand", "Typical DPE probe"],
        [
            ["PA.I.B.K1a", "Location &amp; expiration of required aircraft certificates", "Show me AROW. What’s expired?"],
            ["PA.I.B.K1b", "Required inspections &amp; logbook documentation", "Walk AV1ATE from these logs."],
            ["PA.I.B.K1c", "ADs and SAIBs", "Is this AD recurring? How do you know it’s done?"],
            ["PA.I.B.K1d", "Purpose/procedure for a special flight permit", "Annual overdue — can we ferry it?"],
            ["PA.I.B.K1e", "Owner/operator and PIC responsibilities", "Who is responsible for airworthiness?"],
            ["PA.I.B.K2", "Pilot-performed preventive maintenance", "What can you as a private pilot do?"],
            ["PA.I.B.K3a–d", "Inop equipment, MEL, KOEL, placards/discrepancy records", "Landing light out — go or no?"],
            ["PA.I.B.K4", "Standard vs special airworthiness certificates", "What category is on the A/W certificate?"],
        ],
        [0.95 * inch, 3.2 * inch, 2.55 * inch],
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph("ACS risk &amp; skills", s["H2"]))
    story.append(bullet("<b>PA.I.B.R1</b> — Mitigate risk from inoperative equipment discovered before flight."))
    story.append(bullet("<b>PA.I.B.S1</b> — Locate and describe airplane airworthiness and registration information."))
    story.append(bullet("<b>PA.I.B.S2</b> — Determine the airplane is airworthy in the evaluator’s scenario."))
    story.append(bullet("<b>PA.I.B.S3</b> — Apply correct inoperative-equipment procedures in the scenario."))
    story.append(Paragraph(
        "Appendix 3 of the ACS also notes: if equipment is inoperative but legal under §91.213, the "
        "DPE must still confirm that nothing required to complete the practical test is missing.",
        s["Body"],
    ))
    story.append(Paragraph("Official refs: FAA-S-ACS-6C AOI Task B; ACS Appendix 3; 14 CFR §61.45", s["Ref"]))
    story.append(PageBreak())

    # -------- 2 AIRPLANE IDENTITY --------
    story.append(section_title("2. N9858G / Cessna 172L airplane identity"))
    story.append(Paragraph(
        "Bring these numbers to the oral. Examiners love when you can open the TCDS and POH and "
        "point to the exact model data — not a generic “172” answer.",
        s["Body"],
    ))
    story.append(make_table(
        ["Item", "N9858G / 172L fact", "Where it lives"],
        [
            ["Registration", "N9858G (valid; reg expiration on certificate — verify in aircraft)", "Registration certificate; FAA registry"],
            ["Model / year", "Cessna 172L, 1971", "Data plate; TCDS; registration"],
            ["Serial number", "17259758 (1971 model range 17259224–17259903)", "Data plate; TCDS 3A12 §VI"],
            ["Type certificate", "3A12", "TCDS header"],
            ["A/W certificate", "Standard — Normal &amp; Utility categories (A/W date 05/12/1971)", "Airworthiness certificate; FAA registry"],
            ["Engine", "Lycoming O-320-E2D, 150 hp @ 2700 RPM", "TCDS; engine data plate; POH"],
            ["Fuel (TCDS)", "80/87 minimum grade aviation gasoline", "TCDS; filler placard"],
            ["Prop (common)", "McCauley 1C172/MTM 7653 (and other approved models listed)", "TCDS §VI; prop data plate"],
            ["Max weight", "Normal 2300 lb · Utility 2000 lb · Seaplane 2220 lb", "TCDS; placards; W&amp;B"],
            ["Fuel capacity", "42 gal total / 38 gal usable (two 21-gal wing tanks)", "TCDS; POH / aircraft info"],
            ["Oil", "2 gal capacity (−14.0), 1.5 gal usable (aircraft card often shows 8 qt)", "TCDS Note 1; oil filler"],
            ["V-speeds (CAS)", "VA 122 mph · VNO 140 · VNE 174 · VFE 100", "TCDS; ASI markings; POH"],
            ["Certification basis", "CAR Part 3 (Nov 1, 1949) amdts 3-1 through 3-12 (Models 172–172P)", "TCDS “Data Pertinent to All Models”"],
            ["Electrical", "14-volt system for this serial range (Note 5)", "TCDS Note 5; aircraft info (14V / 50A alt.)"],
            ["KOEL note", "1971 172L Owner’s Manual era — typically <b>no modern KOEL table</b>; use equipment list + §91.205 + TCDS", "POH/Owner’s Manual; equipment list"],
        ],
        [1.15 * inch, 3.5 * inch, 2.05 * inch],
    ))
    story.append(Spacer(1, 8))
    story.append(CalloutBox(
        "TCDS “Equipment” statement that matters for §91.213(d)",
        "TCDS 3A12: “The basic required equipment as prescribed in the applicable airworthiness "
        "requirements (see Certification Basis) must be installed… Refer to applicable equipment list "
        "for the Model 172E and subsequent models.” For inop-equipment decisions, that equipment list "
        "(and any placards/AFM limitations) is your KOEL surrogate on an older 172L.",
        W, border=WARN, fill=colors.HexColor("#FBF0EA"),
    ))
    story.append(Paragraph(
        "Official refs: TCDS 3A12 Rev. 74 (Model 172L); C172L POH/Owner’s Manual for N9858G; "
        "14 CFR §21.41; FAA Aircraft Registry inquiry N9858G",
        s["Ref"],
    ))
    story.append(PageBreak())

    # -------- 3 AROW --------
    story.append(section_title("3. Required documents — AROW / ARROW"))
    story.append(Paragraph(
        "Mnemonic <b>AROW</b> (or <b>ARROW</b> if you include radio station license when required). "
        "These must be aboard (airworthiness certificate displayed). Weight &amp; balance is required "
        "to operate within limitations even though it is not always listed in the AROW rhyme.",
        s["Body"],
    ))
    story.append(make_table(
        ["Letter", "Document", "Key rule / DPE trap"],
        [
            ["A", "Airworthiness certificate", "§91.203(a)(1),(b) — appropriate &amp; current; displayed at cabin/cockpit entrance, legible. Does <b>not</b> expire, but aircraft must remain airworthy."],
            ["R", "Registration certificate", "§91.203(a)(2) — effective U.S. registration. <b>Does expire</b> (typically 3 years / see certificate). N-number must match."],
            ["O", "Operating limitations", "AFM/POH (when required), placards, markings. For older 172L: placards + owner’s manual / AFM as applicable. See also §91.9."],
            ["W", "Weight &amp; balance data", "Current empty weight, CG, equipment list. TCDS Note 1 requires W&amp;B at certification; §91.9 — operate within limits."],
            ["R*", "Radio station license", "Only when required (generally international / certain ops). Many U.S.-only Part 91 trainers do not need one aboard. Ask/verify for your op."],
        ],
        [0.55 * inch, 1.55 * inch, 4.6 * inch],
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph("Also expected on the airplane / in records (not all in the AROW rhyme)", s["H2"]))
    story.append(bullet("External data plate (§45.11) with nationality/registration marks (§45.23)."))
    story.append(bullet("Compass deviation card (§23.1547 / certification rules; still expected in practice)."))
    story.append(bullet("ELTs and maintenance entries when installed (§91.207)."))
    story.append(bullet("Transponder/ADS-B maintenance records when used in rule airspace (§91.413 / §91.225)."))
    story.append(qa(
        "Is the airworthiness certificate “expired” if the annual is overdue?",
        "No — the standard airworthiness certificate itself does not expire. But the aircraft is <b>not "
        "airworthy</b> if required inspections, ADs, or configuration requirements are not met. You may "
        "not operate it under §91.7 until corrected (or a special flight permit authorizes a ferry).",
        "14 CFR §21.181; §91.7; §91.409; ACS PA.I.B.K1a / K1d",
    ))
    story.append(qa(
        "Where must the airworthiness certificate be?",
        "Displayed at the cabin or cockpit entrance so it is legible to passengers or crew.",
        "14 CFR §91.203(b)",
    ))
    story.append(PageBreak())

    # -------- 4 AIRWORTHY --------
    story.append(section_title("4. What “airworthy” means — §91.7"))
    story.append(Paragraph(
        "Two classic parts of airworthiness (PHAK / maintenance community framing the DPE expects):",
        s["Body"],
    ))
    story.append(bullet("<b>Conformity</b> — aircraft matches its type design (TCDS, STCs, ADs, approved alterations)."))
    story.append(bullet("<b>Condition for safe operation</b> — maintained, inspected, and safe to fly."))
    story.append(Spacer(1, 4))
    story.append(CalloutBox(
        "§91.7 Civil aircraft airworthiness (say this almost verbatim)",
        "(a) No person may operate a civil aircraft unless it is in an airworthy condition.<br/>"
        "(b) The pilot in command of a civil aircraft is responsible for determining whether that "
        "aircraft is in condition for safe flight. The PIC shall discontinue the flight when "
        "unairworthy mechanical, electrical, or structural conditions occur.",
        W, border=NAVY,
    ))
    story.append(Paragraph(
        "Owner/operator responsibilities for maintenance, inspections, and AD compliance live in "
        "§91.403 and related rules — but the PIC still makes the final go/no-go for safe flight.",
        s["Body"],
    ))
    story.append(Paragraph("Official refs: 14 CFR §91.7; §91.403; FAA-H-8083-25 (PHAK) Ch. 9; ACS PA.I.B.K1e", s["Ref"]))
    story.append(PageBreak())

    # -------- 5 AV1ATE --------
    story.append(section_title("5. Inspections &amp; records — AV1ATE"))
    story.append(Paragraph(
        "Use <b>AV1ATE</b> as your inspection cascade. For each item: due date / tach / Hobbs, "
        "who signed, and where the entry is.",
        s["Body"],
    ))
    story.append(make_table(
        ["", "Inspection / item", "Rule &amp; interval", "What you show the DPE"],
        [
            ["A", "Annual inspection", "§91.409(a) — every 12 calendar months", "Logbook entry + return to service by A&amp;P with IA"],
            ["V", "VOR check (IFR)", "§91.171 — within preceding 30 days for IFR", "Usually N/A for pure VFR PPL checkride unless IFR used"],
            ["1", "100-hour (if required)", "§91.409(b) — aircraft for hire / flight instruction for hire", "If school airplane used for hire instruction: required. Privately operated not-for-hire: annual alone may suffice."],
            ["A", "Altimeter / static (IFR)", "§91.411 — 24 calendar months", "Required to operate under IFR in controlled airspace"],
            ["T", "Transponder", "§91.413 — 24 calendar months", "Needed if transponder is used / required"],
            ["E", "ELT", "§91.207 — inspect every 12 calendar months; battery rules", "Inspection entry; battery replacement dates"],
        ],
        [0.35 * inch, 1.35 * inch, 2.4 * inch, 2.6 * inch],
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph("Other currency items DPEs often weave in", s["H2"]))
    story.append(bullet("<b>ADS-B Out</b> — must be ON and performing if required by §91.225; maintenance/compliance records matter."))
    story.append(bullet("<b>Airworthiness Directives</b> — see next section; treat as “must be done” inspections."))
    story.append(bullet("<b>Progressive inspection</b> — alternate program under §91.409(d) if approved."))
    story.append(bullet("<b>After maintenance</b> — §91.407 operational check / test flight rules when flight characteristics may have changed."))
    story.append(qa(
        "Does a rental/training 172 need a 100-hour?",
        "If it is operated to carry persons for hire, or to give flight instruction for hire, yes — "
        "§91.409(b). Many school airplanes need both annual and 100-hour. A privately owned airplane "
        "not used for hire generally needs the annual (and other applicable items), not a 100-hour. "
        "Know which regime N9858G is under for your flight.",
        "14 CFR §91.409(a),(b); ACS PA.I.B.K1b",
    ))
    story.append(qa(
        "Calendar month — if annual was done January 15, when is it due?",
        "It is due by the end of January next year (through January 31). “12 calendar months” means "
        "you get the remainder of the month.",
        "14 CFR §91.409; PHAK / common DPE clarification",
    ))
    story.append(PageBreak())

    # -------- 6 ADs --------
    story.append(section_title("6. Airworthiness Directives &amp; SAIBs"))
    story.append(Paragraph(
        "ADs are legally enforceable rules (Part 39). An airplane with an applicable unpaid AD is not "
        "airworthy. SAIBs (Special Airworthiness Information Bulletins) are informational — not "
        "mandatory like ADs — but a sharp applicant knows the difference and still considers them in risk management.",
        s["Body"],
    ))
    story.append(bullet("<b>One-time AD</b> — comply once; keep the record."))
    story.append(bullet("<b>Recurring AD</b> — comply at the specified interval (hours/cycles/calendar)."))
    story.append(bullet("<b>Emergency AD</b> — immediate action; rare but possible."))
    story.append(bullet("Research: FAA AD search by make/model/serial + engine/prop ADs + STC appliances."))
    story.append(qa(
        "Who must comply with ADs?",
        "The owner/operator is primarily responsible for maintaining the aircraft in an airworthy "
        "condition, including AD compliance (§91.403). The PIC still must determine the aircraft is "
        "safe/airworthy before flight (§91.7).",
        "14 CFR part 39; §91.403; §91.7; ACS PA.I.B.K1c / K1e",
    ))
    story.append(qa(
        "Where do you prove ADs are done?",
        "Aircraft maintenance records — AD compliance list / logbook entries stating method of "
        "compliance, date, and hours/cycles as applicable (§91.417).",
        "14 CFR §91.417; ACS PA.I.B.K1b / K1c",
    ))
    story.append(PageBreak())

    # -------- 7 SPECIAL FLIGHT PERMIT --------
    story.append(section_title("7. Special flight permits (“ferry permits”)"))
    story.append(Paragraph(
        "If the aircraft does not currently meet airworthiness requirements but can be safely flown "
        "under limitations (e.g., overdue annual, to a repair station), you may request a <b>special "
        "flight permit</b> under §21.197 / §21.199 (and operating rules).",
        s["Body"],
    ))
    story.append(bullet("Purpose examples: fly to a point for repair/inspection/storage; deliver; evacuate danger; customer demo under conditions; overweight ferry within limits (see TCDS Note 6 for structural ferry guidance on 172s)."))
    story.append(bullet("Issued by FAA Flight Standards / FSDO process (or authorized persons)."))
    story.append(bullet("Operate only as the permit authorizes — route, crew, daylight, gear stowed, etc."))
    story.append(qa(
        "Annual expired yesterday — can we still fly the checkride?",
        "Not under the standard airworthiness certificate alone. Options: complete the inspection and "
        "return to service, or obtain a special flight permit for an authorized ferry (a practical test "
        "is not what ferry permits are for). For the checkride, the airplane must be airworthy for the "
        "test (§61.45 / ACS).",
        "14 CFR §21.197; §21.199; §91.203; §61.45; ACS PA.I.B.K1d; ACS Appendix 3",
    ))
    story.append(PageBreak())

    # -------- 8 91.205 --------
    story.append(section_title("8. Day / night VFR required equipment — §91.205"))
    story.append(Paragraph(
        "Mnemonics help; reading the regulation wins. Recite <b>A TOMATO FLAMES</b> (day) and "
        "<b>FLAPS</b> (night additions), then open §91.205 if needed.",
        s["Body"],
    ))
    story.append(Paragraph("Day VFR — A TOMATO FLAMES (§91.205(b))", s["H2"]))
    day_items = [
        ("A", "Altimeter"),
        ("T", "Tachometer (for each engine)"),
        ("O", "Oil temperature gauge (each engine with liquid cooling — know your Lycoming air-cooled case: oil temp still required for this engine type as equipped)"),
        ("M", "Manifold pressure gauge (each altitude engine — typically N/A for O-320 normally aspirated; say so)"),
        ("A", "Airspeed indicator"),
        ("T", "Temperature gauge (each liquid-cooled engine — N/A if air-cooled)"),
        ("O", "Oil pressure gauge (each engine)"),
        ("F", "Fuel gauge (each tank)"),
        ("L", "Landing gear position indicator (retractable only — N/A on 172L fixed gear)"),
        ("A", "Anti-collision lights (aircraft certificated after certain dates / as required — know anticollision requirements; also see night)"),
        ("M", "Magnetic direction indicator (compass)"),
        ("E", "ELTs as required by §91.207"),
        ("S", "Safety belts / shoulder harnesses as required"),
    ]
    # Cleaner standard list for the mnemonic commonly taught:
    story.append(Paragraph(
        "Common training mnemonic mapping (verify against the actual regulatory text for your exact airplane/date of certification):",
        s["Body"],
    ))
    story.append(make_table(
        ["Mnemonic", "Item", "172L note"],
        [
            ["A", "Airspeed indicator", "Required"],
            ["T", "Tachometer (each engine)", "Required"],
            ["O", "Oil pressure gauge", "Required"],
            ["M", "Manifold pressure gauge", "Usually N/A (non-altitude engine)"],
            ["A", "Altimeter", "Required"],
            ["T", "Temperature gauge (liquid-cooled)", "N/A if air-cooled O-320"],
            ["O", "Oil temperature gauge", "Required for this engine installation"],
            ["F", "Fuel gauge (each tank)", "Required"],
            ["L", "Landing gear position indicator", "N/A — fixed gear"],
            ["A", "Anti-collision light system", "Required if certificated after the applicable date / installed as required — know your airplane"],
            ["M", "Magnetic compass", "Required"],
            ["E", "ELT", "Per §91.207"],
            ["S", "Safety belts", "Per §91.205 / §91.107"],
        ],
        [0.8 * inch, 2.4 * inch, 3.5 * inch],
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph("Night VFR additions — FLAPS (§91.205(c))", s["H2"]))
    story.append(make_table(
        ["Mnemonic", "Item", "Hire vs private trap"],
        [
            ["F", "Fuses (spare set) or three of each kind accessible in flight (if fuses used)", "Know if your 172 uses breakers vs fuses"],
            ["L", "Landing light", "<b>Only if the aircraft is operated for hire</b>"],
            ["A", "Anti-collision lights", "Required for night"],
            ["P", "Position lights", "Required for night"],
            ["S", "Source of electrical energy (adequate)", "Battery/alternator system"],
        ],
        [0.8 * inch, 2.6 * inch, 3.3 * inch],
    ))
    story.append(Spacer(1, 6))
    story.append(CalloutBox(
        "Examiner tip",
        "Do not stop at the mnemonic. Say: “For this Part 91 private flight that is not for hire, "
        "§91.205(c)(4) does not require a landing light at night — but I still must clear §91.213(d) "
        "gates and decide if it is a hazard.”",
        W, border=AMBER, fill=colors.HexColor("#FBF4EA"),
    ))
    story.append(Paragraph("Official refs: 14 CFR §91.205; §91.209 (lights); ACS PA.I.B.K3; AIM lighting paragraphs as applicable", s["Ref"]))
    story.append(PageBreak())

    # -------- 9 MEL --------
    story.append(section_title("9. Does your airplane have an MEL?"))
    story.append(Paragraph(
        "This is one of the highest-yield Private Pilot oral questions. Most light training 172s — "
        "including a typical Part 91 Cessna 172L like N9858G — <b>do not</b> operate under an approved MEL.",
        s["Body"],
    ))
    story.append(make_table(
        ["Term", "What it is", "Applies to N9858G?"],
        [
            ["MMEL", "Master Minimum Equipment List — FAA-approved generic list for an aircraft type", "May exist for C-172 type, but that alone does <b>not</b> authorize you to use it"],
            ["MEL", "Minimum Equipment List customized for a specific aircraft + Letter of Authorization (LOA)", "Only if issued/authorized for <b>that</b> aircraft; uncommon on school 172Ls"],
            ["KOEL", "Kinds of Operations Equipment List in many modern AFM/POHs (day/night/VFR/IFR columns)", "1971 172L manuals usually lack a modern KOEL grid — use equipment list + placards + §91.205"],
            ["§91.213(d)", "No-MEL deferral process for many small non-turbine airplanes", "<b>Yes — this is your normal path</b>"],
        ],
        [0.85 * inch, 3.4 * inch, 2.45 * inch],
    ))
    story.append(Spacer(1, 8))
    story.append(qa(
        "Does N9858G have an MEL?",
        "Unless the aircraft records specifically contain an approved MEL and a Flight Standards LOA "
        "authorizing its use, <b>no</b>. Answer: “We do not have an MEL/LOA, so I use §91.213(d).” "
        "Never invent an MEL. If an MEL/LOA exists, you <b>must</b> use it (§91.213(c) for those required to).",
        "14 CFR §91.213(a)–(d); AC 91-67; ACS PA.I.B.K3b",
    ))
    story.append(qa(
        "What is the difference between MEL and KOEL?",
        "KOEL tells you what equipment is required for a kind of operation (often in Section 2 of a "
        "modern POH). An MEL is a controlled deferral document that lets you fly with listed items "
        "inoperative under specific conditions and repair intervals. KOEL is about “required for this "
        "kind of flight.” MEL is about “how you may continue with something broken.”",
        "AFM/POH; §91.213; ACS PA.I.B.K3b / K3c",
    ))
    story.append(PageBreak())

    # -------- 10 91.213 FLOW --------
    story.append(section_title("10. Inoperative equipment — the §91.213(d) flow"))
    story.append(Paragraph(
        "If no MEL path applies, memorize this spoken flow. DPEs listen for the four “not required” "
        "gates, then deactivation/placard, then hazard determination.",
        s["Body"],
    ))
    story.append(CalloutBox(
        "Speak this sequence",
        "<b>1. Is there an MEL + LOA?</b> If yes → use it. If no → continue.<br/>"
        "<b>2. Four gates — the item must NOT be:</b><br/>"
        "&nbsp;&nbsp;(i) Part of VFR-day type-certification instruments/equipment;<br/>"
        "&nbsp;&nbsp;(ii) Indicated as required on the aircraft equipment list or KOEL for this kind of operation;<br/>"
        "&nbsp;&nbsp;(iii) Required by §91.205 or any other Part 91 rule for this flight; or<br/>"
        "&nbsp;&nbsp;(iv) Required operable by an AD.<br/>"
        "<b>3. If it fails any gate</b> → repair, replace, or get a special flight permit if appropriate. No deferral.<br/>"
        "<b>4. If it passes all gates</b> → remove (placard control, record §43.9) <b>or</b> deactivate and placard "
        "“Inoperative” (maintenance recorded if deactivation is maintenance under Part 43).<br/>"
        "<b>5. Hazard call</b> → a certificated pilot (or qualified maintenance person) determines it is not a hazard.",
        W, border=STEEL,
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph("Practical decision matrix (checkride favorites)", s["H2"]))
    story.append(make_table(
        ["Inop item", "Likely day VFR Part 91 private?", "Why"],
        [
            ["Landing light", "Often YES (after placard + hazard call)", "Not required by §91.205 for non-hire; still clear equipment list/AD/hazard"],
            ["Cabin dome light", "Usually YES", "Not a §91.205 day item"],
            ["GPS (VFR)", "Usually YES if not required by equipment list/ops", "Not a day VFR mandated instrument; still hazard/nav risk under PAVE"],
            ["Transponder in rule airspace needing it", "NO", "Required by Part 91 operating rules for that airspace/operation"],
            ["Alternator / electrical failure deferred?", "Usually NO / high hazard", "Often affects required systems; hazard determination fails"],
            ["ASI / altimeter / oil pressure", "NO", "§91.205 / type certification required"],
            ["Beacon/strobe anticollision when required", "NO for that operation", "§91.205 / §91.209 as applicable"],
            ["Seat belt", "NO", "Required"],
        ],
        [1.7 * inch, 2.0 * inch, 3.0 * inch],
    ))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Official refs: 14 CFR §91.213; §43.9; AC 91-67; FAA-H-8083-25; ACS PA.I.B.K3a–d, R1, S3",
        s["Ref"],
    ))
    story.append(PageBreak())

    # -------- 11 LANDING LIGHT --------
    story.append(section_title("11. Scenario: Can you depart with a broken landing light?"))
    story.append(Paragraph(
        "This is the classic DPE fork. Your answer must branch on <b>day vs night</b> and "
        "<b>for hire vs not for hire</b>, then run §91.213(d).",
        s["Body"],
    ))
    story.append(Paragraph("Branch A — Day VFR, Part 91, not for hire (typical PPL checkride)", s["H2"]))
    story.append(Paragraph(
        "<b>Usually YES, you may depart</b> — if you correctly defer under §91.213(d).",
        s["Body"],
    ))
    story.append(bullet("MEL/LOA? Typically no on N9858G → use §91.213(d)."))
    story.append(bullet("Gate (i) VFR-day type certification equipment? Landing light is not a CAR 3 day-cert basic flight instrument like ASI/altimeter."))
    story.append(bullet("Gate (ii) Required on equipment list / KOEL for day VFR? Check N9858G equipment list — landing lights are normally optional equipment, not “required” for day VFR kind of operation."))
    story.append(bullet("Gate (iii) Required by §91.205 or other Part 91 rule for <b>this</b> flight? Day VFR: landing light not in §91.205(b)."))
    story.append(bullet("Gate (iv) Required by AD? Unlikely for a generic landing light — still verify."))
    story.append(bullet("Then: deactivate + placard “Inoperative” (or remove with proper recording) and determine no hazard (glare N/A, electrical short secured, etc.)."))
    story.append(Paragraph("Branch B — Night VFR, Part 91, <b>not</b> for hire", s["H2"]))
    story.append(Paragraph(
        "<b>Often YES legally under §91.205</b> — because §91.205(c)(4) requires an electric landing "
        "light only if operated <b>for hire</b>. You still must pass the other §91.213(d) gates and the "
        "hazard call. Risk management (PAVE / night ops ACS) may still say “poor choice” even when legal.",
        s["Body"],
    ))
    story.append(Paragraph("Branch C — Night, operated for hire (e.g., some commercial/training-for-hire ops)", s["H2"]))
    story.append(Paragraph(
        "<b>NO</b> — §91.205(c)(4) makes the landing light required. Gate (iii) fails. Repair it or do not go.",
        s["Body"],
    ))
    story.append(Spacer(1, 6))
    story.append(CalloutBox(
        "Model oral answer (day private flight)",
        "“We don’t have an MEL, so I use 91.213(d). A landing light isn’t required for day VFR under "
        "91.205, isn’t a VFR-day type-cert required instrument, and unless the equipment list or an AD "
        "says it’s required for this operation, I can deactivate and placard it Inoperative, log as "
        "needed, and as PIC determine it’s not a hazard. Then I’m legal to depart.”",
        W, border=OK, fill=colors.HexColor("#EAF6F0"),
    ))
    story.append(Paragraph(
        "Official refs: 14 CFR §91.205(b),(c)(4); §91.213(d); §91.7; ACS PA.I.B.K3 / R1 / S3; FAA-H-8083-2 risk mgmt",
        s["Ref"],
    ))
    story.append(PageBreak())

    # -------- 12 PAVE --------
    story.append(section_title("12. Full PAVE checklist for a checkride flight"))
    story.append(Paragraph(
        "PAVE is the ACS/PHAK risk-management framework: <b>Pilot, Aircraft, enVironment, External "
        "pressures</b>. Below is a checkride-ready PAVE you can fill for N9858G. Airworthiness lives "
        "mostly in <b>A</b>, but DPEs watch whether you connect inop gear and weather to the whole picture.",
        s["Body"],
    ))

    def pave_block(letter, title, color, lines):
        head = Table(
            [[Paragraph(f"{letter} — {title}", s["PAVEHead"])]],
            colWidths=[W],
        )
        head.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), color),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        body_rows = [[Paragraph(line, s["BodyLeft"])] for line in lines]
        body = Table(body_rows, colWidths=[W])
        body.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), SOFT),
            ("BOX", (0, 0), (-1, -1), 0.8, color),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        return [head, body, Spacer(1, 8)]

    for flow in pave_block("P", "PILOT", NAVY, [
        "<b>Certificate / medical / BasicMed:</b> Private privileges; medical or BasicMed current (§61.3, §61.23, Part 68).",
        "<b>Flight review / passenger currency:</b> §61.56 flight review; §61.57 day/night takeoff-landing currency if carrying passengers.",
        "<b>Proficiency vs currency:</b> Checkride stress — sleep, food, illness, medication (IMS AFE / PAVE).",
        "<b>Personal minimums:</b> Ceiling/visibility/wind higher than legal Part 91 VFR mins for the test day.",
        "<b>ACS Tasks today:</b> Am I ready for stalls, short/soft, ground reference, diversion, emergencies?",
        "<b>Hazardous attitudes:</b> Macho / invulnerability / anti-authority / impulsivity / resignation — name mitigations.",
    ]):
        story.append(flow)

    for flow in pave_block("A", "AIRCRAFT (airworthiness heart)", STEEL, [
        "<b>AROW aboard &amp; matched to N9858G:</b> A/W certificate displayed; registration effective; operating limitations/placards; current W&amp;B + equipment list.",
        "<b>AV1ATE:</b> Annual (and 100-hour if required) current; ELT inspected; transponder/altimeter if needed for today’s airspace/IFR; AD list reviewed.",
        "<b>Deferred defects:</b> Any open squawks? If inop items exist — MEL or §91.213(d) completed with placards.",
        "<b>Performance:</b> Weight &amp; balance within Normal category 2300 lb / CG envelope; takeoff/landing distances for runway &amp; density altitude.",
        "<b>Fuel/oil:</b> 42/38 fuel system; grade correct; oil quantity (target ~6+ qt per aircraft practice); sumps drained.",
        "<b>POH procedures:</b> Speeds (Vy 82 mph, Vx 68, Vg 80, VA 122 at 2300) committed; emergencies briefed.",
        "<b>Inop example:</b> Landing light deferred? Placarded? Still safe for planned day checkride? Yes/No with regs.",
    ]):
        story.append(flow)

    story.append(PageBreak())
    story.append(Paragraph("PAVE continued", s["H2"]))
    for flow in pave_block("V", "enVIRONMENT", colors.HexColor("#3D6B51"), [
        "<b>Weather:</b> METAR/TAF/GFA/AIRMETs; ceiling/vis for VFR; wind vs 14 kt demonstrated crosswind; turbulence/icing (172L: avoid known icing — placard).",
        "<b>Terrain / airports:</b> Runway lengths vs performance; obstacles; hot/high density altitude on a summer checkride.",
        "<b>Airspace:</b> Route for cross-country planning task; TFRs; ADS-B/transponder needs (§91.225 / §91.215).",
        "<b>Daylight:</b> If night — lighting, §91.209, airport lighting, pilot night currency if pax.",
        "<b>ATC / workload:</b> Busy Class D/C vs nontowered; DPE distractions as simulated emergencies.",
    ]):
        story.append(flow)

    for flow in pave_block("E", "EXTERNAL PRESSURES", AMBER, [
        "<b>Checkride pressure:</b> “Get it done today” before examiner leaves / weather closes — set a personal “no-go” line in advance.",
        "<b>Scheduling money:</b> Aircraft rental / DPE fee sunk-cost fallacy.",
        "<b>People:</b> Instructor optimism, family watching, pride after long training.",
        "<b>Mitigation:</b> Predetermined abort criteria; willing to discontinue (§91.3 PIC authority); honest IMSAFE.",
        "<b>After a deferral:</b> Don’t let “we placarded it, so we’re fine” replace a real hazard assessment.",
    ]):
        story.append(flow)

    story.append(Paragraph(
        "Official refs: FAA-H-8083-2 (Risk Management Handbook) PAVE/IMSAFE; FAA-H-8083-25; "
        "ACS AOI Tasks A–D risk elements; 14 CFR §91.3",
        s["Ref"],
    ))
    story.append(PageBreak())

    # -------- 13 QUESTION BANK --------
    story.append(section_title("13. DPE question bank — airworthiness oral"))
    story.append(Paragraph(
        "Practice answering out loud in 20–40 seconds, citing the rule number first. Questions are "
        "aligned to ACS PA.I.B and common Private Pilot gouges.",
        s["Body"],
    ))

    questions = [
        ("What documents must be on this airplane?",
         "AROW: Airworthiness certificate, Registration, Operating limitations (POH/placards), Weight &amp; balance. Radio station license if required for the operation. Plus you must be able to show inspection/AD status from maintenance records.",
         "14 CFR §91.203; §91.9; ACS PA.I.B.K1a / S1"),
        ("Who is responsible for determining airworthiness before flight?",
         "The PIC is responsible for determining whether the aircraft is in condition for safe flight (§91.7(b)). The owner/operator is responsible for maintaining it airworthy (§91.403).",
         "14 CFR §91.7; §91.403; ACS PA.I.B.K1e"),
        ("Show me the airworthiness certificate — what does ‘Standard’ mean?",
         "It is a standard airworthiness certificate issued for Normal/Utility category operations as typed on the form. It remains effective as long as maintenance/inspections/ADs/markings requirements are met (§21.181).",
         "14 CFR §21.181; §91.203; ACS PA.I.B.K4"),
        ("Does registration expire?",
         "Yes. Check the expiration on the registration certificate and FAA registry. Airworthiness certificate does not expire the same way, but the airplane can still become unairworthy.",
         "14 CFR part 47; §91.203(a)(2); ACS PA.I.B.K1a"),
        ("What inspections are required on N9858G?",
         "Walk AV1ATE for today’s operation: Annual every 12 calendar months; 100-hour if used for hire/flight instruction for hire; ELT inspection; transponder/altimeter if those rules apply; ADs. State which apply to this exact flight.",
         "14 CFR §91.409; §91.207; §91.413; §91.411; part 39; ACS PA.I.B.K1b"),
        ("What is an AD? What is a SAIB?",
         "AD = mandatory Part 39 rule. SAIB = non-mandatory safety information. Uncompiled applicable AD = not airworthy.",
         "14 CFR part 39; FAA SAIB policy; ACS PA.I.B.K1c"),
        ("Can you fly with known inoperative equipment?",
         "Yes, only if you comply with §91.213 — either an approved MEL+LOA path or the §91.213(d) no-MEL process for eligible small airplanes, including placarding and a no-hazard determination.",
         "14 CFR §91.213; AC 91-67; ACS PA.I.B.K3a"),
        ("Does this 172 have an MEL?",
         "Only if there is an aircraft-specific approved MEL and LOA in the aircraft. Typical answer for a 172L trainer: No MEL — we use §91.213(d).",
         "14 CFR §91.213(a),(d); ACS PA.I.B.K3b"),
        ("What is a KOEL and does the 172L have one?",
         "Kinds of Operations Equipment List — modern AFM table showing required equipment by day/night/VFR/IFR. Many 1971 172L manuals do not include a modern KOEL; use the equipment list, placards, TCDS, and §91.205 instead.",
         "POH/AFM; TCDS 3A12 equipment note; ACS PA.I.B.K3c"),
        ("Walk me through 91.213(d).",
         "No MEL → item must not be required by type-cert VFR-day equipment, equipment list/KOEL, §91.205/other Part 91 rules, or AD → remove or deactivate &amp; placard Inoperative → pilot/mechanic determines no hazard.",
         "14 CFR §91.213(d); ACS PA.I.B.S3"),
        ("Landing light is out — can we go?",
         "Day private: usually yes after §91.213(d). Night private not-for-hire: often still legal under §91.205 but must clear 91.213(d) + hazard/PAVE. Night for hire: no — landing light required.",
         "14 CFR §91.205(c)(4); §91.213(d)"),
        ("Beacon is out at night — can we go?",
         "Generally no for night if anticollision lighting is required for that aircraft/operation under §91.205(c) / §91.209. Do not shrug this one away — treat anticollision/position lights as required night equipment.",
         "14 CFR §91.205(c); §91.209"),
        ("Transponder is inoperative — can we depart VFR?",
         "Depends on airspace/route. If the flight needs a transponder under §91.215 (or ADS-B under §91.225), you need an ATC deviation/authorization or must avoid that airspace. Also run §91.213(d).",
         "14 CFR §91.215; §91.225; §91.213; AIM ATC contingency guidance"),
        ("What preventive maintenance can you do?",
         "Part 43 Appendix A(c) lists preventive maintenance a pilot may perform on an aircraft they own/operate (with limitations). Examples often discussed: remove/install landing gear tires, service struts, replace bulbs, etc. Log per §43.9. If it’s not on the list, it’s maintenance for a mechanic.",
         "14 CFR part 43 App. A; §43.3; §43.9; ACS PA.I.B.K2"),
        ("What is a special flight permit?",
         "FAA authorization to fly an aircraft that may not currently meet all airworthiness requirements to a place for repair/inspection/etc., under specific limitations (§21.197/§21.199).",
         "14 CFR §21.197; §21.199; ACS PA.I.B.K1d"),
        ("Where do you find operating limitations for the 172L?",
         "Placards, instrument markings, and the Owner’s Manual/POH. TCDS 3A12 also lists limitations and required placard text for Model 172L.",
         "14 CFR §91.9; TCDS 3A12; POH; ACS PA.I.B.K1a"),
        ("Utility vs Normal category — what changes?",
         "Utility: lower max weight (2000 lb), aft CG restricted, rear seat/baggage typically unoccupied, limited approved maneuvers (chandelles, lazy eights, steep turns, spins, stalls). Normal: 2300 lb, no aerobatics/spins.",
         "TCDS 3A12 Model 172L placards; POH limitations"),
        ("What fuel grade?",
         "TCDS: 80/87 minimum grade aviation gasoline. In practice many operators use approved alternate grades per STC/SI — know what YOUR airplane’s placards/STCs allow (often 100LL under approved data). Don’t guess — read the placard/STC.",
         "TCDS 3A12; aircraft placards/STCs; §91.9"),
        ("After an annual, who returns it to service?",
         "An inspection authorization (IA) holder for the annual inspection return to service.",
         "14 CFR §91.409; part 65 IA privileges"),
        ("The DPE finds an open squawk on the walkaround. What do you do?",
         "Identify the discrepancy, apply §91.7 and §91.213 (or cancel). Do not rationalize. Placard/defer only if legal; otherwise maintenance. ACS skill: determine airworthiness in the scenario given.",
         "14 CFR §91.7; §91.213; ACS PA.I.B.S2 / S3 / R1"),
        ("What records must be kept available?",
         "Maintenance records showing status of life-limited parts, AD compliance, inspections, etc. (§91.417). You should be able to show currency of required inspections before acting as PIC.",
         "14 CFR §91.417; ACS PA.I.B.K1b"),
        ("Can you begin a flight with an inoperative GPS and paper charts only?",
         "Often yes for VFR if not required by equipment list/ops specs, after §91.213(d) if the unit is installed/inop, and if you can navigate safely (ACS navigation/risk). Legal ≠ smart in complex airspace.",
         "14 CFR §91.213; §91.103; ACS AOI cross-country tasks"),
        ("What is the difference between airworthy and legal to fly this route?",
         "Airworthy = conformity + safe condition + inspections/ADs/equipment requirements. Legal route ops also need pilot privileges/currency, weather mins, airspace equipage (ADS-B), flight rules compliance — PIC §91.103 preflight.",
         "14 CFR §91.7; §91.103; §91.205; §91.225"),
        ("ELT battery due date passed — go?",
         "No until complied with §91.207 battery/inspection requirements (unless an exception in the rule applies). Show the entry.",
         "14 CFR §91.207"),
        ("How do you use the TCDS on the oral?",
         "Identify model/serial eligibility, engine/prop, weight/CG, airspeeds, placards, certification basis, equipment note. For 172L S/N 17259758, quote Model 172L 1971 block.",
         "TCDS 3A12; ACS PA.I.B.S1"),
    ]

    for q, a, refs in questions:
        story.append(qa(q, a, refs))

    story.append(PageBreak())

    # -------- 14 MNEMONICS --------
    story.append(section_title("14. Rapid-fire mnemonic sheet"))
    story.append(make_table(
        ["Mnemonic", "Use", "Expands to / meaning"],
        [
            ["AROW", "Documents aboard", "Airworthiness, Registration, Operating limitations, Weight &amp; balance"],
            ["AV1ATE", "Inspections", "Annual, VOR, 100-hour, Altimeter, Transponder, ELT"],
            ["A TOMATO FLAMES", "Day VFR equipment", "§91.205(b) required instruments/equipment mnemonic"],
            ["FLAPS", "Night VFR add-ons", "Fuses, Landing light (if for hire), Anti-collision, Position lights, Source of electricity"],
            ["PAVE", "Risk management", "Pilot, Aircraft, enVironment, External pressures"],
            ["IMSAFE", "Pilot fitness", "Illness, Medication, Stress, Alcohol, Fatigue, Emotion"],
            ["ATOMATO… + 91.213 gates", "Inop gear", "Required? → fix/permit. Not required? → placard + no hazard"],
        ],
        [1.4 * inch, 1.5 * inch, 3.8 * inch],
    ))
    story.append(Spacer(1, 10))
    story.append(Paragraph("N9858G numbers to memorize", s["H2"]))
    story.append(bullet("S/N 17259758 · 1971 172L · TC 3A12 · Normal 2300 / Utility 2000"))
    story.append(bullet("O-320-E2D · 2700 RPM · 42/38 fuel · VA 122 mph CAS · VNE 174 · VNO 140 · VFE 100"))
    story.append(bullet("No MEL → §91.213(d) · Landing light out day private → usually deferrable"))
    story.append(PageBreak())

    # -------- 15 SOURCES --------
    story.append(section_title("15. Sources &amp; day-of-checkride verification"))
    story.append(Paragraph(
        "This guide was built from the current Private Pilot Airplane ACS (FAA-S-ACS-6C), 14 CFR "
        "parts 39/43/91, TCDS 3A12 for Model 172L, and the N9858G C172L POH/aircraft information "
        "package. Regulations and ADs change — verify before you fly.",
        s["Body"],
    ))
    story.append(Paragraph("Primary official publications", s["H2"]))
    story.append(bullet("FAA-S-ACS-6C Private Pilot for Airplane Category ACS — AOI Task B"))
    story.append(bullet("14 CFR §§ 91.3, 91.7, 91.9, 91.103, 91.203, 91.205, 91.207, 91.209, 91.213, 91.215, 91.225, 91.403, 91.407, 91.409, 91.411, 91.413, 91.417"))
    story.append(bullet("14 CFR part 39 (ADs); part 43 (maintenance, App. A preventive); §§ 21.181, 21.197, 21.199"))
    story.append(bullet("TCDS 3A12 Revision 74 — Cessna 172 series (Model 172L pages)"))
    story.append(bullet("FAA-H-8083-25 PHAK; FAA-H-8083-2 Risk Management Handbook; FAA-H-8083-3 AFH"))
    story.append(bullet("AC 91-67 (inoperative instruments/equipment guidance)"))
    story.append(bullet("AIM — airspace, lighting, services (as applicable to the scenario)"))
    story.append(Paragraph("Aircraft-specific package used", s["H2"]))
    story.append(bullet("C172L POH for N9858G (owner’s manual / operating handbook scan)"))
    story.append(bullet("C172L TCDS PDF (same 3A12 family document)"))
    story.append(bullet("N9858G aircraft data card (speeds, weights, systems summary)"))
    story.append(Spacer(1, 8))
    story.append(CalloutBox(
        "Day-of checklist (bring to the oral)",
        "1) Physical AROW documents matched to N-number<br/>"
        "2) Maintenance logs with annual/100-hr/ELT/AD status bookmarked<br/>"
        "3) Current W&amp;B and equipment list<br/>"
        "4) TCDS or printed Model 172L excerpt<br/>"
        "5) POH/Owner’s limitations + placard photos if helpful<br/>"
        "6) Your written §91.213(d) flow + landing-light branching answer<br/>"
        "7) Completed PAVE for the actual checkride plan",
        W, border=AMBER, fill=colors.HexColor("#FBF4EA"),
    ))
    story.append(Spacer(1, 14))
    story.append(HRFlowable(width="100%", thickness=1, color=NAVY))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "End of guide — fly the airplane that’s in the logs, not the airplane in your head.",
        s["Center"],
    ))

    def first_page(canvas, doc_):
        cover_footer(canvas, doc_)

    def later_pages(canvas, doc_):
        footer(canvas, doc_)

    doc.build(story, onFirstPage=first_page, onLaterPages=later_pages)
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    build()
