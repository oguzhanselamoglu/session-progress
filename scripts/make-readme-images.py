#!/usr/bin/env python3
"""Draws the README images (docs/images/*.svg) from invented example data.

The pictures copy the plugin's real layout line by line (band, sessions panel, progress panel); every name in them is made up.
Run it again after a visible change: `python3 scripts/make-readme-images.py`.
"""
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parent.parent / "docs" / "images"

# Dark theme, close to Claude Code's own.
C = {
    "bg": "#151515",
    "chrome": "#232323",
    "pane": "#1b1b1b",
    "rule": "#2e2e2e",
    "text": "#e8e6e3",
    "dim": "#8b8b8b",
    "claude": "#d97757",
    "success": "#4eba65",
    "warning": "#e5b94a",
    "error": "#e06c75",
    "inactive": "#6e6e6e",
    "permission": "#b1b9f9",
    "user": "#9fb8d9",
}
FONT = "ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace"
FS = 13  # font size
LH = 19  # line height
CW = 7.85  # approx. character width at FS (layout only; text flows on its own)


def span(text, color="text", bold=False):
    return (text, color, bold)


def text_line(x, y, spans, attrs=""):
    parts = []
    for t, color, bold in spans:
        w = ' font-weight="700"' if bold else ""
        parts.append(f'<tspan fill="{C[color]}"{w}>{escape(t)}</tspan>')
    return f'<text x="{x}" y="{y}" xml:space="preserve"{attrs}>{"".join(parts)}</text>'


def bar(percent, width):
    filled = round(percent / 100 * width)
    return "█" * filled + "░" * (width - filled)


ICON = {"done": ("✓", "success"), "active": ("●", "claude"), "waiting-user": ("⏸", "warning"), "pending": ("○", "inactive"),
        "skipped": ("–", "inactive"), "blocked": ("✗", "error"), "waiting-external": ("⧗", "permission")}


STRIP = "strip"


def strip(statuses):
    """A phase strip line: drawn with letter spacing (the icons are small in most monospace fonts)."""
    return [(STRIP, "", False)] + [span(ICON[s][0], ICON[s][1]) for s in statuses]


def svg(width, height, body, title):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
        f'font-family="{FONT}" font-size="{FS}">\n<title>{escape(title)}</title>\n' + "\n".join(body) + "\n</svg>\n"
    )


def window(width, height, title):
    return [
        f'<rect width="{width}" height="{height}" rx="12" fill="{C["bg"]}"/>',
        f'<path d="M0 12 a12 12 0 0 1 12 -12 h{width - 24} a12 12 0 0 1 12 12 v22 h-{width} z" fill="{C["chrome"]}"/>',
        f'<circle cx="20" cy="17" r="6" fill="#ff5f57"/><circle cx="40" cy="17" r="6" fill="#febc2e"/>'
        f'<circle cx="60" cy="17" r="6" fill="#28c840"/>',
        f'<text x="{width / 2}" y="22" text-anchor="middle" fill="{C["dim"]}" font-size="12">{escape(title)}</text>',
    ]


# ── Sessions panel (cards) ───────────────────────────────────────────────────────────────────────────────────────────────
def session_cards(t, x, y, w):
    """t: texts for one language. Returns (svg parts, bottom y)."""
    out = [text_line(x, y, [span(t["open"], bold=True), span(t["waiting_n"], "warning", True)])]
    y += 14
    for card in t["cards"]:
        lines = card["lines"]
        h = len(lines) * LH + 18
        border = {"warning": C["warning"], "claude": C["claude"]}.get(card["tone"], C["rule"])
        out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" fill="none" stroke="{border}" stroke-width="1.3"/>')
        ly = y + 24
        for spans in lines:
            if spans and spans[0][0] == STRIP:
                out.append(text_line(x + 14, ly, spans[1:], ' letter-spacing="3"'))
            else:
                out.append(text_line(x + 14, ly, spans))
            ly += LH
        y += h + 10
    y += 16
    out.append(text_line(x, y, [span(t["orphans"], bold=True), span(t["orphans_hint"], "dim")]))
    y += LH + 6
    for spans in t["orphan_lines"]:
        out.append(text_line(x + 16, y, spans))
        y += LH
    y += 12
    for spans in t["footer"]:
        out.append(text_line(x, y, spans))
        y += LH
    return out, y


def sessions_texts(lang):
    en = lang == "en"
    you = "⏸ WAITING ON YOU" if en else "⏸ SENDE BEKLİYOR"
    now_ = "just now" if en else "az önce"
    pct = (lambda n: f"{n}%") if en else (lambda n: f"%{n}")
    return {
        "open": "Open sessions · 4" if en else "Açık oturumlar · 4",
        "waiting_n": "   ⏸ 2 waiting on you" if en else "   ⏸ 2 sende bekliyor",
        "cards": [
            {"tone": "warning", "lines": [
                [span(you, "warning", True), span(f"  ·  {now_}", "dim")],
                [span("Checkout redesign" if en else "Ödeme sayfası yenileme", "claude", True)],
                [span(bar(33, 12), "success"), span(f"  2/6 · {pct(33)}", "dim")],
                strip(["done", "done", "waiting-user", "pending", "pending", "pending"]),
                [span("Waiting: Approve the plan" if en else "Bekliyor: Planı onayla", "warning")],
                [span(("checkout work (this)" if en else "ödeme işi (bu)") + "  ·  acme-shop", "dim")],
            ]},
            {"tone": "warning", "lines": [
                [span(you, "warning", True), span("  ·  3m ago" if en else "  ·  3dk önce", "dim")],
                [span("Payments webhook" if en else "Ödeme webhook'u", "claude", True)],
                [span(bar(40, 12), "success"), span(f"  2/5 · {pct(40)}", "dim")],
                strip(["done", "done", "waiting-user", "pending", "pending"]),
                [span("Waiting: Choose a retry policy" if en else "Bekliyor: Yeniden deneme politikasını seç", "warning")],
                [span("webhooks  ·  acme-shop-webhooks", "dim")],
            ]},
            {"tone": "claude", "lines": [
                [span("● working" if en else "● çalışıyor", "claude", True), span(f"  ·  {now_}", "dim")],
                [span("Search index rebuild" if en else "Arama dizini yeniden kurulumu", "claude", True)],
                [span(bar(60, 12), "success"), span(f"  3/5 · {pct(60)}", "dim")],
                strip(["done", "done", "done", "active", "pending"]),
                [span("Now: Backfill" if en else "Şu an: Geriye dönük doldurma"), span("  ·  claude", "dim")],
                [span("Next: Review" if en else "Sıradaki: İnceleme", "dim")],
                [span("search  ·  acme-shop-search", "dim")],
            ]},
            {"tone": "idle", "lines": [
                [span("○ idle" if en else "○ boşta", "dim"), span("  ·  4m ago" if en else "  ·  4dk önce", "dim")],
                [span("API v2 migration" if en else "API v2 geçişi", "claude", True)],
                [span(bar(100, 12), "success"), span(f"  7/7 · {pct(100)}", "dim")],
                strip(["done"] * 7),
                [span("✓ completed" if en else "✓ tamamlandı", "success")],
                [span(("session 9f2c1a" if en else "oturum 9f2c1a") + "  ·  acme-api", "dim")],
            ]},
        ],
        "orphans": "Unowned packages · 1" if en else "Sahipsiz paketler · 1",
        "orphans_hint": "  (not bound to an open session)" if en else "  (açık bir oturuma bağlı değil)",
        "orphan_lines": [
            [span("Dark mode" if en else "Koyu tema")],
            [span(bar(71, 8), "success"), span(f"  5/7 · {pct(71)}", "dim")],
            [span("Review  ·  2h ago" if en else "İnceleme  ·  2sa önce", "dim")],
        ],
        "footer": [
            [span("2 closed sessions hidden  ·  Read Oct 10 10:42" if en else "2 kapalı oturum gizli  ·  Okundu 10.10 10:42", "dim")],
            [span("/progress bind <package>  ·  /progress name <name>" if en else "/ilerleme bağla <paket>  ·  /ilerleme ad <ad>", "dim")],
        ],
    }


OVERVIEW = {
    "en": {
        "title": "Claude Code — acme-shop",
        "transcript": [
            [span("> ", "dim"), span("Add a coupon field to checkout, with server-side validation")],
            [],
            [span("⏺ ", "text"), span("I'll plan this first and track it as a work package.")],
            [],
            [span("⏺ ", "success"), span("Write", bold=True), span("(.progress/checkout-redesign/progress.json)", "dim")],
            [span("  ⎿  ", "dim"), span("Wrote 6 phases: Explore, Plan, Plan approval, Build, Review, Ship", "dim")],
            [],
            [span("⏺ ", "text"), span("Explored the checkout module (14 files) and wrote the plan:")],
            [span("    1. ", "dim"), span("CouponField component + form wiring")],
            [span("    2. ", "dim"), span("POST /api/coupons/validate with rate limiting")],
            [span("    3. ", "dim"), span("Totals recalculated on apply / remove")],
            [span("    4. ", "dim"), span("Unit + e2e tests")],
            [],
            [span("⏺ ", "text"), span("The plan is ready. Waiting for your approval before I start building.")],
        ],
        "band1": [span("▶ Checkout redesign  ", "claude", True), span(bar(33, 12), "success"), span("  2/6  33%")],
        "band2": [span("  Now: Plan approval", "dim"), span("  ·  ⏸ WAITING ON YOU", "warning", True), span("  ·  25m", "dim"),
                  span("  ·  +1 waiting on you in other sessions (/sessions)", "warning")],
        "prompt": "Approved — go ahead",
        "shortcuts": "? for shortcuts",
        "pane": "Sessions",
        "callout_band": "the band: this session's package",
        "callout_pane": "/sessions — every open session, decisions waiting on you first",
        "alt": "session-progress: the band above the prompt and the sessions panel",
    },
    "tr": {
        "title": "Claude Code — acme-shop",
        "transcript": [
            [span("> ", "dim"), span("Ödeme sayfasına kupon alanı ekle, doğrulaması sunucuda olsun")],
            [],
            [span("⏺ ", "text"), span("Önce planlayıp bunu bir iş paketi olarak izleyeceğim.")],
            [],
            [span("⏺ ", "success"), span("Write", bold=True), span("(.progress/checkout-redesign/progress.json)", "dim")],
            [span("  ⎿  ", "dim"), span("6 aşama yazıldı: Keşif, Plan, Plan onayı, Geliştirme, İnceleme, Yayın", "dim")],
            [],
            [span("⏺ ", "text"), span("Ödeme modülünü inceledim (14 dosya) ve planı yazdım:")],
            [span("    1. ", "dim"), span("CouponField bileşeni + forma bağlama")],
            [span("    2. ", "dim"), span("Hız sınırlı POST /api/coupons/validate")],
            [span("    3. ", "dim"), span("Uygula / kaldır sonrası toplamların yeniden hesabı")],
            [span("    4. ", "dim"), span("Birim + e2e testleri")],
            [],
            [span("⏺ ", "text"), span("Plan hazır. Geliştirmeye başlamadan önce onayını bekliyorum.")],
        ],
        "band1": [span("▶ Ödeme sayfası yenileme  ", "claude", True), span(bar(33, 12), "success"), span("  2/6  %33")],
        "band2": [span("  Şu an: Plan onayı", "dim"), span("  ·  ⏸ SENDE BEKLİYOR", "warning", True), span("  ·  25dk", "dim"),
                  span("  ·  +1 iş başka oturumda sende bekliyor (/oturumlar)", "warning")],
        "prompt": "Onaylandı — devam et",
        "shortcuts": "? kısayollar",
        "pane": "Oturumlar",
        "callout_band": "şerit: bu oturumun paketi",
        "callout_pane": "/oturumlar — açık oturumların hepsi, sende bekleyen kararlar önce",
        "alt": "session-progress: prompt üstündeki şerit ve oturumlar paneli",
    },
}


def overview(lang):
    o = OVERVIEW[lang]
    W, H = 1440, 900
    left_w = 840
    body = window(W, H, o["title"])
    # transcript (left)
    y = 70
    for spans in o["transcript"]:
        if spans:
            body.append(text_line(28, y, spans))
        y += LH + 3
    # band above the prompt
    by = H - 150
    body.append(text_line(36, by, o["band1"]))
    body.append(text_line(36, by + LH, o["band2"]))
    # prompt box
    body.append(f'<rect x="24" y="{by + 36}" width="{left_w - 48}" height="44" rx="8" fill="none" stroke="{C["rule"]}" stroke-width="1.4"/>')
    body.append(text_line(40, by + 63, [span("> ", "dim"), span(o["prompt"], "text")]))
    body.append(f'<rect x="{40 + CW * (len(o["prompt"]) + 2.6):.0f}" y="{by + 50}" width="8" height="17" fill="{C["text"]}" opacity="0.7"/>')
    body.append(text_line(28, H - 22, [span(o["shortcuts"], "dim")]))
    # sessions pane (right)
    px = left_w
    body.append(f'<rect x="{px}" y="34" width="{W - px}" height="{H - 34}" fill="{C["pane"]}"/>')
    body.append(f'<line x1="{px}" y1="34" x2="{px}" y2="{H}" stroke="{C["rule"]}"/>')
    body.append(text_line(px + 20, 60, [span(o["pane"], "text", True)]))
    body.append(f'<line x1="{px}" y1="72" x2="{W}" y2="72" stroke="{C["rule"]}"/>')
    parts, _ = session_cards(sessions_texts(lang), px + 20, 98, W - px - 40)
    body += parts
    # callouts
    body.append(callout(36, by - 30, o["callout_band"]))
    body.append(callout(px + 20, H - 18, o["callout_pane"]))
    return svg(W, H, body, o["alt"])


def callout(x, y, label, anchor="start"):
    return f'<text x="{x}" y="{y}" text-anchor="{anchor}" fill="{C["user"]}" font-size="12" font-style="italic">↳ {escape(label)}</text>'


def progress_rows(lang):
    if lang == "en":
        return [
            [span("Checkout redesign  (feature/checkout-redesign)", "claude", True)],
            [span(bar(33, 24), "success"), span("  2/6 phases  33%  ·  1h 05m")],
            [span("⏸ Waiting on you: Approve the plan", "warning", True)],
            [],
            [span("✓ ", "success", True), span("Explore", "dim"), span("  claude · 18m · 14 files read", "dim")],
            [span("✓ ", "success", True), span("Plan", "dim"), span("  claude · 22m · docs/plans/checkout-coupons.md", "dim")],
            [span("⏸ ", "warning", True), span("Plan approval", bold=True), span("  YOU · 25m", "dim")],
            [span("○ ", "inactive", True), span("Build"), span("  claude", "dim")],
            [span("○ ", "inactive", True), span("Review"), span("  reviewer", "dim")],
            [span("○ ", "inactive", True), span("Ship"), span("  claude", "dim")],
            [],
            [span("Review rounds", bold=True)],
            [span("● ", "warning"), span("round 1 · reviewer · CONCERNS · 3 notes → plan v2"), span("  Oct 10 09:58", "dim")],
            [span("● ", "success"), span("round 2 · reviewer · PASS"), span("  Oct 10 10:21", "dim")],
            [],
            [span("Other active packages", bold=True)],
            [span("● Search index rebuild  ", "claude"), span(bar(60, 8), "success"), span("  3/5 · Backfill · claude · just now", "dim")],
            [span("● Payments webhook  ", "claude"), span(bar(40, 8), "success"), span("  2/5 · Choose a retry policy · YOU · 3m ago", "dim")],
            [],
            [span("Completed", bold=True)],
            [span("✓ ", "success"), span("API v2 migration  ·  Oct 9 17:20  ·  1d 4h", "dim")],
            [],
            [span("Read Oct 10 10:42  ·  /progress refresh  ·  /sessions", "dim")],
        ]
    return [
        [span("Ödeme sayfası yenileme  (feature/checkout-redesign)", "claude", True)],
        [span(bar(33, 24), "success"), span("  2/6 aşama  %33  ·  1sa 05dk")],
        [span("⏸ Sende bekliyor: Planı onayla", "warning", True)],
        [],
        [span("✓ ", "success", True), span("Keşif", "dim"), span("  claude · 18dk · 14 dosya okundu", "dim")],
        [span("✓ ", "success", True), span("Plan", "dim"), span("  claude · 22dk · docs/plans/checkout-coupons.md", "dim")],
        [span("⏸ ", "warning", True), span("Plan onayı", bold=True), span("  SEN · 25dk", "dim")],
        [span("○ ", "inactive", True), span("Geliştirme"), span("  claude", "dim")],
        [span("○ ", "inactive", True), span("İnceleme"), span("  inceleyici", "dim")],
        [span("○ ", "inactive", True), span("Yayın"), span("  claude", "dim")],
        [],
        [span("Denetim turları", bold=True)],
        [span("● ", "warning"), span("1. tur · inceleyici · DİKKAT · 3 not → plan v2"), span("  10.10 09:58", "dim")],
        [span("● ", "success"), span("2. tur · inceleyici · TEMİZ"), span("  10.10 10:21", "dim")],
        [],
        [span("Diğer aktif paketler", bold=True)],
        [span("● Arama dizini yeniden kurulumu  ", "claude"), span(bar(60, 8), "success"), span("  3/5 · Geriye dönük doldurma · claude · az önce", "dim")],
        [span("● Ödeme webhook'u  ", "claude"), span(bar(40, 8), "success"), span("  2/5 · Yeniden deneme politikasını seç · SEN · 3dk önce", "dim")],
        [],
        [span("Tamamlananlar", bold=True)],
        [span("✓ ", "success"), span("API v2 geçişi  ·  09.10 17:20  ·  1g 4sa", "dim")],
        [],
        [span("Okundu 10.10 10:42  ·  /ilerleme yenile  ·  /oturumlar", "dim")],
    ]


def progress_panel(lang):
    W = 760 if lang == "en" else 880
    rows = progress_rows(lang)
    H = 74 + len(rows) * LH + 16
    body = window(W, H, "Progress" if lang == "en" else "İlerleme")
    y = 74
    for spans in rows:
        if spans:
            body.append(text_line(22, y, spans))
        y += LH
    return svg(W, H, body, "session-progress: the /progress panel" if lang == "en" else "session-progress: /ilerleme paneli")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for lang, suffix in (("en", ""), ("tr", "-tr")):
        (OUT / f"overview{suffix}.svg").write_text(overview(lang), encoding="utf-8")
        (OUT / f"progress-panel{suffix}.svg").write_text(progress_panel(lang), encoding="utf-8")
    print("wrote", ", ".join(p.name for p in sorted(OUT.glob("*.svg"))))


if __name__ == "__main__":
    main()
