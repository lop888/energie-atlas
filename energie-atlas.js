/* Energie-Atlas v1.0.0 – Baukasten-Card für Home Assistant (Glas-Design)
 * Gesamtpaket: Basis-Card + Themen-Module (Energie, Solar, Speicher, Zähler, Heizung, Klima, Wetter,
 * Aquarium, Netzwerk, Backups, Finanzen, Allrounder) + dot-gauge-card.
 * Alle Entitäten sind leer vorbelegt und werden im visuellen Editor gewählt.
 * Erstellt mit Claude (Anthropic). Lizenz: MIT, siehe LICENSE.
 */
/* ===== dot-gauge-card ===== */
/* dot-gauge-card – Teil von Energie-Atlas */
(() => {
const DEF = {
  name: "", min: 0, max: 100, decimals: 1, needle: true,
  segments: [{ from: 0, color: "#43a047" }, { from: 60, color: "#ffa600" }, { from: 85, color: "#db4437" }],
  avg_min: 60, ref_days: 10, ref_window_h: 1, outlier: 100,
  mode: "ratio", k: 2, diff_scale: 5, cap: 5,
  speed: 0.2, live_speed: 0.6,
};
const CX = 100, CY = 100, R_RING = 84, R_LIVE = 53, R_AVG = 42, W_LINE = 3;
const C_LIVE = "#000080", C_AVG = "#7f88c8", C_OFF = "#8a8a8a";
const fmt = (v, d = 1) => (v == null || isNaN(v) ? "–" : v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pt = (r, f) => { const a = Math.PI * (1 - f); return [CX + r * Math.cos(a), CY - r * Math.sin(a)]; };
const arc = (r, f0, f1) => {
  const [x0, y0] = pt(r, f0), [x1, y1] = pt(r, f1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

class DotGaugeCard extends HTMLElement {
  static getConfigElement() { return document.createElement("dot-gauge-card-editor"); }
  static getStubConfig() { return { entity: "", name: "" }; }
  setConfig(c) {
    if (!c || !c.entity) throw new Error("dot-gauge-card: entity fehlt");
    this._c = { ...DEF, ...c };
    if (!Array.isArray(this._c.segments) || !this._c.segments.length) this._c.segments = DEF.segments;
    this._unit = null; this._ref = null; this._m60 = null; this._refAt = 0; this._key = null;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._build();
    if (this._hass) this._fetch();
  }
  set hass(h) {
    this._hass = h;
    const s = h.states[this._c.entity];
    const v = s ? parseFloat(s.state) : NaN;
    this._val = isNaN(v) ? null : v;
    if (s && this._unit == null) this._unit = s.attributes.unit_of_measurement || "";
    this._paint();
    if (!this._loading && (!this._refAt || Date.now() - this._refAt > 5 * 60e3)) this._fetch();
  }
  connectedCallback() {
    this._run = true; this._t = performance.now();
    const loop = (t) => { if (!this._run) return; this._tick(t); this._raf = requestAnimationFrame(loop); };
    this._raf = requestAnimationFrame(loop);
  }
  disconnectedCallback() { this._run = false; cancelAnimationFrame(this._raf); }
  getCardSize() { return 3; }

  _build() {
    this.shadowRoot.innerHTML = `<style>
      :host { display:block; }
      .w { padding:6px 4px 2px; color:#000; font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
      .t { font-size:14px; font-weight:600; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:2px; }
      svg { display:block; width:100%; height:auto; overflow:visible; }
      .v { font-size:22px; font-weight:700; fill:#000; font-variant-numeric: tabular-nums; }
      .u { font-size:12px; font-weight:400; opacity:.7; }
    </style>
    <div class="w"><div class="t" id="t"></div>
      <svg viewBox="0 0 200 106">
        <title id="tip"></title>
        <g id="ring"></g>
        <circle id="a1" r="3.5"/><circle id="a2" r="3.5"/>
        <circle id="l1" r="4.5"/><circle id="l2" r="4.5"/>
        <line id="nd" stroke="#000" stroke-width="${W_LINE}" stroke-linecap="round" opacity="0.8"/>
        <text id="val" x="100" y="97" text-anchor="middle" class="v"></text>
      </svg>
    </div>`;
    const $ = (id) => this.shadowRoot.getElementById(id);
    this._el = { t: $("t"), tip: $("tip"), ring: $("ring"), a1: $("a1"), a2: $("a2"), l1: $("l1"), l2: $("l2"), nd: $("nd"), val: $("val") };
    this._el.t.textContent = this._c.name || "";
    this._el.t.style.display = this._c.name ? "" : "none";
    this._pl = 0.05; this._pa = 0.55; this._sl = null; this._sa = null;
  }

  _frac(v) { const c = this._c, span = (c.max - c.min) || 1; return Math.max(0, Math.min(1, (v - c.min) / span)); }

  _ratio() {
    const c = this._c, m = this._m60, ref = this._ref;
    if (m == null || !ref || !ref.ok || ref.avg == null) return null;
    let r;
    if (c.mode === "diff") {
      r = 1 + (m - ref.avg) / (Number(c.diff_scale) || 5);
    } else {
      const k = Number(c.k) || 0, den = ref.avg + k;
      r = den <= 0 ? 1 : (m + k) / den;
    }
    return Math.max(0, Math.min(Number(c.cap) || 5, r));
  }

  _paint() {
    if (!this._el) return;
    const c = this._c, v = this._val, d = Number(c.decimals) || 0;
    const key = v == null ? "na" : v.toFixed(d + 1);
    if (key !== this._key) {
      this._key = key;
      let g = "";
      if (v == null) {
        g = `<path d="${arc(R_RING, 0, 1)}" stroke="${C_OFF}" stroke-width="${W_LINE}" fill="none" stroke-dasharray="3 3" opacity="0.6"/>`;
      } else {
        const fv = this._frac(v);
        const seg = c.segments.slice().sort((a, b) => a.from - b.from);
        seg.forEach((s, i) => {
          const a = this._frac(s.from), b = i < seg.length - 1 ? this._frac(seg[i + 1].from) : 1;
          if (b <= a) return;
          g += `<path d="${arc(R_RING, a, b)}" stroke="${s.color}" stroke-width="${W_LINE}" fill="none" opacity="0.25"/>`;
          if (fv > a) g += `<path d="${arc(R_RING, a, Math.min(b, fv))}" stroke="${s.color}" stroke-width="${W_LINE}" fill="none"/>`;
        });
      }
      this._el.ring.innerHTML = g;
      const nd = this._el.nd;
      if (c.needle !== false && v != null) {
        const f = this._frac(v), [x0, y0] = pt(R_RING - 10, f), [x1, y1] = pt(R_RING + 7, f);
        nd.setAttribute("x1", x0.toFixed(2)); nd.setAttribute("y1", y0.toFixed(2));
        nd.setAttribute("x2", x1.toFixed(2)); nd.setAttribute("y2", y1.toFixed(2));
        nd.style.display = "";
      } else nd.style.display = "none";
      this._el.val.innerHTML = `${fmt(v, d)}<tspan class="u" dx="2">${v == null ? "" : (this._unit || "")}</tspan>`;
    }
    this._tipUpd();
  }

  _tipUpd() {
    if (!this._el) return;
    const c = this._c, d = Number(c.decimals) || 0, u = this._unit || "", ref = this._ref, r = this._ratio();
    let s = `${c.name ? c.name + ": " : ""}${fmt(this._val, d)} ${u}`;
    s += `\nØ ${c.avg_min} min: ${fmt(this._m60, d)} ${u}`;
    if (ref) {
      s += `\nnormal (Ø ${ref.days} Tage, ±${c.ref_window_h} h): ${fmt(ref.avg, d)} ${u} · ${ref.n} Tage gewertet, ${ref.out} Ausreißer raus`;
      if (!ref.ok) s += "\nReferenz unsicher (zu wenig Tage)";
    }
    s += `\n1h-Tempo: ${r == null ? "–" : "×" + fmt(r, 2)}`;
    if (this._err) s += `\nFehler: ${this._err}`;
    this._el.tip.textContent = s;
  }

  async _fetch() {
    if (this._loading || !this._hass || !this._c) return;
    this._loading = true; this._refAt = Date.now();
    const c = this._c, id = c.entity, now = new Date();
    try {
      const days = Math.max(1, Number(c.ref_days) || 10);
      const W = (Number(c.ref_window_h) || 1) * 3600e3;
      const am = (Number(c.avg_min) || 60) * 60e3;
      const q = (s, e, period) => this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: s.toISOString(), end_time: e.toISOString(),
        statistic_ids: [id], period, types: ["mean"],
      });
      const hs = new Date(now.getTime() - days * 86400e3 - W - 3 * 3600e3);
      const [r5, rh] = await Promise.all([q(new Date(now.getTime() - am), now, "5minute"), q(hs, now, "hour")]);
      const ts = (x) => (typeof x === "number" ? x : Date.parse(x));
      const m5 = (r5[id] || []).filter((x) => x.mean != null);
      const need5 = Math.max(2, Math.floor(am / 300e3 / 2));
      this._m60 = m5.length >= need5 ? m5.reduce((a, x) => a + x.mean, 0) / m5.length : null;
      const hr = (rh[id] || []).filter((x) => x.mean != null).map((x) => ({ s: ts(x.start), m: x.mean }));
      const dv = [];
      for (let dd = 1; dd <= days; dd++) {
        const cd = new Date(now); cd.setDate(cd.getDate() - dd);
        const w0 = cd.getTime() - W, w1 = cd.getTime() + W;
        let sum = 0, ov = 0;
        for (const b of hr) {
          const o = Math.min(b.s + 3600e3, w1) - Math.max(b.s, w0);
          if (o > 0) { sum += b.m * o; ov += o; }
        }
        if (ov >= W) dv.push(sum / ov); // mind. halbes Fenster mit Daten, sonst Tag fehlt
      }
      const raw = dv.length ? dv.reduce((a, b) => a + b, 0) / dv.length : null;
      const ol = Number(c.outlier), of = 1 + (isNaN(ol) ? 100 : ol) / 100;
      const keep = raw == null ? [] : dv.filter((v) => (raw <= 0 ? true : v <= raw * of));
      const avg = keep.length ? keep.reduce((a, b) => a + b, 0) / keep.length : null;
      this._ref = { avg, n: keep.length, out: dv.length - keep.length, days, ok: keep.length >= Math.max(3, Math.ceil(days / 2)) };
      this._err = null;
    } catch (e) {
      this._err = e.message || String(e);
    } finally {
      this._loading = false;
      this._tipUpd();
    }
  }

  _tick(t) {
    const dt = Math.min((t - (this._t || t)) / 1000, 0.1); this._t = t;
    const c = this._c, el = this._el;
    if (!c || !el) return;
    const tl = this._val == null ? 0 : this._frac(this._val) * (Number(c.live_speed) || 0.6);
    const r = this._ratio();
    const ta = r == null ? 0 : (Number(c.speed) || 0.2) * r;
    const k = 1 - Math.exp(-dt / 1.5);
    this._sl = this._sl == null ? tl : this._sl + (tl - this._sl) * k;
    this._sa = this._sa == null ? ta : this._sa + (ta - this._sa) * k;
    this._pl = (this._pl + this._sl * dt) % 1;
    this._pa = (this._pa + this._sa * dt) % 1;
    const liveOn = this._val != null, avgOn = r != null;
    const place = (e, p, R, col, op) => {
      const a = Math.PI + p * 2 * Math.PI;
      const x = CX + R * Math.cos(a), y = CY + R * Math.sin(a);
      e.setAttribute("cx", x.toFixed(2)); e.setAttribute("cy", y.toFixed(2));
      e.setAttribute("fill", col);
      e.style.opacity = (Math.max(0, Math.min(1, (CY + 1 - y) / 5)) * op).toFixed(3);
    };
    place(el.l1, this._pl, R_LIVE, liveOn ? C_LIVE : C_OFF, liveOn ? 1 : 0.35);
    place(el.l2, (this._pl + 0.5) % 1, R_LIVE, liveOn ? C_LIVE : C_OFF, liveOn ? 1 : 0.35);
    place(el.a1, this._pa, R_AVG, avgOn ? C_AVG : C_OFF, avgOn ? 1 : 0.35);
    place(el.a2, (this._pa + 0.5) % 1, R_AVG, avgOn ? C_AVG : C_OFF, avgOn ? 1 : 0.35);
  }
}

/* ---------- Editor ---------- */
const SCHEMA = [
  { name: "entity", label: "Entität", selector: { entity: {} } },
  { name: "name", label: "Titel", selector: { text: {} } },
  { name: "min", label: "Minimum", selector: { number: { mode: "box", step: "any" } } },
  { name: "max", label: "Maximum (= 100 % Live-Tempo)", selector: { number: { mode: "box", step: "any" } } },
  { name: "decimals", label: "Nachkommastellen", selector: { number: { min: 0, max: 4, step: 1, mode: "box" } } },
  { name: "needle", label: "Zeiger anzeigen", selector: { boolean: {} } },
  { name: "mode", label: "Vergleich 1h-Punkt", selector: { select: { mode: "dropdown", options: [
    { value: "ratio", label: "Faktor mit Offset k (Last, %)" },
    { value: "diff", label: "Differenz (Temperatur)" },
  ] } } },
  { name: "k", label: "Offset k (Faktor-Modus)", selector: { number: { mode: "box", step: "any" } } },
  { name: "diff_scale", label: "Differenz für doppeltes Tempo (Differenz-Modus)", selector: { number: { mode: "box", step: "any" } } },
  { name: "avg_min", label: "Mittelwert jetzt (Minuten)", selector: { number: { min: 5, max: 240, step: 5, mode: "box" } } },
  { name: "ref_days", label: "Referenz-Tage", selector: { number: { min: 3, max: 60, step: 1, mode: "box" } } },
  { name: "ref_window_h", label: "Referenz-Fenster ± Stunden", selector: { number: { min: 0.5, max: 6, step: 0.5, mode: "box" } } },
  { name: "outlier", label: "Ausreißer-Tag ab % über Ø", selector: { number: { min: 10, max: 1000, step: 10, mode: "box" } } },
];
let _formLoaded;
const loadForm = () => {
  if (!_formLoaded) {
    _formLoaded = (async () => {
      if (customElements.get("ha-form") && customElements.get("ha-entity-picker")) return;
      try {
        const helpers = await window.loadCardHelpers();
        const card = await helpers.createCardElement({ type: "entities", entities: [] });
        if (card.constructor.getConfigElement) await card.constructor.getConfigElement();
      } catch (e) { /* ignorieren */ }
      await customElements.whenDefined("ha-form");
    })();
  }
  return _formLoaded;
};
class DotGaugeCardEditor extends HTMLElement {
  setConfig(c) { this._c = { ...c }; loadForm().then(() => this._render()); }
  set hass(h) { this._hass = h; if (this._f) this._f.hass = h; }
  _render() {
    if (!this._f) {
      this._f = document.createElement("ha-form");
      this._f.computeLabel = (s) => s.label || s.name;
      this._f.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._c = { ...this._c, ...ev.detail.value };
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._c }, bubbles: true, composed: true }));
      });
      this.appendChild(this._f);
      const hint = document.createElement("div");
      hint.style.cssText = "font-size:12px;opacity:.7;margin-top:8px";
      hint.textContent = "Farbsegmente (segments) im YAML-Modus bearbeiten.";
      this.appendChild(hint);
    }
    const { type, segments, ...rest } = { ...DEF, ...this._c };
    this._f.hass = this._hass;
    this._f.schema = SCHEMA;
    this._f.data = rest;
  }
}

if (!customElements.get("dot-gauge-card-editor")) customElements.define("dot-gauge-card-editor", DotGaugeCardEditor);
if (!customElements.get("dot-gauge-card")) {
  customElements.define("dot-gauge-card", DotGaugeCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: "dot-gauge-card", name: "Dot-Gauge (Tempo-Punkte)", description: "Halbkreis mit Live- und 1h-Tempo-Punkt im Vergleich zur 10-Tage-Referenz" });
}
})();

/* ===== core_public ===== */
/* Energie-Atlas v1.0.0 – Baukasten-Card für Home Assistant (Glas-Design)
 * Ein Rahmen, frei kombinierbare Module: Kacheln, Gauges, Verlaufsgraph, Tabelle, Batterien.
 * Erstellt mit Claude (Anthropic). Lizenz: MIT, siehe LICENSE.
 *
 * type: custom:energie-atlas
 * title: Titel
 * Aussehen (alle optional, leer = Standard-Glas):
 *   glas_deckkraft, rand_deckkraft, kachel_deckkraft, kachel_rand_deckkraft (0–100 %), unschaerfe (px),
 *   milch (0–100 %), hintergrund_farbe, kachel_farbe, textfarbe (#rrggbb)
 * datenquelle: { dienst, host, port, db, tabelle, profil, timeout }   optional, nur für Graph-Linien mit quelle: extern
 * modules:   Reihenfolge = Anzeige; half: true = halbe Breite (zwei nebeneinander, Handy volle Breite)
 *   - type: tiles      columns, tiles: [{ name, icon, entity, format, attribute, decimals, unit, color, warn, bad, text_on, text_off, range }]
 *   - type: gauges     columns, style, gauges: [{ entity, name, style, min, max, decimals, unit, preset, segments, range, agg }]
 *                      style: arc | ring | needle | bar | vbar | value | dot (dot benötigt zusätzlich dot-gauge-card)
 *   - type: graph      name, range (last:7d | today | month | m:2025-02 | y:2025 …), range_picker, hours, height, style, show_scale,
 *                      decimals, unit, factor, period, series: [{ entity, name, color, style, axis, change, factor, quelle }]
 *   - type: batteries  areas, exclude_areas, exclude (Regex), low, mid, columns   (Akkus mit device_class battery)
 *   - type: matrix     label_width, highlight_last, highlight_last_row, columns: [{ name, icon, unit, decimals, factor, range }],
 *                      rows: [{ label, icon, unit, decimals, factor, cells: [{ entity, warn, bad }] }]
 * Lücken bleiben sichtbar („–“ bzw. unterbrochene Linie). Klick auf Kachel/Wert öffnet die Entität.
 */
(() => {
const COL = { ok: "#43a047", warn: "#ffa600", bad: "#db4437", off: "#9e9e9e", base: "#000080" };
const DEFC = ["#000080", "#ffa600", "#6a1b9a", "#43a047"];
const PRESET = {
  load: [{ from: 0, color: "#43a047" }, { from: 60, color: "#ffa600" }, { from: 85, color: "#db4437" }],
  ram: [{ from: 0, color: "#43a047" }, { from: 75, color: "#ffa600" }, { from: 90, color: "#db4437" }],
  temp: [{ from: 20, color: "#2196f3" }, { from: 35, color: "#43a047" }, { from: 60, color: "#ffa600" }, { from: 75, color: "#db4437" }],
  temp_hot: [{ from: 20, color: "#2196f3" }, { from: 35, color: "#43a047" }, { from: 70, color: "#ffa600" }, { from: 85, color: "#db4437" }],
};
const nf = (x, d) => { if (x === "" || x == null) return d; const v = Number(x); return isNaN(v) ? d : v; };
const fmt = (v, d) => (v == null || isNaN(v) ? "–" : v.toLocaleString("de-DE", d == null ? { maximumFractionDigits: 2 } : { minimumFractionDigits: d, maximumFractionDigits: d }));
const comma = (s) => String(s).replace(/(\d)\.(\d)/g, "$1,$2");
const dur = (sec) => `${Math.floor(sec / 86400)} T ${Math.floor((sec % 86400) / 3600)} h`;
const relH = (hrs, pre) => (hrs < 1 ? `${pre} ${Math.max(0, Math.round(hrs * 60))} min` : `${pre} ${Math.round(hrs)} h`);
const ts = (x) => (typeof x === "number" ? x : Date.parse(x));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const NA = { text: "–", metric: null };
const QI = { db: "mdi:server", ha: "mdi:home", warn: "mdi:home-alert", load: "mdi:timer-sand" };
const qIcon = (k, tip, col) => `<span class="qi${k === "warn" ? " w" : ""}" title="${esc(tip)}">${col ? `<i style="background:${esc(col)}"></i>` : ""}<ha-icon icon="${QI[k] || QI.ha}"></ha-icon></span>`;

/* ---------- Transparenz (Prozentfelder -> CSS-Variablen; leer = bisheriger Wert) ---------- */
const pct = (x) => { if (x === "" || x == null) return null; const v = Number(x); return isNaN(v) ? null : Math.min(100, Math.max(0, v)) / 100; };
const GLAS_VARS = [["glas_deckkraft", "--ea-glas"], ["kachel_deckkraft", "--ea-kachel"], ["rand_deckkraft", "--ea-rand"], ["kachel_rand_deckkraft", "--ea-krand"]];
function glasVars(el, o, keys) { let any = false; for (const [k, v] of GLAS_VARS) if (keys.includes(k)) { const p = pct(o && o[k]); if (p != null) { el.style.setProperty(v, p); any = true; } } return any; }
const kd = (o) => { const p = pct(o && o.deckkraft); return p == null ? "" : ` style="--ea-kachel:${p}"`; };
/* v0.15: Farben (Karte, Kacheln, Text) und Milchglas – leer = bisheriges Aussehen */
const rgbOf = (x) => { const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(x || "").trim()); if (!m) return null; let h = m[1]; if (h.length === 3) h = h.split("").map((c) => c + c).join(""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(","); };
function farbVars(el, o) {
  if (!el || !o) return false;
  const kr = rgbOf(o.hintergrund_farbe), kk = rgbOf(o.kachel_farbe), tx = rgbOf(o.textfarbe), mi = pct(o.milch);
  if (kr) el.style.setProperty("--ea-rgb", kr);
  if (kk) el.style.setProperty("--ea-krgb", kk);
  if (tx) el.style.setProperty("--ea-text", `rgb(${tx})`);
  if (mi != null) { el.style.setProperty("--ea-milch", (mi * 0.45).toFixed(3)); el.style.setProperty("--ea-hell", (1 + mi * 0.25).toFixed(3)); el.style.setProperty("--ea-sat", (1 - mi * 0.5).toFixed(3)); }
  return !!kk;
}
/* Themen-Pakete haben eigene Kacheln (.inner/.tile/.drive) – nur wenn Transparenz eingestellt ist, wird sie dort uebernommen */
let _ovr = null;
const OVR_CSS = `.inner, .tile, .drive { background: rgba(var(--ea-krgb,255,255,255),var(--ea-kachel,0.1)) !important; border-color: rgba(255,255,255,var(--ea-krand, 0.10)) !important; }`;
function adoptGlas(sr) {
  if (!sr || sr.__eaGlas) return; sr.__eaGlas = true;
  try { if (!_ovr) { _ovr = new CSSStyleSheet(); _ovr.replaceSync(OVR_CSS); } sr.adoptedStyleSheets = [...sr.adoptedStyleSheets, _ovr]; }
  catch (e) { const st = document.createElement("style"); st.textContent = OVR_CSS; sr.appendChild(st); }
}

/* ---------- Zeiträume (letzte X / Kalender / fester Monat oder Jahr) ---------- */
const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONL = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
function resolveRange(spec) {
  if (!spec) return null;
  const now = Date.now(), N = new Date(now), Y = N.getFullYear(), M = N.getMonth();
  const day0 = (y, m, d) => new Date(y, m, d).getTime(), today = day0(Y, M, N.getDate());
  const wk = (() => { const x = new Date(today); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.getTime(); })();
  const R = (t0, t1, label, rolling) => ({ t0, t1: Math.min(t1, now), label, live: t1 >= now - 60e3, rolling: !!rolling });
  let m;
  if ((m = /^last:(\d+)(h|d|mo)$/.exec(spec))) {
    const n = +m[1];
    if (m[2] === "h") return R(now - n * 3600e3, now, `letzte ${n} h`, true);
    if (m[2] === "d") return R(now - n * 864e5, now, `letzte ${n} Tage`, true);
    const x = new Date(now); x.setMonth(x.getMonth() - n); return R(x.getTime(), now, `letzte ${n} Monate`, true);
  }
  switch (spec) {
    case "today": return R(today, now, "heute");
    case "yesterday": return R(day0(Y, M, N.getDate() - 1), today, "gestern");
    case "week": return R(wk, now, "diese Woche");
    case "lastweek": { const x = new Date(wk); x.setDate(x.getDate() - 7); return R(x.getTime(), wk, "letzte Woche"); }
    case "month": return R(day0(Y, M, 1), now, "dieser Monat");
    case "lastmonth": return R(day0(Y, M - 1, 1), day0(Y, M, 1), `${MONL[(M + 11) % 12]} ${M ? Y : Y - 1}`);
    case "year": return R(day0(Y, 0, 1), now, `${Y}`);
    case "lastyear": return R(day0(Y - 1, 0, 1), day0(Y, 0, 1), `${Y - 1}`);
  }
  if ((m = /^m:(\d{4})-(\d{1,2})$/.exec(spec))) { const y = +m[1], mo = +m[2] - 1; return R(day0(y, mo, 1), day0(y, mo + 1, 1), `${MONL[mo]} ${y}`); }
  if ((m = /^y:(\d{4})$/.exec(spec))) return R(day0(+m[1], 0, 1), day0(+m[1] + 1, 0, 1), m[1]);
  if ((m = /^d:(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(spec))) { const y = +m[1], mo = +m[2] - 1, d = +m[3]; return R(day0(y, mo, d), day0(y, mo, d + 1), `${d}. ${MONL[mo]} ${y}`); }
  return null;
}
function rangeOpts() {
  const N = new Date(), Y = N.getFullYear(), o = [];
  for (const [v, l] of [["last:24h", "letzte 24 h"], ["last:48h", "letzte 48 h"], ["last:7d", "letzte 7 Tage"], ["last:30d", "letzte 30 Tage"], ["last:90d", "letzte 90 Tage"], ["last:12mo", "letzte 12 Monate"],
    ["today", "heute"], ["yesterday", "gestern"], ["week", "diese Woche"], ["lastweek", "letzte Woche"], ["month", "dieser Monat"], ["lastmonth", "letzter Monat"], ["year", "dieses Jahr"], ["lastyear", "letztes Jahr"]]) o.push([v, l]);
  for (let i = 0; i < 24; i++) { const d = new Date(Y, N.getMonth() - i, 1); o.push([`m:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, `Monat: ${MONL[d.getMonth()]} ${d.getFullYear()}`]); }
  for (let y = Y; y > Y - 6; y--) o.push([`y:${y}`, `Jahr: ${y}`]);
  return o;
}
/* Statistik-Werte über einen Zeitraum (Verbrauch eines Zählers, Mittel/Min/Max), gecacht für alle Karten */
const STAT = {
  c: {},
  get(h, id, spec, kind) {
    if (!id || !spec) return null;
    const key = `${id}|${spec}|${kind}`, now = Date.now();
    let e = this.c[key];
    if (e && e.at && now - e.at < e.ttl) return e.v;
    if (!e) e = this.c[key] = { v: undefined };
    if (!e.loading) { e.loading = true; this.load(h, id, spec, kind, e); }
    return e.v;
  },
  async load(h, id, spec, kind, e) {
    try {
      const R = resolveRange(spec); if (!R) { e.v = null; e.ttl = 3600e3; return; }
      const span = R.t1 - R.t0, per = R.rolling ? (span <= 35 * 864e5 ? "hour" : "day") : span <= 3 * 864e5 ? "hour" : span <= 400 * 864e5 ? "day" : "month";
      const q = async (period, a, b, types) => ((await h.callWS({ type: "recorder/statistics_during_period", start_time: new Date(a).toISOString(), end_time: new Date(b).toISOString(), statistic_ids: [id], period, types })) || {})[id] || [];
      if (kind === "change") {
        let rows = (await q(per, R.t0, R.t1, ["change"])).filter((r) => r.change != null), v = rows.length ? rows.reduce((s, r) => s + r.change, 0) : null;
        if (R.live) {
          let end = rows.length ? ts(rows[rows.length - 1].end) : R.t0;
          for (const p of ["hour", "5minute"]) {
            if (Date.now() - end < 60e3) break;
            const r2 = (await q(p, end, R.t1, ["change"])).filter((r) => r.change != null);
            if (r2.length) { v = (v || 0) + r2.reduce((s, r) => s + r.change, 0); end = ts(r2[r2.length - 1].end); }
          }
        }
        e.v = v;
      } else {
        const rows = await q(per, R.t0, R.t1, ["mean", "min", "max"]);
        const x = rows.map((r) => (kind === "max" ? r.max ?? r.mean : kind === "min" ? r.min ?? r.mean : r.mean)).filter((y) => y != null);
        e.v = !x.length ? null : kind === "max" ? Math.max(...x) : kind === "min" ? Math.min(...x) : x.reduce((a, b) => a + b, 0) / x.length;
      }
      e.ttl = R.live ? 5 * 60e3 : 3600e3;
    } catch (err) { e.v = null; e.ttl = 60e3; } finally { e.at = Date.now(); e.loading = false; }
  },
};

/* ---------- Kachel-Werte (wie srv-panel) ---------- */
function tileVal(h, t) {
  const fm = t.format || "state";
  if (fm === "updates") {
    const n = Object.keys(h.states).filter((e) => e.startsWith("update.") && h.states[e].state === "on").length;
    return { text: n ? `${n} offen` : "keine", metric: n };
  }
  const s = t.entity ? h.states[t.entity] : null;
  const dec = t.decimals === "" || t.decimals == null ? null : Number(t.decimals);
  if (t.range && t.entity) {
    const r = STAT.get(h, t.entity, t.range, "change");
    if (r === undefined) return { text: "…", metric: null };
    if (r == null) return NA;
    const u = t.unit != null && t.unit !== "" ? t.unit : (s && s.attributes.unit_of_measurement) || "";
    return { text: fmt(r, dec ?? 2) + (u ? " " + u : ""), metric: r };
  }
  if (!s || s.state === "unavailable" || s.state === "unknown") return NA;
  const a = s.attributes, v = parseFloat(s.state);
  switch (fm) {
    case "since": { const ms = Date.parse(s.state); if (isNaN(ms)) return NA; const sec = (Date.now() - ms) / 1000; return { text: dur(sec), metric: sec / 3600 }; }
    case "secs_ago": if (isNaN(v)) return NA; return { text: v < 60 ? "live" : v < 3600 ? `${Math.round(v / 60)} min` : `${Math.round(v / 3600)} h`, metric: v };
    case "days": return isNaN(v) ? NA : { text: `${fmt(v, dec ?? 1)} T`, metric: v };
    case "mio": return isNaN(v) ? NA : { text: `${fmt(v / 1e6, dec ?? 2)} Mio`, metric: v };
    case "mb_gb": return isNaN(v) ? NA : { text: `${fmt(v / 1000, dec ?? 2)} GB`, metric: v / 1000 };
    case "year_since": return isNaN(v) ? NA : { text: `seit ${new Date(Date.now() - v * 365.25 * 864e5).getFullYear()}`, metric: v };
    case "year_until": return isNaN(v) ? NA : { text: `bis ${new Date().getFullYear() + Math.round(v)}`, metric: v };
    case "onoff": { const on = s.state === "on"; return { text: on ? t.text_on || "an" : t.text_off || "aus", metric: on ? 1 : 0 }; }
    case "version": return { text: a.installed_version || "–", metric: s.state === "on" ? 1 : 0 };
    case "attr": {
      const x = a[t.attribute]; if (x == null) return NA;
      const xv = parseFloat(x);
      return { text: typeof x === "number" ? fmt(x, dec) + (t.unit ? " " + t.unit : "") : t.raw ? String(x) : comma(x), metric: isNaN(xv) ? null : xv };
    }
    case "ago": { const ms = Date.parse(s.state); if (isNaN(ms)) return NA; const hr = (Date.now() - ms) / 3600e3; return { text: relH(hr, "vor"), metric: hr }; }
    case "until": { const ms = Date.parse(s.state); if (isNaN(ms)) return NA; const hr = Math.max(0, (ms - Date.now()) / 3600e3); return { text: relH(hr, "in"), metric: hr }; }
    case "backup_state": {
      const m = { backed_up: "gesichert", in_progress: "läuft", failed: "Fehler", idle: "bereit" };
      return { text: m[s.state] || s.state, metric: s.state === "failed" ? 2 : s.state === "in_progress" ? 1 : 0 };
    }
    case "backup_latest": {
      const b = (a.backups || []).slice().sort((x, y) => new Date(y.date) - new Date(x.date));
      return { text: b.length && b[0].size ? comma(b[0].size) : "–", metric: null };
    }
    case "backup_all": {
      const n = a.backups_in_google_drive;
      return { text: `${n != null ? n + " · " : ""}${comma(a.size_in_google_drive || "–")}`, metric: null };
    }
    default: {
      if (isNaN(v)) return { text: s.state, metric: null };
      const u = t.unit != null && t.unit !== "" ? t.unit : a.unit_of_measurement || "";
      return { text: fmt(v, dec) + (u ? " " + u : ""), metric: v };
    }
  }
}
function tileCol(t, r) {
  const m = r.metric, mode = t.color || "none";
  if (mode === "none") return COL.base;
  if (m == null) return COL.off;
  const w = nf(t.warn, null), b = nf(t.bad, null);
  switch (mode) {
    case "up": return b != null && m >= b ? COL.bad : w != null && m >= w ? COL.warn : COL.ok;
    case "down": return b != null && m <= b ? COL.bad : w != null && m <= w ? COL.warn : COL.ok;
    case "onoff": return m ? COL.ok : COL.bad;
    case "flag": return m > 0 ? COL.warn : COL.ok;
    case "state3": return m >= 2 ? COL.bad : m >= 1 ? COL.warn : COL.ok;
    default: return COL.base;
  }
}

const CSS = `
  :host { display:block; }
  .glass { background: linear-gradient(rgba(255,255,255,var(--ea-milch,0)),rgba(255,255,255,var(--ea-milch,0))), rgba(var(--ea-rgb,255,255,255),var(--ea-glas,0.01));
    backdrop-filter: blur(var(--ea-blur,10px)) brightness(var(--ea-hell,1)) saturate(var(--ea-sat,1)); -webkit-backdrop-filter: blur(var(--ea-blur,10px)) brightness(var(--ea-hell,1)) saturate(var(--ea-sat,1));
    border: 1px solid rgba(255,255,255,var(--ea-rand,0.2)); border-radius: 12px; padding: 12px; color:var(--ea-text,#000); box-sizing:border-box;
    font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
  .title { font-size:22px; font-weight:700; text-align:center; margin:4px 0 12px; }
  .mods { display:grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap:10px 14px; }
  .mod { grid-column: 1 / 3; min-width:0; }
  .mod.half { grid-column:auto; }
  @media (max-width: 560px) { .mod.half { grid-column: 1 / 3; } }
  .num { font-variant-numeric: tabular-nums; }
  /* Kacheln + Gauges */
  .gauges, .tiles { display:grid; gap:8px; }
  .tile { min-height:70px; box-sizing:border-box; border-radius:12px; background: rgba(var(--ea-krgb,255,255,255),var(--ea-kachel,0.1));
    backdrop-filter: blur(var(--ea-blur,10px)); -webkit-backdrop-filter: blur(var(--ea-blur,10px)); border:1px solid rgba(255,255,255,var(--ea-krand,0.2));
    padding:6px 4px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px; cursor:pointer; min-width:0; }
  .tile ha-icon { --mdc-icon-size:22px; flex:none; }
  .tn { font-size:11px; line-height:1.25; opacity:.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
  .tv { font-size:16px; line-height:1.25; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
  .tile.blink { border-color:#db4437; animation: sblink 2s ease infinite; }
  .ng { box-sizing:border-box; border-radius:12px; background: rgba(var(--ea-krgb,255,255,255),var(--ea-kachel,0.1)); border:1px solid rgba(255,255,255,var(--ea-krand,0.2));
    backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); padding:8px 10px; cursor:pointer; min-width:0; text-align:center; display:flex; flex-direction:column; justify-content:center; }
  .ng svg { display:block; width:100%; max-height:130px; }
  .ng .sv1 { font-size:17px; font-weight:700; } .ng .sv2 { font-size:9px; opacity:.6; fill:var(--ea-text,#000); }
  .ngn { font-size:12px; opacity:.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; }
  .ngv { font-size:20px; font-weight:700; white-space:nowrap; } .ngv span { font-size:11px; font-weight:400; opacity:.65; margin-left:3px; color:var(--ea-text,#000); }
  .ngv.big2 { font-size:32px; line-height:1.1; }
  .ngm { display:flex; justify-content:space-between; font-size:10px; opacity:.55; margin:0 4px; }
  .ngm.v { flex-direction:column; align-items:flex-start; gap:2px; margin:4px 0 0; }
  .ngh { display:flex; justify-content:space-between; align-items:baseline; gap:8px; } .ngh .ngn { margin:0; text-align:left; }
  .ngt { height:10px; border-radius:5px; background:rgba(0,0,0,0.10); overflow:hidden; margin:6px 0 2px; } .ngt.thin { height:4px; margin:4px 10%; }
  .ngt i { display:block; height:100%; border-radius:5px; }
  .ngvb { display:flex; align-items:center; justify-content:center; gap:10px; } .ngvb svg { width:34px; height:110px; flex:none; } .ngvb .ngv { text-align:left; }
  @keyframes sblink { 0%,100% { opacity:1 } 50% { opacity:.55 } }
  /* Graph */
  .gr { padding:8px 8px 0; cursor:pointer; }
  .gh { font-size:14px; font-weight:600; display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .gh .rp { font:inherit; font-size:12px; font-weight:400; border:1px solid rgba(0,0,0,.2); border-radius:8px; background:rgba(255,255,255,.4); padding:2px 4px; max-width:55%; cursor:pointer; }
  .gh .rl2 { font-size:12px; font-weight:400; opacity:.7; }
  .gv { margin:4px 0 6px; white-space:nowrap; }
  .big { font-size:30px; font-weight:300; }
  .half .big { font-size:24px; }
  .gu { font-size:16px; opacity:.6; margin-left:4px; }
  .mm { display:flex; justify-content:space-between; font-size:13px; gap:8px; }
  .mm div { display:flex; flex-direction:column; }
  .mm .r { text-align:right; }
  .mm b { font-weight:500; }
  .mm span { opacity:.8; }
  .lg { display:flex; justify-content:center; gap:16px; flex-wrap:wrap; font-size:13px; margin:6px 0 2px; }
  .lg i { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:5px; }
  .sv { margin-top:4px; }
  svg.gs { display:block; width:100%; }
  .sc { position:absolute; font-size:10px; opacity:.6; background:rgba(var(--ea-rgb,255,255,255),.55); border-radius:3px; padding:0 2px; pointer-events:none; }
  .sc.l { left:0; } .sc.r { right:0; }
  .ld { font-size:12px; opacity:.6; text-align:center; padding:12px; }
  .err { color:#a11a1a; font-size:12px; padding:8px; }
  .qh { font-size:11px; opacity:.6; margin:2px 0 0; display:flex; justify-content:flex-end; gap:8px; } .qh:empty { display:none; } .qh.w { opacity:.9; }
  .qi { display:inline-flex; align-items:center; gap:3px; cursor:help; } .qi ha-icon { --mdc-icon-size:14px; } .qi i { width:7px; height:7px; border-radius:50%; display:inline-block; } .qi.w { color:#a11a1a; }
  /* Tabelle */
  .mx-t { font-size:15px; font-weight:700; text-align:center; margin:2px 0 6px; }
  table { width:100%; border-collapse:separate; border-spacing:0; table-layout:fixed; }
  th, td { padding:6px 4px; text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  th { font-size:12px; font-weight:600; opacity:.8; vertical-align:bottom; }
  th ha-icon { --mdc-icon-size:20px; color:#000080; display:block; margin:0 0 2px auto; }
  th.rl, td.rl { text-align:left; width:var(--rlw,16%); }
  td.rl { font-size:13px; font-weight:600; opacity:.75; }
  td.rl ha-icon { --mdc-icon-size:18px; color:#000080; margin-right:6px; vertical-align:middle; }
  td.v { font-size:15px; font-weight:700; cursor:pointer; font-variant-numeric: tabular-nums; }
  td.v .u { font-size:11px; font-weight:400; opacity:.6; margin-left:2px; }
  td.v .dot { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:5px; vertical-align:middle; }
  td.na { opacity:.45; }
  tbody tr:nth-child(odd) td { background: rgba(255,255,255,0.12); }
  tbody tr td:first-child { border-radius:8px 0 0 8px; } tbody tr td:last-child { border-radius:0 8px 8px 0; }
  .hl { border-left:1px solid rgba(0,0,0,0.15); }
  td.hl.v { font-weight:800; }
  tr.hr td { border-top:1px solid rgba(0,0,0,0.15); font-weight:800; }
  tr.hr td.rl { opacity:.9; }
  /* Batterien */
  .bats { display:grid; gap:8px; }
  .bat { height:64px; box-sizing:border-box; padding:6px 12px; border-radius:12px; background: rgba(var(--ea-krgb,255,255,255),var(--ea-kachel,0.1));
    backdrop-filter: blur(var(--ea-blur,10px)); -webkit-backdrop-filter: blur(var(--ea-blur,10px)); border:1px solid rgba(255,255,255,var(--ea-krand,0.2)); cursor:pointer;
    display:grid; grid-template-areas:"i n s" "i l s" "b b b"; grid-template-columns:36px minmax(0,1fr) auto; grid-template-rows:1fr 1fr 8px; column-gap:10px; }
  .bat ha-icon { grid-area:i; --mdc-icon-size:28px; align-self:center; justify-self:center; }
  .bat .bn { grid-area:n; align-self:end; font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .bat .bl { grid-area:l; align-self:start; font-size:11px; color:var(--ea-text,#333); opacity:.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .bat .bs { grid-area:s; align-self:center; font-size:16px; font-weight:700; }
  .bat .bb { grid-area:b; align-self:center; height:4px; border-radius:2px; background:rgba(0,0,0,0.12); overflow:hidden; }
  .bat .bb i { display:block; height:100%; }
  .none { font-size:12px; opacity:.6; text-align:center; padding:8px; }
  @media (max-width: 480px) { td.v { font-size:13px; } th { font-size:11px; } td.v .u { display:none; } }
`;

/* ===================== Module ===================== */
class TilesMod {
  constructor(c, el) {
    this.c = c;
    el.innerHTML = `<div class="tiles" style="grid-template-columns:repeat(${nf(c.columns, 3)},minmax(0,1fr))"></div>`;
    this.box = el.firstChild; this.last = 0;
  }
  set hass(h) {
    const now = Date.now();
    if (this.last && now - this.last < 2000) return;
    this.last = now;
    this.box.innerHTML = (this.c.tiles || []).map((t) => {
      const r = tileVal(h, t), col = tileCol(t, r), blink = t.color === "onoff" && r.metric === 0;
      return `<div class="tile${blink ? " blink" : ""}" data-e="${esc(t.entity)}" title="${esc(t.name)}"${kd(t)}>
        <ha-icon icon="${esc(t.icon || "mdi:information-outline")}" style="color:${col}"></ha-icon>
        <div class="tn">${esc(t.name)}</div><div class="tv num">${esc(r.text)}</div></div>`;
    }).join("");
  }
}

const GTYPES = [["dot", "Tempo-Punkte (benötigt dot-gauge-card)"], ["arc", "Halbkreis"], ["ring", "Ring 270°"], ["needle", "Tacho mit Zeiger"],
  ["bar", "Balken waagerecht"], ["vbar", "Balken senkrecht"], ["value", "Große Zahl"]];
const segCol = (segs, v) => { let c = segs[0].color; for (const sg of segs) if (v >= sg.from) c = sg.color; return c; };
const pt = (cx, cy, r, a) => { const t = (a * Math.PI) / 180; return `${(cx + r * Math.cos(t)).toFixed(2)},${(cy + r * Math.sin(t)).toFixed(2)}`; };
const arcP = (cx, cy, r, a0, a1) => (a1 - a0 < 0.01 ? "" : `M${pt(cx, cy, r, a0)}A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${pt(cx, cy, r, a1)}`);
class GaugesMod {
  constructor(c, el) {
    this.c = c; this.els = []; this.h = null; this.nat = [];
    el.innerHTML = `<div class="gauges" style="grid-template-columns:repeat(${nf(c.columns, 2)},minmax(0,1fr))"></div>`;
    const box = el.firstChild;
    for (const g of (c.gauges || []).filter((x) => x && x.entity)) {
      const st = g.style || c.style || "arc";
      const segs = Array.isArray(g.segments) && g.segments.length ? g.segments : PRESET[g.preset || "load"] || PRESET.load;
      const slot = document.createElement("div"); box.appendChild(slot);
      if (st === "dot") {
        customElements.whenDefined("dot-gauge-card").then(() => {
          const { preset, style, ...rest } = g;
          const cfg = { ...rest, type: "custom:dot-gauge-card", segments: segs };
          const e = document.createElement("dot-gauge-card");
          try { e.setConfig(cfg); } catch (err) { return; }
          if (this.h) e.hass = this.h;
          slot.appendChild(e); this.els.push(e);
        });
      } else { slot.className = `ng ng-${st}`; slot.dataset.e = g.entity; if (pct(g.deckkraft) != null) slot.style.setProperty("--ea-kachel", pct(g.deckkraft)); this.nat.push({ g, st, segs, el: slot, sig: null }); }
    }
  }
  set hass(h) { this.h = h; for (const e of this.els) e.hass = h; for (const n of this.nat) this.drawN(n, h); }
  drawN(n, h) {
    const { g, st, segs } = n, s = h.states[g.entity], rv = g.range ? STAT.get(h, g.entity, g.range, g.agg || "mean") : null;
    const v = g.range ? (rv == null ? NaN : rv) : s ? parseFloat(s.state) : NaN, ok = !isNaN(v);
    const min = nf(g.min, 0), max = nf(g.max, 100), dec = nf(g.decimals, 1);
    const unit = g.unit != null && g.unit !== "" ? g.unit : (s && s.attributes.unit_of_measurement) || "";
    const p = ok ? Math.min(1, Math.max(0, (v - min) / (max - min || 1))) : 0, col = ok ? segCol(segs, v) : COL.off;
    const txt = ok ? fmt(v, dec) : "–", sig = `${txt}|${unit}|${col}`;
    if (sig === n.sig) return; n.sig = sig;
    const RG = g.range ? resolveRange(g.range) : null, aggL = { mean: "Ø", max: "max", min: "min" }[g.agg || "mean"];
    const nm = `<div class="ngn">${esc(g.name || (s && s.attributes.friendly_name) || g.entity)}${RG ? ` · ${aggL} ${esc(RG.label)}` : ""}</div>`;
    const val = `<div class="ngv num" style="color:${ok ? col : COL.off}">${txt}<span>${esc(unit)}</span></div>`;
    const mm = `<div class="ngm"><span>${fmt(min, 0)}</span><span>${fmt(max, 0)}</span></div>`;
    const TR = "rgba(0,0,0,0.10)";
    let html = "";
    if (st === "arc" || st === "ring") {
      const ring = st === "ring", a0 = ring ? 135 : 180, span = ring ? 270 : 180, cx = 60, cy = ring ? 58 : 60, r = ring ? 44 : 48, vb = ring ? "0 0 120 104" : "0 0 120 68";
      html = `<svg viewBox="${vb}"><path d="${arcP(cx, cy, r, a0, a0 + span)}" stroke="${TR}" stroke-width="10" fill="none" stroke-linecap="round"/>
        ${ok && p > 0 ? `<path d="${arcP(cx, cy, r, a0, a0 + span * p)}" stroke="${col}" stroke-width="10" fill="none" stroke-linecap="round"/>` : ""}
        <text x="${cx}" y="${ring ? cy + 6 : cy - 6}" text-anchor="middle" class="sv1" style="fill:${ok ? "var(--ea-text,#000)" : COL.off}">${txt}</text>
        <text x="${cx}" y="${ring ? cy + 20 : cy + 6}" text-anchor="middle" class="sv2">${esc(unit)}</text></svg>${mm}${nm}`;
    } else if (st === "needle") {
      const cx = 60, cy = 60, r = 46, ang = (x) => 180 + 180 * Math.min(1, Math.max(0, (x - min) / (max - min || 1)));
      let bands = "";
      segs.forEach((sg, i) => {
        const lo = Math.max(min, sg.from), hi = Math.min(max, i + 1 < segs.length ? segs[i + 1].from : max);
        if (hi > lo) bands += `<path d="${arcP(cx, cy, r, ang(lo), ang(hi))}" stroke="${sg.color}" stroke-width="9" fill="none" opacity=".8"/>`;
      });
      if (!bands) bands = `<path d="${arcP(cx, cy, r, 180, 360)}" stroke="${TR}" stroke-width="9" fill="none"/>`;
      html = `<svg viewBox="0 0 120 70">${bands}
        ${ok ? `<line x1="${cx}" y1="${cy}" x2="${pt(cx, cy, r - 4, 180 + 180 * p).split(",")[0]}" y2="${pt(cx, cy, r - 4, 180 + 180 * p).split(",")[1]}" stroke="#222" stroke-width="2.5" stroke-linecap="round"/>` : ""}
        <circle cx="${cx}" cy="${cy}" r="4.5" fill="#222"/></svg>${mm}${val}${nm}`;
    } else if (st === "bar") {
      html = `<div class="ngh">${nm}${val}</div><div class="ngt"><i style="width:${(p * 100).toFixed(1)}%;background:${col}"></i></div>${mm}`;
    } else if (st === "vbar") {
      html = `<div class="ngvb"><svg viewBox="0 0 30 100"><rect x="9" y="4" width="12" height="92" rx="6" fill="${TR}"/>
        ${ok ? `<rect x="9" y="${(4 + 92 * (1 - p)).toFixed(1)}" width="12" height="${(92 * p).toFixed(1)}" rx="6" fill="${col}"/>` : ""}</svg>
        <div>${val}<div class="ngm v"><span>max ${fmt(max, 0)}</span><span>min ${fmt(min, 0)}</span></div></div></div>${nm}`;
    } else {
      html = `<div class="ngv big2 num" style="color:${ok ? col : COL.off}">${txt}<span>${esc(unit)}</span></div><div class="ngt thin"><i style="width:${(p * 100).toFixed(1)}%;background:${col}"></i></div>${nm}`;
    }
    n.el.innerHTML = html;
  }
}

const GSTYLES = [["line", "Linie"], ["area", "Fläche"], ["step", "Stufen (Linie)"], ["step_area", "Stufen (Fläche)"], ["bar", "Balken (nebeneinander)"],
  ["stack_area", "Fläche gestapelt"], ["stack_bar", "Balken gestapelt"], ["points", "Punkte"], ["band", "Min/Max-Band + Mittelwert"]];
class GraphMod {
  constructor(c, el, ctx) {
    this.c = c; this.ds = (ctx && ctx.ds) || {}; this.at = 0; this.loading = false; this.data = null; this.errMsg = null;
    const ser = this.ser();
    const lg = ser.length > 1 ? `<div class="lg">${ser.map((s, i) => `<span><i style="background:${esc(s.color || DEFC[i % 4])}"></i>${esc(s.name || s.entity)}${s.axis === "right" ? " ▸" : ""}</span>`).join("")}</div>` : "";
    this.range = c.range || "";
    const RG = resolveRange(this.range);
    const pick = c.range_picker ? `<select class="rp">${c.range ? "" : `<option value="">letzte ${nf(c.hours, 24)} h</option>`}${rangeOpts().map(([v, l]) => `<option value="${v}"${v === this.range ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`
      : RG && !RG.rolling ? `<span class="rl2">${esc(RG.label)}</span>` : "";
    el.innerHTML = `<div class="gr" data-e="${esc(ser[0] ? ser[0].entity : "")}"><div class="gh"><span>${esc(c.name)}</span>${pick}</div>
      <div class="gv"></div><div class="mm"></div>${lg}<div class="sv"><div class="ld">Lade Verlauf…</div></div><div class="qh"></div></div>`;
    this.gv = el.querySelector(".gv"); this.mm = el.querySelector(".mm"); this.sv = el.querySelector(".sv"); this.qh = el.querySelector(".qh");
    const sel = el.querySelector(".rp");
    if (sel) {
      sel.addEventListener("click", (e) => e.stopPropagation());
      sel.addEventListener("change", (e) => { e.stopPropagation(); this.range = sel.value; this.data = null; this.sv.innerHTML = `<div class="ld">Lade Verlauf…</div>`; this.mm.innerHTML = ""; this.at = 0; if (this.h) { this.hass = this.h; } });
    }
  }
  ser() { return (this.c.series || []).filter((s) => s && s.entity); }
  styleOf(s) { return s.style || this.c.style || (this.c.fill === false ? "line" : "area"); }
  unit() {
    if (this.c.unit) return this.c.unit;
    const s0 = this.ser()[0], st = s0 && this.h && this.h.states[s0.entity];
    return st ? st.attributes.unit_of_measurement || "" : "";
  }
  set hass(h) {
    this.h = h;
    const s0 = this.ser()[0], st = s0 && h.states[s0.entity], v = st ? parseFloat(st.state) : NaN;
    const fac = nf(s0 && s0.factor, nf(this.c.factor, 1));
    const RG = resolveRange(this.range), live = !RG || RG.live;
    if (live && !(s0 && s0.change)) { const gh = isNaN(v) ? `<span class="big">–</span>` : `<span class="big num">${fmt(v * fac, nf(this.c.decimals, 1))}</span><span class="gu">${esc(this.unit())}</span>`; if (gh !== this._gvs) { this._gvs = gh; this.gv.innerHTML = gh; } }
    if (!this.loading && (!this.at || (live && Date.now() - this.at > 5 * 60e3))) this.fetch();
  }
  async fetch() {
    this.loading = true;
    const h = this.h, g = this.c, ser = this.ser(), rq = this.range;
    let ids = [];
    try {
      const now = Date.now(), RG = resolveRange(this.range) || { t0: now - nf(g.hours, 24) * 3600e3, t1: now, live: true };
      const span = RG.t1 - RG.t0, recent = RG.t0 > now - 9 * 864e5;
      const period = g.period || (span <= 2.05 * 864e5 && recent ? "5minute" : span <= 35 * 864e5 ? "hour" : span <= 800 * 864e5 ? "day" : "month");
      const edges = [];
      if (period === "5minute" || period === "hour") {
        const bms = (period === "hour" ? 60 : Math.max(5, Math.round(60 / nf(g.points_per_hour, 4)))) * 60e3;
        for (let t = Math.floor(RG.t0 / bms) * bms; t < RG.t1; t += bms) edges.push(t);
        edges.push(edges[edges.length - 1] + bms);
      } else {
        const d = new Date(RG.t0); d.setHours(0, 0, 0, 0); if (period === "month") d.setDate(1);
        while (d.getTime() < RG.t1) { edges.push(d.getTime()); if (period === "day") d.setDate(d.getDate() + 1); else d.setMonth(d.getMonth() + 1); }
        edges.push(d.getTime());
      }
      const t0 = edges[0], n = edges.length - 1, end = Math.min(edges[n], now);
      const idx = (t) => { if (t < edges[0] || t >= edges[n]) return -1; let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (edges[mid] <= t) lo = mid; else hi = mid - 1; } return lo; };
      const sIso = new Date(t0).toISOString(), eIso = new Date(end).toISOString();
      /* externe Quelle je Linie; kein Dienst/Fehler/Zeitueberschreitung/leer -> intern, mit Hinweis */
      const ext = {}, notes = [], DS = this.ds || {};
      const extIds = [...new Set(ser.filter((s) => s.quelle === "extern" && !s.change).map((s) => s.entity))];
      const bMin = edges.length > 1 ? Math.round((edges[1] - edges[0]) / 60e3) : 60;
      const bucket = period === "5minute" ? `${bMin} minutes` : period === "hour" ? "1 hour" : period === "day" ? "1 day" : "1 month";
      const bLbl = period === "5minute" ? `${bMin} min` : period === "hour" ? "1 h" : period === "day" ? "Tag" : "Monat";
      if (extIds.length && !DS.dienst) for (const id of extIds) ext[id] = false;
      if (extIds.length && DS.dienst) {
        const sv2 = String(DS.dienst).split("."), tmo = Math.max(1, nf(DS.timeout, 8)) * 1000, extra = {};
        for (const k of ["host", "port", "db", "tabelle", "profil"]) if (DS[k] !== "" && DS[k] != null) extra[k] = DS[k];
        await Promise.all(extIds.map(async (id) => {
          let tm;
          try {
            const r = await Promise.race([h.callWS({ type: "call_service", domain: sv2[0], service: sv2.slice(1).join("."), service_data: { sensor_id: id, start: sIso, end: eIso, bucket, ...extra }, return_response: true }),
              new Promise((_, rej) => { tm = setTimeout(() => rej(new Error("Zeitueberschreitung")), tmo); })]);
            const d = ((r && r.response) || {}).data;
            ext[id] = Array.isArray(d) && d.length ? d : null;
          } catch (e) { ext[id] = false; } finally { clearTimeout(tm); }
        }));
      }
      const useExt = (s) => s.quelle === "extern" && !s.change && Array.isArray(ext[s.entity]);
      ids = [...new Set(ser.filter((s) => !useExt(s)).map((s) => s.entity))];
      const qn = (s) => (ser.length > 1 ? `${s.name || s.entity}: ` : "");
      const anyExt = ser.some((s) => s.quelle === "extern");
      ser.forEach((s, i) => {
        if (!anyExt) return;
        const c = ser.length > 1 ? s.color || DEFC[i % 4] : null;
        if (s.quelle !== "extern") notes.push({ k: "ha", c, t: `${qn(s)}intern (Home Assistant)` });
        else if (s.change) notes.push({ k: "ha", c, t: `${qn(s)}Zähler vorerst intern` });
        else if (ext[s.entity] === false) notes.push({ k: "warn", w: true, c, t: `${qn(s)}extern nicht erreichbar · intern` });
        else if (ext[s.entity] === null) notes.push({ k: "warn", w: true, c, t: `${qn(s)}extern ohne Daten · intern` });
        else notes.push({ k: "db", c, t: `${qn(s)}extern · ${bLbl}` });
      });
      this.qnote = notes;
      let res = {}, hist = {};
      if (ids.length) res = await h.callWS({ type: "recorder/statistics_during_period", start_time: sIso, end_time: eIso, statistic_ids: ids, period, types: ["mean", "min", "max", "state", "change"] });
      const val = (r) => (r.mean != null ? r.mean : r.state);
      const missing = ids.filter((id) => !(res[id] && res[id].some((r) => val(r) != null || r.change != null)));
      if (missing.length) hist = await h.callWS({ type: "history/history_during_period", start_time: sIso, end_time: eIso, entity_ids: missing, minimal_response: true, no_attributes: true, significant_changes_only: false });
      const series = ser.map((s) => {
        const fac = nf(s.factor, nf(g.factor, 1)), o = new Array(n).fill(null), lo = new Array(n).fill(null), hi = new Array(n).fill(null);
        const mm = (k, a, b) => { if (a == null) return; lo[k] = lo[k] == null ? a : Math.min(lo[k], a); hi[k] = hi[k] == null ? b : Math.max(hi[k], b); };
        if (useExt(s)) {
          const sum = new Array(n).fill(0), cnt = new Array(n).fill(0);
          for (const p of ext[s.entity]) {
            const v = p && p[1] != null ? Number(p[1]) : NaN; if (isNaN(v)) continue;
            const k = idx(ts(p[0])); if (k >= 0) { sum[k] += v; cnt[k]++; mm(k, v * fac, v * fac); }
          }
          for (let k = 0; k < n; k++) if (cnt[k]) o[k] = (sum[k] / cnt[k]) * fac;
        } else if (!missing.includes(s.entity)) {
          const sum = new Array(n).fill(0), cnt = new Array(n).fill(0);
          for (const r of res[s.entity]) {
            const rv = s.change ? r.change : val(r); if (rv == null) continue;
            const k = idx(ts(r.start));
            if (k >= 0) { sum[k] += rv; cnt[k]++; mm(k, (r.min != null ? r.min : rv) * fac, (r.max != null ? r.max : rv) * fac); }
          }
          for (let k = 0; k < n; k++) if (cnt[k]) o[k] = (s.change ? sum[k] : sum[k] / cnt[k]) * fac;
        } else {
          const pts = (hist[s.entity] || []).map((p) => ({ t: p.lu != null ? p.lu * 1000 : Date.parse(p.last_updated || p.last_changed), v: parseFloat(p.s != null ? p.s : p.state) })).sort((a, b) => a.t - b.t);
          let j = 0, last = null;
          for (let k = 0; k < n; k++) {
            const a = edges[k], b = edges[k + 1]; let sm = 0, ct = 0;
            if (a > now) { o[k] = null; continue; }
            if (last != null) mm(k, last * fac, last * fac);
            while (j < pts.length && pts[j].t < b) {
              const p = pts[j];
              if (isNaN(p.v)) last = null; else { last = p.v; if (p.t >= a) { sm += p.v; ct++; mm(k, p.v * fac, p.v * fac); } }
              j++;
            }
            const v = ct ? sm / ct : last;
            o[k] = v == null ? null : v * fac;
            if (o[k] == null) { lo[k] = null; hi[k] = null; }
          }
        }
        const cap = nf(s.cap, null), ov = nf(s.over, null);
        if (cap != null || ov != null) for (let k = 0; k < n; k++) if (o[k] != null) { if (cap != null) o[k] = Math.min(o[k], cap); if (ov != null) o[k] = Math.max(o[k] - ov, 0); }
        return { v: o, lo, hi };
      });
      this.data = { edges, n, period, span, series, live: RG.live }; this.errMsg = null;
    } catch (e) {
      this.errMsg = e.message || String(e);
    } finally {
      this.at = Date.now(); this.loading = false;
      if (rq !== this.range) { this.at = 0; if (this.h) this.hass = this.h; } else this.draw();
    }
  }
  draw() {
    const g = this.c, sv = this.sv, mm = this.mm;
    if (this.qh) { const q = this.qnote || [], qs = q.map((x) => x.k + x.t).join("|"); if (qs !== this._qs) { this._qs = qs; this.qh.innerHTML = q.map((x) => qIcon(x.k, x.t, x.c)).join(""); this.qh.className = "qh" + (q.some((x) => x.w) ? " w" : ""); } }
    if (this.errMsg) { sv.innerHTML = `<div class="err">Fehler: ${esc(this.errMsg)}</div>`; return; }
    const D = this.data; if (!D) return;
    const ser = this.ser(), n = D.n;
    if (!D.series.some((d) => d.v.some((v) => v != null))) { sv.innerHTML = `<div class="ld">keine Daten im Zeitraum</div>`; mm.innerHTML = ""; return; }
    const sty = ser.map((s) => this.styleOf(s)), ax = ser.map((s) => (s.axis === "right" ? "r" : "l"));
    /* gestapelte Werte je Achse (Lücke einer Serie = sie traegt nichts bei und wird dort nicht gezeichnet) */
    const base = ser.map(() => new Array(n).fill(null)), top = ser.map(() => new Array(n).fill(null));
    for (const a of ["l", "r"]) for (const kind of ["stack_area", "stack_bar"]) {
      const acc = new Array(n).fill(0);
      ser.forEach((s, i) => {
        if (ax[i] !== a || sty[i] !== kind) return;
        D.series[i].v.forEach((v, k) => { if (v == null) return; base[i][k] = acc[k]; acc[k] += v; top[i][k] = acc[k]; });
      });
    }
    const rng = {};
    for (const a of ["l", "r"]) {
      const vals = [];
      ser.forEach((s, i) => {
        if (ax[i] !== a) return;
        const d = D.series[i];
        if (sty[i].startsWith("stack")) { top[i].forEach((v) => v != null && vals.push(v)); base[i].forEach((v) => v != null && vals.push(v)); }
        else if (sty[i] === "band") { d.lo.forEach((v) => v != null && vals.push(v)); d.hi.forEach((v) => v != null && vals.push(v)); }
        else d.v.forEach((v) => v != null && vals.push(v));
        if (/bar|area/.test(sty[i])) vals.push(0);
      });
      if (!vals.length) continue;
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
      const pad = (hi - lo) * 0.08; hi += pad; if (lo < 0 || !vals.includes(0)) lo -= pad;
      rng[a] = [lo, hi];
    }
    const W = 300, H = Math.max(30, nf(g.height, g.half ? 60 : 80)), sw = W / n;
    const X = (k) => (k + 0.5) * sw, XL = (k) => k * sw, XR = (k) => (k + 1) * sw;
    const Yf = (a) => { const [lo, hi] = rng[a]; return (v) => H - ((v - lo) / (hi - lo)) * H; };
    const uid = Math.random().toString(36).slice(2, 7), f1 = (x) => x.toFixed(1);
    const runs = (arr) => { const r = []; let cur = null; arr.forEach((v, k) => { if (v == null) { if (cur) { r.push(cur); cur = null; } return; } if (!cur) cur = []; cur.push(k); }); if (cur) r.push(cur); return r; };
    const nBar = ser.filter((s, i) => sty[i] === "bar").length; let barI = 0;
    let defs = "", body = "";
    ser.forEach((s, i) => {
      if (!rng[ax[i]]) return;
      const col = esc(s.color || DEFC[i % 4]), Y = Yf(ax[i]), d = D.series[i], st = sty[i], y0 = Y(Math.min(Math.max(0, rng[ax[i]][0]), rng[ax[i]][1]));
      const gid = `f${uid}_${i}`;
      defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity="${i === 0 ? 0.35 : 0.22}"/><stop offset="1" stop-color="${col}" stop-opacity="0.02"/></linearGradient>`;
      const line = (p) => `<path d="${p}" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
      if (st === "line" || st === "area") {
        for (const r of runs(d.v)) {
          const p = r.map((k, j) => `${j ? "L" : "M"}${f1(r.length === 1 ? XL(k) : X(k))},${f1(Y(d.v[k]))}`).join("") + (r.length === 1 ? `L${f1(XR(r[0]))},${f1(Y(d.v[r[0]]))}` : "");
          if (st === "area") { const x0 = r.length === 1 ? XL(r[0]) : X(r[0]), x1 = r.length === 1 ? XR(r[0]) : X(r[r.length - 1]); body += `<path d="${p}L${f1(x1)},${f1(y0)}L${f1(x0)},${f1(y0)}Z" fill="url(#${gid})"/>`; }
          body += line(p);
        }
      } else if (st === "step" || st === "step_area") {
        for (const r of runs(d.v)) {
          const p = r.map((k, j) => `${j ? "L" : "M"}${f1(XL(k))},${f1(Y(d.v[k]))}L${f1(XR(k))},${f1(Y(d.v[k]))}`).join("");
          if (st === "step_area") body += `<path d="${p}L${f1(XR(r[r.length - 1]))},${f1(y0)}L${f1(XL(r[0]))},${f1(y0)}Z" fill="url(#${gid})"/>`;
          body += line(p);
        }
      } else if (st === "stack_area") {
        for (const r of runs(top[i])) {
          let p = r.map((k, j) => `${j ? "L" : "M"}${f1(XL(k))},${f1(Y(top[i][k]))}L${f1(XR(k))},${f1(Y(top[i][k]))}`).join("");
          for (let j = r.length - 1; j >= 0; j--) { const k = r[j]; p += `L${f1(XR(k))},${f1(Y(base[i][k]))}L${f1(XL(k))},${f1(Y(base[i][k]))}`; }
          body += `<path d="${p}Z" fill="${col}" fill-opacity="${i === 0 ? 0.4 : 0.6}" stroke="none"/>`;
        }
      } else if (st === "stack_bar" || st === "bar") {
        const gap = Math.min(sw * 0.2, 2), bw = st === "bar" ? (sw - gap) / Math.max(1, nBar) : sw - gap, off = st === "bar" ? gap / 2 + barI * bw : gap / 2;
        d.v.forEach((v, k) => {
          if (v == null) return;
          const a = st === "bar" ? y0 : Y(base[i][k]), b = st === "bar" ? Y(v) : Y(top[i][k]);
          body += `<rect x="${f1(XL(k) + off)}" y="${f1(Math.min(a, b))}" width="${f1(Math.max(0.3, bw))}" height="${f1(Math.max(0.5, Math.abs(a - b)))}" fill="${col}" fill-opacity="${st === "bar" ? 0.75 : i === 0 ? 0.5 : 0.7}"/>`;
        });
        if (st === "bar") barI++;
      } else if (st === "points") {
        d.v.forEach((v, k) => { if (v != null) body += `<ellipse cx="${f1(X(k))}" cy="${f1(Y(v))}" rx="${f1(Math.min(2.2, sw / 2))}" ry="2.2" fill="${col}"/>`; });
      } else if (st === "band") {
        for (const r of runs(d.v)) {
          const rr = r.filter((k) => d.lo[k] != null && d.hi[k] != null);
          if (rr.length) {
            let p = rr.map((k, j) => `${j ? "L" : "M"}${f1(XL(k))},${f1(Y(d.hi[k]))}L${f1(XR(k))},${f1(Y(d.hi[k]))}`).join("");
            for (let j = rr.length - 1; j >= 0; j--) { const k = rr[j]; p += `L${f1(XR(k))},${f1(Y(d.lo[k]))}L${f1(XL(k))},${f1(Y(d.lo[k]))}`; }
            body += `<path d="${p}Z" fill="${col}" fill-opacity="0.18" stroke="none"/>`;
          }
          body += line(r.map((k, j) => `${j ? "L" : "M"}${f1(r.length === 1 ? XL(k) : X(k))},${f1(Y(d.v[k]))}`).join("") + (r.length === 1 ? `L${f1(XR(r[0]))},${f1(Y(d.v[r[0]]))}` : ""));
        }
      }
    });
    const dec = nf(g.decimals, 1), scale = g.show_scale || !!rng.r;
    const lab = (a, side) => !rng[a] ? "" : `<span class="sc ${side}" style="top:0">${fmt(rng[a][1], dec)}</span><span class="sc ${side}" style="bottom:0">${fmt(rng[a][0], dec)}</span>`;
    sv.innerHTML = `<div style="position:relative"><svg class="gs" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px"><defs>${defs}</defs>${body}</svg>${scale ? lab("l", "l") + lab("r", "r") : ""}</div>`;
    const a0 = D.series[0].v; let mi = -1, ma = -1;
    a0.forEach((v, k) => { if (v == null) return; if (mi < 0 || v < a0[mi]) mi = k; if (ma < 0 || v > a0[ma]) ma = k; });
    const u = esc(this.unit());
    const tl = (k) => {
      const dt = new Date(D.edges[k]);
      if (D.period === "month") return `${MON[dt.getMonth()]} ${dt.getFullYear()}`;
      const dd = dt.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
      if (D.period === "day") return dd;
      const tm = dt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      return D.span > 26 * 3600e3 ? `${dd} ${tm}` : tm;
    };
    const chg = !!(this.ser()[0] && this.ser()[0].change);
    if (!D.live || chg) { const ok = a0.filter((x) => x != null), sm = ok.reduce((x, y) => x + y, 0), av = ok.length ? (chg ? sm : sm / ok.length) : null;
      this._gvs = null; this.gv.innerHTML = av == null ? `<span class="big">–</span>` : `<span class="gu" style="margin:0 4px 0 0">${chg ? "Σ" : "Ø"}</span><span class="big num">${fmt(av, dec)}</span><span class="gu">${u}</span>`; }
    mm.innerHTML = mi < 0 ? "" : `<div><b>Min</b><span class="num">${fmt(a0[mi], dec)} ${u}</span><span>${tl(mi)}</span></div>
      <div class="r"><b>Max</b><span class="num">${fmt(a0[ma], dec)} ${u}</span><span>${tl(ma)}</span></div>`;
  }
}

class MatrixMod {
  constructor(c, el) { this.c = c; this.el = el; this.sig = null; }
  cell(row, cell, hl, colCfg) {
    const s = cell && cell.entity ? this.h.states[cell.entity] : null, rg = colCfg && colCfg.range;
    const rv = rg && s ? STAT.get(this.h, cell.entity, rg, "change") : null;
    const v = rg ? (rv == null ? NaN : rv) : s ? parseFloat(s.state) : NaN;
    const cls = `v${hl ? " hl" : ""}`;
    if (!s || isNaN(v)) return { sig: rv === undefined ? "l" : "x", html: `<td class="${cls} na" data-e="${esc(cell && cell.entity)}">${rv === undefined && rg && s ? "…" : "–"}</td>` };
    const pick = (k) => [cell, colCfg, row].map((o) => o && o[k]).find((x) => x !== "" && x != null);
    const pu = pick("unit");
    let unit = pu != null ? pu : s.attributes.unit_of_measurement || "", txt;
    if (pu === "auto") {
      const su = s.attributes.unit_of_measurement || "kWh";
      const kwh = su === "Wh" ? v / 1000 : su === "MWh" ? v * 1000 : v;
      if (Math.abs(kwh) < 1) { unit = "Wh"; txt = fmt(kwh * 1000, 0); } else { unit = "kWh"; txt = fmt(kwh, nf(pick("decimals"), 2)); }
    } else txt = fmt(v * nf(pick("factor"), 1), nf(pick("decimals"), 1));
    const w = nf(cell.warn, null), b = nf(cell.bad, null);
    const col = b != null && v >= b ? COL.bad : w != null && v >= w ? COL.warn : w != null || b != null ? COL.ok : null;
    const dot = col ? `<span class="dot" style="background:${col}"></span>` : "";
    return { sig: txt + col, html: `<td class="${cls}" data-e="${esc(cell.entity)}" title="${esc(s.attributes.friendly_name || cell.entity)}">${dot}${txt}${unit ? `<span class="u">${esc(unit)}</span>` : ""}</td>` };
  }
  set hass(h) {
    this.h = h;
    const now = Date.now(); if (this._lt && now - this._lt < 1500) return; this._lt = now;
    const c = this.c, cols = c.columns || [], rows = c.rows || [], n = cols.length, nr = rows.length;
    const hlLast = c.highlight_last !== false && n > 1, hlRow = !!c.highlight_last_row && nr > 1;
    let sig = "";
    const body = rows.map((r, ri) => {
      const cells = Array.from({ length: n }, (_, i) => this.cell(r, (r.cells || [])[i], hlLast && i === n - 1, cols[i]));
      sig += cells.map((x) => x.sig).join("|") + "#";
      const ic = r.icon ? `<ha-icon icon="${esc(r.icon)}"></ha-icon>` : "";
      return `<tr${hlRow && ri === nr - 1 ? ' class="hr"' : ""}><td class="rl">${ic}${esc(r.label)}</td>${cells.map((x) => x.html).join("")}</tr>`;
    }).join("");
    if (sig === this.sig) return;
    this.sig = sig;
    const head = cols.map((col, i) => `<th class="${hlLast && i === n - 1 ? "hl" : ""}">${col.icon ? `<ha-icon icon="${esc(col.icon)}"></ha-icon>` : ""}${esc(col.name)}</th>`).join("");
    this.el.innerHTML = `${c.name ? `<div class="mx-t">${esc(c.name)}</div>` : ""}<table style="${c.label_width ? `--rlw:${esc(c.label_width)}` : ""}">
      <thead><tr><th class="rl"></th>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }
}

class BatteriesMod {
  constructor(c, el) {
    this.c = c; this.last = 0; this.sig = null;
    el.innerHTML = `<div class="bats" style="grid-template-columns:repeat(${nf(c.columns, 1)},minmax(0,1fr))"></div>`;
    this.box = el.firstChild;
  }
  area(h, id) {
    const e = (h.entities || {})[id] || {};
    let a = e.area_id;
    if (!a && e.device_id && h.devices && h.devices[e.device_id]) a = h.devices[e.device_id].area_id;
    return a || null;
  }
  set hass(h) {
    const now = Date.now();
    if (this.last && now - this.last < 5000) return;
    this.last = now;
    const c = this.c, inc = c.areas || [], exA = c.exclude_areas || [], low = nf(c.low, 20), mid = nf(c.mid, 50);
    let ex = null; try { ex = c.exclude ? new RegExp(c.exclude, "i") : null; } catch (e) { ex = null; }
    const list = [];
    for (const [id, s] of Object.entries(h.states)) {
      if (!/^(sensor|binary_sensor)\./.test(id) || s.attributes.device_class !== "battery") continue;
      if (ex && ex.test(id)) continue;
      const a = this.area(h, id);
      if (inc.length && !inc.includes(a)) continue;
      if (exA.length && exA.includes(a)) continue;
      const bin = id.startsWith("binary_sensor."), v = parseFloat(s.state);
      const key = bin ? (s.state === "on" ? -1 : 1000) : isNaN(v) ? 2000 : v;
      list.push({ id, s, a, bin, v, key });
    }
    list.sort((x, y) => x.key - y.key);
    const rows = list.map(({ id, s, a, bin, v }) => {
      const col = bin ? (s.state === "on" ? COL.bad : COL.ok) : isNaN(v) ? COL.off : v <= low ? COL.bad : v <= mid ? COL.warn : COL.ok;
      const pct = bin ? (s.state === "on" ? 10 : 100) : isNaN(v) ? 0 : Math.min(100, Math.max(0, v));
      const lvl = Math.round(v / 10) * 10;
      const icon = bin ? (s.state === "on" ? "mdi:battery-alert" : "mdi:battery") : isNaN(v) ? "mdi:battery-unknown" : lvl >= 100 ? "mdi:battery" : lvl <= 0 ? "mdi:battery-outline" : `mdi:battery-${lvl}`;
      const txt = bin ? (s.state === "on" ? "Schwach" : s.state === "off" ? "OK" : s.state) : isNaN(v) ? "—" : `${Math.round(v)} %`;
      const red = s.state === "on" || (!isNaN(v) && v <= low);
      const name = (s.attributes.friendly_name || id).replace(/\s*(Batterie|Battery level|Battery|battery_soc)\s*$/i, "").replace(/\s+/g, " ").trim();
      const ar = a && h.areas ? h.areas[a] : null, fl = ar && ar.floor_id && h.floors ? h.floors[ar.floor_id] : null;
      const lab = ar ? (fl ? `${fl.name} · ${ar.name}` : ar.name) : "Ohne Raum";
      return `<div class="bat" data-e="${esc(id)}"><ha-icon icon="${icon}" style="color:${col}"></ha-icon><div class="bn">${esc(name)}</div>
        <div class="bl">${esc(lab)}</div><div class="bs num" style="color:${red ? COL.bad : "var(--ea-text,#000)"}">${esc(txt)}</div><div class="bb"><i style="width:${pct}%;background:${col}"></i></div></div>`;
    });
    const html = rows.length ? rows.join("") : `<div class="none">keine Akkus in diesem Bereich</div>`;
    if (html === this.sig) return;
    this.sig = html; this.box.innerHTML = html;
  }
}

const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const MODS = { tiles: TilesMod, gauges: GaugesMod, graph: GraphMod, matrix: MatrixMod, batteries: BatteriesMod };

class EnergieAtlas extends HTMLElement {
  static getConfigElement() { return document.createElement("energie-atlas-editor"); }
  static getStubConfig() { return { title: "Neu", modules: [{ type: "tiles", columns: 3, tiles: [{ name: "Wert", icon: "mdi:information-outline", entity: "", format: "state", color: "none" }] }] }; }
  setConfig(c) {
    if (!c || (c.modules != null && !Array.isArray(c.modules))) throw new Error("modules muss eine Liste sein");
    this._config = JSON.parse(JSON.stringify({ title: "", modules: [], ...c }));
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (ev) => {
        const el = ev.composedPath().find((x) => x && x.dataset && x.dataset.e);
        if (el) this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: el.dataset.e }, bubbles: true, composed: true }));
      });
    }
    this._build();
  }
  connectedCallback() { if (this._hass && this._pending) { this._pending = false; this.hass = this._hass; } }
  _dispose() {
    for (const x of this._mods || []) {
      const m = x.m;
      try { if (m.onDisconnect) m.onDisconnect(); } catch (e) { /* egal */ }
      try { if (m._ro) m._ro.disconnect(); } catch (e) { /* egal */ }
      m._gone = true;
    }
    this._mods = [];
  }
  _build() {
    this._dispose();
    const c = this._config;
    this.shadowRoot.innerHTML = `<style>${CSS}</style><div class="glass">${c.title ? `<div class="title">${esc(c.title)}</div>` : ""}<div class="mods"></div></div>`;
    const box = this.shadowRoot.querySelector(".mods");
    const cardKd = glasVars(this.shadowRoot.querySelector(".glass"), c, GLAS_VARS.map((x) => x[0]));
    const ub = pct(c.unschaerfe != null && c.unschaerfe !== "" ? c.unschaerfe : null); if (ub != null) this.shadowRoot.querySelector(".glass").style.setProperty("--ea-blur", `${Math.round(ub * 100)}px`);
    const farbKd = farbVars(this.shadowRoot.querySelector(".glass"), c);
    this._mods = []; this._unknown = [];
    const ctx = { ds: c.datenquelle || {} };
    for (const m of c.modules) {
      const K = MODS[m && m.type] || REG.modules[m && m.type];
      const el = document.createElement("div");
      el.className = `mod${m && m.half ? " half" : ""}`;
      el._kd = glasVars(el, m, ["kachel_deckkraft", "kachel_rand_deckkraft"]);
      box.appendChild(el);
      if (!K) { this._unknown.push(m && m.type); el.innerHTML = `<div class="err">Unbekanntes Modul: ${esc(m && m.type)}</div>`; continue; }
      try { this._mods.push({ m: new K(m, el, ctx), el }); } catch (e) { el.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    }
    for (const x of this._mods) { const me = x.el.classList.contains("mod") ? x.el : x.el.parentElement; if ((cardKd || farbKd || (me && me._kd)) && x.el.shadowRoot) adoptGlas(x.el.shadowRoot); }
    this._regV = REG.ver || 0;
    if (this._hass) this.hass = this._hass;
  }
  set hass(h) {
    this._hass = h;
    if (!this.isConnected) { this._pending = true; return; }
    if (document.hidden) return; /* v0.12b: Browser-Tab im Hintergrund – nichts rechnen/laden; das naechste HA-Update nach der Rueckkehr holt alles nach */
    const v = REG.ver || 0;
    if (v !== this._regV) {
      this._regV = v;
      if (this._unknown && this._unknown.some((t) => REG.modules[t])) { this._build(); return; }
    }
    for (const x of this._mods || []) {
      try { x.m.hass = h; } catch (e) { if (!x.err) { x.err = true; x.el.innerHTML = `<div class="err">Modulfehler: ${esc(e.message || e)}</div>`; } }
    }
  }
  getCardSize() { return 2 + 3 * ((this._config && this._config.modules.length) || 1); }
  getGridOptions() { return { columns: "full", min_rows: 2 }; }
}

/* ===================== Editor ===================== */
const ENT = { entity: {} }, TXT = { text: {} }, ICON = { icon: {} }, BOOL = { boolean: {} }, COLOR = { text: { type: "color" } };
const ANY = { number: { mode: "box", step: "any" } }, NUM = (min, max) => ({ number: { min, max, step: 1, mode: "box" } });
const SEL = (opts) => ({ select: { mode: "dropdown", options: opts.map(([value, label]) => ({ value, label })) } });
const fld = (name, label, selector) => ({ name, label, selector });
const RSEL = (empty) => ({ select: { mode: "dropdown", custom_value: true, options: [{ value: "", label: empty }, ...rangeOpts().map(([value, label]) => ({ value, label }))] } });
const FORMATS = [["state", "Zahl / Zustand"], ["since", "Laufzeit seit Zeitstempel"], ["secs_ago", "Sekunden → live / min / h"],
  ["days", "Tage (z.B. Betriebstage)"], ["mio", "Millionen (Zeilen)"], ["mb_gb", "MB → GB"],
  ["year_since", "Jahre zurück → „seit Jahr“"], ["year_until", "Jahre voraus → „bis Jahr“"], ["onoff", "an / aus (Texte wählbar)"],
  ["version", "Update: installierte Version"], ["updates", "Anzahl offener Updates"], ["attr", "Attribut anzeigen"],
  ["ago", "vor … (Zeitstempel)"], ["until", "in … (Zeitstempel)"], ["backup_state", "Backup-Status"],
  ["backup_latest", "Größe neuestes Backup"], ["backup_all", "Backups Google Drive"]];
const COLORS = [["none", "fest (Blau)"], ["up", "Ampel: höher = schlechter"], ["down", "Ampel: niedriger = schlechter"],
  ["onoff", "an = grün, aus = rot + Blinken"], ["flag", "> 0 = gelb, sonst grün"], ["state3", "0 grün · 1 gelb · 2 rot"]];
const TYPES = { tiles: "Kacheln", gauges: "Gauges", graph: "Verlaufsgraph", matrix: "Tabelle", batteries: "Batterien" };
const HALF = fld("half", "Halbe Breite (zwei nebeneinander)", BOOL);
const PCT = { number: { min: 0, max: 100, step: 1, mode: "box", unit_of_measurement: "%" } };
const MOD_GLAS_F = [fld("kachel_deckkraft", "Kacheln: Deckkraft Hintergrund (leer = wie Karte)", PCT), fld("kachel_rand_deckkraft", "Kacheln: Deckkraft Rahmen (leer = wie Karte)", PCT)];
const CARD_GLAS_F = [fld("glas_deckkraft", "Karte: Deckkraft Hintergrund (Standard 1 %)", PCT), fld("rand_deckkraft", "Karte: Deckkraft Rahmen (Standard 20 %)", PCT),
  fld("kachel_deckkraft", "Kacheln: Deckkraft Hintergrund (Standard 10 %)", PCT), fld("kachel_rand_deckkraft", "Kacheln: Deckkraft Rahmen (Standard 20 %)", PCT),
  fld("unschaerfe", "Unschärfe dahinter (px, Standard 10)", { number: { min: 0, max: 40, step: 1, mode: "box", unit_of_measurement: "px" } }),
  fld("milch", "Milchglas-Effekt (%, 0 = klares Glas)", PCT), fld("hintergrund_farbe", "Karte: Hintergrundfarbe (leer = weiß)", COLOR),
  fld("kachel_farbe", "Kacheln: Hintergrundfarbe (leer = weiß)", COLOR), fld("textfarbe", "Textfarbe (leer = schwarz, z. B. hell bei dunklem Hintergrund)", COLOR)];
const DS_F = [fld("dienst", "Dienst, der Verlaufsdaten liefert (z. B. pyscript.ltss_series)", TXT), fld("host", "Server / Host (leer = wie im Dienst hinterlegt)", TXT), fld("port", "Port", NUM(1, 65535)),
  fld("db", "Datenbank", TXT), fld("tabelle", "Tabelle / View", TXT), fld("profil", "Zugangsprofil (Name in secrets.yaml, kein Passwort!)", TXT), fld("timeout", "Zeitlimit in s (danach intern, Standard 8)", NUM(1, 60))];
const TILE_F = [fld("name", "Name", TXT), fld("icon", "Icon", ICON), fld("entity", "Entität", ENT), fld("format", "Anzeige", SEL(FORMATS)),
  fld("attribute", "Attribut (nur Format „Attribut“)", TXT), fld("decimals", "Nachkommastellen (leer = automatisch)", NUM(0, 6)),
  fld("range", "Zeitraum → zeigt Verbrauch des Zählers statt aktuellem Wert", RSEL("– aktueller Wert –")),
  fld("unit", "Einheit (leer = von der Entität)", TXT), fld("color", "Icon-Farbe", SEL(COLORS)),
  fld("warn", "Schwelle gelb", ANY), fld("bad", "Schwelle rot", ANY), fld("text_on", "Text bei an", TXT), fld("text_off", "Text bei aus", TXT), fld("deckkraft", "Deckkraft dieser Kachel (%, leer = wie Modul)", PCT)];
const GAUGE_F = [fld("entity", "Entität", ENT), fld("name", "Titel", TXT), fld("style", "Gauge-Art", SEL([["", "wie Modul"], ...GTYPES])),
  fld("range", "Zeitraum → Wert über den Zeitraum statt aktuell (nicht bei Tempo-Punkten)", RSEL("– aktueller Wert –")),
  fld("agg", "Wert über den Zeitraum", SEL([["mean", "Mittelwert"], ["max", "Maximum"], ["min", "Minimum"]])),
  fld("min", "Minimum", ANY), fld("max", "Maximum", ANY), fld("decimals", "Nachkommastellen", NUM(0, 4)), fld("unit", "Einheit (leer = von der Entität)", TXT),
  fld("preset", "Farbsegmente", SEL([["load", "Last (gelb ab 60, rot ab 85)"], ["ram", "Belegung (gelb ab 75, rot ab 90)"], ["temp", "Temperatur (gelb ab 60, rot ab 75)"], ["temp_hot", "Temperatur (gelb ab 70, rot ab 85)"]])),
  fld("mode", "Vergleich 1h-Punkt (nur Tempo-Punkte)", SEL([["ratio", "Faktor mit Offset k"], ["diff", "Differenz (Temperatur)"]])),
  fld("k", "Offset k (nur Tempo-Punkte, Faktor-Modus)", ANY), fld("diff_scale", "Differenz für doppeltes Tempo (nur Tempo-Punkte)", ANY), fld("deckkraft", "Deckkraft dieses Gauges (%, leer = wie Modul; nicht bei Tempo-Punkten)", PCT)];
const GRAPH_F = [HALF, fld("name", "Titel", TXT), fld("range", "Zeitraum", RSEL("letzte X Stunden (Feld darunter)")), fld("range_picker", "Zeitraum-Auswahl auf der Karte anzeigen", BOOL),
  fld("hours", "Stunden (wenn kein Zeitraum gewählt)", NUM(1, 720)), fld("points_per_hour", "Punkte pro Stunde (bis 48 h)", NUM(1, 12)),
  fld("height", "Höhe (px)", NUM(30, 300)), fld("style", "Darstellung", SEL(GSTYLES)), fld("show_scale", "Skala (Min/Max der Achse) anzeigen", BOOL), fld("decimals", "Nachkommastellen", NUM(0, 4)),
  fld("period", "Raster", SEL([["", "automatisch"], ["hour", "Stunde"], ["day", "Tag"]])),
  fld("unit", "Einheit (leer = von der Entität)", TXT), fld("factor", "Faktor für alle Linien (z.B. 0,001 für MB→GB)", ANY)];
const SERIES_F = [fld("entity", "Entität", ENT), fld("name", "Name in der Legende (leer = Entität)", TXT), fld("color", "Farbe", COLOR),
  fld("style", "Darstellung dieser Linie", SEL([["", "wie Graph"], ...GSTYLES])), fld("axis", "Y-Achse", SEL([["left", "links"], ["right", "rechts (eigene Skala)"]])),
  fld("quelle", "Datenquelle", SEL([["intern", "intern (Home Assistant)"], ["extern", "extern (siehe Kopf „Datenquelle extern“)"]])),
  fld("change", "Verbrauch je Abschnitt (Zähler, statt Stand)", BOOL), fld("cap", "höchstens (z.B. Sockel)", ANY), fld("over", "nur Anteil über (z.B. Rest über Sockel)", ANY),
  fld("factor", "Faktor nur für diese Linie (leer = wie oben)", ANY)];
const FMT_F = [fld("unit", "Einheit (leer = von Entität, auto = Wh/kWh automatisch)", TXT), fld("decimals", "Nachkommastellen", NUM(0, 4)), fld("factor", "Faktor (z.B. 1000 für kWh→Wh)", ANY)];
const blank = {
  tiles: () => ({ type: "tiles", columns: 3, tiles: [] }),
  gauges: () => ({ type: "gauges", columns: 2, gauges: [] }),
  graph: () => ({ type: "graph", name: "Neu · 24 h", hours: 24, style: "area", decimals: 1, series: [{ entity: "", name: "", color: DEFC[0] }] }),
  matrix: () => ({ type: "matrix", highlight_last: false, columns: [], rows: [] }),
  batteries: () => ({ type: "batteries", areas: [], exclude: "", low: 20, mid: 50 }),
};
let _rdy;
const pickers = () => {
  if (!_rdy) _rdy = (async () => {
    if (customElements.get("ha-form") && customElements.get("ha-entity-picker")) return;
    try { const hp = await window.loadCardHelpers(); const cd = await hp.createCardElement({ type: "entities", entities: [] }); if (cd.constructor.getConfigElement) await cd.constructor.getConfigElement(); } catch (e) { /* egal */ }
    await customElements.whenDefined("ha-form");
  })();
  return _rdy;
};
const ED_CSS = `
  .sec { margin: 16px 0 6px; font-weight: 600; font-size: 15px; }
  .sub { font-size: 13px; font-weight: 600; margin: 12px 0 4px; opacity: .8; }
  .item { border: 1px solid var(--divider-color, #ddd); border-radius: 10px; padding: 8px 10px 10px; margin-bottom: 8px; }
  .item .item { border-style: dashed; }
  .ih { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .ih .t { flex: 1; font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item.closed > .body { display: none; } .body { margin-top: 6px; }
  button { cursor: pointer; border: 1px solid var(--divider-color, #ccc); background: var(--card-background-color, #fff); color: var(--primary-text-color);
    border-radius: 8px; padding: 4px 8px; font-size: 13px; display: inline-flex; align-items: center; gap: 4px; }
  button:disabled { opacity: .35; cursor: default; } button ha-icon { --mdc-icon-size: 18px; }
  .add { width: 100%; justify-content: center; padding: 8px; margin-bottom: 6px; }
  .adds { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .hint { font-size: 12px; opacity: .7; margin-top: 8px; }
`;
const label = (o) => (o && (o.name || o.label || o.entity)) || "";
/* ---- Auto-Editor: Listen/Objekte statt YAML-Blob, Entitäten mit Feld-Funktion ---- */
const LBL = { name: "Name", sub: "Untertitel", icon: "Icon", color: "Farbe", entity: "Entität", label: "Beschriftung",
  power: "Leistung (W)", soc: "Ladestand (SoC %)", energy: "Energie", capacity: "Kapazität", capacity_kwh: "Kapazität (kWh, fest)",
  today: "Energie heute", week: "Energie 7 Tage", two_weeks: "Energie 14 Tage", month: "Energie Monat", total: "Zählerstand gesamt",
  voltage: "Spannung (V)", current: "Strom (A)", temp: "Temperatur", output: "Ausgangsleistung (W)", pv: "PV-Eingang",
  kwp: "Anlagengröße (kWp)", compare: "Vergleichs-Leistung (Gerät selbst)", ports: "Module / Ports", energy_factor: "Faktor Energie",
  timer_power: "Timer-Ausgangsleistung", timer_switch: "Timer Ein/Aus", dod: "Entladetiefe (DoD)", today_pv: "PV heute (kWh)",
  today_out: "Ausgang heute (kWh)", today_charge: "Geladen heute (kWh)", today_discharge: "Entladen heute (kWh)",
  abs: "Immer positiv (Betrag)", area: "Fläche füllen", signed: "Vorzeichen zeigen", floors: "Etagen", rooms: "Räume",
  humidity: "Luftfeuchte", co2: "CO₂", window: "Fenster", climate: "Thermostat", devices: "Geräte", tree: "Struktur", rows: "Zeilen", cols: "Spaltenüberschrift", charge: "Geladen", discharge: "Entladen", total_energy: "Energie gesamt (alle WR)", storage_out_extra: "Zusätzlicher Speicher-Ausgang", big: "Große Speicher", small: "Kleine Speicher", items: "Erzeuger", sun: "Sonne (sun.sun)", short: "Kurzname", basement: "Keller", outdoor: "Außenbereich", hum: "Luftfeuchte", bat: "Batterie (%)", status: "Status-Entität", port: "Port (Verkehr/Status)", port_label: "Port-Beschriftung", switch: "Ist ein Switch", children: "Untergeräte", max_w: "Skala max. (W)", total_kwh: "Restkapazität gesamt (kWh)", combined_soc: "Gesamt-SoC (%)", hours: "Verlauf (Stunden)", inverters: "Wechselrichter", units: "Speicher", strings: "Strings", series: "Kurven", historie: "Historie" };
const TL = {
  "slc-sun": { solar: "Solarleistung gesamt (W)", sun: "Sonne (sun.sun)", kwp: "Anlagengröße gesamt (kWp)", gauge_max: "Gauge-Maximum (W)", pv_min: "PV gilt als aktiv ab (W)",
    grid: "Netz / Hausanschluss (W)", storage_net: "Speicher netto (W, + laden)", storage_max: "Speicher-Skala (W)", today: "PV heute (kWh)", week: "PV 7 Tage (kWh)",
    export_today: "Einspeisung heute (kWh)", autarky: "Autarkie heute (%)", selfuse: "Eigenverbrauch heute (%)", status: "Energiequelle (Status-Sensor)",
    share_solar: "Anteil Solar (%)", share_batt: "Anteil Akku (%)", share_grid: "Anteil Netz (%)" },
  "slc-storage": { max_w: "Leistungs-Skala (W)", total_kwh: "Restkapazität gesamt (kWh)", combined_soc: "Gesamt-SoC (%)" },
  "slc-generators": { total_today: "PV gesamt heute (kWh)", total_now: "PV gesamt jetzt (W)", sort: "Nach Leistung sortieren" },
  "slc-yield": { power: "PV-Leistung jetzt (W)", today: "PV heute (kWh)", month: "PV Monat (kWh)", days: "Anzahl Tage" },
  "mst-control": { status: "Integrationsstatus", active: "Aktive Batterien", delay: "Ladeverzögerung", window: "Entladefenster", quality: "PD-Regelqualität",
    unresponsive: "Nicht reagierende Batterien", solar_today: "Solar heute (kWh)", home_today: "Haushalt heute (kWh)", import_today: "Netzbezug heute (kWh)", export_today: "Einspeisung heute (kWh)", charge_today: "Geladen heute (kWh)", discharge_today: "Entladen heute (kWh)", home_now: "Haushalt jetzt (W)", solar_now: "Solar jetzt (W)", peak_switch: "Spitzenlastkappung (switch)", peak_active: "Spitzenlastkappung aktiv", peak_limit: "Spitzenlast-Limit (number)", target: "PD-Ziel Netzleistung (number)", deadband: "PD-Totband (number)", rs485: "RS485-Steuermodus (switch)" },
};
const PER = ["heute", "7 Tage", "14 Tage", "Monat"];
const isEnt = (v) => typeof v === "string" && /^[a-z_]+\.[a-z0-9_]*[a-z0-9]$/.test(v);
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const prim = (v) => v == null || ["string", "number", "boolean"].includes(typeof v);
const hintOf = (objs) => { const h = {}; for (const o of objs) for (const [k, x] of Object.entries(o || {})) (h[k] = h[k] || []).push(x); return h; };
const kindOf = (v, hv) => {
  if (prim(v)) return "p";
  if (isObj(v)) return "o";
  if (!Array.isArray(v)) return "x";
  if (!v.length) { const o = (hv || []).find((x) => Array.isArray(x) && x.length); return o ? kindOf(o) : "skip"; }
  if (v.every(prim)) return "a";
  if (v.every((r) => Array.isArray(r) && r.every(prim))) return "aa";
  if (v.every(isObj)) return "lo";
  return "x";
};
const selFor = (k, samples) => {
  const s = samples.filter((x) => x != null && x !== "");
  if (k === "icon" || s.some((x) => typeof x === "string" && x.startsWith("mdi:"))) return ICON;
  if (k === "color" || s.some((x) => typeof x === "string" && /^#[0-9a-f]{3,8}$/i.test(x))) return COLOR;
  if (k === "prefix" || /_prefix$/.test(k)) return TXT;
  if (s.some(isEnt)) return ENT;
  if (s.length && s.every((x) => typeof x === "boolean")) return BOOL;
  if (s.length && s.every((x) => typeof x === "number")) return ANY;
  return TXT;
};

class EnergieAtlasEditor extends HTMLElement {
  constructor() { super(); this._forms = []; this._open = {}; this.attachShadow({ mode: "open" }); }
  set hass(h) { this._hass = h; for (const f of this._forms) f.hass = h; }
  setConfig(config) {
    const same = this._lastJson && JSON.stringify(config) === this._lastJson;
    if (same && this._built) return; /* v0.12a: eigene Daten behalten – sonst schreiben die offenen Felder in eine veraltete Kopie (2. Aenderung ging verloren) */
    this._c = JSON.parse(JSON.stringify({ title: "", modules: [], ...config }));
    pickers().then(() => this._render());
  }
  _emit() {
    const clean = (o) => { if (o && typeof o === "object" && !Array.isArray(o)) for (const k of Object.keys(o)) { if (o[k] === "" || o[k] == null) delete o[k]; else clean(o[k]); } else if (Array.isArray(o)) o.forEach(clean); return o; };
    for (const m of this._c.modules) if (m.type === "matrix") for (const r of m.rows || []) { r.cells = r.cells || []; while (r.cells.length < (m.columns || []).length) r.cells.push({}); r.cells.length = (m.columns || []).length; }
    const { type, ...rest } = clean(JSON.parse(JSON.stringify(this._c)));
    const cfg = { type, ...rest };
    this._lastJson = JSON.stringify(cfg);
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: cfg }, bubbles: true, composed: true }));
  }
  _rerender() { this._emit(); this._render(); }
  _form(schema, data, on) {
    const f = document.createElement("ha-form");
    const ct = this._curType, raw = (s) => !s.label || s.label === s.name || s.label === s.name.replace(/_/g, " ");
    f.hass = this._hass; f.schema = schema; f.data = data; f.computeLabel = (s) => (raw(s) ? this._lbl(s.name, ct) : s.label);
    f.addEventListener("value-changed", (ev) => { ev.stopPropagation(); f.data = ev.detail.value; on(ev.detail.value); });
    this._forms.push(f); return f;
  }
  _btn(icon, title, fn, dis) {
    const b = document.createElement("button"); b.title = title; b.innerHTML = `<ha-icon icon="${icon}"></ha-icon>`; b.disabled = !!dis;
    b.addEventListener("click", (e) => { e.stopPropagation(); fn(); }); return b;
  }
  _el(cls, txt) { const d = document.createElement("div"); d.className = cls; if (txt != null) d.textContent = txt; return d; }
  _addBtn(txt, fn) { const b = document.createElement("button"); b.className = "add"; b.innerHTML = `<ha-icon icon="mdi:plus"></ha-icon>${esc(txt)}`; b.addEventListener("click", fn); return b; }
  _item(key, title, arr, i, fill, onMove) {
    const box = this._el(`item${this._open[key] ? "" : " closed"}`), head = this._el("ih");
    const t = document.createElement("span"); t.className = "t"; t.textContent = `${i + 1}. ${title}`;
    const mv = (d) => { const j = i + d; [arr[i], arr[j]] = [arr[j], arr[i]]; if (onMove) onMove(i, j); this._rerender(); };
    head.append(t, this._btn("mdi:arrow-up", "nach oben", () => mv(-1), i === 0), this._btn("mdi:arrow-down", "nach unten", () => mv(1), i === arr.length - 1),
      this._btn("mdi:delete-outline", "entfernen", () => { arr.splice(i, 1); if (onMove) onMove(i, null); this._rerender(); }));
    head.addEventListener("click", () => { this._open[key] = !this._open[key]; box.classList.toggle("closed", !this._open[key]); });
    const body = this._el("body"); fill(body, t);
    box.append(head, body); return box;
  }
  _list(parent, owner, key, title, fields, mk, k0, onMove, addTxt) {
    parent.appendChild(this._el("sub", title));
    const arr = owner[key] || (owner[key] = []);
    arr.forEach((it, j) => { if (this._open[`${k0}:${j}`] == null && !label(it)) this._open[`${k0}:${j}`] = true; });
    arr.forEach((it, j) => parent.appendChild(this._item(`${k0}:${j}`, label(it) || "(noch leer)", arr, j,
      (b, t) => b.appendChild(this._form(fields, { ...it }, (v) => { arr[j] = { ...arr[j], ...v }; t.textContent = `${j + 1}. ${label(arr[j])}`; this._emit(); })),
      onMove ? (a, b2) => onMove(a, b2) : null)));
    parent.appendChild(this._addBtn(addTxt || `${title.replace(/s?$/, "")} hinzufügen`, () => { arr.push(mk()); this._open[`${k0}:${arr.length - 1}`] = true; this._rerender(); }));
  }
  _lbl(k, t = this._curType) { return ((REG.labels || {})[t] || {})[k] || (TL[t] || {})[k] || LBL[k] || k; }
  /* Primitive Felder + Listen aus Primitiven (flach) in EIN Formular, Objekte/Objektlisten rekursiv darunter */
  _auto(parent, obj, k0, proto, hint, only) {
    proto = proto || {}; hint = hint || {};
    const hs = (k) => hint[k] || [];
    const keys = only || [...new Set([...Object.keys(proto), ...Object.keys(obj)])].filter((k) => k !== "type");
    const schema = [], data = {}, flat = [], deep = [];
    for (const k of keys) {
      const v = obj[k] !== undefined ? obj[k] : proto[k], pv = proto[k], kind = kindOf(v, hs(k));
      if (kind === "p") { schema.push(fld(k, this._lbl(k), selFor(k, [v, pv, ...hs(k)]))); data[k] = v ?? ""; continue; }
      if (kind === "a") {
        const vv = Array.isArray(v) ? v : [];
        const sel = selFor(k, [...vv, ...(Array.isArray(pv) ? pv : []), ...hs(k).flat()]), per = vv.length === 4 && sel === ENT && vv.some((x) => /heute|_7_tage|_14_tage|monat/.test(x || ""));
        const n = vv.length + (sel === ENT && !per ? 1 : 0);
        for (let i = 0; i < Math.max(n, 1); i++) { schema.push(fld(`${k}#${i}`, `${this._lbl(k)} ${per ? PER[i] : i + 1}`, sel)); data[`${k}#${i}`] = vv[i] ?? ""; }
        flat.push([k, "a"]); continue;
      }
      if (kind === "aa") {
        const vv = v.length ? v : [hs(k).find((x) => Array.isArray(x) && x.length)[0]].map((r) => r.map(() => "")), w = Math.max(...vv.map((r) => r.length));
        for (let i = 0; i <= (v.length ? v.length : 0); i++) for (let j = 0; j < w; j++) {
          const col = [...vv.map((r) => r[j]), ...hs(k).flat().map((r) => Array.isArray(r) ? r[j] : null)], sel = selFor(k, col);
          schema.push(fld(`${k}#${i}#${j}`, `${this._lbl(k)} ${i + 1}: ${sel === ENT ? "Entität" : "Faktor"}`, sel)); data[`${k}#${i}#${j}`] = (v[i] || [])[j] ?? "";
        }
        flat.push([k, "aa", w]); continue;
      }
      if (kind === "lo" || kind === "o") deep.push([k, v, kind]);
      else if (kind === "x") parent.appendChild(this._el("hint", `${this._lbl(k)}: Format nicht editierbar – bitte im YAML-Code bearbeiten.`));
    }
    if (schema.length) parent.appendChild(this._form(schema, data, (val) => {
      for (const f of schema) if (!f.name.includes("#")) { const x = val[f.name]; if (x === "" || x == null) delete obj[f.name]; else obj[f.name] = x; }
      for (const [k, kind, w] of flat) {
        if (kind === "a") { const a = []; for (let i = 0; `${k}#${i}` in val; i++) a.push(val[`${k}#${i}`] ?? ""); while (a.length && (a[a.length - 1] === "" || a[a.length - 1] == null)) a.pop(); obj[k] = a; }
        else { const a = []; for (let i = 0; `${k}#${i}#0` in val; i++) { const r = []; for (let j = 0; j < w; j++) r.push(val[`${k}#${i}#${j}`] ?? ""); a.push(r); }
          obj[k] = a.filter((r) => r[0] !== "" && r[0] != null).map((r) => r.map((x) => (x === "" ? null : x))); }
      }
      this._emit();
    }));
    for (const [k, v, kind] of deep) {
      if (obj[k] === undefined) obj[k] = JSON.parse(JSON.stringify(v));
      const sib = hs(k).filter(Boolean), p2 = kind === "lo" ? [...(Array.isArray(proto[k]) ? proto[k] : []), ...sib.flat()] : proto[k];
      this._autoKey(parent, obj, k, this._lbl(k), `${k0}:${k}`, p2);
    }
  }
  _autoKey(parent, owner, key, title, k0, proto) {
    title = String(title || key).replace(/\s*\((?:YAML|Liste)[^)]*\)/g, "");
    let v = owner[key];
    if (v === undefined || v === null) v = owner[key] = Array.isArray(proto) ? JSON.parse(JSON.stringify(proto)) : isObj(proto) ? JSON.parse(JSON.stringify(proto)) : [];
    if (Array.isArray(v) && v.every((x) => isObj(x))) {
      parent.appendChild(this._el("sub", title));
      const shape = Object.assign({}, ...(Array.isArray(proto) ? proto : []), ...v);
      const mk = () => Object.fromEntries(Object.entries(shape).filter(([, x]) => prim(x) || Array.isArray(x)).map(([k, x]) => [k, Array.isArray(x) ? [] : typeof x === "number" ? null : typeof x === "boolean" ? false : ""]));
      v.forEach((it, j) => {
        const key2 = `${k0}:${j}`;
        if (this._open[key2] == null && !label(it)) this._open[key2] = true;
        parent.appendChild(this._item(key2, label(it) || "(noch leer)", v, j, (b) => this._auto(b, it, key2, mk(), hintOf([...v, ...(Array.isArray(proto) ? proto : [])])), null));
      });
      parent.appendChild(this._addBtn(`${title}: Eintrag hinzufügen`, () => { v.push(mk()); this._open[`${k0}:${v.length - 1}`] = true; this._rerender(); }));
      return;
    }
    if (isObj(v) && Object.values(v).length && Object.values(v).every(isObj)) {
      parent.appendChild(this._el("sub", title));
      for (const [sk, sv] of Object.entries(v)) {
        const key2 = `${k0}:${sk}`, box = this._el(`item${this._open[key2] ? "" : " closed"}`), head = this._el("ih"), t = document.createElement("span");
        t.className = "t"; t.textContent = sv.name || this._lbl(sk); head.appendChild(t);
        head.addEventListener("click", () => { this._open[key2] = !this._open[key2]; box.classList.toggle("closed", !this._open[key2]); });
        const body = this._el("body"); this._auto(body, sv, key2, isObj(proto) ? proto[sk] : null, hintOf(Object.values(v))); box.append(head, body); parent.appendChild(box);
      }
      return;
    }
    if (isObj(v)) { parent.appendChild(this._el("sub", title)); const box = this._el("item"); this._auto(box, v, k0, isObj(proto) ? proto : null); parent.appendChild(box); return; }
    if (Array.isArray(v) && ["a", "aa"].includes(kindOf(v, [proto]))) { parent.appendChild(this._el("sub", title)); const box = this._el("item"); this._auto(box, owner, k0, { [key]: proto }, {}, [key]); parent.appendChild(box); return; }
    parent.appendChild(this._el("hint", `${title}: Format nicht editierbar – bitte im YAML-Code bearbeiten.`));
  }
  _modBody(body, m, k0, t) {
    const upd = (v) => { Object.assign(m, v); t.textContent = t.textContent.replace(/·.*$/, `· ${TYPES[m.type]}${m.name ? " – " + m.name : ""}`); this._emit(); };
    if (m.type === "tiles") {
      body.appendChild(this._form([HALF, fld("columns", "Kacheln pro Zeile", NUM(1, 6))], { half: !!m.half, columns: m.columns ?? 3 }, upd));
      this._list(body, m, "tiles", "Kacheln", TILE_F, () => ({ name: "Neu", icon: "mdi:information-outline", entity: "", format: "state", color: "none" }), `${k0}:t`);
    } else if (m.type === "gauges") {
      body.appendChild(this._form([HALF, fld("columns", "Gauges pro Zeile", NUM(1, 4)), fld("style", "Gauge-Art (für alle, einzeln überschreibbar)", SEL(GTYPES))], { half: !!m.half, columns: m.columns ?? 2, style: m.style || "arc" }, upd));
      this._list(body, m, "gauges", "Gauges", GAUGE_F, () => ({ entity: "", name: "Neu", min: 0, max: 100, preset: "load", mode: "ratio", k: 2, decimals: 1 }), `${k0}:g`);
    } else if (m.type === "graph") {
      const { series, ...base } = m;
      body.appendChild(this._form(GRAPH_F, { ...base, style: m.style || (m.fill === false ? "line" : "area") }, (v) => { delete v.fill; delete m.fill; upd(v); }));
      this._list(body, m, "series", "Linien", SERIES_F, () => ({ entity: "", name: "", color: DEFC[(m.series || []).length % DEFC.length] }), `${k0}:s`, null, "Linie hinzufügen");
    } else if (m.type === "batteries") {
      const AREAS = { area: { multiple: true } };
      body.appendChild(this._form([HALF, fld("areas", "Bereiche (leer = alle)", AREAS), fld("exclude_areas", "Bereiche ausschließen", AREAS),
        fld("exclude", "Entitäten ausschließen (Regex auf entity_id)", TXT), fld("low", "Rot bis (%)", NUM(0, 100)), fld("mid", "Gelb bis (%)", NUM(0, 100)),
        fld("columns", "Spalten", NUM(1, 4))],
        { half: !!m.half, areas: m.areas || [], exclude_areas: m.exclude_areas || [], exclude: m.exclude || "", low: m.low ?? 20, mid: m.mid ?? 50, columns: m.columns ?? 1 }, upd));
    } else if (REG.editors[m.type] && REG.editors[m.type].fields) {
      this._curType = m.type;
      const isO = (f) => f.selector && f.selector.object !== undefined, fs = REG.editors[m.type].fields, plain = [HALF, ...fs.filter((f) => !isO(f))];
      const K = REG.modules[m.type]; let D = {}; try { D = (K && K.defaults) || {}; } catch (e) { /* egal */ }
      body.appendChild(this._form(plain, Object.fromEntries(plain.map((f) => [f.name, m[f.name] ?? D[f.name] ?? (f.name === "half" ? false : "")])), (v) => {
        for (const f of plain) { const x = v[f.name]; if (x === "" || x == null) delete m[f.name]; else m[f.name] = x; }
        t.textContent = t.textContent.replace(/·.*$/, `· ${TYPES[m.type]}${m.name ? " – " + m.name : ""}`); this._emit();
      }));
      for (const f of fs.filter(isO)) this._autoKey(body, m, f.name, f.label && f.label !== f.name ? f.label : this._lbl(f.name), `${k0}:${f.name}`, D[f.name]);
    } else if (m.type === "matrix") {
      body.appendChild(this._form([HALF, fld("name", "Überschrift (optional)", TXT), fld("label_width", "Breite Zeilenbeschriftung (z.B. 28%)", TXT),
        fld("highlight_last", "Letzte Spalte hervorheben", BOOL), fld("highlight_last_row", "Letzte Zeile hervorheben (z.B. Gesamt)", BOOL)],
        { half: !!m.half, name: m.name || "", label_width: m.label_width || "", highlight_last: m.highlight_last !== false, highlight_last_row: !!m.highlight_last_row }, upd));
      const rows = m.rows || (m.rows = []);
      this._list(body, m, "columns", "Spalten", [fld("name", "Name", TXT), fld("icon", "Icon", ICON), fld("range", "Zeitraum → Zellen zeigen Verbrauch der Zähler", RSEL("– aktueller Wert –")), ...FMT_F], () => ({ name: "Neu" }), `${k0}:c`,
        (a, b) => { for (const r of rows) { r.cells = r.cells || []; if (b == null) r.cells.splice(a, 1); else [r.cells[a], r.cells[b]] = [r.cells[b], r.cells[a]]; } });
      body.appendChild(this._el("sub", "Zeilen"));
      rows.forEach((r, j) => body.appendChild(this._item(`${k0}:r:${j}`, label(r), rows, j, (b, tt) => {
        b.appendChild(this._form([fld("label", "Beschriftung", TXT), fld("icon", "Icon", ICON), ...FMT_F], { ...r, cells: undefined },
          (v) => { const cells = rows[j].cells; rows[j] = { ...rows[j], ...v, cells }; tt.textContent = `${j + 1}. ${label(rows[j])}`; this._emit(); }));
        (m.columns || []).forEach((col, ci) => {
          b.appendChild(this._el("sub", `Spalte „${col.name || ci + 1}“`));
          const cs = rows[j].cells || (rows[j].cells = []);
          b.appendChild(this._form([fld("entity", "Entität", ENT), fld("warn", "Ampel gelb ab (Rohwert)", ANY), fld("bad", "Ampel rot ab (Rohwert)", ANY)], { ...(cs[ci] || {}) },
            (v) => { while (cs.length <= ci) cs.push({}); cs[ci] = { ...cs[ci], ...v }; this._emit(); }));
        });
      })));
      body.appendChild(this._addBtn("Zeile hinzufügen", () => { rows.push({ label: "Neu", cells: (m.columns || []).map(() => ({})) }); this._open[`${k0}:r:${rows.length - 1}`] = true; this._rerender(); }));
    }
  }
  _render() {
    const c = this._c, root = this.shadowRoot;
    this._forms = []; root.innerHTML = `<style>${ED_CSS}</style>`;
    root.appendChild(this._form([fld("title", "Titel", TXT)], { title: c.title || "" }, (v) => { c.title = v.title; this._emit(); }));
    { const gb = this._el(`item${this._open.glas ? "" : " closed"}`), gh = this._el("ih"), gt = document.createElement("span"); gt.className = "t"; gt.textContent = "Glas, Farbe & Transparenz";
      gh.appendChild(gt); gh.addEventListener("click", () => { this._open.glas = !this._open.glas; gb.classList.toggle("closed", !this._open.glas); });
      const gbd = this._el("body"); gbd.appendChild(this._form(CARD_GLAS_F, Object.fromEntries(CARD_GLAS_F.map((f) => [f.name, c[f.name] ?? ""])), (v) => {
        for (const f of CARD_GLAS_F) { const x = v[f.name]; if (x === "" || x == null) delete c[f.name]; else c[f.name] = x; } this._emit(); }));
      gbd.appendChild(this._addBtn("Farben & Milchglas zurücksetzen", () => { for (const k of ["hintergrund_farbe", "kachel_farbe", "textfarbe", "milch"]) delete c[k]; this._rerender(); }));
      gbd.appendChild(this._el("hint", "Leer = bisheriger Wert. Jedes Modul und jede Kachel kann die Kachel-Deckkraft einzeln überschreiben. Die Farbe wirkt zusammen mit der Deckkraft: bei 1 % Deckkraft sieht man auch von einer kräftigen Farbe kaum etwas. Der Knopf oben setzt Farben und Milchglas auf das Standard-Aussehen zurück.")); gb.append(gh, gbd); root.appendChild(gb); }
    { const db = this._el(`item${this._open.ds ? "" : " closed"}`), dh = this._el("ih"), dt = document.createElement("span"); dt.className = "t"; dt.textContent = "Datenquelle extern (optional)";
      dh.appendChild(dt); dh.addEventListener("click", () => { this._open.ds = !this._open.ds; db.classList.toggle("closed", !this._open.ds); });
      const ds = c.datenquelle || {}, dbd = this._el("body");
      dbd.appendChild(this._form(DS_F, Object.fromEntries(DS_F.map((f) => [f.name, ds[f.name] ?? ""])), (v) => {
        const o = {}; for (const f of DS_F) { const x = v[f.name]; if (x !== "" && x != null) o[f.name] = x; }
        if (Object.keys(o).length) c.datenquelle = o; else delete c.datenquelle; this._emit(); }));
      dbd.appendChild(this._el("hint", "Gilt nur für Graph-Linien mit Datenquelle „extern“ – Standard ist überall intern. Server-Felder werden an den Dienst übergeben: erst ausfüllen, wenn der pyscript-Adapter sie kennt. Passwörter gehören nur in secrets.yaml."));
      db.append(dh, dbd); root.appendChild(db); }
    root.appendChild(this._el("sec", "Module"));
    c.modules.forEach((m, i) => root.appendChild(this._item(`m:${i}`, `· ${TYPES[m.type] || m.type}${m.name ? " – " + m.name : ""}`, c.modules, i, (b, t) => { this._modBody(b, m, `m:${i}`, t); b.appendChild(this._el("sub", "Transparenz dieses Moduls"));
      b.appendChild(this._form(MOD_GLAS_F, Object.fromEntries(MOD_GLAS_F.map((f) => [f.name, m[f.name] ?? ""])), (v) => { for (const f of MOD_GLAS_F) { const x = v[f.name]; if (x === "" || x == null) delete m[f.name]; else m[f.name] = x; } this._emit(); })); })));
    const adds = this._el("adds");
    for (const [k, e] of Object.entries(REG.editors)) if (!TYPES[k] && e.label) { TYPES[k] = e.label; if (e.blank) blank[k] = e.blank; }
    for (const [k, v] of Object.entries(TYPES)) adds.appendChild(this._addBtn(v, () => { c.modules.push(blank[k]()); this._open[`m:${c.modules.length - 1}`] = true; this._rerender(); }));
    root.appendChild(adds);
    root.appendChild(this._el("hint", "Eintrag anklicken zum Auf-/Zuklappen. Module erscheinen in dieser Reihenfolge; „halbe Breite“ stellt zwei nebeneinander. Eigene Gauge-Farbsegmente (segments) gehen im YAML-Modus."));
    this._built = true;
  }
}

if (!customElements.get("energie-atlas-editor")) customElements.define("energie-atlas-editor", EnergieAtlasEditor);
/* eigener Nachlade-Mechanismus (s. set hass) - die Haken der Modul-Pakete werden dadurch uebersprungen */
EnergieAtlas.prototype.__regHook = true;
if (!customElements.get("energie-atlas")) {
  customElements.define("energie-atlas", EnergieAtlas);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: "energie-atlas", name: "Energie-Atlas", description: "Baukasten im Glas-Design: Kacheln, Gauges, Graphen und Tabellen frei kombinierbar" });
}
})();

/* ===== energie-atlas-anzeige ===== */
/* energie-atlas-anzeige – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const CORE = new Set(["tiles", "gauges", "graph", "matrix", "batteries"]);
const KEYS = ["titel", "titel_icon", "titel_aus", "fusszeile", "fusszeile_aus"];
const F = [
  { name: "titel", label: "Titel ersetzen (leer = Standard)", selector: { text: {} } },
  { name: "titel_icon", label: "Titel-Icon ersetzen", selector: { icon: {} } },
  { name: "titel_aus", label: "Titel ausblenden", selector: { boolean: {} } },
  { name: "fusszeile", label: "Fußzeile ersetzen (leer = Standard)", selector: { text: {} } },
  { name: "fusszeile_aus", label: "Fußzeile ausblenden", selector: { boolean: {} } },
];
const hasOv = (m) => m && !CORE.has(m.type) && KEYS.some((k) => m[k] != null && m[k] !== "" && m[k] !== false);

function apply(root, m) {
  const t = root.querySelector(".title");
  if (t) {
    const hide = m.titel_aus ? "none" : "";
    if (t.style.display !== hide) t.style.display = hide;
    if (m.titel_icon) {
      let ic = t.querySelector(":scope > ha-icon");
      if (!ic) { ic = document.createElement("ha-icon"); t.insertBefore(ic, t.firstChild); }
      if (ic.getAttribute("icon") !== m.titel_icon) ic.setAttribute("icon", m.titel_icon);
    }
    if (m.titel) {
      const txt = [...t.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      const tg = txt || [...t.children].find((n) => n.tagName !== "HA-ICON" && !n.classList.contains("tv"));
      if (tg) { if (tg.textContent !== m.titel) tg.textContent = m.titel; }
      else t.appendChild(document.createTextNode(m.titel));
    }
  }
  const subs = root.querySelectorAll(".sub"), d = m.fusszeile_aus ? "none" : "";
  subs.forEach((s) => { if (s.style.display !== d) s.style.display = d; });
  if (m.fusszeile && !m.fusszeile_aus && subs.length) {
    const s = subs[subs.length - 1];
    if (s.textContent !== m.fusszeile) s.textContent = m.fusszeile;
  }
}
function watch(el, m) {
  const root = el.shadowRoot || el;
  let q = false;
  const run = () => { q = false; try { apply(root, m); } catch (e) { /* egal */ } };
  const mo = new MutationObserver(() => { if (!q) { q = true; queueMicrotask(run); } });
  mo.observe(root, { childList: true, subtree: true, characterData: true });
  run();
  return mo;
}

/* Editor: Felder an alle Themen-Module anhaengen (auch an spaeter geladene Pakete) */
function addFields() {
  for (const [t, e] of Object.entries(REG.editors || {})) {
    if (CORE.has(t) || !e || !Array.isArray(e.fields) || e.__anz) continue;
    e.fields = [...e.fields.filter((f) => !KEYS.includes(f.name)), ...F];
    e.__anz = true;
  }
  REG.labels = REG.labels || {};
}
addFields();
{ let n = 0; const iv = setInterval(() => { addFields(); if (++n >= 60) clearInterval(iv); }, 1000); }

customElements.whenDefined("energie-atlas").then(() => {
  const PR = customElements.get("energie-atlas").prototype;
  if (PR.__anzHook) return;
  PR.__anzHook = true;
  const build = PR._build, dispose = PR._dispose;
  PR._dispose = function () {
    for (const o of this.__ovs || []) { try { o.disconnect(); } catch (e) { /* egal */ } }
    this.__ovs = [];
    return dispose.apply(this, arguments);
  };
  PR._build = function () {
    const r = build.apply(this, arguments);
    addFields();
    this.__ovs = [];
    const mods = (this._config && this._config.modules) || [];
    const els = this.shadowRoot ? [...this.shadowRoot.querySelectorAll(".mods > .mod")] : [];
    mods.forEach((m, i) => { if (hasOv(m) && els[i]) this.__ovs.push(watch(els[i], m)); });
    return r;
  };
  /* bereits gebaute Karten beim naechsten hass neu aufbauen lassen */
  REG.ver = (REG.ver || 0) + 1;
});
})();

/* ===== energie-atlas-energie ===== */
/* energie-atlas-energie – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const C = { solar: "#e0a000", import: "#b22222", export: "#228b22", batt: "#1e6fd9", home: "#000080" };
const COMPACT_W = 560;

const num = (h, id) => { const s = h && id && h.states[id]; if (!s) return null; const v = parseFloat(s.state); return isNaN(v) ? null : v; };
const fmtN = (v, d = 0) => (v == null || isNaN(v) ? "–" : Number(v).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtW = (v, signed = false) => {
  if (v == null || isNaN(v)) return "–";
  const a = signed ? v : Math.abs(v);
  return Math.abs(a) >= 1200 ? `${fmtN(a / 1000, 2)} kW` : `${fmtN(a, 0)} W`;
};
const fmtKwh = (v) => (v == null ? "–" : fmtN(v, v < 10 ? 2 : v < 100 ? 1 : 0));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const QI = { db: "mdi:server", ha: "mdi:home", warn: "mdi:home-alert", load: "mdi:timer-sand" };
const qIcon = (k, tip) => `<span class="qi${k === "warn" ? " w" : ""}" title="${esc(tip)}"><ha-icon icon="${QI[k] || QI.ha}"></ha-icon></span>`;

const CSS = `
  :host { display:block; }
  .glass { color:#000; box-sizing:border-box; font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
  .title { display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:600; margin-bottom:10px; }
  .title ha-icon { --mdc-icon-size: 20px; color:#000080; }
  .sub { font-size:11px; opacity:.6; text-align:center; margin-top:6px; }
  .inner { background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.10); border-radius:12px; }
  .num { font-variant-numeric: tabular-nums; }
  .err { color:#a11a1a; font-size:13px; }
  .load { opacity:.6; font-size:13px; text-align:center; padding:12px; }
  .ent { cursor:pointer; }
`;

class Base {
  static get defaults() { return {}; }
  static get css() { return ""; }
  static get throttle() { return 2000; }
  constructor(c, el) {
    this._config = { ...JSON.parse(JSON.stringify(this.constructor.defaults)), ...(c || {}) };
    this.el = el;
    this.shadowRoot = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${CSS}${this.constructor.css}</style><div class="glass"><div class="load">Lade…</div></div>`;
    this._dirty = true;
    this.shadowRoot.addEventListener("click", (ev) => {
      const n = ev.composedPath().find((x) => x.dataset && x.dataset.entity);
      if (n) { ev.stopPropagation(); this.el.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: n.dataset.entity }, bubbles: true, composed: true })); }
    });
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver((e) => {
        const w = Math.round(e[0].contentRect.width);
        if (w > 0 && Math.abs(w - (this._w || 0)) > 12) {
          const was = this._compact();
          this._w = w;
          if (was !== this._compact()) this._dirty = true;
          this._update(true);
        }
      });
      this._ro.observe(el);
    }
  }
  _alive() {
    if (this.el.isConnected) { this._seen = true; return true; }
    if (this._seen && !this._gone) { this._gone = true; if (this._ro) this._ro.disconnect(); }
    return !this._seen;
  }
  set hass(h) {
    if (!this._alive()) return;
    this._hass = h;
    if (!this._last || Date.now() - this._last > this.constructor.throttle) this._update(false);
  }
  _compact() { return (this._w || this.el.clientWidth || 800) < COMPACT_W; }
  _width() { return Math.max(300, Math.min(1600, this._w || this.el.clientWidth || 600)); }
  get box() { return this.shadowRoot.querySelector(".glass"); }
  _update(force) {
    if (!this._hass) return;
    this._last = Date.now();
    this.box.classList.toggle("compact", this._compact());
    try { this.update(force); } catch (e) { this._dirty = true; this.box.innerHTML = `<div class="err">Fehler: ${esc(e.message || e)}</div>`; }
  }
}

/* ===================== energie-hero: Live-Energiefluss ===================== */
class Hero extends Base {
  static get defaults() {
    return {
      show_rest: true,
      solar: "",
      grid: "",
      battery: "",
      battery_soc: "",
      home: "",
      status: "",
      pv_today: "",
      home_today: "",
      import_today: "",
      export_today: "",
      autarky: "",
      selfuse: "",
    };
  }
  static get throttle() { return 1500; }
  static get css() {
    return `
    .hero { display:grid; grid-template-columns: 1.55fr 1fr; gap:14px; align-items:stretch; }
    .compact .hero { grid-template-columns: 1fr; gap:10px; }
    .flow { position:relative; height: 340px; }
    .compact .flow { height: 290px; }
    .flow svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
    .ln { fill:none; stroke-width:2; vector-effect: non-scaling-stroke; opacity:.22; }
    .ln.on { opacity:1; stroke-width:4; stroke-linecap:round; stroke-dasharray: 0.1 13; animation: eaflow linear infinite; }
    @keyframes eaflow { to { stroke-dashoffset: -26.2; } }
    .node { --s:74px; position:absolute; transform: translate(-50%, calc(var(--s) / -2)); display:flex; flex-direction:column; align-items:center; gap:2px; text-align:center; cursor:pointer; }
    .circ { width:var(--s); height:var(--s); border-radius:50%; display:flex; align-items:center; justify-content:center;
      background: rgba(255,255,255,0.82); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      border: 3px solid var(--c); box-shadow: 0 0 0 4px rgba(255,255,255,0.15), 0 0 18px -6px var(--c); position:relative; }
    .compact .node { --s:60px; }
    .circ ha-icon { --mdc-icon-size: 30px; color: var(--c); }
    .compact .circ ha-icon { --mdc-icon-size: 24px; }
    .node.home { --s:86px; }
    .compact .node.home { --s:68px; }
    .soc { position:absolute; inset:-7px; border-radius:50%;
      background: conic-gradient(var(--c) calc(var(--p) * 1%), rgba(0,0,0,0.08) 0);
      -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px));
              mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px)); }
    .nv { font-size:16px; font-weight:700; white-space:nowrap; }
    .compact .nv { font-size:14px; }
    .nl { font-size:12px; opacity:.75; white-space:nowrap; }
    .side { display:flex; flex-direction:column; gap:10px; }
    .status { padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .status .st { font-size:18px; font-weight:700; }
    .status .sw { font-size:15px; font-weight:600; opacity:.85; }
    .kpis { display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
    .kpi { padding:10px 12px; display:flex; align-items:center; gap:10px; }
    .ring { width:42px; height:42px; border-radius:50%; flex:none; display:flex; align-items:center; justify-content:center;
      background: conic-gradient(var(--c) calc(var(--p) * 1%), rgba(0,0,0,0.08) 0); position:relative; }
    .ring::after { content:""; width:32px; height:32px; border-radius:50%; background: rgba(255,255,255,0.75); position:absolute; }
    .ring ha-icon { position:relative; z-index:1; --mdc-icon-size:18px; color: var(--c); }
    .kv { font-size:18px; font-weight:700; }
    .kl { font-size:12px; opacity:.75; }
    .netrow { padding:10px 12px; display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
    .netrow > div { display:flex; flex-direction:column; }
    .bal { height:8px; border-radius:4px; overflow:hidden; display:flex; margin-top:6px; background:rgba(0,0,0,0.08); }
    .bal i { display:block; height:100%; }
    `;
  }
  _build() {
    const c = this._config;
    const P = { solar: [50, 14], grid: [12, 48], batt: [88, 48], home: [50, 74] };
    const path = (a, b, cx, cy) => `M ${a[0]} ${a[1]} Q ${cx} ${cy} ${b[0]} ${b[1]}`;
    const lines = {
      s2h: path(P.solar, P.home, 50, 50), s2g: path(P.solar, P.grid, 12, 14), s2b: path(P.solar, P.batt, 88, 14),
      g2h: path(P.grid, P.home, 12, 74), b2h: path(P.batt, P.home, 88, 74), g2b: path(P.grid, P.batt, 50, 36),
    };
    const lc = { s2h: C.solar, s2g: C.export, s2b: C.batt, g2h: C.import, b2h: C.batt, g2b: C.import };
    const node = (k, ent, icon, label, color, extra = "") => `
      <div class="node ${k}" data-entity="${esc(ent)}" style="left:${P[k][0]}%;top:${P[k][1]}%;--c:${color}">
        <div class="circ">${extra}<ha-icon icon="${icon}" id="i-${k}"></ha-icon></div>
        <div class="nv num" id="v-${k}">–</div>
        <div class="nl" id="l-${k}">${label}</div>
      </div>`;
    const kpi = (ent, ring, icon, id, label) => `<div class="inner kpi ent" data-entity="${esc(ent)}">${ring}<div><div class="kv num" id="${id}">–</div><div class="kl">${label}</div></div></div>`;
    this.box.innerHTML = `
      <div class="hero">
        <div class="flow">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            ${Object.entries(lines).map(([k, d]) => `<path class="ln" id="p-${k}" d="${d}" stroke="${lc[k]}"/>`).join("")}
          </svg>
          ${node("solar", c.solar, "mdi:solar-power-variant", "Solar", C.solar)}
          ${node("grid", c.grid, "mdi:transmission-tower", "Netz", C.import)}
          ${node("batt", c.battery, "mdi:home-battery", "Speicher", C.batt, '<div class="soc" id="soc"></div>')}
          ${node("home", c.home, "mdi:home-lightning-bolt", "Haus", C.home)}
        </div>
        <div class="side">
          <div class="inner status ent" data-entity="${esc(c.status)}"><span class="st" id="st">–</span><span class="sw num" id="sw"></span></div>
          <div class="kpis">
            ${kpi(c.autarky, `<div class="ring" id="r-aut" style="--c:${C.export};--p:0"><ha-icon icon="mdi:shield-home"></ha-icon></div>`, "", "k-aut", "Autarkie heute")}
            ${kpi(c.selfuse, `<div class="ring" id="r-eig" style="--c:${C.solar};--p:0"><ha-icon icon="mdi:recycle"></ha-icon></div>`, "", "k-eig", "Eigenverbrauch")}
            ${kpi(c.pv_today, `<div class="ring" style="--c:${C.solar};--p:100"><ha-icon icon="mdi:white-balance-sunny"></ha-icon></div>`, "", "k-pv", "PV heute")}
            ${kpi(c.home_today, `<div class="ring" style="--c:${C.home};--p:100"><ha-icon icon="mdi:home-lightning-bolt-outline"></ha-icon></div>`, "", "k-home", "Haus heute")}
          </div>
          <div class="inner netrow">
            <div class="ent" data-entity="${esc(c.import_today)}"><span class="kl">Bezug heute</span><span class="kv num" id="k-imp" style="color:${C.import}">–</span></div>
            <div class="ent" data-entity="${esc(c.export_today)}" style="text-align:right;align-items:flex-end"><span class="kl">Einspeisung heute</span><span class="kv num" id="k-exp" style="color:${C.export}">–</span></div>
            <div class="bal" style="grid-column:1/3"><i id="b-imp" style="background:${C.import}"></i><i id="b-exp" style="background:${C.export};margin-left:auto"></i></div>
          </div>
          ${c.show_rest === false ? "" : `<div class="inner status" title="Solar + Netz − Speicher − Haus. Positiv = Wandler- und Eigenverluste der Wechselrichter und Speicher."><span class="kl">Rest / Wandlerverluste</span><span class="sw num" id="rest">–</span></div>`}
        </div>
      </div>`;
    this._dirty = false;
  }
  update() {
    if (this._dirty || !this.shadowRoot.getElementById("p-s2h")) this._build();
    const h = this._hass, c = this._config, $ = (id) => this.shadowRoot.getElementById(id);
    const pvR = num(h, c.solar), gridR = num(h, c.grid), battR = num(h, c.battery), homeR = num(h, c.home), soc = num(h, c.battery_soc);
    const pv = pvR == null ? 0 : Math.max(0, Math.abs(pvR)), grid = gridR || 0, batt = battR || 0;
    const exp = Math.max(0, -grid), imp = Math.max(0, grid), chg = Math.max(0, batt), dis = Math.max(0, -batt);
    const s2g = Math.min(pv, exp), s2b = Math.min(pv - s2g, chg), s2h = Math.max(0, pv - s2g - s2b);
    const g2b = Math.min(imp, Math.max(0, chg - s2b));   // Akku laedt mehr, als Solar liefert -> Rest kommt aus dem Netz
    const flows = { s2h, s2g, s2b, g2h: Math.max(0, imp - g2b), g2b, b2h: dis };
    for (const [k, w] of Object.entries(flows)) {
      const p = $(`p-${k}`);
      if (!p) continue;
      const on = w > 15;
      const hide = (k === "g2b" && !on) || (k.startsWith("s2") && pv <= 15);
      if (p.style.display !== (hide ? "none" : "")) p.style.display = hide ? "none" : "";
      p.classList.toggle("on", on);
      if (on) { const dur = Math.max(0.45, Math.min(4, 26 / Math.sqrt(w))).toFixed(2) + "s"; if (p.style.animationDuration !== dur) p.style.animationDuration = dur; }
    }
    $("v-solar").textContent = pvR == null ? "–" : fmtW(pv);
    $("v-home").textContent = homeR == null ? "–" : fmtW(Math.max(0, homeR));
    $("v-grid").textContent = fmtW(gridR);
    $("l-grid").textContent = gridR == null ? "Netz" : grid < -15 ? "Einspeisung" : grid > 15 ? "Bezug" : "Netz";
    this.shadowRoot.querySelector(".node.grid").style.setProperty("--c", grid < -15 ? C.export : grid > 15 ? C.import : "#000080");   // ~0 W: neutral
    $("v-batt").textContent = fmtW(battR);
    $("l-batt").textContent = `${battR == null ? "Speicher" : batt > 15 ? "lädt" : batt < -15 ? "entlädt" : "Speicher"}${soc != null ? " · " + fmtN(soc, 0) + " %" : ""}`;
    $("soc").style.setProperty("--p", soc == null ? 0 : soc);
    $("i-batt").setAttribute("icon", soc == null ? "mdi:home-battery" : soc > 90 ? "mdi:battery" : soc > 60 ? "mdi:battery-70" : soc > 30 ? "mdi:battery-40" : "mdi:battery-10");

    const st = h.states[c.status] ? h.states[c.status].state : "–";
    $("st").textContent = st;
    $("st").style.color = /Einspeis|Solar|Batterie|Akku|Speicher/i.test(st) ? "#1b6b1b" : /Netz/i.test(st) ? "#0077aa" : "#555";
    $("sw").textContent = fmtW(/Batterie|Akku|Speicher/i.test(st) ? dis || pv : pv || imp);

    const aut = num(h, c.autarky), eig = num(h, c.selfuse);
    $("k-aut").textContent = aut == null ? "–" : fmtN(aut, 0) + " %";
    $("r-aut").style.setProperty("--p", aut || 0);
    $("k-eig").textContent = eig == null ? "–" : fmtN(eig, 0) + " %";
    $("r-eig").style.setProperty("--p", eig || 0);
    const kwh = (x) => (x == null ? "–" : fmtKwh(x) + " kWh");
    $("k-pv").textContent = kwh(num(h, c.pv_today));
    $("k-home").textContent = kwh(num(h, c.home_today));
    const it = num(h, c.import_today), et = num(h, c.export_today);
    $("k-imp").textContent = kwh(it);
    $("k-exp").textContent = kwh(et);
    const rEl = $("rest");
    if (rEl) {
      const ok = pvR != null && gridR != null && battR != null && homeR != null;
      const rest = ok ? pv + gridR - battR - homeR : null;
      rEl.textContent = rest == null ? "–" : fmtW(rest, true) + (homeR > 50 && rest != null ? ` · ${fmtN((rest / Math.max(1, pv + imp + dis)) * 100, 0)} %` : "");
    }
    const tot = (it || 0) + (et || 0) || 1;
    $("b-imp").style.width = (((it || 0) / tot) * 100).toFixed(1) + "%";
    $("b-exp").style.width = (((et || 0) / tot) * 100).toFixed(1) + "%";
  }
}

/* ===================== energie-trend: Verlauf ===================== */
class Trend extends Base {
  static get defaults() {
    return {
      hours: 24,
      bucket_min: 5,
      series: [
        { entity: "", name: "Solar", color: C.solar, abs: true },
        { entity: "", name: "Haus", color: C.home },
        { entity: "", name: "Netz", color: C.import, signed: true },
        { entity: "", name: "Speicher", color: C.batt, signed: true },
      ],
    };
  }
  static get throttle() { return 30000; }
  static get css() {
    return `
    .wrap { position:relative; }
    svg { display:block; } svg text { fill:#000; font-size:11px; }
    .tip { position:absolute; pointer-events:none; background: rgba(255,255,255,0.85); border:1px solid rgba(0,0,0,0.1);
      border-radius:8px; padding:6px 8px; font-size:12px; white-space:nowrap; display:none; box-shadow:0 4px 14px rgba(0,0,0,0.15); }
    .tip b { display:block; margin-bottom:2px; }
    .tip i { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
    .legend { display:flex; justify-content:center; gap:14px; flex-wrap:wrap; font-size:12px; margin-top:6px; }
    .legend span { display:inline-flex; align-items:center; gap:6px; }
    .legend i { width:12px; height:4px; border-radius:2px; display:inline-block; }
    `;
  }
  async _fetch() {
    if (this._loading) return;
    this._loading = true;
    try {
      const c = this._config, ser = (c.series || []).filter((s) => s && s.entity);
      const hours = Number(c.hours) || 24, bmin = Number(c.bucket_min) || 5;
      const end = new Date(), start = new Date(end.getTime() - hours * 3600e3);
      const ids = [...new Set(ser.map((s) => s.entity))], tms = (x) => (typeof x === "number" ? x : Date.parse(x));
      /* 5-Min-Statistik (Mittelwert) statt aller Rohwerte; fehlt eine Statistik, greift die Historie wie bisher */
      let st = {};
      try { st = (await this._hass.callWS({ type: "recorder/statistics_during_period", start_time: start.toISOString(), end_time: end.toISOString(), statistic_ids: ids, period: "5minute", types: ["mean"], units: { power: "W" } })) || {}; } catch (e) { st = {}; }
      /* Rohwerte von kW-Sensoren in W umrechnen (die Statistik rechnet HA ueber units selbst um) */
      const fk = (id) => { const u = ((this._hass.states[id] || {}).attributes || {}).unit_of_measurement; return u === "kW" ? 1e3 : u === "MW" ? 1e6 : 1; };
      const hasSt = (id) => !!(st[id] && st[id].some((r) => r.mean != null));
      let tail = start.getTime();
      for (const id of ids) if (hasSt(id)) { const r = st[id]; tail = Math.max(tail, tms(r[r.length - 1].end)); }
      const miss = ids.filter((id) => !hasSt(id)), stIds = ids.filter(hasSt);
      const hq = (from, list) => (list.length ? this._hass.callWS({ type: "history/history_during_period", start_time: new Date(from).toISOString(), end_time: end.toISOString(),
        entity_ids: list, minimal_response: true, no_attributes: true, significant_changes_only: false }) : Promise.resolve({}));
      /* Sensoren ohne Statistik: ganzer Zeitraum; mit Statistik: nur die noch nicht verdichteten letzten Minuten */
      const [rMiss, rTail] = await Promise.all([hq(start.getTime(), miss), hq(Math.min(tail, end.getTime() - 60e3), stIds)]);
      const res = { ...rTail, ...rMiss };
      const bms = bmin * 60e3, t0 = Math.floor(start.getTime() / bms) * bms, n = Math.ceil((end.getTime() - t0) / bms);
      this._ser = ser;
      this._times = Array.from({ length: n }, (_, i) => t0 + i * bms);
      /* unavailable/unknown -> NaN -> ab dort null, bis wieder ein gueltiger Wert kommt (Luecke statt Weiterzeichnen) */
      this._data = ser.map((s) => {
        const raw = (res[s.entity] || [])
          .map((p) => ({ t: p.lu != null ? p.lu * 1000 : Date.parse(p.last_updated || p.last_changed), v: parseFloat(p.s != null ? p.s : p.state) * fk(s.entity) }))
          .sort((a, b) => a.t - b.t);
        const out = new Array(n).fill(null);
        let j = 0, last = null;
        for (let i = 0; i < n; i++) {
          const a = this._times[i], b = a + bms;
          let sum = 0, cnt = 0;
          while (j < raw.length && raw[j].t < b) {
            const v = raw[j].v;
            if (raw[j].t >= a && !isNaN(v)) { sum += v; cnt++; }
            last = isNaN(v) ? null : v;
            j++;
          }
          let v = cnt ? sum / cnt : last;
          if (v != null && s.abs) v = Math.abs(v);
          out[i] = v;
        }
        if (hasSt(s.entity)) {
          /* Statistik-Abschnitte ueberschreiben; Abschnitte ohne Statistik vor dem Ende bleiben Luecken */
          const tb = Math.floor(tail / bms), sm = new Array(n).fill(0), ct = new Array(n).fill(0);
          for (const r of st[s.entity]) { if (r.mean == null) continue; const k = Math.floor((tms(r.start) - t0) / bms); if (k >= 0 && k < n) { sm[k] += r.mean; ct[k]++; } }
          for (let i = 0; i < n; i++) {
            if (this._times[i] >= tb * bms && out[i] != null && !ct[i]) continue;
            let v = ct[i] ? sm[i] / ct[i] : null;
            if (v != null && s.abs) v = Math.abs(v);
            out[i] = v;
          }
        }
        return out;
      });
      this._fetchedAt = Date.now();
      this._err = null;
    } catch (e) {
      this._err = e.message || String(e);
    } finally {
      this._loading = false;
      if (this.el.isConnected) this._render();   // Board inzwischen verlassen: nicht mehr zeichnen
    }
  }
  update(force) {
    if (!this._fetchedAt || Date.now() - this._fetchedAt > 5 * 60e3) { this._fetch(); return; }
    if (force) this._render();
  }
  _render() {
    if (this._err) { this.box.innerHTML = `<div class="err">Fehler: ${esc(this._err)}</div>`; return; }
    if (!this._data) return;
    const c = this._config, ser = this._ser, compact = this._compact();
    const W = this._width(), H = compact ? 200 : 230;
    const pL = 40, pR = 6, pT = 8, pB = 22, pw = W - pL - pR, ph = H - pT - pB;
    const vals = this._data.flat().filter((v) => v != null);
    let mx = Math.max(500, ...vals), mn = Math.min(0, ...vals);
    const unit = mx - mn > 6000 ? 2000 : mx - mn > 2500 ? 1000 : 500;
    mx = Math.ceil(mx / unit) * unit; mn = Math.floor(mn / unit) * unit;
    const n = this._times.length;
    const X = (i) => pL + (i / Math.max(1, n - 1)) * pw;
    const Y = (v) => pT + ((mx - v) / (mx - mn)) * ph;
    let g = "";
    for (let v = mn; v <= mx + 1; v += unit) {
      g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,${v === 0 ? 0.35 : 0.1})"/>`;
      g += `<text x="${pL - 4}" y="${Y(v) + 4}" text-anchor="end">${Math.abs(v) >= 1000 ? fmtN(v / 1000, 0) + "k" : fmtN(v, 0)}</text>`;
    }
    const stepH = compact ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const d = new Date(this._times[i]);
      if (d.getMinutes() === 0 && d.getHours() % stepH === 0) {
        g += `<line x1="${X(i)}" x2="${X(i)}" y1="${pT}" y2="${pT + ph}" stroke="rgba(0,0,0,0.06)"/>`;
        g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${String(d.getHours()).padStart(2, "0")}:00</text>`;
      }
    }
    /* Zeitpunkte, an denen keine einzige Serie einen Wert hat, leicht grau hinterlegen */
    for (let i = 0; i < n; i++) if (this._data.every((a) => a[i] == null)) {
      const x0 = i ? (X(i - 1) + X(i)) / 2 : X(0), x1 = i < n - 1 ? (X(i) + X(i + 1)) / 2 : X(i);
      g += `<rect x="${x0.toFixed(1)}" y="${pT}" width="${Math.max(0.5, x1 - x0).toFixed(2)}" height="${ph}" fill="rgba(0,0,0,0.05)"/>`;
    }
    let gaps = 0;
    this._data.forEach((arr, si) => {
      const s = ser[si];
      let i = 0, line = "", area = "";
      while (i < n) {
        if (arr[i] == null) { i++; continue; }
        let e = i; while (e < n && arr[e] != null) e++;
        let seg = "";
        for (let q = i; q < e; q++) seg += `${q === i ? "M" : "L"}${X(q).toFixed(1)},${Y(arr[q]).toFixed(1)} `;
        line += seg;
        area += `${seg}L${X(e - 1).toFixed(1)},${Y(0).toFixed(1)} L${X(i).toFixed(1)},${Y(0).toFixed(1)} Z `;
        if (e < n) gaps++;
        i = e;
      }
      if (area) g += `<path d="${area}" fill="${s.color}" fill-opacity="${si === 0 ? 0.18 : 0.07}" stroke="none"/>`;
      if (line) g += `<path d="${line}" fill="none" stroke="${s.color}" stroke-width="${si === 0 ? 2.2 : 1.6}" stroke-linejoin="round"/>`;
    });
    g += `<line id="cx" x1="0" x2="0" y1="${pT}" y2="${pT + ph}" stroke="#000080" stroke-width="1" stroke-dasharray="3,3" style="display:none"/>`;
    g += `<rect id="hit" x="${pL}" y="${pT}" width="${pw}" height="${ph}" fill="transparent"/>`;
    const legend = ser.map((s) => `<span class="ent" data-entity="${esc(s.entity)}"><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("");
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:chart-bell-curve-cumulative"></ha-icon>Verlauf ${fmtN(Number(c.hours) || 24)} h</div>
      <div class="wrap"><svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg><div class="tip" id="tip"></div></div>
      <div class="legend">${legend}</div>
      <div class="sub">Netz: + Bezug / − Einspeisung · Speicher: + laden / − entladen · ${fmtN(Number(c.bucket_min) || 5)}-Min-Mittel${gaps ? " · Lücken = keine Daten" : ""}</div>`;
    const svg = this.shadowRoot.querySelector("svg"), tip = this.shadowRoot.getElementById("tip");
    const cx = this.shadowRoot.getElementById("cx"), hit = this.shadowRoot.getElementById("hit");
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - pL) / pw) * (n - 1))));
      cx.setAttribute("x1", X(i)); cx.setAttribute("x2", X(i)); cx.style.display = "";
      const d = new Date(this._times[i]);
      tip.innerHTML = `<b>${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</b>` +
        ser.map((s, si) => `<div><i style="background:${s.color}"></i>${esc(s.name)}: ${fmtW((this._data[si] || [])[i], !!s.signed)}</div>`).join("");
      tip.style.display = "block";
      const left = (X(i) / W) * r.width;
      tip.style.left = Math.min(r.width - tip.offsetWidth - 4, Math.max(4, left + 10)) + "px";
      tip.style.top = "8px";
    };
    const leave = () => { tip.style.display = "none"; cx.style.display = "none"; };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", leave);
    hit.addEventListener("pointercancel", leave);
    svg.style.touchAction = "pan-y";   // senkrechtes Wischen scrollt weiter die Seite
  }
}

/* ===================== energie-kwh: kWh-Zeitraeume ===================== */
class Kwh extends Base {
  constructor(c, el, ctx) { super(c, el); this._ds = (ctx && ctx.ds) || {}; }
  static get defaults() {
    return {
      ranges: ["today", "last:7d", "last:14d", "month"],
      rows: [
        { name: "Solar", icon: "mdi:white-balance-sunny", color: C.solar,
          e: ["", "", "", ""] },
        { name: "Bezug 1.8.0", icon: "mdi:transmission-tower-import", color: C.import,
          e: ["", "", "", ""] },
        { name: "Einspeisung 2.8.0", icon: "mdi:transmission-tower-export", color: C.export,
          e: ["", "", "", ""] },
      ],
      cols: ["Heute", "7 Tage", "14 Tage", "Monat"],
    };
  }
  static get throttle() { return 10000; }
  static get css() {
    return `
    .grid { display:grid; gap:8px; }
    .r { padding:10px 12px; }
    .rh { display:flex; align-items:center; gap:8px; font-size:14px; font-weight:600; margin-bottom:6px; }
    .rh ha-icon { --mdc-icon-size:18px; color: var(--c); }
    .cells { display:grid; grid-template-columns: repeat(4, 1fr); gap:6px; }
    .cell { display:flex; flex-direction:column; gap:3px; min-width:0; }
    .cv { font-size:20px; font-weight:700; }
    .compact .cv { font-size:16px; }
    .cl { font-size:12px; opacity:.7; }
    .mb { height:4px; border-radius:2px; background: rgba(0,0,0,0.08); overflow:hidden; }
    .mb i { display:block; height:100%; background: var(--c); border-radius:2px; }
    .sub.w { color:#a11a1a; opacity:.9; }
    .rh .qi { margin-left:auto; display:inline-flex; opacity:.55; cursor:help; } .rh .qi ha-icon { --mdc-icon-size:15px; color:#000; }
    .rh .qi.w { opacity:.95; } .rh .qi.w ha-icon { color:#a11a1a; }
    `;
  }
  /* Beginn je Spalten-Zeitraum (Ende = jetzt) */
  _spans() {
    const now = new Date(), d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return (this._config.ranges || []).map((s) => {
      let m;
      if (s === "today") return d0;
      if (s === "week") { const x = new Date(d0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.getTime(); }
      if (s === "month") return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      if (s === "year") return new Date(now.getFullYear(), 0, 1).getTime();
      if ((m = /^last:(\d+)(h|d)$/.exec(s || ""))) return now.getTime() - Number(m[1]) * (m[2] === "h" ? 3600e3 : 864e5);
      return null;
    });
  }
  /* Extern: Verbrauch = Zaehlerstand jetzt - Zaehlerstand am Zeitraumbeginn, beides vom DB-Server */
  async _fetchExt() {
    this._xLoading = true;
    const c = this._config, h = this._hass, DS = this._ds || {}, out = {};
    const sv = String(DS.dienst || "").split("."), tmo = Math.max(1, Number(DS.timeout) || 8) * 1000, extra = {};
    for (const k of ["host", "port", "db", "tabelle", "profil"]) if (DS[k] !== "" && DS[k] != null) extra[k] = DS[k];
    const call = async (id, a, b) => {
      let tm;
      try {
        const r = await Promise.race([h.callWS({ type: "call_service", domain: sv[0], service: sv.slice(1).join("."), service_data: { sensor_id: id, start: new Date(a).toISOString(), end: new Date(b).toISOString(), bucket: "5 minutes", ...extra }, return_response: true }),
          new Promise((_, rej) => { tm = setTimeout(() => rej(new Error("Zeitueberschreitung")), tmo); })]);
        const d = ((r && r.response) || {}).data;
        return (Array.isArray(d) ? d : []).map((p) => [Number(p[0]), p[1] == null ? NaN : Number(p[1])]).filter((p) => !isNaN(p[1]));
      } finally { clearTimeout(tm); }
    };
    /* Fallback ohne DB-Server: Verbrauch aus der HA-Statistik (change) des Zaehlerstands; fehlt der Zeitraumbeginn -> Luecke */
    const tms = (x) => (typeof x === "number" ? x : Date.parse(x));
    const stat = async (id, spans) => {
      try {
        const now = Date.now(), H = 3600e3, ok = spans.filter((t) => t != null);
        if (!ok.length) return null;
        const a = Math.floor(Math.min(...ok) / H) * H;
        const q = async (p, from) => ((await h.callWS({ type: "recorder/statistics_during_period", start_time: new Date(from).toISOString(), end_time: new Date(now).toISOString(), statistic_ids: [id], period: p, types: ["change"] })) || {})[id] || [];
        const rows = (await q("hour", a)).filter((r) => r.change != null).map((r) => ({ s: tms(r.start), e: tms(r.end), c: r.change }));
        const last = rows.length ? rows[rows.length - 1].e : a;
        if (now - last > 60e3) for (const r of await q("5minute", last)) if (r.change != null) rows.push({ s: tms(r.start), e: tms(r.end), c: r.change });
        if (!rows.length) return null;
        return spans.map((t0) => {
          if (t0 == null) return null;
          const f = Math.floor(t0 / H) * H, sel = rows.filter((r) => r.s >= f);
          if (!sel.length || sel[0].s - f > H) return null;
          return sel.reduce((x, r) => x + r.c, 0);
        });
      } catch (e) { return null; }
    };
    try {
      const now = Date.now(), spans = this._spans();
      await Promise.all((c.rows || []).map(async (r, ri) => {
        if (!r || r.quelle !== "extern") return;
        if (!r.zaehler) { out[ri] = { st: "nozaehler" }; return; }
        try {
          const pe = await call(r.zaehler, now - 2 * 864e5, now);   /* ltss schreibt nur bei Aenderung: letzter bekannter Stand */
          if (!pe.length) { out[ri] = { st: "leer", v: await stat(r.zaehler, spans) }; return; }
          const vEnd = pe[pe.length - 1][1];
          const v = await Promise.all(spans.map(async (t0) => {
            if (t0 == null) return null;
            const ps = await call(r.zaehler, t0 - 2 * 864e5, t0 + 3600e3);
            const bef = ps.filter((p) => p[0] <= t0), p0 = bef.length ? bef[bef.length - 1] : ps[0];
            if (!p0) return null;                                       /* kein Stand um den Zeitraumbeginn: Luecke */
            const d = vEnd - p0[1];
            return d < 0 ? null : d;                                  /* Zaehler zurueckgesetzt: nicht schaetzen */
          }));
          out[ri] = { st: "ok", v };
        } catch (e) { out[ri] = { st: "fehler", v: await stat(r.zaehler, spans) }; }
      }));
    } finally {
      this._ext = out; this._xAt = Date.now(); this._xLoading = false;
      if (this._hass && this.el.isConnected) this._update(true);
    }
  }
  update() {
    const h = this._hass, c = this._config, cols = c.cols || [], X = this._ext || {}, notes = [], anyExt = (c.rows || []).some((r) => r && r.quelle === "extern");
    if ((c.rows || []).some((r) => r && r.quelle === "extern") && !this._xLoading && (!this._xAt || Date.now() - this._xAt > 5 * 60e3)) this._fetchExt();
    const rows = (c.rows || []).map((r, ri) => {
      let v = (r.e || []).map((id) => num(h, id)), ents = (r.e || []).slice();
      if (r.quelle === "extern") {
        const x = X[ri];
        if (!x) { v = v.map(() => null); notes.push({ k: "load", t: `${r.name}: lade vom DB-Server…` }); }
        else if (x.st === "ok") { v = x.v; ents = v.map(() => r.zaehler); notes.push({ k: "db", t: `${r.name}: DB-Server` }); }
        else {
          const why = x.st === "nozaehler" ? "kein Zählerstand eingetragen" : x.st === "leer" ? "extern ohne Daten" : "extern nicht erreichbar";
          if (x.st !== "nozaehler") { v = Array.isArray(x.v) ? x.v : v.map(() => null); ents = v.map(() => r.zaehler); }
          notes.push({ k: "warn", w: true, t: `${r.name}: ${why} · ${x.st === "nozaehler" ? "intern" : Array.isArray(x.v) ? "HA-Statistik" : "keine Daten"}` });
        }
      }
      const nt = r.quelle === "extern" ? notes[notes.length - 1] : anyExt ? { k: "ha", t: `${r.name}: intern (Home Assistant)` } : null;
      const mx = Math.max(0.001, ...v.filter((x) => x != null));
      return `<div class="inner r" style="--c:${r.color || "#666"}">
        <div class="rh"><ha-icon icon="${esc(r.icon || "mdi:flash")}"></ha-icon>${esc(r.name)}${nt ? qIcon(nt.k, nt.t) : ""}</div>
        <div class="cells">${v.map((x, i) => `<div class="cell ent" data-entity="${esc(ents[i])}"><span class="cl">${esc(cols[i] ?? "")}</span>
          <span class="cv num">${fmtKwh(x)}</span><div class="mb"><i style="width:${Math.max(0, Math.min(100, ((x || 0) / mx) * 100)).toFixed(0)}%"></i></div></div>`).join("")}</div>
      </div>`;
    }).join("");
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:sigma"></ha-icon>Energie in kWh</div><div class="grid">${rows}</div>`;
  }
}

/* ===================== energie-wr: Wechselrichter + Zaehlerstaende ===================== */
class Wr extends Base {
  static get defaults() {
    return {
      inverters: [
        { name: "WR Altanlage", entity: "", icon: "mdi:solar-panel" },
        { name: "WR Neuanlage", entity: "", icon: "mdi:solar-panel-large" },
        { name: "WR Speicher 2", entity: "", icon: "mdi:home-battery-outline" },
      ],
      total: "",
      meter_decimals: 2,
      trend: true,
      trend_pct: true,
      flow: true,
      flow_max_import: 3000,
      flow_max_export: 10000,
      trend_days: 10,
      trend_outlier: 100,
      trend_band: 10,
      meters: [
        { name: "1.8.0 Bezug", entity: "", color: C.import, decimals: 4, power: "", flow_dir: "bezug" },
        { name: "2.8.0 Einspeisung", entity: "", color: C.export, power: "", flow_dir: "einspeisung" },
        { name: "Solar Altanlage", entity: "", color: C.solar, power: "", flow_dir: "beide" },
        { name: "Solar Neuanlage", entity: "", color: C.solar, power: "", flow_dir: "beide" },
      ],
    };
  }
  static get throttle() { return 3000; }
  static get css() {
    return `
    .list { padding: 6px 12px; }
    .it { display:grid; grid-template-columns: 26px 1fr auto; align-items:center; gap:8px; padding:7px 0; }
    .it + .it { border-top:1px solid rgba(0,0,0,0.06); }
    .it ha-icon { --mdc-icon-size:22px; color:#000080; }
    .nm { font-size:14px; }
    .vv { font-size:15px; font-weight:600; text-align:right; }
    .bar { grid-column: 2 / 4; height:5px; border-radius:3px; background: rgba(0,0,0,0.08); overflow:hidden; margin-top:-2px; }
    .bar i { display:block; height:100%; background:${C.solar}; border-radius:3px; transition: width .6s; }
    .tot { font-weight:700; }
    .h2 { font-size:12px; font-weight:600; opacity:.7; margin:12px 2px 6px; }
    .meters { display:grid; grid-template-columns: 1fr 1fr; gap:6px; }
    .m { padding:8px 10px; min-width:0; }
    .m .kr { display:flex; align-items:center; justify-content:space-between; gap:6px; min-height:22px; }
    .m .k { font-size:12px; opacity:.7; display:flex; align-items:center; gap:6px; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .m .k i { width:7px; height:7px; border-radius:50%; display:inline-block; flex:none; }
    .m .vr { display:flex; align-items:baseline; justify-content:space-between; gap:6px; }
    .m .v { font-size:18px; font-weight:700; white-space:nowrap; }
    .m .v small { font-size:12px; font-weight:400; opacity:.7; margin-left:2px; }
    .m .pc { font-size:12px; font-weight:600; opacity:.75; white-space:nowrap; flex:none; }
    .m .tr { --mdc-icon-size:22px; color:#000080; flex:none; }
    .m .tr.q { opacity:.35; }
    .m .fl { position:relative; height:3px; margin-top:1px; border-radius:2px; overflow:hidden; background:rgba(0,0,0,0.07); }
    .m .fl b { position:absolute; top:0; left:0; height:100%; width:16%; border-radius:2px; will-change:transform; }
    .m .fl.st b { opacity:.35; }
    `;
  }
  /* Trend: Summe der letzten 24 vollen Stunden vs. Ø der letzten x vollen Tage.
   * Ausreisser-Tage (> trend_outlier % ueber Schnitt) fliegen raus; ± trend_band % = unveraendert.
   * Fehlende Stunden/Tage werden nicht aufgefuellt; zu wenig Daten -> Fragezeichen. */
  async _fetchTrend() {
    if (this._tLoading) return;
    this._tLoading = true;
    try {
      const c = this._config;
      const ids = [...new Set((c.meters || []).map((m) => m.entity).filter(Boolean))];
      if (ids.length) {
        const days = Math.max(1, Number(c.trend_days) || 10);
        const outl = Number(c.trend_outlier), outF = 1 + (isNaN(outl) ? 100 : outl) / 100;
        const bandP = Number(c.trend_band), bandF = (isNaN(bandP) ? 10 : bandP) / 100;
        const now = new Date();
        const hEnd = new Date(now); hEnd.setMinutes(0, 0, 0);
        const hStart = new Date(hEnd.getTime() - 24 * 3600e3);
        const dEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const dStart = new Date(dEnd); dStart.setDate(dStart.getDate() - days);
        const q = (s, e, period) => this._hass.callWS({ type: "recorder/statistics_during_period",
          start_time: s.toISOString(), end_time: e.toISOString(), statistic_ids: ids, period, types: ["change"] });
        const [hr, dr] = await Promise.all([q(hStart, hEnd, "hour"), q(dStart, dEnd, "day")]);
        const t = {};
        for (const id of ids) {
          const hrs = (hr[id] || []).filter((x) => x.change != null);
          const dv = (dr[id] || []).filter((x) => x.change != null).map((x) => Math.max(0, x.change));
          const v24 = hrs.reduce((a, x) => a + Math.max(0, x.change), 0);
          const raw = dv.length ? dv.reduce((a, b) => a + b, 0) / dv.length : null;
          const keep = raw == null ? [] : dv.filter((v) => v <= raw * outF);
          const avg = keep.length ? keep.reduce((a, b) => a + b, 0) / keep.length : null;
          const ok = hrs.length >= 20 && keep.length >= Math.max(3, Math.ceil(days / 2));
          let dir = null;
          if (ok) { const band = Math.max(avg * bandF, 0.005); dir = v24 > avg + band ? 1 : v24 < avg - band ? -1 : 0; }
          t[id] = { v24, avg, n: keep.length, out: dv.length - keep.length, hrs: hrs.length, dir, ok, days };
        }
        this._trend = t;
      }
      this._tErr = null;
    } catch (e) {
      this._tErr = e.message || String(e);
    } finally {
      this._tAt = Date.now();
      this._tLoading = false;
      if (this._hass && this.el.isConnected) this._update(true);
    }
  }
  _trendParts(id, dec, m) {
    const c = this._config, E = { ic: "", pc: "" }, mm = m || {};
    const showIc = c.trend !== false && mm.trend !== false, showPc = c.trend_pct !== false && mm.trend_pct !== false;
    if ((!showIc && !showPc) || !id) return E;
    const r = this._trendParts2(id, dec);
    return { ic: showIc ? r.ic : "", pc: showPc ? r.pc : "" };
  }
  _trendParts2(id, dec) {
    const E = { ic: "", pc: "" };
    if (this._tErr) return { ic: `<ha-icon class="tr q" icon="mdi:alert-circle-outline" title="Trend-Fehler: ${esc(this._tErr)}"></ha-icon>`, pc: "" };
    const t = this._trend && this._trend[id];
    if (!t) return E;
    const d = Math.min(4, Math.max(2, dec));
    const info = `24 h: ${fmtN(t.v24, d)} kWh · Ø ${t.days} Tage: ${t.avg == null ? "–" : fmtN(t.avg, d)} kWh (${t.n} Tage gewertet, ${t.out} Ausreißer raus)`;
    if (!t.ok) return { ic: `<ha-icon class="tr q" icon="mdi:help-circle-outline" title="Zu wenig Daten · ${t.hrs}/24 h · ${info}"></ha-icon>`, pc: "" };
    let pc = "";
    if (t.avg != null && t.avg > 0.0005) {
      const p = ((t.v24 - t.avg) / t.avg) * 100, a = Math.abs(p);
      const sg = Math.round(a) === 0 ? "±" : p > 0 ? "+" : "−";
      pc = a > 999 ? `${sg}>999 %` : `${sg}${fmtN(a, 0)} %`;
    }
    const icon = t.dir > 0 ? "mdi:trending-up" : t.dir < 0 ? "mdi:trending-down" : "mdi:trending-neutral";
    const word = t.dir > 0 ? "steigend" : t.dir < 0 ? "fallend" : "unverändert";
    return {
      ic: `<ha-icon class="tr" icon="${icon}" title="${word} · ${info}"></ha-icon>`,
      pc: pc ? `<span class="pc num" title="${word} · ${info}">${pc}</span>` : "",
    };
  }
  update() {
    const h = this._hass, c = this._config;
    const wantTrend = (c.trend !== false || c.trend_pct !== false) && (c.meters || []).some((m) => m.trend !== false || m.trend_pct !== false);
    if (wantTrend && !this._tLoading && (!this._tAt || Date.now() - this._tAt > 15 * 60e3)) this._fetchTrend();
    const inv = c.inverters || [], vals = inv.map((i) => num(h, i.entity)), tot = num(h, c.total);
    const ref = Math.max(1, Math.abs(tot || 0), ...vals.map((v) => Math.abs(v || 0)));
    const items = inv.map((x, k) => `<div class="it ent" data-entity="${esc(x.entity)}"><ha-icon icon="${esc(x.icon || "mdi:solar-panel")}"></ha-icon><span class="nm">${esc(x.name)}</span><span class="vv num">${fmtW(vals[k])}</span>
        <div class="bar"><i style="width:${((Math.abs(vals[k] || 0) / ref) * 100).toFixed(1)}%"></i></div></div>`).join("");
    const md = c.meter_decimals != null ? c.meter_decimals : 2;
    const meters = (c.meters || []).map((m, k) => {
      const dec = m.decimals != null && m.decimals !== "" ? Number(m.decimals) : md;
      const tp = this._trendParts(m.entity, dec, m);
      const fl = c.flow !== false && m.flow !== false && m.power ? `<div class="fl" data-k="${k}"><b style="background:${m.color || "#666"}"></b></div>` : "";
      return `<div class="inner m ent" data-entity="${esc(m.entity)}"><div class="kr"><span class="k"><i style="background:${m.color || "#666"}"></i>${esc(m.name)}</span>${tp.ic}</div>
      <div class="vr"><span class="v num">${fmtN(num(h, m.entity), dec)}<small>kWh</small></span>${tp.pc}</div>${fl}</div>`;
    }).join("");
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:solar-power-variant"></ha-icon>Wechselrichter</div>
      <div class="inner list">${items}
        <div class="it tot ent" data-entity="${esc(c.total)}"><ha-icon icon="mdi:sigma"></ha-icon><span class="nm">WR gesamt</span><span class="vv num">${fmtW(tot)}</span></div>
      </div>
      <div class="h2">Zählerstände</div>
      <div class="meters">${meters}</div>`;
    this._flowSet();
  }
  /* Laufstrich: Geschwindigkeit je Zaehler aus der Leistung (+ Bezug / - Einspeisung).
   * flow_dir "bezug": nur bei Bezug, nach rechts | "einspeisung": nur bei Einspeisung, nach rechts
   * | "beide": Bezug nach rechts, Einspeisung nach links. Volle Geschwindigkeit bei flow_max_import / flow_max_export. */
  _flowSet() {
    const c = this._config, h = this._hass;
    this._fl = [];
    if (c.flow === false) return;
    const mi0 = Math.max(1, Number(c.flow_max_import) || 3000), mx0 = Math.max(1, Number(c.flow_max_export) || 10000);
    const kw = (x, d) => (x === "" || x == null || isNaN(Number(x)) || Number(x) === 0 ? d : Math.max(1, Math.abs(Number(x)) * 1000));
    this._ph = this._ph || {};
    (c.meters || []).forEach((m, k) => {
      if (!m.power || m.flow === false) return;
      const node = this.shadowRoot.querySelector(`.fl[data-k="${k}"]`);
      if (!node) return;
      const p = num(h, m.power), dir = m.flow_dir || "beide";
      const mi = kw(m.flow_max_rechts, mi0), mx = kw(m.flow_max_links, mx0);   // je Zaehler, sonst Modulwert
      let v = 0;
      if (p != null) {
        if (p > 0 && (dir === "bezug" || dir === "beide")) v = Math.min(1, p / mi);
        else if (p < 0 && dir === "einspeisung") v = Math.min(1, -p / mx);
        else if (p < 0 && dir === "beide") v = -Math.min(1, -p / mx);
      }
      if (Math.abs(v) < 0.003) v = 0;
      node.classList.toggle("st", v === 0);
      node.title = p == null ? "Leistung unbekannt" : `${fmtW(p, true)}${v === 0 ? " · steht" : v > 0 ? " · läuft nach rechts" : " · läuft nach links"}`;
      if (this._ph[k] == null) this._ph[k] = Math.random();
      this._fl.push({ k, b: node.firstElementChild, v });
    });
    this._flowRun();
  }
  _flowRun() {
    if (this._raf) return;
    let last = performance.now();
    const tick = (t) => {
      this._raf = null;
      if (!this.el.isConnected || document.hidden || !this._fl || !this._fl.some((f) => f.v)) return;   // ruht (auch wenn alle stehen), naechstes update() startet neu
      const dt = Math.min(0.25, (t - last) / 1000); last = t;
      for (const f of this._fl) {
        // volle Geschwindigkeit: einmal quer in 1,2 s
        this._ph[f.k] = (((this._ph[f.k] + f.v * dt / 1.2) % 1) + 1) % 1;
        if (f.b) f.b.style.transform = `translateX(${(this._ph[f.k] * 1.16 - 0.16) * 625}%)`;
      }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }
}

/* ===================== energie-monate: letzte 12 Monate ===================== */
class Monate extends Base {
  static get defaults() { return { bezug: "", einspeisung: "", months: 12 }; }
  static get throttle() { return 60000; }
  static get css() {
    return `
    svg { display:block; } svg text { fill:#000; font-size:11px; }
    .legend { display:flex; justify-content:center; gap:14px; flex-wrap:wrap; font-size:12px; margin-top:6px; }
    .legend span { display:inline-flex; align-items:center; gap:6px; }
    .legend i { width:12px; height:10px; border-radius:2px; display:inline-block; }
    `;
  }
  async _fetch() {
    if (this._loading) return;
    this._loading = true;
    try {
      const c = this._config, now = new Date(), months = Number(c.months) || 12;
      const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
      this._start = start;
      this._res = await this._hass.callWS({ type: "recorder/statistics_during_period",
        start_time: start.toISOString(), end_time: now.toISOString(),
        statistic_ids: [c.bezug, c.einspeisung].filter(Boolean), period: "month", types: ["change"] });
      this._at = Date.now(); this._err = null;
    } catch (e) { this._err = e.message || String(e); }
    finally { this._loading = false; if (this.el.isConnected) this._render(); }
  }
  update(force) {
    if (!this._at || Date.now() - this._at > 30 * 60e3) { this._fetch(); return; }
    if (force) this._render();
  }
  _render() {
    if (this._err) { this.box.innerHTML = `<div class="err">Fehler: ${esc(this._err)}</div>`; return; }
    if (!this._res) return;
    const c = this._config, compact = this._compact(), cnt = Number(c.months) || 12;
    const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
    const months = Array.from({ length: cnt }, (_, i) => new Date(this._start.getFullYear(), this._start.getMonth() + i, 1));
    const pick = (id) => months.map((m) => {
      const r = (this._res[id] || []).find((x) => { const d = new Date(new Date(x.start).getTime() + 12 * 3600e3); return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth(); });
      return r && r.change != null ? Math.max(0, r.change) : null;
    });
    const B = pick(c.bezug), E = pick(c.einspeisung);
    const mx = Math.max(10, ...B.filter((v) => v != null), ...E.filter((v) => v != null));
    const unit = mx > 1500 ? 500 : mx > 400 ? 100 : mx > 100 ? 25 : 5, tmax = Math.ceil(mx / unit) * unit;
    const W = this._width(), H = compact ? 190 : 220;
    const pL = 40, pR = 4, pT = 8, pB = 22, pw = W - pL - pR, ph = H - pT - pB;
    const step = pw / cnt, bw = (step * 0.8) / 2, Y = (v) => pT + ph - (v / tmax) * ph;
    let g = "", missing = 0;
    for (let i = 0; i <= 4; i++) {
      const v = (tmax / 4) * i;
      g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,0.1)"/><text x="${pL - 4}" y="${Y(v) + 4}" text-anchor="end">${fmtN(v, 0)}</text>`;
    }
    months.forEach((m, i) => {
      const x0 = pL + step * i + step * 0.1;
      [[B[i], C.import, "Bezug"], [E[i], C.export, "Einspeisung"]].forEach(([v, col, nm], k) => {
        if (v == null) {
          missing++;
          g += `<text x="${(x0 + k * bw + bw / 2).toFixed(1)}" y="${(Y(0) - 3).toFixed(1)}" text-anchor="middle" style="opacity:.45"><title>${MON[m.getMonth()]} ${m.getFullYear()} ${nm}: keine Daten</title>–</text>`;
          return;
        }
        g += `<rect x="${(x0 + k * bw).toFixed(1)}" y="${Y(v).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${(pT + ph - Y(v)).toFixed(1)}" rx="2" fill="${col}" fill-opacity="${i === cnt - 1 ? 0.55 : 0.9}"><title>${MON[m.getMonth()]} ${m.getFullYear()} ${nm}: ${fmtN(v, 1)} kWh</title></rect>`;
      });
      const lbl = compact && step < 30 ? MON[m.getMonth()].charAt(0) : MON[m.getMonth()];
      g += `<text x="${pL + step * i + step / 2}" y="${H - 6}" text-anchor="middle">${lbl}</text>`;
    });
    const sb = B.reduce((a, v) => a + (v || 0), 0), se = E.reduce((a, v) => a + (v || 0), 0);
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:calendar-month"></ha-icon>Letzte ${cnt} Monate</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg>
      <div class="legend"><span class="ent" data-entity="${esc(c.bezug)}"><i style="background:${C.import}"></i>Bezug ${fmtN(sb, 0)} kWh</span><span class="ent" data-entity="${esc(c.einspeisung)}"><i style="background:${C.export}"></i>Einspeisung ${fmtN(se, 0)} kWh</span></div>
      ${missing ? `<div class="sub">– = Monat ohne Statistik</div>` : ""}`;
  }
}

/* ======================= Anmeldung beim Atlas ======================= */
const E = (name, label) => ({ name, label, selector: { entity: {} } });
const N = (name, label, min, max, step) => ({ name, label, selector: { number: { min, max, step, mode: "box" } } });
const B = (name, label) => ({ name, label, selector: { boolean: {} } });
const O = (name, label) => ({ name, label, selector: { object: {} } });
const LIST = [
  ["energie-hero", Hero, "Strom: Live-Fluss", [E("solar", "Solar-Leistung (W)"), E("grid", "Netz-Leistung (W, + Bezug / − Einspeisung)"),
    E("battery", "Speicher-Leistung (W, + laden / − entladen)"), E("battery_soc", "Speicher-Ladestand (%)"), E("home", "Hausverbrauch (W)"),
    E("status", "Status-Text"), E("pv_today", "PV heute (kWh)"), E("home_today", "Haus heute (kWh)"), E("import_today", "Bezug heute (kWh)"),
    E("export_today", "Einspeisung heute (kWh)"), E("autarky", "Autarkie heute (%)"), E("selfuse", "Eigenverbrauchsquote (%)"),
    B("show_rest", "Bilanz-Rest (Wandlerverluste) anzeigen")]],
  ["energie-trend", Trend, "Strom: Verlauf", [N("hours", "Zeitraum (Stunden)", 1, 168, 1), N("bucket_min", "Mittelwert-Raster (Minuten)", 1, 60, 1),
  ]],
  ["energie-kwh", Kwh, "Strom: kWh-Zeiträume", []],
  ["energie-wr", Wr, "Strom: Wechselrichter + Zähler", [E("total", "WR gesamt (W)"), N("meter_decimals", "Nachkommastellen Zähler", 0, 6, 1),
    N("flow_max_import", "Laufstrich: volle Geschwindigkeit bei Bezug (W)", 100, 50000, 100),
    N("flow_max_export", "Laufstrich: volle Geschwindigkeit bei Einspeisung (W)", 100, 50000, 100),
    N("trend_days", "Trend: Referenz-Tage (Ø)", 3, 60, 1),
    N("trend_outlier", "Trend: Ausreißer-Tag ab % über Ø", 10, 1000, 10), N("trend_band", "Trend: Toleranz „unverändert“ (± %)", 0, 100, 1)]],
  ["energie-monate", Monate, "Strom: 12 Monate", [E("bezug", "Bezug (Zähler mit Langzeitstatistik)"), E("einspeisung", "Einspeisung (Zähler mit Langzeitstatistik)"),
    N("months", "Anzahl Monate", 1, 36, 1)]],
];
for (const [type, K, label, fields] of LIST) { REG.modules[type] = K; REG.editors[type] = { label, fields, blank: () => ({ type }) }; }
REG.ver = (REG.ver || 0) + 1;

/* ======================= Editor: Listen statt Roh-Objekte ======================= */
const T = (name, label) => ({ name, label, selector: { text: {} } });
const ICN = (name, label) => ({ name, label, selector: { icon: {} } });
const COL = (name, label) => ({ name, label, selector: { text: { type: "color" } } });
const DEF_COLS = ["Heute", "7 Tage", "14 Tage", "Monat"];
const DEF_RG = ["today", "last:7d", "last:14d", "month"];
const ED = {
  "energie-kwh": {
    base: (m) => [...[0, 1, 2, 3].map((i) => T(`col${i}`, `Spalte ${i + 1}: Überschrift`)),
      ...[0, 1, 2, 3].map((i) => T(`rg${i}`, `Spalte ${i + 1}: Zeitraum für extern (today, week, month, year, last:7d, last:24h …)`))],
    toBase: (m) => Object.fromEntries([...[0, 1, 2, 3].map((i) => [`col${i}`, (m.cols || DEF_COLS)[i] || ""]), ...[0, 1, 2, 3].map((i) => [`rg${i}`, (m.ranges || DEF_RG)[i] || ""])]),
    fromBase: (v, m) => { m.cols = [0, 1, 2, 3].map((i) => v[`col${i}`] || ""); const rg = [0, 1, 2, 3].map((i) => v[`rg${i}`] || ""); if (rg.join("|") === DEF_RG.join("|")) delete m.ranges; else m.ranges = rg; },
    lists: [{
      key: "rows", title: "Zeilen", add: "Zeile hinzufügen",
      fields: (m) => { const c = m.cols || DEF_COLS; return [T("name", "Name"), ICN("icon", "Icon"), COL("color", "Farbe"),
        ...[0, 1, 2, 3].map((i) => E(`e${i}`, `Entität „${c[i] || "Spalte " + (i + 1)}“`)),
        { name: "quelle", label: "Datenquelle", selector: { select: { mode: "dropdown", options: [{ value: "intern", label: "intern (Sensoren oben)" }, { value: "extern", label: "extern (DB-Server rechnet aus dem Zählerstand)" }] } } },
        E("zaehler", "Zählerstand für extern (kWh, muss in ltss gespeichert sein)")]; },
      mk: () => ({ name: "", icon: "mdi:flash", color: "#000080", e: ["", "", "", ""] }),
      toForm: (r) => { const d = { name: r.name || "", icon: r.icon || "", color: r.color || "#000080", quelle: r.quelle || "", zaehler: r.zaehler || "" }; [0, 1, 2, 3].forEach((i) => { d[`e${i}`] = (r.e || [])[i] || ""; }); return d; },
      fromForm: (v) => ({ name: v.name || "", icon: v.icon || "", color: v.color || "", e: [0, 1, 2, 3].map((i) => v[`e${i}`] || ""), quelle: v.quelle || "", zaehler: v.zaehler || "" }),
    }],
  },
  "energie-trend": {
    lists: [{
      key: "series", title: "Kurven", add: "Kurve hinzufügen",
      fields: () => [E("entity", "Entität (W)"), T("name", "Name"), COL("color", "Farbe"),
        B("abs", "Immer positiv darstellen (Betrag)"), B("signed", "Vorzeichen zeigen (+ / −)")],
      mk: () => ({ entity: "", name: "", color: "#000080" }),
    }],
  },
  "energie-wr": {
    lists: [
      { key: "inverters", title: "Wechselrichter", add: "Wechselrichter hinzufügen",
        fields: () => [T("name", "Name"), E("entity", "Leistung (W)"), ICN("icon", "Icon")],
        mk: () => ({ name: "", entity: "", icon: "mdi:solar-panel" }) },
      { key: "meters", title: "Zählerstände", add: "Zählerstand hinzufügen",
        fields: () => [T("name", "Name"), E("entity", "Zähler (kWh)"), COL("color", "Farbe"), N("decimals", "Nachkommastellen (leer = wie oben)", 0, 6, 1),
          B("trend", "Trend-Symbol anzeigen"), B("trend_pct", "Trend-Prozentwert anzeigen"), B("flow", "Laufstrich anzeigen"),
          E("power", "Laufstrich: Leistung (W, + Bezug / − Einspeisung)"),
          { name: "flow_dir", label: "Laufstrich: Richtung", selector: { select: { mode: "dropdown", options: [
            { value: "beide", label: "beide (Bezug → rechts, Einspeisung ← links)" },
            { value: "bezug", label: "nur Bezug (→ rechts)" },
            { value: "einspeisung", label: "nur Einspeisung (→ rechts)" }] } } },
          N("flow_max_links", "Laufstrich: volle Geschwindigkeit bei Einspeisung (kW, negativ, z. B. -10; leer = Wert oben)", -100, 0, 0.1),
          N("flow_max_rechts", "Laufstrich: volle Geschwindigkeit bei Bezug (kW, z. B. 5; leer = Wert oben)", 0, 100, 0.1)],
        toForm: (r) => ({ ...r, trend: r.trend !== false, trend_pct: r.trend_pct !== false, flow: r.flow !== false }),
        mk: () => ({ name: "", entity: "", color: "#000080", flow_dir: "beide" }) },
    ],
  },
};
const lbl = (o) => (o && (o.name || o.entity)) || "";
customElements.whenDefined("energie-atlas-editor").then(() => {
  const P = customElements.get("energie-atlas-editor").prototype;
  if (P.__energieListEd || !P._modBody) return;
  P.__energieListEd = true;
  const orig = P._modBody;
  P._modBody = function (body, m, k0, t) {
    const spec = ED[m.type];
    if (!spec) return orig.call(this, body, m, k0, t);
    const K = REG.modules[m.type], D = (K && K.defaults) || {};
    const fields = [{ name: "half", label: "Halbe Breite (zwei nebeneinander)", selector: { boolean: {} } },
      ...((REG.editors[m.type] && REG.editors[m.type].fields) || []), ...(spec.base ? spec.base(m) : [])];
    const data = { ...m, half: !!m.half, ...(spec.toBase ? spec.toBase(m) : {}) };
    body.appendChild(this._form(fields, data, (v) => {
      for (const f of fields) if (!/^(col|rg)\d$/.test(f.name)) { if (v[f.name] === "" || v[f.name] == null) delete m[f.name]; else m[f.name] = v[f.name]; }
      if (spec.fromBase) spec.fromBase(v, m);
      this._emit();
    }));
    for (const L of spec.lists || []) {
      if (!Array.isArray(m[L.key])) m[L.key] = JSON.parse(JSON.stringify(D[L.key] || []));
      const arr = m[L.key], kk = `${k0}:${L.key}`;
      body.appendChild(this._el("sub", L.title));
      arr.forEach((it, j) => {
        const key = `${kk}:${j}`;
        if (this._open[key] == null && !lbl(it)) this._open[key] = true;
        body.appendChild(this._item(key, lbl(it) || "(noch leer)", arr, j, (b, tt) => {
          b.appendChild(this._form(L.fields(m), L.toForm ? L.toForm(it) : { ...it }, (v) => {
            arr[j] = L.fromForm ? L.fromForm(v, arr[j]) : { ...arr[j], ...v };
            tt.textContent = `${j + 1}. ${lbl(arr[j]) || "(noch leer)"}`; this._emit();
          }));
        }, null));
      });
      body.appendChild(this._addBtn(L.add, () => { arr.push(L.mk()); this._open[`${kk}:${arr.length - 1}`] = true; this._rerender(); }));
    }
  };
});

customElements.whenDefined("energie-atlas").then(() => {
  const P = customElements.get("energie-atlas").prototype;
  if (P.__regHook) return;
  const d = Object.getOwnPropertyDescriptor(P, "hass");
  if (!d || !d.set) return;
  P.__regHook = true;
  Object.defineProperty(P, "hass", {
    configurable: true,
    get: d.get,
    set(h) {
      const v = REG.ver || 0;
      if (this._config && this._regV !== v) {
        this._regV = v;
        if ((this._config.modules || []).some((m) => m && REG.modules[m.type])) { this._hass = h; this._build(); return; }
      }
      d.set.call(this, h);
    },
  });
});
})();

/* ===== energie-atlas-strom ===== */
/* energie-atlas-strom – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const REFETCH_MS = 30 * 60 * 1000, LIVE_MS = 10 * 1000, COMPACT_W = 560, DAY = 86400000;
const CACHE = {};
const fmt = (v, d = 0) => (v == null || isNaN(v) ? "–" : v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = (v, d = 2) => (v == null || isNaN(v) ? "–" : `${fmt(v, d)} €`);
const kwhD = (v) => (v != null && Math.abs(v) < 100 ? 1 : 0);

function series(rows, liveState) {
  const pts = (rows || []).filter((r) => r.sum != null).map((r) => ({ t: new Date(r.end).getTime(), s: r.sum, st: r.state })).sort((a, b) => a.t - b.t);
  if (pts.length && liveState != null && !isNaN(liveState)) {
    const last = pts[pts.length - 1];
    if (last.st != null && liveState >= last.st) {
      const now = Date.now();
      if (now > last.t) pts.push({ t: now, s: last.s + (liveState - last.st) });
      else last.s = last.s + (liveState - last.st);
    }
  }
  return pts;
}
function sumAt(pts, t) {
  if (!pts.length || t < pts[0].t) return null;
  const last = pts[pts.length - 1];
  if (t >= last.t) return last.s;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid; }
  const a = pts[lo], b = pts[hi];
  if (b.t === a.t) return a.s;
  return a.s + ((b.s - a.s) * (t - a.t)) / (b.t - a.t);
}
function diff(pts, t0, t1) { const a = sumAt(pts, t0), b = sumAt(pts, t1); if (a == null || b == null) return null; return Math.max(0, b - a); }
const sameDay = (date, yearsBack) => { const d = new Date(date); d.setFullYear(d.getFullYear() - yearsBack); return d.getTime(); };
function parseDate(s) { if (!s || typeof s !== "string") return null; const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
const addYears = (d, n) => new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
const today0 = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const dshort = (d) => (d ? `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}` : "–");
const dtiny = (d) => (d ? `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.` : "–");
function abschlaege(start, ziel, intervall, betrag, tag) {
  if (!start || !ziel || ziel < start || !(betrag > 0)) return 0;
  if (intervall === "gesamte Vertragslaufzeit") return (betrag * Math.round((ziel - start) / DAY)) / 365;
  let n = 0, y = start.getFullYear(), m = start.getMonth();
  for (let i = 0; i < 240; i++) {
    const f = new Date(y, m, tag);
    if (f > ziel) break;
    if (f >= start && (intervall === "monatlich" || [2, 5, 8, 11].includes(m))) n++;
    if (++m > 11) { m = 0; y++; }
  }
  return n * betrag;
}

const STYLE = `
  :host { display:block; }
  .glass { color:#000; box-sizing:border-box; font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
  .title { display:flex; align-items:center; justify-content:center; gap:8px; font-size: 15px; font-weight: 600; margin-bottom: 10px; text-align:center; }
  .title ha-icon { --mdc-icon-size: 20px; color: #000080; flex:none; }
  .sub { font-size: 11px; opacity: .6; text-align:center; margin-top: 6px; }
  .tiles { display:grid; grid-template-columns: repeat(auto-fit, minmax(var(--tmin,210px), 1fr)); gap: 8px; }
  .tile { background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.10); border-radius: 12px; padding: 10px 12px; min-width:0; display:flex; flex-direction:column; }
  .tile h4 { margin:0 0 8px 0; font-size: 13px; font-weight: 600; display:flex; align-items:center; gap:6px; }
  .tile h4 ha-icon { --mdc-icon-size: 18px; color:#000080; flex:none; }
  .row { display:flex; justify-content:space-between; align-items:baseline; margin: 4px 0; gap:6px; }
  .lbl { font-size: 12px; opacity: .7; display:flex; align-items:center; gap:6px; white-space:nowrap; }
  .dot { width:8px; height:8px; border-radius:50%; display:inline-block; flex:none; }
  .val { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; white-space:nowrap; }
  .val small { font-size: 11px; font-weight: 400; opacity:.7; margin-left:2px; }
  .v { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; white-space:nowrap; }
  .cmp { font-size: 11px; text-align:right; opacity:.85; font-variant-numeric: tabular-nums; }
  .hero { margin: 8px 0 2px 0; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.10); }
  .hero .lbl { font-size: 12px; opacity: .8; }
  .hero .big { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; white-space:nowrap; }
  .fc { margin-top: auto; padding-top: 6px; }
  .fc .row .v { font-size: 13px; }
  .note { font-size: 10px; opacity: .6; }
  .good { color: #1b7a1b; } .bad { color: #a11a1a; } .neutral { opacity:.6; }
  .bar { height: 6px; border-radius: 3px; background: rgba(0,0,0,0.08); overflow:hidden; margin-top:8px; }
  .bar > div { height:100%; background:#000080; border-radius:3px; }
  .legend { display:flex; justify-content:center; gap:14px; font-size:12px; margin-top:6px; flex-wrap:wrap; }
  .legend span { display:inline-flex; align-items:center; gap:6px; }
  .legend i { width:12px; height:10px; border-radius:2px; display:inline-block; }
  svg { display:block; }
  svg text { fill:#000; font-size:11px; }
  .scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-variant-numeric: tabular-nums; }
  th, td { padding: 8px 6px; font-size: 13px; text-align:right; white-space:nowrap; }
  th { font-weight:600; font-size:12px; opacity:.7; border-bottom:1px solid rgba(0,0,0,0.15); }
  td:first-child, th:first-child { text-align:left; }
  tr + tr td { border-top: 1px solid rgba(0,0,0,0.06); }
  tr.sum td { border-top: 1px solid rgba(0,0,0,0.25); font-weight:700; }
  tr.cur td { background: rgba(0,0,128,0.05); }
  td .d { display:block; font-size:10px; font-weight:400; }
  th.grp { text-align:center; border-bottom:none; padding-bottom:0; }
  .yr { font-weight:600; }
  .mini { display:inline-block; height:8px; border-radius:2px; vertical-align:middle; margin-left:6px; }
  .err { color:#a11a1a; font-size:13px; }
  .load { opacity:.6; font-size:13px; text-align:center; padding:12px; }
  .compact .title { font-size: 14px; margin-bottom: 8px; }
  .compact .tiles { grid-template-columns: var(--tcomp, 1fr 1fr); gap: 6px; }
  .compact .tile { padding: 8px 8px; }
  .compact .tile h4 { font-size: 12px; margin-bottom: 4px; }
  .compact .tile h4 ha-icon { --mdc-icon-size: 15px; }
  .compact .ejc .row { flex-direction: column; align-items: flex-start; gap: 0; margin: 4px 0 0 0; }
  .compact .lbl { font-size: 11px; }
  .compact .val { font-size: 17px; }
  .compact .cmp { font-size: 10px; text-align:left; }
  .compact .hero .big { font-size: 21px; }
  .compact .legend { font-size: 11px; gap: 8px; }
  .compact th, .compact td { padding: 6px 3px; font-size: 12px; }
  .compact th { font-size: 11px; }
  /* Eingabe */
  .rows { display:flex; flex-direction:column; gap:2px; }
  .er { display:grid; grid-template-columns: 28px minmax(0,1fr) auto; align-items:center; gap:10px; padding:6px; border-radius:10px; }
  .er:nth-child(odd) { background: rgba(255,255,255,0.10); }
  .er > ha-icon { --mdc-icon-size:22px; color:#000080; justify-self:center; }
  .en { font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; }
  .ev { display:flex; align-items:center; gap:6px; font-size:14px; font-weight:600; font-variant-numeric: tabular-nums; white-space:nowrap; }
  .ev small { font-size:12px; font-weight:400; opacity:.7; }
  .ev input, .ev select { box-sizing:border-box; padding:6px 8px; border-radius:8px; border:1px solid rgba(0,0,0,0.25);
    background: rgba(255,255,255,0.55); font: inherit; font-weight:600; color:#000; max-width:190px; }
  .ev input[type=number] { width:110px; text-align:right; }
  .ev input[type=checkbox] { width:20px; height:20px; accent-color:#000080; }
  .ev input:focus, .ev select:focus { outline:2px solid #000080; outline-offset:0; }
  .ev .bad { border-color:#a11a1a; outline-color:#a11a1a; }
  .ev .ok { border-color:#1b7a1b; }
  .sec { font-size:12px; font-weight:600; opacity:.65; margin:10px 6px 2px; }
  .compact .ev input[type=number] { width:90px; }
  .compact .ev input, .compact .ev select { max-width:150px; }
`;

/* ---------- gemeinsame Modul-Basis (Atlas: constructor(config, el) + set hass) ---------- */
class Base {
  constructor(c, el, defaults) {
    this._config = { ...defaults, ...(c || {}) };
    this.el = el;
    this.shadowRoot = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="glass"><div class="load">Lade…</div></div>`;
    this._lastRender = 0;
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver((e) => { const w = Math.round(e[0].contentRect.width); if (w > 0 && Math.abs(w - (this._w || 0)) > 16) { this._w = w; this._render(); } });
      this._ro.observe(el);
    }
  }
  _alive() {
    if (this.el.isConnected) { this._seen = true; return true; }
    if (this._seen && !this._gone) { this._gone = true; if (this._ro) this._ro.disconnect(); }
    return !this._seen;
  }
  set hass(hass) {
    if (!this._alive()) return;
    this._hass = hass;
    const now = Date.now();
    if (!this._raw || now - this._fetched > REFETCH_MS) this._load();
    else if (now - this._lastRender > LIVE_MS) this._render();
  }
  _compact() { return (this._w || this.el.clientWidth || 800) < COMPACT_W; }
  get box() { return this.shadowRoot.querySelector(".glass"); }
  async _load() {
    if (this._loading || !this._hass) return;
    this._loading = true;
    const c = this._config, start = this._start(), key = `${c.bezug}|${c.einspeisung}|${start.getTime()}`;
    try {
      let entry = CACHE[key];
      if (!entry || Date.now() - entry.time > REFETCH_MS) {
        entry = { time: Date.now(), promise: this._hass.callWS({ type: "recorder/statistics_during_period", start_time: start.toISOString(),
          end_time: new Date().toISOString(), statistic_ids: [c.bezug, c.einspeisung], period: "day", types: ["sum", "state"] }) };
        CACHE[key] = entry;
      }
      this._raw = await entry.promise;
      this._fetched = Date.now();
      this._render();
    } catch (e) {
      delete CACHE[key];
      this.box.innerHTML = `<div class="err">Fehler: ${esc(e.message || e)}</div>`;
    } finally { this._loading = false; }
  }
  _render() {
    if (!this._raw || !this._hass) return;
    this._lastRender = Date.now();
    const compact = this._compact(), box = this.box;
    box.classList.toggle("compact", compact);
    try { box.innerHTML = this.draw(compact); } catch (e) { box.innerHTML = `<div class="err">Fehler: ${esc(e.message || e)}</div>`; }
  }
  _width(compact) { return Math.max(300, Math.min(1400, this._w || this.el.clientWidth || 640)); }
}

/* =================== Strom Jahr (energie-jahr-card) =================== */
class JahrBase extends Base {
  constructor(c, el) { super(c, el, { metric: "bezug", bezug: "", einspeisung: "" }); }
  _start() { return new Date(new Date().getFullYear() - 3, 0, 1); }
  _series() {
    const c = this._config, live = (id) => { const s = this._hass.states[id]; return s ? parseFloat(s.state) : null; };
    return { bezug: series(this._raw[c.bezug], live(c.bezug)), einsp: series(this._raw[c.einspeisung], live(c.einspeisung)) };
  }
  draw(compact) { return this.part(this._series(), compact); }
  _cmp(cur, prev, lowerIsGood, label, compact) {
    if (cur == null || prev == null || prev <= 0) return `<div class="cmp neutral">${compact ? "" : label + ": "}–</div>`;
    const pct = ((cur - prev) / prev) * 100, up = pct >= 0, good = lowerIsGood ? !up : up;
    const cls = Math.abs(pct) < 1 ? "neutral" : good ? "good" : "bad";
    const p = `${up ? "▲" : "▼"} ${fmt(Math.abs(pct), 0)} %`, pv = fmt(prev, prev < 100 ? 1 : 0);
    return compact ? `<div class="cmp ${cls}">${p} (${pv})</div>` : `<div class="cmp ${cls}">${p} ${label} (${pv})</div>`;
  }
  _pair(title, icon, b, bPrev, e, ePrev, cmpLabel, compact, extra = "") {
    const c = this._config;
    return `<div class="tile">
      <h4><ha-icon icon="${icon}"></ha-icon>${title}</h4>
      <div class="row" data-e="${esc(c.bezug)}" style="cursor:pointer"><span class="lbl"><i class="dot" style="background:#b22222"></i>Bezug</span>
        <span class="val">${fmt(b, b != null && b < 100 ? 1 : 0)}<small>kWh</small></span></div>
      ${this._cmp(b, bPrev, true, cmpLabel, compact)}
      <div class="row" data-e="${esc(c.einspeisung)}" style="cursor:pointer"><span class="lbl"><i class="dot" style="background:#228b22"></i>Einspeisung</span>
        <span class="val">${fmt(e, e != null && e < 100 ? 1 : 0)}<small>kWh</small></span></div>
      ${this._cmp(e, ePrev, false, cmpLabel, compact)}
      ${extra}
    </div>`;
  }
}
class JahrKpi extends JahrBase {
  part(s, compact) {
    const now = new Date(), t = now.getTime(), y = now.getFullYear();
    const jan = (yy) => new Date(yy, 0, 1).getTime(), prevDay = sameDay(now, 1);
    const r365b = diff(s.bezug, t - 365 * DAY, t), r365bP = diff(s.bezug, t - 730 * DAY, t - 365 * DAY);
    const r365e = diff(s.einsp, t - 365 * DAY, t), r365eP = diff(s.einsp, t - 730 * DAY, t - 365 * DAY);
    const ytdB = diff(s.bezug, jan(y), t), ytdBP = diff(s.bezug, jan(y - 1), prevDay);
    const ytdE = diff(s.einsp, jan(y), t), ytdEP = diff(s.einsp, jan(y - 1), prevDay);
    const mStart = new Date(y, now.getMonth(), 1).getTime(), mStartP = new Date(y - 1, now.getMonth(), 1).getTime();
    const monB = diff(s.bezug, mStart, t), monBP = diff(s.bezug, mStartP, prevDay);
    const monE = diff(s.einsp, mStart, t), monEP = diff(s.einsp, mStartP, prevDay);
    const fullBP = diff(s.bezug, jan(y - 1), jan(y)), fullEP = diff(s.einsp, jan(y - 1), jan(y));
    const fc = (ytd, ytdPrev, fullPrev) => (ytd == null || ytdPrev == null || fullPrev == null || ytdPrev <= 0 ? null : ytd * (fullPrev / ytdPrev));
    const fcB = fc(ytdB, ytdBP, fullBP), fcE = fc(ytdE, ytdEP, fullEP);
    const yearPct = ((t - jan(y)) / (jan(y + 1) - jan(y))) * 100, daysLeft = Math.ceil((jan(y + 1) - t) / DAY);
    const progress = `<div class="bar"><div style="width:${yearPct.toFixed(1)}%"></div></div>
      <div class="sub">${fmt(yearPct, compact ? 0 : 1)} %${compact ? "" : ` von ${y} vorbei`} – noch ${daysLeft} Tage</div>`;
    const mn = MON[now.getMonth()];
    return `<div class="ejc"><div class="title"><ha-icon icon="mdi:calendar-sync"></ha-icon>Jahresrückblick live</div>
      <div class="tiles">
        ${this._pair(compact ? "365 Tage" : "Letzte 365 Tage", "mdi:calendar-refresh", r365b, r365bP, r365e, r365eP, "vs. 365 T. davor", compact)}
        ${this._pair(compact ? "Seit 1.1." : `Seit 1. Januar ${y}`, "mdi:calendar-start", ytdB, ytdBP, ytdE, ytdEP, `vs. ${y - 1}`, compact, progress)}
        ${this._pair(compact ? `${mn} bisher` : `${mn} ${y} bis heute`, "mdi:calendar-today", monB, monBP, monE, monEP, `vs. ${mn} ${y - 1}`, compact)}
        ${this._pair(compact ? `Prognose ${y}` : `Hochrechnung ${y}`, "mdi:crystal-ball", fcB, fullBP, fcE, fullEP, `vs. ${y - 1} gesamt`, compact, compact ? "" : `<div class="sub">bisher × Verlauf ${y - 1}</div>`)}
      </div>
      <div class="sub">${compact ? "Klammer = Vergleichswert Vorjahr / Vorzeitraum" : `Live aus ${esc(this._config.bezug)} / ${esc(this._config.einspeisung)} · Vergleiche jeweils zum gleichen Stichtag`}</div></div>`;
  }
}
class JahrMonate extends JahrBase {
  part(s, compact) {
    const isB = this._config.metric !== "einspeisung", pts = isB ? s.bezug : s.einsp;
    const base = (isB ? [178, 34, 34] : [34, 139, 34]).join(",");
    const now = new Date(), y = now.getFullYear(), years = [y - 2, y - 1, y], alphas = [0.3, 0.6, 1];
    const vals = years.map((yy) => MON.map((_, m) => {
      const a = new Date(yy, m, 1).getTime();
      if (a > now.getTime()) return null;
      const b = Math.min(new Date(yy, m + 1, 1).getTime(), now.getTime());
      return diff(pts, a, b);
    }));
    const all = vals.flat().filter((v) => v != null);
    if (!all.length) return `<div class="err">Keine Daten.</div>`;
    const max = Math.max(1, ...all), W = this._width(compact), H = compact ? 210 : 240;
    const pL = compact ? 34 : 44, pB = 24, pT = 8, pR = 4, plotW = W - pL - pR, plotH = H - pT - pB;
    const step = plotW / 12, gw = step * 0.82, bw = gw / 3;
    const unit = max >= 1000 ? 500 : max >= 200 ? 100 : max >= 50 ? 25 : 5;
    const tmax = Math.ceil(max / unit) * unit, ys = (v) => pT + plotH - (v / tmax) * plotH, fsz = compact ? 10 : 11;
    let g = "";
    for (let i = 0; i <= 4; i++) {
      const v = (tmax / 4) * i, yy = ys(v);
      g += `<line x1="${pL}" x2="${W - pR}" y1="${yy}" y2="${yy}" stroke="rgba(0,0,0,0.10)"/><text x="${pL - 4}" y="${yy + 4}" text-anchor="end" style="font-size:${fsz}px">${fmt(v, 0)}</text>`;
    }
    years.forEach((yy, yi) => {
      vals[yi].forEach((v, m) => {
        const x = pL + step * m + (step - gw) / 2 + yi * bw;
        if (v == null) {
          if (new Date(yy, m, 1).getTime() <= now.getTime()) g += `<text x="${(x + bw / 2).toFixed(1)}" y="${(pT + plotH - 3).toFixed(1)}" text-anchor="middle" style="font-size:9px;opacity:.45"><title>${MON[m]} ${yy}: keine Daten</title>–</text>`;
          return;
        }
        const top = ys(v), h = pT + plotH - top, partial = yy === y && m === now.getMonth();
        g += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="${compact ? 1 : 2}" fill="rgba(${base},${alphas[yi]})" ${partial ? 'stroke="#000080" stroke-dasharray="3,2"' : ""}><title>${MON[m]} ${yy}${partial ? " (bis heute)" : ""}: ${fmt(v, 1)} kWh</title></rect>`;
      });
    });
    MON.forEach((mn, m) => {
      const label = compact && step < 30 ? mn.charAt(0) : mn;
      g += `<text x="${pL + step * m + step / 2}" y="${H - 7}" text-anchor="middle" style="font-size:${fsz}px" ${m === now.getMonth() ? 'font-weight="700"' : ""}>${label}</text>`;
    });
    const sums = vals.map((arr) => arr.reduce((a, v) => a + (v || 0), 0));
    const legend = years.map((yy, i) => `<span><i style="background:rgba(${base},${alphas[i]})"></i>${yy}: ${fmt(sums[i], 0)} kWh${yy === y && !compact ? " (bis heute)" : ""}</span>`).join("");
    return `<div class="title"><ha-icon icon="${isB ? "mdi:transmission-tower-import" : "mdi:transmission-tower-export"}"></ha-icon>${isB ? "Bezug 1.8.0" : "Einspeisung 2.8.0"} pro Monat</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${g}</svg>
      <div class="legend">${legend}</div>`;
  }
}
class JahrJahre extends JahrBase {
  part(s, compact) {
    const now = new Date(), y = now.getFullYear(), t = now.getTime();
    const jan = (yy) => new Date(yy, 0, 1).getTime(), prevDay = sameDay(now, 1);
    const rows = [y - 2, y - 1, y].map((yy) => { const end = Math.min(jan(yy + 1), t); return { yy, b: diff(s.bezug, jan(yy), end), e: diff(s.einsp, jan(yy), end), partial: yy === y }; });
    const maxB = Math.max(1, ...rows.map((r) => r.b || 0)), maxE = Math.max(1, ...rows.map((r) => r.e || 0));
    const pct = (cur, prev) => (cur == null || prev == null || prev <= 0 ? null : ((cur - prev) / prev) * 100);
    const pctCell = (p, lowerGood) => {
      if (p == null) return `<span class="neutral">–</span>`;
      const good = lowerGood ? p < 0 : p > 0, cls = Math.abs(p) < 1 ? "neutral" : good ? "good" : "bad";
      return `<span class="${cls}">${p >= 0 ? "+" : "−"}${fmt(Math.abs(p), 0)} %</span>`;
    };
    const saldoTxt = (r) => { const sd = r.b != null && r.e != null ? r.e - r.b : null; return sd == null ? "–" : (sd >= 0 ? "+" : "−") + fmt(Math.abs(sd), 0); };
    const prevOf = (r, i) => { const prev = rows[i - 1]; if (!prev) return { pB: null, pE: null }; return { pB: r.partial ? diff(s.bezug, jan(prev.yy), prevDay) : prev.b, pE: r.partial ? diff(s.einsp, jan(prev.yy), prevDay) : prev.e }; };
    if (compact) {
      const body = rows.map((r, i) => { const { pB, pE } = prevOf(r, i); return `<tr>
        <td class="yr">${r.yy}${r.partial ? '<span class="d neutral">bis heute</span>' : ""}</td>
        <td>${fmt(r.b, 0)}<span class="d">${pctCell(pct(r.b, pB), true)}</span></td>
        <td>${fmt(r.e, 0)}<span class="d">${pctCell(pct(r.e, pE), false)}</span></td>
        <td><b>${saldoTxt(r)}</b></td></tr>`; }).join("");
      return `<div class="title"><ha-icon icon="mdi:table-large"></ha-icon>Jahressummen</div>
        <table><tr><th>Jahr</th><th>Bezug</th><th>Einsp.</th><th>Saldo</th></tr>${body}</table>
        <div class="sub">kWh · % = zum Vorjahr (laufendes Jahr: gleicher Stichtag)</div>`;
    }
    const body = rows.map((r, i) => {
      const { pB, pE } = prevOf(r, i), ratio = r.b != null && r.b > 0 && r.e != null ? r.e / r.b : null;
      return `<tr>
        <td class="yr">${r.yy}${r.partial ? ' <span class="neutral" style="font-weight:400;font-size:11px">bis heute</span>' : ""}</td>
        <td>${fmt(r.b, 0)}<span class="mini" style="width:${(((r.b || 0) / maxB) * 40).toFixed(0)}px;background:#b22222"></span></td>
        <td>${pctCell(pct(r.b, pB), true)}</td>
        <td>${fmt(r.e, 0)}<span class="mini" style="width:${(((r.e || 0) / maxE) * 40).toFixed(0)}px;background:#228b22"></span></td>
        <td>${pctCell(pct(r.e, pE), false)}</td>
        <td><b>${saldoTxt(r)}</b></td>
        <td>${ratio == null ? "–" : fmt(ratio, 1) + " : 1"}</td></tr>`;
    }).join("");
    return `<div class="title"><ha-icon icon="mdi:table-large"></ha-icon>Jahressummen</div>
      <div class="scroll"><table>
        <tr><th>Jahr</th><th>Bezug kWh</th><th>Δ Vorjahr</th><th>Einspeisung kWh</th><th>Δ Vorjahr</th><th>Saldo kWh</th><th>Einsp. : Bezug</th></tr>
        ${body}
      </table></div>
      <div class="sub">Δ im laufenden Jahr gegenüber dem gleichen Stichtag des Vorjahres · Saldo = Einspeisung − Bezug</div>`;
  }
}

/* =================== Vertrag (strom-vertrag-card) =================== */
const H = {
  b_start: "", p_start: "", stichtag: "",
  b_ap: "", b_ap_alt: "",
  b_gp: "", b_gp_alt: "", b_wechsel: "",
  b_ab: "", b_ab_tag: "", b_ab_int: "",
  b_ab_korr: "",
  p_v: "", p_v_alt: "", p_wechsel: "",
  p_ab: "", p_ab_tag: "", p_ab_int: "",
  p_ab_korr: "",
  s_b_kwh: "", s_b_kosten: "", s_b_ab: "", s_b_saldo: "",
  s_p_kwh: "", s_p_verg: "", s_p_ab: "", s_p_saldo: "",
};
class VBase extends Base {
  constructor(c, el) { super(c, el, { bezug: "", einspeisung: "", jahre: 3, historie: [] }); }
  _start() { return new Date(new Date().getFullYear() - (Math.max(3, Number(this._config.jahre) || 3) + 2), 0, 1); }
  _st(id) { const s = this._hass && this._hass.states[id]; return s ? s.state : null; }
  _num(id, d = null) { const v = parseFloat(this._st(id)); return isNaN(v) ? d : v; }
  _attr(id, a) { const s = this._hass && this._hass.states[id]; const v = s ? parseFloat(s.attributes[a]) : NaN; return isNaN(v) ? null : v; }
  _series() { const c = this._config; return { b: series(this._raw[c.bezug], this._num(c.bezug)), e: series(this._raw[c.einspeisung], this._num(c.einspeisung)) }; }
  _ctx() {
    const bStart = parseDate(this._st(H.b_start)), pStart = parseDate(this._st(H.p_start)) || bStart;
    if (!bStart) return null;
    return {
      t0: today0(), now: Date.now(), bStart, pStart,
      bEnd: new Date(addYears(bStart, 1).getTime() - DAY), pEnd: new Date(addYears(pStart, 1).getTime() - DAY),
      stichtag: parseDate(this._st(H.stichtag)),
      ap: this._num(H.b_ap, 0), apAlt: this._num(H.b_ap_alt, 0), gp: this._num(H.b_gp, 0), gpAlt: this._num(H.b_gp_alt, 0),
      bWechsel: parseDate(this._st(H.b_wechsel)), v: this._num(H.p_v, 0), vAlt: this._num(H.p_v_alt, 0), pWechsel: parseDate(this._st(H.p_wechsel)),
    };
  }
  _priceAt(d, start, wechsel, alt, neu) { return wechsel && wechsel > start && d < wechsel ? alt : neu; }
  _factor(pts, start, ziel, now) {
    const tz = ziel.getTime() + DAY, tn = now;
    if (tz <= tn) return { f: 1, how: "ist" };
    const ps = addYears(start, -1).getTime(), prevNow = diff(pts, ps, tn - 365 * DAY), prevZiel = diff(pts, ps, tz - 365 * DAY);
    if (prevNow != null && prevZiel != null && prevNow > 0.5 && prevZiel >= prevNow) return { f: prevZiel / prevNow, how: "vj" };
    const dn = Math.max(1, (tn - start.getTime()) / DAY);
    return { f: (tz - start.getTime()) / DAY / dn, how: "linear" };
  }
  _forecast(s, c, ziel) {
    if (!ziel) return null;
    const zEnd = new Date(ziel.getTime());
    const bKwh = this._num(H.s_b_kwh), bKosten = this._num(H.s_b_kosten);
    const bAp = this._attr(H.s_b_kosten, "arbeitspreis_anteil"), bGp = this._attr(H.s_b_kosten, "grundpreis_anteil");
    let bez = null;
    if (bKwh != null && bKosten != null) {
      const fb = this._factor(s.b, c.bStart, zEnd, c.now), kwhZ = bKwh * fb.f;
      const restTage = Math.max(0, Math.round((zEnd.getTime() - c.t0.getTime()) / DAY) + 1);
      const kosten = (bAp != null && bGp != null ? bAp + bGp : bKosten) + ((kwhZ - bKwh) * c.ap) / 100 + (c.gp * restTage) / 365;
      const ab = abschlaege(c.bStart, zEnd, this._st(H.b_ab_int), this._num(H.b_ab, 0), this._num(H.b_ab_tag, 1)) + this._num(H.b_ab_korr, 0);
      bez = { kwh: kwhZ, kosten, ab, saldo: ab - kosten, how: fb.how };
    }
    const pKwh = this._num(H.s_p_kwh), pVerg = this._num(H.s_p_verg);
    let pv = null;
    if (pKwh != null && pVerg != null) {
      const fp = this._factor(s.e, c.pStart, zEnd, c.now), kwhZ = pKwh * fp.f, verg = pVerg + ((kwhZ - pKwh) * c.v) / 100;
      const ab = abschlaege(c.pStart, zEnd, this._st(H.p_ab_int), this._num(H.p_ab, 0), this._num(H.p_ab_tag, 1)) + this._num(H.p_ab_korr, 0);
      pv = { kwh: kwhZ, verg, ab, saldo: verg - ab, how: fp.how };
    }
    return { bez, pv, ges: bez && pv ? bez.saldo + pv.saldo : null };
  }
  draw(compact) {
    const c = this._ctx();
    if (!c) return `<div class="err">Abrechnungsbeginn (${H.b_start}) fehlt.</div>`;
    return this.part(this._series(), c, compact);
  }
  _pctCell(cur, prev, lowerGood) {
    if (cur == null || prev == null || prev <= 0.05) return `<span class="neutral">–</span>`;
    const p = ((cur - prev) / prev) * 100, good = lowerGood ? p < 0 : p > 0, cls = Math.abs(p) < 1 ? "neutral" : good ? "good" : "bad";
    return `<span class="${cls}">${p >= 0 ? "+" : "−"}${fmt(Math.abs(p), 0)} %</span>`;
  }
  _signed(v, d = 2) { return v == null || isNaN(v) ? "–" : `${v >= 0 ? "+" : "−"}${fmt(Math.abs(v), d)} €`; }
  _cls(v) { return v == null ? "neutral" : v >= 0 ? "good" : "bad"; }
}
class VSaldo extends VBase {
  part(s, c, compact) {
    const fS = this._forecast(s, c, c.stichtag && c.stichtag > c.t0 ? c.stichtag : null), fE = this._forecast(s, c, c.bEnd);
    const howTxt = (h) => (h === "vj" ? "nach Vorjahresverlauf" : h === "linear" ? "linear (kein Vorjahr)" : "");
    const bKwh = this._num(H.s_b_kwh), pKwh = this._num(H.s_p_kwh);
    const bPrev = diff(s.b, addYears(c.bStart, -1).getTime(), c.now - 365 * DAY), pPrev = diff(s.e, addYears(c.pStart, -1).getTime(), c.now - 365 * DAY);
    const bSaldo = this._num(H.s_b_saldo), pSaldo = this._num(H.s_p_saldo), ges = bSaldo != null && pSaldo != null ? bSaldo + pSaldo : null;
    const fcRows = (key, field, lblPos, lblNeg) => {
      const rows = [];
      if (fS && fS[key]) rows.push([`zum ${dtiny(c.stichtag)}`, fS[key][field] ?? fS[key]]);
      if (fE && fE[key]) rows.push([`zum ${dtiny(c.bEnd)} (Jahr)`, fE[key][field] ?? fE[key]]);
      return rows.map(([l, v]) => `<div class="row"><span class="lbl">${l}</span><span class="v ${this._cls(v)}">${this._signed(v, 0)} <span class="note">${v >= 0 ? lblPos : lblNeg}</span></span></div>`).join("");
    };
    const bAp = this._attr(H.s_b_kosten, "arbeitspreis_anteil"), bGp = this._attr(H.s_b_kosten, "grundpreis_anteil");
    const days = Math.round((c.t0 - c.bStart) / DAY), total = Math.round((c.bEnd - c.bStart) / DAY) + 1, pct = Math.min(100, Math.max(0, (days / total) * 100));
    const row = (l, v, e) => `<div class="row"${e ? ` data-e="${esc(e)}" style="cursor:pointer"` : ""}><span class="lbl">${l}</span><span class="v">${v}</span></div>`;
    const tB = `<div class="tile">
      <h4><ha-icon icon="mdi:transmission-tower-import"></ha-icon>Bezug 180 · EWE Strom</h4>
      ${row(`Verbrauch seit ${dtiny(c.bStart)}`, `${fmt(bKwh, kwhD(bKwh))} kWh`, H.s_b_kwh)}
      ${row("zum Vorjahr", `${this._pctCell(bKwh, bPrev, true)} <span class="note">(${fmt(bPrev, kwhD(bPrev))})</span>`)}
      ${row(`Arbeitspreis ${fmt(c.ap, 2)} ct`, eur(bAp), H.s_b_kosten)}
      ${row(`Grundpreis ${fmt(c.gp, 2)} €/a`, eur(bGp), H.s_b_kosten)}
      ${row("Abschläge gezahlt", eur(this._num(H.s_b_ab)), H.s_b_ab)}
      <div class="hero row" data-e="${H.s_b_saldo}" style="cursor:pointer"><span class="lbl">${bSaldo != null && bSaldo < 0 ? "Nachzahlung heute" : "Guthaben heute"}</span><span class="big ${this._cls(bSaldo)}">${this._signed(bSaldo)}</span></div>
      <div class="fc"><div class="note">Hochrechnung ${howTxt(fE && fE.bez && fE.bez.how)}</div>${fcRows("bez", "saldo", "Guthaben", "Nachzahlung")}</div>
    </div>`;
    const tP = `<div class="tile">
      <h4><ha-icon icon="mdi:transmission-tower-export"></ha-icon>Einspeisung 280 · PV</h4>
      ${row(`Eingespeist seit ${dtiny(c.pStart)}`, `${fmt(pKwh, kwhD(pKwh))} kWh`, H.s_p_kwh)}
      ${row("zum Vorjahr", `${this._pctCell(pKwh, pPrev, false)} <span class="note">(${fmt(pPrev, kwhD(pPrev))})</span>`)}
      ${row(`Vergütung ${fmt(c.v, 2)} ct`, eur(this._num(H.s_p_verg)), H.s_p_verg)}
      ${row("Abschläge erhalten", eur(this._num(H.s_p_ab)), H.s_p_ab)}
      ${row("&nbsp;", "&nbsp;")}
      <div class="hero row" data-e="${H.s_p_saldo}" style="cursor:pointer"><span class="lbl">${pSaldo != null && pSaldo < 0 ? "zu viel erhalten" : "EWE schuldet noch"}</span><span class="big ${this._cls(pSaldo)}">${this._signed(pSaldo)}</span></div>
      <div class="fc"><div class="note">Hochrechnung ${howTxt(fE && fE.pv && fE.pv.how)}</div>${fcRows("pv", "saldo", "EWE zahlt", "zurück")}</div>
    </div>`;
    const gRow = (l, f) => (f && f.ges != null ? `<div class="row"><span class="lbl">${l}</span><span class="v ${this._cls(f.ges)}">${this._signed(f.ges, 0)}</span></div>` : "");
    const net = (this._num(H.s_p_verg) ?? 0) - (this._num(H.s_b_kosten) ?? 0);
    const tG = `<div class="tile">
      <h4><ha-icon icon="mdi:scale-balance"></ha-icon>Gesamt · Bezug + PV</h4>
      <div class="row"><span class="lbl">Abrechnungsjahr</span><span class="v">${dshort(c.bStart)} – ${dshort(c.bEnd)}</span></div>
      <div class="bar"><div style="width:${pct.toFixed(1)}%"></div></div>
      <div class="row"><span class="note">Tag ${days + 1} von ${total}</span><span class="note">noch ${Math.max(0, total - days - 1)} Tage</span></div>
      <div class="row"><span class="lbl">Netto (Vergütung − Kosten)</span><span class="v ${this._cls(net)}">${this._signed(net)}</span></div>
      <div class="hero row"><span class="lbl">Saldo heute</span><span class="big ${this._cls(ges)}">${this._signed(ges)}</span></div>
      <div class="fc"><div class="note">bei Zwischenabrechnung</div>${gRow(`zum ${dtiny(c.stichtag)}`, fS)}${gRow(`zum ${dtiny(c.bEnd)} (Jahr)`, fE)}</div>
    </div>`;
    return `<div class="title"><ha-icon icon="mdi:file-document-outline"></ha-icon>Vertragsübersicht</div>
      <div class="tiles" style="--tmin:230px;--tcomp:1fr">${tB}${tP}${tG}</div>
      <div class="sub">+ = zu deinen Gunsten · Hochrechnung: bisherige Menge × Verlauf des Vorjahres, Preise aktuell${compact ? "" : " · Stichtag über „Stichtag Zwischenabrechnung“ einstellbar"}</div>`;
  }
}
class VMonate extends VBase {
  part(s, c, compact) {
    const segs = [];
    let a = new Date(c.bStart);
    while (a <= c.t0 && segs.length < 14) {
      const next = new Date(a.getFullYear(), a.getMonth() + 1, 1), endExcl = new Date(Math.min(next.getTime(), c.bEnd.getTime() + DAY));
      segs.push({ a, b: endExcl });
      a = endExcl;
    }
    const nowT = c.now, sum = { b: 0, bP: 0, e: 0, eP: 0, k: 0, v: 0 };
    const rows = segs.map((sg) => {
      const cur = sg.b.getTime() > nowT, t1 = cur ? nowT : sg.b.getTime(), tA = sg.a.getTime();
      const b = diff(s.b, tA, t1), e = diff(s.e, tA, t1);
      const bP = diff(s.b, addYears(sg.a, -1).getTime(), t1 - 365 * DAY), eP = diff(s.e, addYears(sg.a, -1).getTime(), t1 - 365 * DAY);
      const tage = (t1 - tA) / DAY;
      const ap = this._priceAt(sg.a, c.bStart, c.bWechsel, c.apAlt, c.ap), gp = this._priceAt(sg.a, c.bStart, c.bWechsel, c.gpAlt, c.gp);
      const v = this._priceAt(sg.a, c.pStart, c.pWechsel, c.vAlt, c.v);
      const k = b == null ? null : (b * ap) / 100 + (gp * tage) / 365, vg = e == null ? null : (e * v) / 100;
      sum.b += b || 0; sum.bP += bP || 0; sum.e += e || 0; sum.eP += eP || 0; sum.k += k || 0; sum.v += vg || 0;
      const partial = sg.a.getDate() !== 1;
      const lbl = `${MON[sg.a.getMonth()]} ${String(sg.a.getFullYear()).slice(2)}${partial ? ` <span class="note">ab ${sg.a.getDate()}.</span>` : ""}${cur ? ` <span class="note">bis heute</span>` : ""}`;
      return { lbl, cur, b, bP, e, eP, k, vg };
    });
    const net = (r) => (r.k == null || r.vg == null ? null : r.vg - r.k);
    if (compact) {
      const body = rows.map((r) => `<tr class="${r.cur ? "cur" : ""}"><td>${r.lbl}</td>
        <td>${fmt(r.b, kwhD(r.b))}<span class="d">${this._pctCell(r.b, r.bP, true)}</span></td>
        <td>${fmt(r.e, kwhD(r.e))}<span class="d">${this._pctCell(r.e, r.eP, false)}</span></td>
        <td><b class="${this._cls(net(r))}">${this._signed(net(r), 0)}</b></td></tr>`).join("");
      return `<div class="title"><ha-icon icon="mdi:calendar-month"></ha-icon>Abrechnungsjahr ${dshort(c.bStart)}</div>
        <table><tr><th>Monat</th><th>Bezug</th><th>Einsp.</th><th>Netto</th></tr>${body}
        <tr class="sum"><td>Summe</td><td>${fmt(sum.b, kwhD(sum.b))}<span class="d">${this._pctCell(sum.b, sum.bP, true)}</span></td>
        <td>${fmt(sum.e, 0)}<span class="d">${this._pctCell(sum.e, sum.eP, false)}</span></td><td>${this._signed(sum.v - sum.k, 0)}</td></tr></table>
        <div class="sub">kWh · % = gleicher Zeitraum Vorjahr · Netto = Vergütung − Kosten (inkl. Grundpreis)</div>`;
    }
    const body = rows.map((r) => `<tr class="${r.cur ? "cur" : ""}"><td>${r.lbl}</td>
      <td>${fmt(r.b, kwhD(r.b))}</td><td>${this._pctCell(r.b, r.bP, true)}</td><td>${eur(r.k)}</td>
      <td>${fmt(r.e, kwhD(r.e))}</td><td>${this._pctCell(r.e, r.eP, false)}</td><td>${eur(r.vg)}</td>
      <td><b class="${this._cls(net(r))}">${this._signed(net(r))}</b></td></tr>`).join("");
    return `<div class="title"><ha-icon icon="mdi:calendar-month"></ha-icon>Abrechnungsjahr ${dshort(c.bStart)} – ${dshort(c.bEnd)} · Monate</div>
      <div class="scroll"><table>
        <tr><th></th><th class="grp" colspan="3">Bezug 180</th><th class="grp" colspan="3">Einspeisung 280</th><th></th></tr>
        <tr><th>Monat</th><th>kWh</th><th>Δ Vorjahr</th><th>Kosten</th><th>kWh</th><th>Δ Vorjahr</th><th>Vergütung</th><th>Netto</th></tr>
        ${body}
        <tr class="sum"><td>Summe</td><td>${fmt(sum.b, kwhD(sum.b))}</td><td>${this._pctCell(sum.b, sum.bP, true)}</td><td>${eur(sum.k)}</td>
          <td>${fmt(sum.e, 0)}</td><td>${this._pctCell(sum.e, sum.eP, false)}</td><td>${eur(sum.v)}</td><td>${this._signed(sum.v - sum.k)}</td></tr>
      </table></div>
      <div class="sub">Kosten inkl. anteiligem Grundpreis · Δ = gleicher Zeitraum im Vorjahr (laufender Monat bis zum gleichen Tag) · Netto = Vergütung − Kosten</div>`;
  }
}
class VJahre extends VBase {
  part(s, c, compact) {
    const n = Math.max(1, Math.min(6, parseInt(this._config.jahre, 10) || 3));
    const hist = Array.isArray(this._config.historie) ? this._config.historie : [];
    const histFor = (start) => hist.find((h) => { const v = parseDate(String(h.von || "")); return v && Math.abs(v - start) < 3 * DAY; });
    const fE = this._forecast(s, c, c.bEnd), years = [];
    for (let i = n; i >= 0; i--) {
      const a = addYears(c.bStart, -i), bExcl = addYears(c.bStart, -i + 1), cur = i === 0, t1 = cur ? c.now : bExcl.getTime();
      const b = diff(s.b, a.getTime(), t1), e = diff(s.e, a.getTime(), t1);
      const pa = addYears(a, -1).getTime(), pt1 = cur ? c.now - 365 * DAY : a.getTime();
      years.push({ a, cur, b, e, bP: diff(s.b, pa, pt1), eP: diff(s.e, pa, pt1), h: histFor(a) });
    }
    const lbl = (y) => `${String(y.a.getFullYear()).slice(2)}/${String(y.a.getFullYear() + 1).slice(2)}`;
    const kostenCell = (y) => (y.cur ? eur(this._num(H.s_b_kosten), 0) + ' <span class="note">bisher</span>' : y.h && y.h.kosten != null ? eur(+y.h.kosten, 0) : "–");
    const abCell = (y) => (y.cur ? eur(this._num(H.s_b_ab), 0) + ' <span class="note">bisher</span>' : y.h && y.h.abschlaege != null ? eur(+y.h.abschlaege, 0) : "–");
    const ergCell = (y) => {
      if (y.cur) return fE && fE.bez ? `<b class="${this._cls(fE.bez.saldo)}">${this._signed(fE.bez.saldo, 0)}</b> <span class="note">Prognose</span>` : "–";
      if (!y.h || y.h.saldo == null) return "–";
      return `<b class="${this._cls(+y.h.saldo)}">${this._signed(+y.h.saldo, 0)}</b>${y.h.vorlaeufig ? ' <span class="note">vorl.</span>' : ""}`;
    };
    const apCell = (y) => (y.cur ? `${fmt(c.ap, 2)}` : y.h && y.h.arbeitspreis_ct != null ? fmt(+y.h.arbeitspreis_ct, 2) : "–");
    const pvLine = fE && fE.pv ? `PV ${lbl(years[years.length - 1])}: EWE zahlt zum ${dtiny(c.bEnd)} voraussichtlich noch ${eur(fE.pv.saldo, 0)}` : "";
    if (compact) {
      const body = years.map((y) => `<tr class="${y.cur ? "cur" : ""}">
        <td><b>${lbl(y)}</b>${y.cur ? '<span class="d neutral">bis heute</span>' : ""}</td>
        <td>${fmt(y.b, 0)}<span class="d">${this._pctCell(y.b, y.bP, true)}</span></td>
        <td>${fmt(y.e, 0)}<span class="d">${this._pctCell(y.e, y.eP, false)}</span></td>
        <td>${ergCell(y)}</td></tr>`).join("");
      return `<div class="title"><ha-icon icon="mdi:table-large"></ha-icon>Abrechnungsjahre</div>
        <table><tr><th>Jahr</th><th>Bezug</th><th>Einsp.</th><th>Ergebnis</th></tr>${body}</table>
        <div class="sub">kWh · Ergebnis Bezug laut Rechnung (+ Guthaben / − Nachzahlung)${pvLine ? "<br>" + pvLine : ""}</div>`;
    }
    const body = years.map((y) => `<tr class="${y.cur ? "cur" : ""}">
      <td><b>${lbl(y)}</b> <span class="note">${dtiny(y.a)}</span></td>
      <td>${fmt(y.b, 0)}</td><td>${this._pctCell(y.b, y.bP, true)}</td>
      <td>${fmt(y.e, 0)}</td><td>${this._pctCell(y.e, y.eP, false)}</td>
      <td>${apCell(y)}</td><td>${kostenCell(y)}</td><td>${abCell(y)}</td><td>${ergCell(y)}</td></tr>`).join("");
    return `<div class="title"><ha-icon icon="mdi:table-large"></ha-icon>Abrechnungsjahre im Vergleich</div>
      <div class="scroll"><table>
        <tr><th></th><th class="grp" colspan="2">Bezug 180</th><th class="grp" colspan="2">Einspeisung 280</th><th class="grp" colspan="4">Stromrechnung</th></tr>
        <tr><th>Jahr</th><th>kWh</th><th>Δ</th><th>kWh</th><th>Δ</th><th>ct/kWh</th><th>Kosten</th><th>Abschläge</th><th>Ergebnis</th></tr>
        ${body}
      </table></div>
      <div class="sub">Abrechnungsjahr ${dtiny(c.bStart)}–${dtiny(c.bEnd)} · Δ laufendes Jahr = gleicher Stichtag Vorjahr · Rechnungswerte aus der Historie, + Guthaben / − Nachzahlung${pvLine ? " · " + pvLine : ""}</div>`;
  }
}

/* =================== eingabe: allgemeine Eingabeliste =================== */
const DOMICON = { input_number: "mdi:ray-vertex", input_datetime: "mdi:calendar-clock", input_select: "mdi:format-list-bulleted", input_boolean: "mdi:toggle-switch-outline",
  input_text: "mdi:form-textbox", counter: "mdi:counter", sensor: "mdi:gauge" };
const decOf = (step) => { const s = String(step ?? 1); return s.includes(".") ? s.split(".")[1].length : 0; };
class Eingabe {
  constructor(c, el) {
    this._config = { name: "", icon: "mdi:form-select", rows: [], ...(c || {}) };
    this.el = el;
    this.shadowRoot = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="glass"></div>`;
    this._built = false;
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver((e) => { const w = Math.round(e[0].contentRect.width); if (w > 0) this.shadowRoot.querySelector(".glass").classList.toggle("compact", w < COMPACT_W); });
      this._ro.observe(el);
    }
  }
  _ctl(r, i, s) {
    const dom = String(r.entity).split(".")[0], a = (s && s.attributes) || {};
    if (r.readonly || !s) return `<span data-v="${i}"></span>`;
    if (dom === "input_number") return `<input type="number" inputmode="decimal" data-i="${i}" min="${esc(a.min)}" max="${esc(a.max)}" step="${esc(a.step)}"><small>${esc(a.unit_of_measurement || "")}</small>`;
    if (dom === "input_datetime") return `<input type="${a.has_date && a.has_time ? "datetime-local" : a.has_time ? "time" : "date"}" data-i="${i}">`;
    if (dom === "input_select") return `<select data-i="${i}">${(a.options || []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>`;
    if (dom === "input_boolean") return `<input type="checkbox" data-i="${i}">`;
    if (dom === "input_text") return `<input type="text" data-i="${i}" maxlength="${esc(a.max || 255)}">`;
    return `<span data-v="${i}"></span>`;
  }
  _valueOf(dom, s) {
    const a = s.attributes;
    if (dom === "input_number") { const v = parseFloat(s.state); return isNaN(v) ? "" : v.toFixed(decOf(a.step)); }
    if (dom === "input_datetime") {
      if (a.has_date && a.has_time) return String(s.state).replace(" ", "T").slice(0, 16);
      if (a.has_time) return String(s.state).slice(0, 5);
      return String(s.state).slice(0, 10);
    }
    return s.state;
  }
  _commit(r, el) {
    const h = this._hass, s = h.states[r.entity], dom = String(r.entity).split(".")[0], a = (s && s.attributes) || {};
    let call;
    if (dom === "input_number") {
      const v = parseFloat(String(el.value).replace(",", "."));
      if (isNaN(v)) { el.classList.add("bad"); el.title = "keine Zahl"; return; }
      if (s && v === parseFloat(s.state)) return;
      call = ["input_number", "set_value", { value: v }];
    } else if (dom === "input_datetime") {
      if (!el.value) { el.classList.add("bad"); el.title = "leer"; return; }
      if (a.has_date && a.has_time) call = ["input_datetime", "set_datetime", { datetime: el.value.replace("T", " ") + (el.value.length === 16 ? ":00" : "") }];
      else if (a.has_time) call = ["input_datetime", "set_datetime", { time: el.value.length === 5 ? el.value + ":00" : el.value }];
      else call = ["input_datetime", "set_datetime", { date: el.value }];
    } else if (dom === "input_select") call = ["input_select", "select_option", { option: el.value }];
    else if (dom === "input_boolean") call = ["input_boolean", el.checked ? "turn_on" : "turn_off", {}];
    else if (dom === "input_text") call = ["input_text", "set_value", { value: el.value }];
    else return;
    el.classList.remove("bad", "ok");
    h.callService(call[0], call[1], { entity_id: r.entity, ...call[2] })
      .then(() => { el.classList.add("ok"); el.title = "übernommen"; setTimeout(() => el.classList.remove("ok"), 2000); })
      .catch((e) => { el.classList.add("bad"); el.title = e.message || String(e); });
  }
  set hass(h) {
    this._hass = h;
    const box = this.shadowRoot.querySelector(".glass"), c = this._config, rows = c.rows || [];
    if (!this._built) {
      box.innerHTML = `${c.name ? `<div class="title"><ha-icon icon="${esc(c.icon)}"></ha-icon>${esc(c.name)}</div>` : ""}<div class="rows">${rows.map((r, i) => {
        if (!r || (!r.entity && r.label)) return `<div class="sec">${esc(r && r.label)}</div>`;
        const s = h.states[r.entity], dom = String(r.entity).split(".")[0];
        const icon = r.icon || (s && s.attributes.icon) || DOMICON[dom] || "mdi:information-outline";
        const name = r.name || (s && s.attributes.friendly_name) || r.entity;
        return `<div class="er"><ha-icon icon="${esc(icon)}"></ha-icon><span class="en" data-e="${esc(r.entity)}" title="${esc(r.entity)}">${esc(name)}</span><span class="ev">${this._ctl(r, i, s)}</span></div>`;
      }).join("")}</div>`;
      box.querySelectorAll("[data-i]").forEach((el) => {
        const r = rows[Number(el.dataset.i)];
        el.addEventListener("change", () => this._commit(r, el));
        if (el.tagName === "INPUT" && el.type !== "checkbox") el.addEventListener("keydown", (e) => { if (e.key === "Enter") el.blur(); });
        el.addEventListener("click", (e) => e.stopPropagation());
      });
      this._built = true;
    }
    const focused = this.shadowRoot.activeElement;
    rows.forEach((r, i) => {
      if (!r || !r.entity) return;
      const s = h.states[r.entity], dom = String(r.entity).split(".")[0];
      const ctl = box.querySelector(`[data-i="${i}"]`);
      if (ctl) {
        if (ctl === focused || !s) return;
        if (ctl.type === "checkbox") ctl.checked = s.state === "on";
        else ctl.value = this._valueOf(dom, s);
        return;
      }
      const vEl = box.querySelector(`[data-v="${i}"]`);
      if (!vEl) return;
      if (!s || s.state === "unavailable" || s.state === "unknown") { vEl.innerHTML = "–"; return; }
      const v = parseFloat(s.state), u = s.attributes.unit_of_measurement || "";
      if (isNaN(v) || /^\d{4}-\d{2}-\d{2}/.test(s.state)) { vEl.textContent = s.state; return; }
      const d = r.decimals != null ? Number(r.decimals) : s.attributes.step != null ? decOf(s.attributes.step) : Math.min(3, (String(s.state).split(".")[1] || "").length);
      vEl.innerHTML = `${fmt(v, d)}${u ? ` <small>${esc(u)}</small>` : ""}`;
    });
  }
}

/* ======================= Anmeldung beim Atlas ======================= */
const ENT = { entity: { domain: "sensor" } }, TXT = { text: {} }, ICON = { icon: {} }, OBJ = { object: {} };
const NUM = (min, max) => ({ number: { min, max, step: 1, mode: "box" } });
const f = (name, label, selector) => ({ name, label, selector });
const SE = [f("bezug", "Zähler Bezug (180)", ENT), f("einspeisung", "Zähler Einspeisung (280)", ENT)];
const LIST = [
  ["strom-jahr-kpi", JahrKpi, "Strom Jahr: Kennzahlen", SE],
  ["strom-jahr-monate", JahrMonate, "Strom Jahr: Monate", [f("metric", "Zähler", { select: { mode: "dropdown", options: [{ value: "bezug", label: "Bezug 1.8.0" }, { value: "einspeisung", label: "Einspeisung 2.8.0" }] } }), ...SE]],
  ["strom-jahr-jahre", JahrJahre, "Strom Jahr: Jahressummen", SE],
  ["vertrag-saldo", VSaldo, "Vertrag: Saldo & Hochrechnung", SE],
  ["vertrag-monate", VMonate, "Vertrag: Monate", SE],
  ["vertrag-jahre", VJahre, "Vertrag: Abrechnungsjahre", [...SE, f("jahre", "Vorjahre", NUM(1, 6)),
    f("historie", "Rechnungs-Historie (YAML: zeitraum, von, kwh, arbeitspreis_ct, grundpreis_jahr, kosten, abschlaege, saldo, vorlaeufig)", OBJ)]],
  ["eingabe", Eingabe, "Eingabeliste (Helfer)", [f("name", "Titel", TXT), f("icon", "Icon", ICON),
    f("rows", "Zeilen (YAML: - entity, name, icon, decimals, readonly  |  - label: Abschnitt)", OBJ)]],
];
for (const [type, K, label, fields] of LIST) {
  REG.modules[type] = K;
  REG.editors[type] = { label, fields, blank: () => ({ type, ...(type === "eingabe" ? { name: "Eingaben", rows: [] } : {}) }) };
}
REG.ver = (REG.ver || 0) + 1;

customElements.whenDefined("energie-atlas").then(() => {
  const P = customElements.get("energie-atlas").prototype;
  if (P.__regHook) return;
  const d = Object.getOwnPropertyDescriptor(P, "hass");
  if (!d || !d.set) return;
  P.__regHook = true;
  Object.defineProperty(P, "hass", {
    configurable: true,
    get: d.get,
    set(h) {
      const v = REG.ver || 0;
      if (this._config && this._regV !== v) {
        this._regV = v;
        if ((this._config.modules || []).some((m) => m && REG.modules[m.type])) { this._hass = h; this._build(); return; }
      }
      d.set.call(this, h);
    },
  });
});
})();

/* ===== energie-atlas-solar ===== */
/* energie-atlas-solar – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const C = { solar: "#e0a000", sun: "#f5b400", import: "#b22222", export: "#228b22", batt: "#1e6fd9", dis: "#e07000", home: "#000080", soc: "#7b3fb5" };
const COMPACT_W = 560;

const num = (hass, id) => {
  const s = hass && id && hass.states[id];
  if (!s) return null;
  const v = parseFloat(s.state);
  return isNaN(v) ? null : v;
};
const sumPow = (hass, list) => {
  if (!list) return null;
  let t = 0, ok = false;
  for (const [id, f] of list) { const v = num(hass, id); if (v != null) { t += v * (f == null ? 1 : f); ok = true; } }
  return ok ? t : null;
};
const fmtN = (v, d = 0) =>
  v == null || isNaN(v) ? "–" : v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtW = (v, signed = false) => {
  if (v == null || isNaN(v)) return "–";
  const a = signed ? v : Math.abs(v);
  const s = signed && a > 0 ? "+" : "";
  return Math.abs(a) >= 1200 ? `${s}${fmtN(a / 1000, 2)} kW` : `${s}${fmtN(a, 0)} W`;
};
const fmtKwh = (v) => (v == null ? "–" : fmtN(v, v < 10 ? 2 : v < 100 ? 1 : 0));
const hhmm = (d) => (d ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–");
const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const socColor = (p) => (p == null ? "#888" : p >= 60 ? "#2e9d3a" : p >= 30 ? "#e0a000" : "#c0392b");
const dur = (ms) => {
  const m = Math.max(0, Math.round(ms / 60e3));
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60);
  if (hh < 24) return `${hh} h ${String(m % 60).padStart(2, "0")} min`;
  return `${Math.floor(hh / 24)} d ${hh % 24} h`;
};
const when = (t) => {
  const d = new Date(t), a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  const dd = Math.round((b - a) / 864e5), hm = hhmm(d);
  return dd === 0 ? hm : dd === 1 ? `morgen ${hm}` : dd === -1 ? `gestern ${hm}` : `${d.getDate()}.${d.getMonth() + 1}. ${hm}`;
};
// Mondhoehe in Grad (vereinfachter SunCalc-Rechenweg, ~1 Grad genau)
const moonAlt = (date, lat, lng) => {
  const r = Math.PI / 180, e = r * 23.4397, d = date.valueOf() / 864e5 - 0.5 + 2440588 - 2451545;
  const L = r * (218.316 + 13.176396 * d), M = r * (134.963 + 13.064993 * d), F = r * (93.272 + 13.22935 * d);
  const l = L + r * 6.289 * Math.sin(M), b = r * 5.128 * Math.sin(F);
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  const H = r * (280.16 + 360.9856235 * d) + r * lng - ra, phi = r * lat;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / r;
};

const BASE_CSS = `
  :host { display:block; }
  .glass { color: #000; box-sizing: border-box;
    font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
  .title { display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:600; margin-bottom:10px; }
  .title ha-icon { --mdc-icon-size: 20px; color:#000080; }
  .title .tv { margin-left:auto; font-weight:700; }
  .title.split { justify-content:flex-start; }
  .sub { font-size:11px; opacity:.6; text-align:center; margin-top:6px; }
  .inner { background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.10); border-radius:12px; }
  .num { font-variant-numeric: tabular-nums; }
  .err { color:#a11a1a; font-size:13px; }
  .load { opacity:.6; font-size:13px; text-align:center; padding:12px; }
  .kl { font-size:12px; opacity:.72; }
  .kv { font-size:18px; font-weight:700; }
  svg text { fill:#000; font-size:11px; }
  .tip { position:absolute; pointer-events:none; background: rgba(255,255,255,0.88); border:1px solid rgba(0,0,0,0.1);
    border-radius:8px; padding:6px 8px; font-size:12px; white-space:nowrap; display:none; box-shadow:0 4px 14px rgba(0,0,0,0.15); z-index:2; }
  .tip b { display:block; margin-bottom:2px; }
  .tip i { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
  .legend { display:flex; justify-content:center; gap:14px; flex-wrap:wrap; font-size:12px; margin-top:6px; }
  .legend span { display:inline-flex; align-items:center; gap:6px; }
  .legend i { width:12px; height:4px; border-radius:2px; display:inline-block; }
  .bidi { position:relative; height:6px; border-radius:3px; background: rgba(0,0,0,0.08); overflow:hidden; }
  .bidi::after { content:""; position:absolute; left:50%; top:-2px; bottom:-2px; width:1px; background: rgba(0,0,0,0.35); }
  .bidi i { position:absolute; top:0; bottom:0; border-radius:3px; transition: all .6s; }
`;

class SlcBase {
  constructor(c, el) {
    this.el = el;
    this._config = JSON.parse(JSON.stringify({ ...(this.constructor.defaults || {}), ...(c || {}) }));
    this.shadowRoot = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}${this.constructor.css || ""}</style><div class="glass"><div class="load">Lade…</div></div>`;
    this._dirty = true; this._at = 0;
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver((e) => {
        const w = Math.round(e[0].contentRect.width);
        if (w > 0 && Math.abs(w - (this._w || 0)) > 12) { this._w = w; this._dirty = true; this._resized = true; this._update(true); }
      });
      this._ro.observe(el);
    }
  }
  set hass(h) {
    if (!this.el.isConnected && this._seen) { if (this._ro) this._ro.disconnect(); return; }
    if (this.el.isConnected) this._seen = true;
    this._hass = h; if (!this._last || Date.now() - this._last > (this.constructor.throttle || 2000)) this._update(false);
  }
  _compact() { return (this._w || this.el.clientWidth || 800) < COMPACT_W; }
  get box() { return this.shadowRoot.querySelector(".glass"); }
  $(id) { return this.shadowRoot.getElementById(id); }
  _update(force) {
    if (!this._hass || !this.shadowRoot) return;
    this._last = Date.now();
    this.box.classList.toggle("compact", this._compact());
    this.update(force);
  }
  async _stats(ids, start, period, types, end) {
    return this._hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: start.toISOString(), end_time: (end || new Date()).toISOString(),
      statistic_ids: ids, period, types,
    });
  }
}

/* ---------------- slc-sun: Sonnenbogen + Kennzahlen ---------------- */
class SlcSun extends SlcBase {
  static get defaults() {
    return {
      solar: "",
      sun: "sun.sun",
      kwp: 22,
      gauge_max: 10000,
      pv_min: 20,
      grid: "",
      storage_net: "",
      storage_out_extra: ["", "", ""],
      storage_max: 5000,
      today: "",
      week: "",
      export_today: "",
      autarky: "",
      selfuse: "",
      status: "",
      share_solar: "",
      share_batt: "",
      share_grid: "",
    };
  }
  static get throttle() { return 1500; }
  static get css() {
    return `
    .hero { display:grid; grid-template-columns: 1fr 1fr; gap:14px; align-items:stretch; }
    .compact .hero { grid-template-columns: 1fr; gap:10px; }
    .arcbox { position:relative; padding:6px 6px 10px; display:flex; flex-direction:column; justify-content:center; }
    .arcbox .arcin { position:relative; width:100%; max-width:440px; margin:0 auto; }
    .arcbox svg { width:100%; height:auto; display:block; overflow:visible; }
    .center { position:absolute; left:0; right:0; bottom:4%; text-align:center; pointer-events:none; }
    .big { font-size:40px; font-weight:800; letter-spacing:-0.5px; line-height:1.05; }
    .compact .big { font-size:32px; }
    .bl { font-size:13px; opacity:.75; margin-top:2px; }
    .util { display:inline-block; margin-top:6px; font-size:12px; padding:2px 10px; border-radius:10px; background: rgba(224,160,0,0.18); }
    .times { display:flex; justify-content:space-between; font-size:12px; padding:0 4px; margin:4px auto 0; width:100%; max-width:470px; box-sizing:border-box; }
    .times span { display:inline-flex; align-items:center; gap:4px; }
    .times ha-icon { --mdc-icon-size:16px; color:${C.solar}; }
    .side { display:flex; flex-direction:column; gap:10px; }
    .status { padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .status .st { font-size:17px; font-weight:700; }
    .mix { padding:10px 12px; }
    .mixbar { display:flex; height:12px; border-radius:6px; overflow:hidden; background: rgba(0,0,0,0.08); margin:6px 0 6px; }
    .mixbar i { display:block; height:100%; transition: width .6s; }
    .mixl { display:flex; justify-content:space-between; font-size:12px; }
    .mixl span { display:inline-flex; align-items:center; gap:5px; }
    .mixl b { width:8px; height:8px; border-radius:50%; display:inline-block; }
    .kpis { display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
    .kpi { padding:10px 12px; display:flex; align-items:center; gap:10px; }
    .ring { width:42px; height:42px; border-radius:50%; flex:none; display:flex; align-items:center; justify-content:center;
      background: conic-gradient(var(--c) calc(var(--p) * 1%), rgba(0,0,0,0.08) 0); position:relative; transition: all .6s; }
    .ring::after { content:""; width:32px; height:32px; border-radius:50%; background: rgba(255,255,255,0.75); position:absolute; }
    .ring ha-icon { position:relative; z-index:1; --mdc-icon-size:18px; color: var(--c); }
    .ico { width:42px; height:42px; border-radius:50%; flex:none; display:flex; align-items:center; justify-content:center; background: rgba(255,255,255,0.55); }
    .ico ha-icon { --mdc-icon-size:22px; color: var(--c); }
    .kpi .kl small { opacity:.8; }
    @keyframes slcpulse { 0%,100% { opacity:.55 } 50% { opacity:.95 } }
    .halo { animation: slcpulse 3.5s ease-in-out infinite; }
    `;
  }
  _build() {
    this.box.innerHTML = `
      <div class="hero">
        <div class="inner arcbox"><div class="arcin">
          <svg viewBox="0 0 300 156" id="svg">
            <defs>
              <linearGradient id="g-arc" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stop-color="#f7c948"/><stop offset=".5" stop-color="${C.sun}"/><stop offset="1" stop-color="#e86a1c"/>
              </linearGradient>
              <radialGradient id="g-sun"><stop offset="0" stop-color="#fff6c8"/><stop offset=".45" stop-color="${C.sun}"/><stop offset="1" stop-color="${C.sun}" stop-opacity="0"/></radialGradient>
              <radialGradient id="g-moon"><stop offset="0" stop-color="#eef3ff"/><stop offset=".4" stop-color="#c9d6f5" stop-opacity=".7"/><stop offset="1" stop-color="#9fb3d9" stop-opacity="0"/></radialGradient>
              <linearGradient id="g-night" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stop-color="#5b6d99"/><stop offset=".5" stop-color="#9fb3d9"/><stop offset="1" stop-color="#c9d6f5"/>
              </linearGradient>
              <clipPath id="mclip"><circle r="9"/></clipPath>
              <linearGradient id="g-gauge" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stop-color="#ffe08a"/><stop offset=".6" stop-color="${C.solar}"/><stop offset="1" stop-color="#e86a1c"/>
              </linearGradient>
              <linearGradient id="g-batt" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stop-color="#b7d3ff"/><stop offset=".6" stop-color="#4a8fe6"/><stop offset="1" stop-color="${C.batt}"/>
              </linearGradient>
              <linearGradient id="g-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stop-color="${C.sun}" stop-opacity=".28"/><stop offset="1" stop-color="${C.sun}" stop-opacity="0"/>
              </linearGradient>
            </defs>
            <line x1="6" x2="294" y1="150" y2="150" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>
            <path d="M20 150 A130 130 0 0 1 280 150" fill="none" stroke="rgba(0,0,0,0.15)" stroke-width="2" stroke-dasharray="2 5"/>
            <path id="fillarea" d="" fill="url(#g-fill)"/>
            <path d="M44 150 A106 106 0 0 1 256 150" fill="none" stroke="rgba(0,0,0,0.08)" stroke-width="9" stroke-linecap="round"/>
            <path id="gauge" d="M44 150 A106 106 0 0 1 256 150" pathLength="100" fill="none" stroke="url(#g-gauge)" stroke-width="9" stroke-linecap="round" stroke-dasharray="0 100" style="transition: stroke-dasharray .8s"/>
            <text x="60" y="146" style="font-size:8px;opacity:.55">0</text>
            <text x="240" y="146" text-anchor="end" style="font-size:8px;opacity:.55" id="gmax">10 kW</text>
            <path id="prog" d="M20 150 A130 130 0 0 1 280 150" pathLength="100" fill="none" stroke="url(#g-arc)" stroke-width="5" stroke-linecap="round" stroke-dasharray="0 100"/>
            <g id="moon" style="display:none">
              <circle class="halo" r="22" fill="url(#g-moon)"/>
              <circle r="9" fill="#f6f2dc" stroke="#fff" stroke-width="1.5"/>
              <circle id="mshadow" r="9.6" cx="0" fill="#26304a" fill-opacity=".82" clip-path="url(#mclip)"/>
            </g>
            <g id="sun" style="display:none">
              <circle class="halo" id="sun-h" r="26" fill="url(#g-sun)"/>
              <circle id="sun-c" r="9" fill="${C.sun}" stroke="#fff" stroke-width="2"/>
            </g>
          </svg>
          <div class="center">
            <div class="big num" id="pv">–</div>
            <div class="bl" id="pvl">Solar jetzt</div>
            <div class="util num" id="util">–</div>
          </div></div>
          <div class="times">
            <span><ha-icon id="ic-l" icon="mdi:weather-sunset-up"></ha-icon><b class="num" id="rise">–</b></span>
            <span class="num" id="dayl" style="opacity:.75">–</span>
            <span><b class="num" id="set">–</b><ha-icon id="ic-r" icon="mdi:weather-sunset-down"></ha-icon></span>
          </div>
        </div>
        <div class="side">
          <div class="inner status"><span class="st" id="st">–</span><span class="kl" id="stx"></span></div>
          <div class="inner mix">
            <div class="kl">Deckung Hausverbrauch jetzt</div>
            <div class="mixbar"><i id="m-s" style="background:${C.solar}"></i><i id="m-b" style="background:${C.batt}"></i><i id="m-g" style="background:${C.import}"></i></div>
            <div class="mixl">
              <span><b style="background:${C.solar}"></b>Solar <span class="num" id="t-s">–</span></span>
              <span><b style="background:${C.batt}"></b>Speicher <span class="num" id="t-b">–</span></span>
              <span><b style="background:${C.import}"></b>Netz <span class="num" id="t-g">–</span></span>
            </div>
          </div>
          <div class="kpis">
            <div class="inner kpi"><div class="ring" id="r-aut" style="--c:${C.export};--p:0"><ha-icon icon="mdi:shield-home"></ha-icon></div>
              <div><div class="kv num" id="k-aut">–</div><div class="kl">Autarkie heute</div></div></div>
            <div class="inner kpi"><div class="ring" id="r-eig" style="--c:${C.solar};--p:0"><ha-icon icon="mdi:recycle"></ha-icon></div>
              <div><div class="kv num" id="k-eig">–</div><div class="kl">Eigenverbrauch</div></div></div>
            <div class="inner kpi"><div class="ico" style="--c:${C.solar}"><ha-icon icon="mdi:white-balance-sunny"></ha-icon></div>
              <div><div class="kv num" id="k-pv">–</div><div class="kl">PV heute</div></div></div>
            <div class="inner kpi"><div class="ico" style="--c:#e86a1c"><ha-icon icon="mdi:summit"></ha-icon></div>
              <div><div class="kv num" id="k-peak">–</div><div class="kl" id="k-peakt">Spitze heute</div></div></div>
            <div class="inner kpi"><div class="ico" style="--c:${C.export}"><ha-icon icon="mdi:transmission-tower-export"></ha-icon></div>
              <div><div class="kv num" id="k-exp">–</div><div class="kl">Einspeisung heute</div></div></div>
            <div class="inner kpi"><div class="ico" style="--c:${C.solar}"><ha-icon icon="mdi:calendar-week"></ha-icon></div>
              <div><div class="kv num" id="k-week">–</div><div class="kl">PV 7 Tage</div></div></div>
          </div>
        </div>
      </div>`;
    this._dirty = false;
  }
  async _fetchPeak() {
    if (this._pl) return;
    this._pl = true;
    try {
      const res = await this._stats([this._config.solar], midnight(), "5minute", ["max"]);
      let mx = null, t = null;
      for (const r of res[this._config.solar] || []) if (r.max != null && (mx == null || r.max > mx)) { mx = r.max; t = new Date(r.start); }
      this._peak = { v: mx, t };
      this._pat = Date.now();
    } catch (e) { this._peak = null; }
    finally { this._pl = false; }
  }
  _sunTimes() {
    const s = this._hass.states[this._config.sun];
    if (!s) return null;
    const now = new Date();
    const today = (iso) => {
      if (!iso) return null;
      let d = new Date(iso);
      for (let i = 0; i < 2 && d.toDateString() !== now.toDateString() && d > now; i++) d = new Date(d.getTime() - 864e5);
      return d;
    };
    return { rise: today(s.attributes.next_rising), set: today(s.attributes.next_setting), nextRise: s.attributes.next_rising ? new Date(s.attributes.next_rising) : null, elev: s.attributes.elevation };
  }
  update() {
    if (this._dirty) this._build();
    const h = this._hass, c = this._config, $ = (id) => this.$(id);
    if (!this._pat || Date.now() - this._pat > 5 * 60e3) this._fetchPeak();
    const pvRaw = num(h, c.solar), pv = Math.max(0, Math.abs(pvRaw || 0));
    const gm = c.gauge_max || (c.kwp || 10) * 1000;
    const kw = (w) => fmtN(w / 1000, w % 1000 ? 1 : 0) + " kW";
    // PV aus -> Nachtmodus: gross = Netz, Tacho = Speicherausgabe
    const pvOff = pvRaw != null && pv < (c.pv_min || 20);
    let lbl = "Solar jetzt";
    if (pvOff) {
      const grid = num(h, c.grid) || 0;
      const out = Math.max(0, -(num(h, c.storage_net) || 0)) + (c.storage_out_extra || []).reduce((a, id) => a + Math.max(0, num(h, id) || 0), 0);
      const sm = c.storage_max || 5000, sp = Math.min(100, (out / sm) * 100);
      $("pv").textContent = fmtW(grid);
      lbl = grid > 15 ? "Netzbezug" : grid < -15 ? "Einspeisung" : "Netz ausgeglichen";
      $("gauge").setAttribute("stroke", "url(#g-batt)");
      $("gauge").setAttribute("stroke-dasharray", `${sp.toFixed(1)} 100`);
      $("gauge").style.opacity = sp < 0.5 ? "0" : "1";
      $("gmax").textContent = kw(sm);
      $("util").textContent = `Speicher ${fmtW(out)} · ${fmtN(sp, 0)} %`;
      $("util").style.background = "rgba(30,111,217,0.16)";
    } else {
      const gp = Math.min(100, (pv / gm) * 100);
      $("pv").textContent = pvRaw == null ? "–" : fmtW(pv);
      $("gauge").setAttribute("stroke", "url(#g-gauge)");
      $("gauge").setAttribute("stroke-dasharray", `${gp.toFixed(1)} 100`);
      $("gauge").style.opacity = gp < 0.5 ? "0" : "1";
      $("gmax").textContent = kw(gm);
      $("util").textContent = `${fmtN(gp, 0)} % von ${kw(gm)}` + (c.kwp ? ` · ${fmtN(c.kwp, 0)} kWp` : "");
      $("util").style.background = "";
    }

    const st = this._sunTimes(), now = new Date();
    const sunG = $("sun"), prog = $("prog");
    if (st && st.rise && st.set) {
      const hm = (m) => { m = Math.max(0, Math.round(m)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
      const moonG = $("moon");
      let f = (now - st.rise) / (st.set - st.rise);
      const up = f > 0 && f < 1;
      if (up) {
        const left = Math.round((st.set - now) / 60e3);
        $("rise").textContent = hhmm(st.rise);
        $("set").textContent = hhmm(st.set);
        $("ic-l").setAttribute("icon", "mdi:weather-sunset-up");
        $("ic-r").setAttribute("icon", "mdi:weather-sunset-down");
        $("dayl").textContent = `noch ${hm(left)} h Sonne`;
        prog.setAttribute("stroke", "url(#g-arc)");
        prog.setAttribute("stroke-dasharray", `${(f * 100).toFixed(2)} 100`);
        const x = 150 - 130 * Math.cos(Math.PI * f), y = 150 - 130 * Math.sin(Math.PI * f);
        moonG.style.display = "none";
        sunG.style.display = "";
        sunG.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
        const k = Math.min(1, pv / gm);
        $("sun-h").setAttribute("r", (18 + 16 * k).toFixed(1));
        const steps = 30; let d = "M20 150 ";
        for (let i = 1; i <= steps; i++) { const a = Math.PI * f * (i / steps); d += `L${(150 - 130 * Math.cos(a)).toFixed(1)} ${(150 - 130 * Math.sin(a)).toFixed(1)} `; }
        d += `L${x.toFixed(1)} 150 Z`;
        $("fillarea").setAttribute("d", d);
        $("pvl").textContent = lbl;
      } else {
        // Nacht: Mond läuft vom Sonnenuntergang bis zum nächsten Sonnenaufgang
        const nStart = now >= st.set ? st.set : new Date(st.set.getTime() - 864e5);
        const nEnd = now >= st.set ? (st.nextRise || new Date(st.rise.getTime() + 864e5)) : st.rise;
        const g = Math.max(0, Math.min(1, (now - nStart) / (nEnd - nStart)));
        $("rise").textContent = hhmm(nStart);
        $("set").textContent = hhmm(nEnd);
        $("ic-l").setAttribute("icon", "mdi:weather-sunset-down");
        $("ic-r").setAttribute("icon", "mdi:weather-sunset-up");
        $("dayl").textContent = `noch ${hm((nEnd - now) / 60e3)} h bis Sonnenaufgang`;
        prog.setAttribute("stroke", "url(#g-night)");
        prog.setAttribute("stroke-dasharray", `${(g * 100).toFixed(2)} 100`);
        const x = 150 - 130 * Math.cos(Math.PI * g), y = 150 - 130 * Math.sin(Math.PI * g);
        sunG.style.display = "none";
        moonG.style.display = "";
        moonG.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
        // Mondphase (synodischer Monat, Referenz-Neumond 06.01.2000 18:14 UTC)
        const syn = 29.530588853;
        let p = ((now - Date.UTC(2000, 0, 6, 18, 14)) / 864e5 / syn) % 1;
        if (p < 0) p += 1;
        const off = 18 * (p < 0.5 ? p * 2 : (1 - p) * 2);
        $("mshadow").setAttribute("cx", (p < 0.5 ? -off : off).toFixed(2));
        const ill = Math.round(((1 - Math.cos(2 * Math.PI * p)) / 2) * 100);
        const ph = p < 0.03 || p > 0.97 ? "Neumond" : p < 0.22 ? "Zunehmende Sichel" : p < 0.28 ? "Erstes Viertel"
          : p < 0.47 ? "Zunehmender Mond" : p < 0.53 ? "Vollmond" : p < 0.72 ? "Abnehmender Mond" : p < 0.78 ? "Letztes Viertel" : "Abnehmende Sichel";
        $("fillarea").setAttribute("d", "");
        $("pvl").textContent = `${lbl} · ${ph} ${ill} %`;
      }
    }

    const stt = h.states[c.status] ? h.states[c.status].state : "–";
    $("st").textContent = stt;
    $("st").style.color = /Einspeis|Solar/i.test(stt) ? "#1b6b1b" : /Batterie|Akku|Speicher/i.test(stt) ? C.batt : /Netz/i.test(stt) ? "#0077aa" : "#555";
    {
      let tx = "";
      if (st && st.elev != null && st.elev >= 0) tx = `Sonnenhöhe ${fmtN(st.elev, 0)}°`;
      else if (h.config && h.config.latitude != null) {
        const n = new Date(), ma = moonAlt(n, h.config.latitude, h.config.longitude), mb = moonAlt(new Date(n.getTime() + 6e5), h.config.latitude, h.config.longitude);
        const pf = mb > ma ? "↑" : "↓";
        tx = ma > 0 ? `Mondhöhe ${fmtN(ma, 0)}° ${pf}` : `Mond unter Horizont ${pf}`;
      } else if (st && st.elev != null) tx = `Sonnenhöhe ${fmtN(st.elev, 0)}°`;
      $("stx").textContent = tx;
    }

    const ss = Math.max(0, num(h, c.share_solar) || 0), sb = Math.max(0, num(h, c.share_batt) || 0), sg = Math.max(0, num(h, c.share_grid) || 0);
    const tot = ss + sb + sg || 1;
    $("m-s").style.width = (ss / tot) * 100 + "%";
    $("m-b").style.width = (sb / tot) * 100 + "%";
    $("m-g").style.width = (sg / tot) * 100 + "%";
    $("t-s").textContent = fmtN(ss, 0) + " %";
    $("t-b").textContent = fmtN(sb, 0) + " %";
    $("t-g").textContent = fmtN(sg, 0) + " %";

    const aut = num(h, c.autarky), eig = num(h, c.selfuse);
    $("k-aut").textContent = aut == null ? "–" : fmtN(aut, 0) + " %";
    $("r-aut").style.setProperty("--p", aut || 0);
    $("k-eig").textContent = eig == null ? "–" : fmtN(eig, 0) + " %";
    $("r-eig").style.setProperty("--p", eig || 0);
    $("k-pv").textContent = fmtKwh(num(h, c.today)) + " kWh";
    $("k-exp").textContent = fmtKwh(num(h, c.export_today)) + " kWh";
    $("k-week").textContent = fmtKwh(num(h, c.week)) + " kWh";
    if (this._peak && this._peak.v != null) {
      const pk = Math.max(this._peak.v, pv);
      $("k-peak").textContent = fmtW(pk);
      $("k-peakt").textContent = `Spitze heute · ${hhmm(pk > this._peak.v ? now : this._peak.t)}`;
    }
  }
  getCardSize() { return 6; }
}

/* ---------------- slc-storage: Speicherpark ---------------- */
class SlcStorage extends SlcBase {
  static get defaults() {
    return {
      max_w: 3000,
      total_kwh: "",
      combined_soc: "",
      big: [
        { name: "Sigenergy", icon: "mdi:home-battery", soc: "",
          power: [["", 1000]], capacity_kwh: 6.0, soc_min: 10, soc_max: 100 },
        { name: "Speicher 2", icon: "mdi:home-battery-outline", soc: "",
          power: [["", -1]], energy: "", soc_min: 12, soc_max: 93, eta_tol: 0, eta_min_delta: 1 },
      ],
      small: [
        { name: "SP1", soc: "", energy: "", energy_factor: 0.001,
          power: [["", 1], ["", 1], ["", -1]] },
        { name: "SP2", soc: "", energy: "", energy_factor: 0.001,
          power: [["", 1], ["", 1], ["", -1]] },
        { name: "SP3", soc: "", energy: "", energy_factor: 0.001,
          power: [["", 1], ["", 1], ["", -1]] },
      ],
    };
  }
  static get throttle() { return 2000; }
  static get css() {
    return `
    .bigs { display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
    .compact .bigs { grid-template-columns: 1fr; }
    .bt { padding:12px; display:grid; grid-template-columns: 54px 1fr; gap:12px; align-items:center; }
    .cell { position:relative; width:46px; height:86px; border:2px solid rgba(0,0,0,0.55); border-radius:9px; padding:3px; box-sizing:border-box; margin-top:6px; background: rgba(255,255,255,0.35); }
    .cell::before { content:""; position:absolute; top:-7px; left:14px; width:14px; height:5px; border-radius:2px 2px 0 0; background: rgba(0,0,0,0.55); }
    .liq { position:absolute; left:3px; right:3px; bottom:3px; border-radius:5px; transition: height .8s, background .8s; overflow:hidden; }
    .liq::after { content:""; position:absolute; inset:0; background: linear-gradient(90deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 45%, rgba(255,255,255,0.18)); }
    .liq.chg::before { content:""; position:absolute; left:0; right:0; height:40%; background: linear-gradient(0deg, rgba(255,255,255,0), rgba(255,255,255,0.45), rgba(255,255,255,0));
      animation: slcrise 2.2s linear infinite; }
    .liq.dis::before { content:""; position:absolute; left:0; right:0; height:40%; background: linear-gradient(0deg, rgba(255,255,255,0), rgba(255,255,255,0.4), rgba(255,255,255,0));
      animation: slcfall 2.2s linear infinite; }
    @keyframes slcrise { from { top:100% } to { top:-40% } }
    @keyframes slcfall { from { top:-40% } to { top:100% } }
    .pct { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; color:#000; text-shadow: 0 0 4px rgba(255,255,255,0.9); }
    .bn { font-size:15px; font-weight:700; display:flex; align-items:center; gap:6px; }
    .bn ha-icon { --mdc-icon-size:18px; color:#000080; }
    .bp { font-size:22px; font-weight:800; margin:2px 0; }
    .bs { font-size:12px; opacity:.75; margin-bottom:6px; }
    .eta { display:flex; align-items:center; gap:5px; font-size:12px; font-weight:600; margin-top:7px; line-height:1.25; }
    .eta ha-icon { --mdc-icon-size:16px; flex:none; }
    .eta small { font-weight:400; opacity:.7; color:#000; }
    .sm .eta { font-size:11px; margin-top:6px; align-items:flex-start; }
    .sm .eta ha-icon { --mdc-icon-size:14px; }
    .sm .eta small { display:block; }
    .smalls { display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin-top:8px; }
    .sm { padding:8px 10px; }
    .sm .r1 { display:flex; justify-content:space-between; align-items:baseline; font-size:13px; }
    .sm .r1 b { font-size:15px; }
    .hb { height:8px; border-radius:4px; background: rgba(0,0,0,0.08); overflow:hidden; margin:5px 0; }
    .hb i { display:block; height:100%; border-radius:4px; transition: width .8s; }
    .sm .r2 { display:flex; justify-content:space-between; font-size:11px; opacity:.8; }
    .sum { margin-top:8px; padding:10px 12px; display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; align-items:end; }
    .compact .sum { grid-template-columns: 1fr 1fr; }
    .sum > div { display:flex; flex-direction:column; gap:2px; }
    .sum .wide { grid-column: 1 / -1; }
    `;
  }
  _calc(b) {
    const h = this._hass;
    const soc = num(h, b.soc);
    const p = sumPow(h, b.power);
    let e = b.energy ? num(h, b.energy) : null;
    if (e != null && b.energy_factor) e *= b.energy_factor;
    if (e == null && soc != null && b.capacity_kwh) e = (soc / 100) * b.capacity_kwh;
    return { soc, p, e };
  }
  async _fetchHist() {
    if (this._hl) return;
    const ids = [...(this._config.big || []), ...(this._config.small || [])].filter((b) => b.soc && b.soc_max != null && b.soc_min != null).map((b) => b.soc);
    if (!ids.length) return;
    this._hl = true;
    try {
      const hrs = this._config.eta_lookback_h || 48;
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: new Date(Date.now() - hrs * 3600e3).toISOString(),
        entity_ids: ids, minimal_response: true, no_attributes: true, significant_changes_only: false,
      });
      const out = {};
      for (const id of ids) {
        out[id] = (res[id] || []).map((x) => {
          const t = (x.lu != null ? x.lu : x.lc) * 1000, v = parseFloat(x.s);
          /* unavailable = Luecke (null), Ausreisser >100/<0 werden verworfen */
          return { t, v: isNaN(v) ? null : v, bad: !isNaN(v) && (v < 0 || v > 100) };
        }).filter((x) => !isNaN(x.t) && !x.bad);
      }
      this._hist = out; this._hErr = null;
    } catch (e) { this._hErr = e.message || String(e); }
    finally { this._hAt = Date.now(); this._hl = false; }
  }
  _eta(b, socNow, sm) {
    const mx = b.soc_max, mn = b.soc_min;
    if (mx == null || mn == null || !b.soc) return null;
    const N = { col: "#555", ic: "mdi:battery-clock-outline" };
    if (socNow == null || socNow < 0 || socNow > 100) return { ...N, txt: sm ? "kein gültiger SoC" : "Prognose: kein gültiger SoC" };
    if (!this._hist) return { ...N, txt: this._hErr ? "Prognose: Verlauf nicht lesbar" : "Prognose: lade Verlauf…" };
    const now = Date.now(), tol = b.eta_tol != null ? b.eta_tol : 0.5, hy = b.eta_hyst != null ? b.eta_hyst : 3;
    const lbH = this._config.eta_lookback_h || 48;
    const arr = (this._hist[b.soc] || []).filter((x) => x.t < now).concat([{ t: now, v: socNow }]);
    const full = socNow >= mx - tol, empty = !full && socNow <= mn + tol;
    if (full || empty) {
      const lim = full ? mx - tol : mn + tol;
      let i = arr.length - 1;
      for (; i >= 0; i--) { const v = arr[i].v; if (v != null && (full ? v < mx - hy : v > mn + hy)) break; }
      let since = null;
      if (i >= 0) for (let j = i + 1; j < arr.length; j++) { const v = arr[j].v; if (v != null && (full ? v >= lim : v <= lim)) { since = arr[j].t; break; } }
      const w = full ? "voll" : "leer", col = full ? C.export : C.import;
      const ic = full ? "mdi:battery-check" : "mdi:battery-alert-variant-outline";
      if (since == null) return { col, ic, txt: `${w} seit über ${lbH} h` };
      return { col, ic, txt: `${w} seit ${when(since)}`, sub: `(${dur(now - since)})` };
    }
    const cf = this._config, wE = cf.eta_window_empty_min || 40, wF = cf.eta_window_full_min || 3;
    const fr = Math.max(0, Math.min(1, (socNow - mn) / ((mx - mn) || 1)));
    const wBase = Math.max(1, Math.round(wE - (wE - wF) * fr));
    const vAt = (t0) => { let v = null, has = false; for (const x of arr) { if (x.t <= t0) { v = x.v; has = true; } else break; } return has ? v : null; };
    const md = b.eta_min_delta != null ? b.eta_min_delta : 0.5;
    /* Fenster schrumpft mit dem SoC (gegen Ende drosselt die Ladung); ohne echte SoC-Stufe minutenweise laenger */
    let wmin = null, v0 = null;
    for (let m = wBase; m <= wE; m++) {
      const v = vAt(now - m * 60e3);
      if (v != null && Math.abs(socNow - v) >= md) { wmin = m; v0 = v; break; }
    }
    if (wmin == null) { wmin = wBase; v0 = vAt(now - wBase * 60e3); }
    const win = wmin * 60e3;
    if (v0 == null) return { ...N, txt: sm ? "zu wenig Daten" : "Prognose: zu wenig Daten" };
    const d = socNow - v0;
    const tr = `${d > 0 ? "+" : d < 0 ? "−" : "±"}${fmtN(Math.abs(d), Math.abs(d) < 10 ? 1 : 0)} %/${wmin} min`;
    if (Math.abs(d) < md) {
      /* seit wann liegt der SoC im Band +/- md um den aktuellen Wert */
      let k = arr.length - 1;
      for (; k >= 0; k--) { const v = arr[k].v; if (v != null && Math.abs(v - socNow) >= md) break; }
      let cs = null;
      if (k >= 0) for (let j = k + 1; j < arr.length; j++) if (arr[j].v != null) { cs = arr[j].t; break; }
      if (cs == null) return { ...N, txt: `konstant seit über ${lbH} h` };
      return { ...N, txt: `konstant seit ${when(cs)}`, sub: `(${dur(now - cs)})` };
    }
    const up = d > 0, rem = up ? ((mx - socNow) / d) * win : ((socNow - mn) / -d) * win;
    const w = up ? "voll" : "leer", col = up ? C.batt : C.dis, ic = up ? "mdi:battery-arrow-up" : "mdi:battery-arrow-down";
    if (rem > lbH * 3600e3) return { col, ic, txt: `${w} erst in über ${Math.round(lbH / 24)} Tagen`, sub: tr };
    if (sm) return { col, ic, txt: `${w} ≈ ${when(now + rem)}`, sub: `in ${dur(rem)} · ${tr}` };
    return { col, ic, txt: `${w} ≈ ${when(now + rem)} · in ${dur(rem)}`, sub: tr };
  }
  _state(p) { return p == null ? "–" : p > 15 ? "lädt" : p < -15 ? "entlädt" : "Ruhe"; }
  _bidi(p, max) {
    const w = Math.min(50, (Math.abs(p || 0) / max) * 50);
    return p >= 0
      ? `<i style="left:50%;width:${w}%;background:${C.batt}"></i>`
      : `<i style="left:${50 - w}%;width:${w}%;background:${C.dis}"></i>`;
  }
  update() {
    const h = this._hass, c = this._config;
    if (!this._hAt || Date.now() - this._hAt > 5 * 60e3) this._fetchHist();
    let net = 0;
    const bigs = c.big.map((b) => {
      const { soc, p, e } = this._calc(b);
      if (b.sum !== false && p != null) net += p;
      const cls = p > 15 ? "chg" : p < -15 ? "dis" : "";
      const col = p > 15 ? C.batt : p < -15 ? C.dis : "#555";
      const eta = this._eta(b, soc);
      return `<div class="inner bt">
        <div class="cell"><div class="liq ${cls}" style="height:calc(${soc || 0}% - 6px * ${(soc || 0) / 100});background:${socColor(soc)}"></div><div class="pct num">${fmtN(soc, 0)}%</div></div>
        <div>
          <div class="bn"><ha-icon icon="${b.icon || "mdi:battery"}"></ha-icon>${b.name}</div>
          <div class="bp num" style="color:${col}">${fmtW(p, true)}</div>
          <div class="bs">${this._state(p)} · ${fmtKwh(e)} kWh gespeichert</div>
          <div class="bidi">${this._bidi(p, b.max_w || c.max_w)}</div>
          ${eta ? `<div class="eta" style="color:${eta.col}"><ha-icon icon="${eta.ic}"></ha-icon><span>${eta.txt}${eta.sub ? ` <small>${eta.sub}</small>` : ""}</span></div>` : ""}
        </div></div>`;
    }).join("");
    const smalls = (c.small || []).map((b) => {
      const { soc, p, e } = this._calc(b);
      const col = p > 15 ? C.batt : p < -15 ? C.dis : "#555";
      const eta = this._eta(b, soc, true);
      return `<div class="inner sm">
        <div class="r1"><span>${b.name}</span><b class="num">${fmtN(soc, 0)} %</b></div>
        <div class="hb"><i style="width:${soc || 0}%;background:${socColor(soc)}"></i></div>
        <div class="r2"><span class="num">${fmtKwh(e)} kWh</span><span class="num" style="color:${col}">${p == null ? "" : "≈ " + fmtW(p, true)}</span></div>
        ${eta ? `<div class="eta" style="color:${eta.col}"><ha-icon icon="${eta.ic}"></ha-icon><span>${eta.txt}${eta.sub ? `<small>${eta.sub}</small>` : ""}</span></div>` : ""}
      </div>`;
    }).join("");
    const tk = num(h, c.total_kwh), cs = num(h, c.combined_soc);
    const ncol = net > 15 ? C.batt : net < -15 ? C.dis : "#555";
    const names = c.big.filter((b) => b.sum !== false).map((b) => b.name).join(" + ");
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:battery-charging-high"></ha-icon>Speicherpark</div>
      <div class="bigs">${bigs}</div>
      ${smalls ? `<div class="smalls">${smalls}</div>` : ""}
      <div class="inner sum">
        <div><span class="kl">Gespeichert gesamt</span><span class="kv num">${fmtKwh(tk)} kWh</span></div>
        <div><span class="kl">SoC ${names}</span><span class="kv num" style="color:${socColor(cs)}">${fmtN(cs, 0)} %</span></div>
        <div><span class="kl">Netto ${names}</span><span class="kv num" style="color:${ncol}">${fmtW(net, true)}</span></div>
        <div class="wide"><div class="bidi">${this._bidi(net, c.max_w * c.big.length)}</div></div>
      </div>
      <div class="sub">+ laden / − entladen · B2500 ≈ PV-Eingang − Ausgang · Prognose: SoC-Trend, Fenster 40 min (leer) bis 3 min (voll)</div>`;
  }
  getCardSize() { return 5; }
}

/* ---------------- slc-day: Tagesverlauf 0–24 h ---------------- */
class SlcDay extends SlcBase {
  static get defaults() {
    return {
      sun: "sun.sun",
      soc: { entity: "", name: "SoC", color: C.soc },
      series: [
        { entity: "", name: "Solar", color: C.solar, abs: true, area: true },
        { entity: "", name: "Haus", color: C.home },
        { entity: "", name: "Speicher", color: C.batt },
      ],
    };
  }
  static get throttle() { return 30000; }
  static get css() { return `.wrap { position:relative; }`; }
  async _fetch() {
    if (this._loading) return;
    this._loading = true;
    try {
      const c = this._config, ids = c.series.map((s) => s.entity);
      if (c.soc) ids.push(c.soc.entity);
      this._t0 = midnight();
      this._res = await this._stats(ids, this._t0, "5minute", ["mean"]);
      this._at = Date.now(); this._err = null;
    } catch (e) { this._err = e.message || String(e); }
    finally { this._loading = false; this._render(); }
  }
  update(force) {
    if (!this._at || Date.now() - this._at > 5 * 60e3 || midnight().getTime() !== (this._t0 && this._t0.getTime())) { this._fetch(); return; }
    if (force) this._render();
  }
  _render() {
    if (this._err) { this.box.innerHTML = `<div class="err">Fehler: ${this._err}</div>`; return; }
    if (!this._res) return;
    const c = this._config, compact = this._compact();
    const n = 288, t0 = this._t0.getTime(), bms = 300e3;
    const arr = (id, abs) => {
      const out = new Array(n).fill(null);
      for (const r of this._res[id] || []) {
        const ts = typeof r.start === "number" ? r.start : Date.parse(r.start);
        const i = Math.round((ts - t0) / bms);
        if (i >= 0 && i < n && r.mean != null) out[i] = abs ? Math.abs(r.mean) : r.mean;
      }
      return out;
    };
    const data = c.series.map((s) => arr(s.entity, s.abs));
    const soc = c.soc ? arr(c.soc.entity) : null;
    const W = Math.max(300, (this._w || 600) - (compact ? 20 : 32)), H = compact ? 210 : 240;
    const pL = 40, pR = soc ? 34 : 6, pT = 10, pB = 22, pw = W - pL - pR, ph = H - pT - pB;
    const vals = data.flat().filter((v) => v != null);
    let mx = Math.max(500, ...vals), mn = Math.min(0, ...vals);
    const unit = mx - mn > 8000 ? 2000 : mx - mn > 3000 ? 1000 : 500;
    mx = Math.ceil(mx / unit) * unit; mn = Math.floor(mn / unit) * unit;
    const X = (i) => pL + (i / (n - 1)) * pw;
    const Y = (v) => pT + ((mx - v) / (mx - mn)) * ph;
    const YS = (p) => pT + ((100 - p) / 100) * ph;
    let g = "";
    const s = this._hass.states[c.sun];
    if (s && s.attributes.next_rising && s.attributes.next_setting) {
      const day = (iso) => { const d = new Date(iso); return (((d.getHours() * 60 + d.getMinutes()) / 1440) * (n - 1)); };
      const ri = day(s.attributes.next_rising), si = day(s.attributes.next_setting);
      g += `<rect x="${pL}" y="${pT}" width="${(X(ri) - pL).toFixed(1)}" height="${ph}" fill="rgba(0,0,60,0.06)"/>`;
      g += `<rect x="${X(si).toFixed(1)}" y="${pT}" width="${(W - pR - X(si)).toFixed(1)}" height="${ph}" fill="rgba(0,0,60,0.06)"/>`;
    }
    for (let v = mn; v <= mx + 1; v += unit) {
      g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,${v === 0 ? 0.35 : 0.1})"/>`;
      g += `<text x="${pL - 4}" y="${Y(v) + 4}" text-anchor="end">${Math.abs(v) >= 1000 ? fmtN(v / 1000, 0) + "k" : fmtN(v, 0)}</text>`;
    }
    if (soc) for (const p of [0, 50, 100]) g += `<text x="${W - pR + 4}" y="${YS(p) + 4}" style="fill:${c.soc.color}">${p}%</text>`;
    const stepH = compact ? 6 : 3;
    for (let hh = 0; hh <= 24; hh += stepH) {
      const i = Math.min(n - 1, (hh * 12));
      g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${String(hh).padStart(2, "0")}</text>`;
    }
    const nowI = ((Date.now() - t0) / bms);
    if (nowI < n) g += `<line x1="${X(nowI)}" x2="${X(nowI)}" y1="${pT}" y2="${pT + ph}" stroke="#000080" stroke-opacity=".5" stroke-width="1"/>`;
    const line = (a, yf) => { let d = "", st = false; a.forEach((v, i) => { if (v == null) { st = false; return; } d += `${st ? "L" : "M"}${X(i).toFixed(1)},${yf(v).toFixed(1)} `; st = true; }); return d; };
    data.forEach((a, si) => {
      const sr = c.series[si], d = line(a, Y);
      if (!d) return;
      if (sr.area) {
        /* Flaeche je Abschnitt - Luecken bleiben leer */
        let ar = "", i = 0; const N = a.length;
        while (i < N) { if (a[i] == null) { i++; continue; } let e = i; while (e < N && a[e] != null) e++;
          for (let q = i; q < e; q++) ar += `${q === i ? "M" : "L"}${X(q).toFixed(1)},${Y(a[q]).toFixed(1)} `;
          ar += `L${X(e - 1).toFixed(1)},${Y(0).toFixed(1)} L${X(i).toFixed(1)},${Y(0).toFixed(1)} Z `; i = e; }
        g += `<path d="${ar}" fill="${sr.color}" fill-opacity=".28"/>`;
      }
      g += `<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="${sr.area ? 2.2 : 1.6}" stroke-linejoin="round"/>`;
    });
    if (soc) g += `<path d="${line(soc, YS)}" fill="none" stroke="${c.soc.color}" stroke-width="1.6" stroke-dasharray="4 3"/>`;
    g += `<line id="cx" x1="0" x2="0" y1="${pT}" y2="${pT + ph}" stroke="#000080" stroke-dasharray="3,3" style="display:none"/>`;
    g += `<rect id="hit" x="${pL}" y="${pT}" width="${pw}" height="${ph}" fill="transparent"/>`;
    const all = soc ? [...c.series, { ...c.soc, pct: true }] : c.series;
    const dataAll = soc ? [...data, soc] : data;
    const legend = all.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join("");
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:chart-areaspline"></ha-icon>Tagesverlauf heute</div>
      <div class="wrap"><svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg><div class="tip" id="tip"></div></div>
      <div class="legend">${legend}</div>
      <div class="sub">Speicher: + laden / − entladen · 5-Min-Mittel · Nacht hinterlegt</div>`;
    const svg = this.shadowRoot.querySelector("svg"), tip = this.$("tip"), cx = this.$("cx"), hit = this.$("hit");
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - pL) / pw) * (n - 1))));
      cx.setAttribute("x1", X(i)); cx.setAttribute("x2", X(i)); cx.style.display = "";
      tip.innerHTML = `<b>${hhmm(new Date(t0 + i * bms))}</b>` + all.map((s, k) =>
        `<div><i style="background:${s.color}"></i>${s.name}: ${s.pct ? fmtN(dataAll[k][i], 0) + " %" : fmtW(dataAll[k][i], !s.abs)}</div>`).join("");
      tip.style.display = "block";
      const left = (X(i) / W) * r.width;
      tip.style.left = (left > r.width / 2 ? Math.max(4, left - tip.offsetWidth - 10) : left + 10) + "px";
      tip.style.top = "8px";
    };
    const leave = () => { tip.style.display = "none"; cx.style.display = "none"; };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", leave);
  }
  getCardSize() { return 5; }
}

/* ---------------- slc-generators: alle Erzeuger ---------------- */
class SlcGenerators extends SlcBase {
  static get defaults() {
    return {
      total_today: "",
      total_now: "",
      sort: true,
      items: [
        { name: "Sigenergy", sub: "Dach 1", kwp: 16, power: "", today: "", icon: "mdi:solar-panel-large" },
        { name: "Wechselrichter 4", sub: "Garage", kwp: 2.0, power: "", today: "", icon: "mdi:solar-panel" },
        { name: "Wechselrichter 3", sub: "Dach 2", kwp: 1.5, power: "", today: "", icon: "mdi:solar-panel" },
        { name: "Wechselrichter 6", sub: "Nebengebäude", kwp: 1.6, power: "", today: "", icon: "mdi:greenhouse" },
        { name: "Wechselrichter 2", sub: "West", kwp: 0.8, power: "", today: "", icon: "mdi:solar-panel" },
        { name: "Wechselrichter 1", sub: "Süd", kwp: 0.6, power: "", today: "", icon: "mdi:solar-panel" },
        { name: "Wechselrichter 5", sub: "Süd", kwp: 0.3, power: "", today: "", icon: "mdi:solar-panel" },
        { name: "B2500", sub: "DC-Eingang", power: "", icon: "mdi:battery-sync" },
      ],
    };
  }
  static get throttle() { return 3000; }
  static get css() {
    return `
    .list { padding: 4px 12px; }
    .it { display:grid; grid-template-columns: 26px 1fr 84px 70px; align-items:center; gap:4px 10px; padding:8px 0; }
    .compact .it { grid-template-columns: 22px 1fr 70px 58px; gap:4px 6px; }
    .it + .it { border-top:1px solid rgba(0,0,0,0.06); }
    .it ha-icon { --mdc-icon-size:20px; color:#000080; }
    .nm { font-size:14px; font-weight:600; line-height:1.15; }
    .nm small { display:block; font-size:11px; font-weight:400; opacity:.65; }
    .vv { font-size:14px; font-weight:700; text-align:right; }
    .vv small { display:block; font-size:10px; font-weight:400; opacity:.65; }
    .bars { grid-column: 2 / 5; display:grid; grid-template-columns: 1fr 70px; gap:10px; }
    .compact .bars { grid-template-columns: 1fr 58px; gap:6px; }
    .b { height:6px; border-radius:3px; background: rgba(0,0,0,0.08); overflow:hidden; }
    .b i { display:block; height:100%; border-radius:3px; transition: width .6s; }
    .head { display:grid; grid-template-columns: 26px 1fr 84px 70px; gap:10px; font-size:11px; opacity:.6; padding:0 12px 4px; }
    .compact .head { grid-template-columns: 22px 1fr 70px 58px; gap:6px; }
    .head span { text-align:right; }
    .foot { display:flex; justify-content:space-between; margin-top:8px; padding:10px 12px; }
    .foot > div { display:flex; flex-direction:column; }
    `;
  }
  update() {
    const h = this._hass, c = this._config;
    let items = c.items.map((it) => ({ ...it, p: Math.abs(num(h, it.power) || 0), t: num(h, it.today) }));
    const tt = num(h, c.total_today);
    const sumT = items.reduce((a, it) => a + (it.t || 0), 0);
    const ref = Math.max(tt || 0, sumT, 0.01);
    if (c.sort) items.sort((a, b) => (b.t || 0) - (a.t || 0) || b.p - a.p);
    const rows = items.map((it) => {
      const util = it.kwp ? Math.min(100, (it.p / (it.kwp * 1000)) * 100) : null;
      const share = it.t != null ? (it.t / ref) * 100 : null;
      return `<div class="it">
        <ha-icon icon="${it.icon || "mdi:solar-panel"}"></ha-icon>
        <span class="nm">${it.name}<small>${it.sub || ""}${it.kwp ? " · " + fmtN(it.kwp, 1) + " kWp" : ""}</small></span>
        <span class="vv num">${fmtW(it.p)}${util != null ? `<small>${fmtN(util, 0)} % Last</small>` : ""}</span>
        <span class="vv num">${it.t != null ? fmtKwh(it.t) : "–"}<small>${share != null ? fmtN(share, 0) + " %" : "kWh"}</small></span>
        <div class="bars">
          <div class="b"><i style="width:${util != null ? util.toFixed(1) : 0}%;background:${C.solar}"></i></div>
          <div class="b"><i style="width:${share != null ? Math.min(100, share).toFixed(1) : 0}%;background:${C.export}"></i></div>
        </div>
      </div>`;
    }).join("");
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:solar-power-variant"></ha-icon>Erzeuger</div>
      <div class="head"><i></i><i></i><span>jetzt</span><span>heute kWh</span></div>
      <div class="inner list">${rows}</div>
      <div class="inner foot">
        <div><span class="kl">Solar jetzt</span><span class="kv num" style="color:${C.solar}">${fmtW(num(h, c.total_now))}</span></div>
        <div style="align-items:flex-end"><span class="kl">PV heute gesamt</span><span class="kv num" style="color:${C.export}">${fmtKwh(tt)} kWh</span></div>
      </div>
      <div class="sub">Gelb: Auslastung zur Nennleistung · Grün: Anteil am Tagesertrag</div>`;
  }
  getCardSize() { return 6; }
}

/* ---------------- slc-yield: Tageserträge ---------------- */
class SlcYield extends SlcBase {
  static get defaults() {
    return { power: "", today: "", month: "", days: 14 };
  }
  static get throttle() { return 30000; }
  static get css() {
    return `
    .wrap { position:relative; }
    .stats { display:grid; grid-template-columns: repeat(4, 1fr); gap:6px; margin-bottom:8px; }
    .compact .stats { grid-template-columns: 1fr 1fr; }
    .stats > div { padding:8px 10px; display:flex; flex-direction:column; }
    .stats .kv { font-size:16px; }
    `;
  }
  async _fetch() {
    if (this._loading) return;
    this._loading = true;
    try {
      const c = this._config, t = midnight();
      const start = new Date(t); start.setDate(start.getDate() - (c.days - 1));
      this._start = start; this._t0 = t;
      this._res = await this._stats([c.power], start, "day", ["mean"], t);
      this._at = Date.now(); this._err = null;
    } catch (e) { this._err = e.message || String(e); }
    finally { this._loading = false; this._render(); }
  }
  update(force) {
    if (!this._at || Date.now() - this._at > 30 * 60e3 || midnight().getTime() !== (this._t0 && this._t0.getTime())) { this._fetch(); return; }
    this._render();
  }
  _render() {
    if (this._err) { this.box.innerHTML = `<div class="err">Fehler: ${this._err}</div>`; return; }
    if (!this._res) return;
    const c = this._config, compact = this._compact(), h = this._hass;
    const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    const days = Array.from({ length: c.days }, (_, i) => { const d = new Date(this._start); d.setDate(d.getDate() + i); return d; });
    const rows = this._res[c.power] || [];
    const vals = days.map((d, i) => {
      if (i === c.days - 1) return num(h, c.today);
      const r = rows.find((x) => new Date(x.start).toDateString() === d.toDateString());
      return r && r.mean != null ? (r.mean * 24) / 1000 : null;
    });
    const past = vals.slice(0, -1).filter((v) => v != null);
    const avg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : null;
    const best = Math.max(0, ...vals.filter((v) => v != null));
    const bestI = vals.indexOf(best);
    const sum = vals.reduce((a, v) => a + (v || 0), 0);
    const W = Math.max(300, (this._w || 600) - (compact ? 20 : 32)), H = compact ? 180 : 200;
    const pL = 34, pR = 4, pT = 16, pB = 22, pw = W - pL - pR, ph = H - pT - pB;
    const unit = best > 80 ? 20 : best > 40 ? 10 : 5;
    const tmax = Math.max(unit, Math.ceil(best / unit) * unit);
    const Y = (v) => pT + ph - (v / tmax) * ph;
    const step = pw / c.days, bw = step * 0.66;
    let g = "";
    for (let v = 0; v <= tmax; v += unit) g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,0.1)"/><text x="${pL - 4}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
    vals.forEach((v, i) => {
      const x = pL + step * i + (step - bw) / 2, d = days[i], today = i === c.days - 1;
      if (v != null) {
        const op = today ? 0.5 : 0.92;
        g += `<rect x="${x.toFixed(1)}" y="${Y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(pT + ph - Y(v)).toFixed(1)}" rx="3" fill="url(#gy)" fill-opacity="${op}" ${i === bestI ? 'stroke="#e86a1c" stroke-width="1.5"' : ""}><title>${WD[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.: ${fmtN(v, 1)} kWh</title></rect>`;
        if (!compact || i === bestI || today) g += `<text x="${(x + bw / 2).toFixed(1)}" y="${(Y(v) - 4).toFixed(1)}" text-anchor="middle" style="font-size:10px;font-weight:600">${fmtN(v, 0)}</text>`;
      }
      const lbl = compact ? `${d.getDate()}` : `${WD[d.getDay()]} ${d.getDate()}`;
      if (!compact || i % 2 === (c.days - 1) % 2) g += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" style="font-size:10px${today ? ";font-weight:700" : ""}">${today ? "Heute" : lbl}</text>`;
    });
    if (avg != null) g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(avg)}" y2="${Y(avg)}" stroke="#000080" stroke-dasharray="5 4" stroke-opacity=".7"/>`;
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:chart-bar"></ha-icon>Ertrag letzte ${c.days} Tage</div>
      <div class="stats">
        <div class="inner"><span class="kl">Ø pro Tag</span><span class="kv num">${fmtKwh(avg)} kWh</span></div>
        <div class="inner"><span class="kl">Bester Tag</span><span class="kv num" style="color:#e86a1c">${fmtKwh(best)} kWh</span></div>
        <div class="inner"><span class="kl">Summe ${c.days} T</span><span class="kv num">${fmtN(sum, 0)} kWh</span></div>
        <div class="inner"><span class="kl">Monat</span><span class="kv num">${fmtKwh(num(h, c.month))} kWh</span></div>
      </div>
      <svg viewBox="0 0 ${W} ${H}" width="100%"><defs><linearGradient id="gy" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${C.sun}"/><stop offset="1" stop-color="#e86a1c"/></linearGradient></defs>${g}</svg>
      <div class="sub">Gestrichelt: Ø der Vortage · Vortage aus Langzeitstatistik, heute live</div>`;
  }
  getCardSize() { return 5; }
}

const SCHEMA = {};
const defs = [
  ["slc-sun", SlcSun, "Solar Glas: Sonnenbogen"],
  ["slc-storage", SlcStorage, "Solar Glas: Speicherpark"],
  ["slc-day", SlcDay, "Solar Glas: Tagesverlauf"],
  ["slc-generators", SlcGenerators, "Solar Glas: Erzeuger"],
  ["slc-yield", SlcYield, "Solar Glas: Tageserträge"],
];
const OBJ_ = { object: {} };
for (const [type, K, label] of defs) {
  const F_ = (name, label, selector) => ({ name, label, selector });
  const S = SCHEMA[type];
  let fields;
  if (S) {
    fields = (S.fields || []).filter((x) => !x.name.includes("__"));
    const grp = [...new Set((S.fields || []).filter((x) => x.name.includes("__")).map((x) => x.name.split("__")[0]))];
    for (const k of grp) fields.push(F_(k, `${k} (Liste)`, OBJ_));
    for (const Li of S.lists || []) fields.push(F_(Li.key, `${Li.title} (YAML-Liste)`, OBJ_));
  } else {
    /* kein eigenes Schema: Felder aus den Standardwerten ableiten */
    fields = Object.entries(K.defaults || {}).map(([k, v]) =>
      typeof v === "string" && /^[a-z_]+\.[a-z0-9_]+$/.test(v) ? F_(k, k, { entity: {} })
      : typeof v === "number" ? F_(k, k, { number: { mode: "box", step: "any" } })
      : typeof v === "boolean" ? F_(k, k, { boolean: {} })
      : typeof v === "string" ? F_(k, k, { text: {} }) : F_(k, `${k} (YAML)`, OBJ_));
  }
  REG.modules[type] = K;
  REG.editors[type] = { label: label.replace(/ Glas:/, ":"), group: "Solar", groupIcon: "mdi:solar-power-variant-outline", fields, blank: () => ({ type }) };
}
REG.ver = (REG.ver || 0) + 1;

customElements.whenDefined("energie-atlas").then(() => {
  const PR = customElements.get("energie-atlas").prototype;
  if (PR.__regHook) return;
  const d = Object.getOwnPropertyDescriptor(PR, "hass");
  if (!d || !d.set) return;
  PR.__regHook = true;
  Object.defineProperty(PR, "hass", {
    configurable: true, get: d.get,
    set(h) {
      const v = REG.ver || 0;
      if (this._config && this._regV !== v) {
        this._regV = v;
        if ((this._config.modules || []).some((m) => m && REG.modules[m.type])) { this._hass = h; this._build(); return; }
      }
      d.set.call(this, h);
    },
  });
});
})();

/* ===== energie-atlas-wr ===== */
/* energie-atlas-wr – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const C = { solar: "#e0a000", export: "#228b22", bad: "#c0392b", warn: "#e07000", home: "#000080" };
const COMPACT_W = 560;
const st = (h, id) => (h && id && h.states[id]) || null;
const num = (h, id) => { const s = st(h, id); if (!s) return null; const v = parseFloat(s.state); return isNaN(v) ? null : v; };
const unit = (h, id) => { const s = st(h, id); return s ? String(s.attributes.unit_of_measurement || "") : ""; };
const pw = (h, id) => { const v = num(h, id); if (v == null) return null; return unit(h, id) === "kW" ? v * 1000 : v; };
const kwh = (h, id) => { const v = num(h, id); if (v == null) return null; const u = unit(h, id); return u === "MWh" ? v * 1000 : u === "Wh" ? v / 1000 : v; };
const fmtN = (v, d = 0) => (v == null || isNaN(v) ? "–" : v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtW = (v, signed = false) => {
  if (v == null || isNaN(v)) return "–";
  const a = signed ? v : Math.abs(v), s = signed && a > 0 ? "+" : "";
  return Math.abs(a) >= 1200 ? `${s}${fmtN(a / 1000, 2)} kW` : `${s}${fmtN(a, 0)} W`;
};
const fmtKwh = (v) => (v == null ? "–" : fmtN(v, v < 10 ? 2 : v < 100 ? 1 : 0));
const hhmm = (d) => (d ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–");
const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const power = (h, u) => { const v = pw(h, u.power); return v == null ? null : Math.max(0, Math.abs(v)); };
const escQ = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const QI = { db: "mdi:server", ha: "mdi:home", warn: "mdi:home-alert", load: "mdi:timer-sand" };
const qIcon = (k, tip, lbl) => `<span class="qi${k === "warn" ? " w" : ""}" title="${escQ(tip)}"><ha-icon icon="${QI[k] || QI.ha}"></ha-icon>${lbl ? escQ(lbl) : ""}</span>`;
const median = (a) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const E = (k) => [`sensor.${k}_heute_hka`, `sensor.${k}_7_tage_hka`, `sensor.${k}_14_tage_hka`, `sensor.${k}_monat_hka`];
const INV = [
  { name: "Wechselrichter 4", sub: "Garage", kwp: 2.0, color: "#ff8f00", icon: "mdi:solar-panel", power: "",
    energy: E("garage_2kw_growatt"), voltage: "", current: "" },
  { name: "Wechselrichter 3", sub: "Dach 2", kwp: 1.5, color: "#ffc107", icon: "mdi:solar-panel", power: "",
    energy: E("garagendach_1_5kw_growatt"), voltage: "", current: "" },
  { name: "Wechselrichter 6", sub: "Nebengebäude", kwp: 1.6, color: "#e91e63", icon: "mdi:greenhouse", power: "",
    compare: "", temp: "", energy: E("pv_gewaechshaus_hoymiles"),
    ports: [{ name: "Modul 1", power: "" }, { name: "Modul 2 · SP3", power: "" },
      { name: "Modul 3", power: "" }, { name: "Modul 4 · SP3", power: "" }] },
  { name: "Wechselrichter 2", sub: "West", kwp: 0.8, color: "#26a69a", icon: "mdi:solar-panel", power: "",
    compare: "", temp: "", energy: E("deye_800w_westen"),
    ports: [{ name: "Modul 1", power: "" }, { name: "Modul 2", power: "" }] },
  { name: "Wechselrichter 1", sub: "mit Speicher SP1/SP2", kwp: 0.6, color: "#2e7d32", icon: "mdi:battery-sync-outline", power: "",
    compare: "", temp: "", energy: E("deye_600w_sueden") },
  { name: "Wechselrichter 5", sub: "Süd", kwp: 0.3, color: "#1e88e5", icon: "mdi:solar-panel", power: "", energy: E("envertech_300w_sueden") },
];
const COLS = ["Heute", "7 Tage", "14 Tage", "Monat"];

/* ---- Datenquelle extern: Verbrauch je Zeitraum aus dem Zaehlerstand. DB-Server -> HA-Statistik -> null (Luecke) ---- */
const SPANS = (ranges) => {
  const now = new Date(), d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return (ranges || []).map((s) => {
    let m;
    if (s === "today") return d0;
    if (s === "week") { const x = new Date(d0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.getTime(); }
    if (s === "month") return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    if (s === "year") return new Date(now.getFullYear(), 0, 1).getTime();
    if ((m = /^last:(\d+)(h|d)$/.exec(s || ""))) return now.getTime() - Number(m[1]) * (m[2] === "h" ? 3600e3 : 864e5);
    return null;
  });
};
async function extSums(h, DS, id, spans, sid) {
  DS = DS || {};
  const sv = String(DS.dienst || "").split("."), tmo = Math.max(1, Number(DS.timeout) || 8) * 1000, extra = {};
  for (const k of ["host", "port", "db", "tabelle", "profil"]) if (DS[k] !== "" && DS[k] != null) extra[k] = DS[k];
  const tms = (x) => (typeof x === "number" ? x : Date.parse(x));
  const call = async (a, b) => {
    let tm;
    try {
      const r = await Promise.race([h.callWS({ type: "call_service", domain: sv[0], service: sv.slice(1).join("."), service_data: { sensor_id: id, start: new Date(a).toISOString(), end: new Date(b).toISOString(), bucket: "5 minutes", ...extra }, return_response: true }),
        new Promise((_, rej) => { tm = setTimeout(() => rej(new Error("Zeitueberschreitung")), tmo); })]);
      const d = ((r && r.response) || {}).data;
      return (Array.isArray(d) ? d : []).map((p) => [Number(p[0]), p[1] == null ? NaN : Number(p[1])]).filter((p) => !isNaN(p[1]));
    } finally { clearTimeout(tm); }
  };
  const stat = async () => {
    try {
      const now = Date.now(), H = 3600e3, ok = spans.filter((t) => t != null);
      if (!ok.length) return null;
      const a = Math.floor(Math.min(...ok) / H) * H;
      const q = async (p, from) => ((await h.callWS({ type: "recorder/statistics_during_period", start_time: new Date(from).toISOString(), end_time: new Date(now).toISOString(), statistic_ids: [sid || id], period: p, types: ["change"] })) || {})[sid || id] || [];
      const rows = (await q("hour", a)).filter((r) => r.change != null).map((r) => ({ s: tms(r.start), e: tms(r.end), c: r.change }));
      const last = rows.length ? rows[rows.length - 1].e : a;
      if (now - last > 60e3) for (const r of await q("5minute", last)) if (r.change != null) rows.push({ s: tms(r.start), e: tms(r.end), c: r.change });
      if (!rows.length) return null;
      return spans.map((t0) => {
        if (t0 == null) return null;
        const f = Math.floor(t0 / H) * H, sel = rows.filter((r) => r.s >= f);
        if (!sel.length || sel[0].s - f > H) return null;
        return sel.reduce((x, r) => x + r.c, 0);
      });
    } catch (e) { return null; }
  };
  const now = Date.now();
  try {
    const pe = await call(now - 2 * 864e5, now);   /* ltss schreibt nur bei Aenderung: letzter bekannter Stand */
    if (!pe.length) return { st: "leer", v: await stat() };
    const vEnd = pe[pe.length - 1][1];
    const v = await Promise.all(spans.map(async (t0) => {
      if (t0 == null) return null;
      const ps = await call(t0 - 2 * 864e5, t0 + 3600e3);
      const bef = ps.filter((p) => p[0] <= t0), p0 = bef.length ? bef[bef.length - 1] : ps[0];
      if (!p0) return null;                                       /* kein Stand um den Zeitraumbeginn: Luecke */
      const d = vEnd - p0[1];
      return d < 0 ? null : d;                                  /* Zaehler zurueckgesetzt: nicht schaetzen */
    }));
    return { st: "ok", v };
  } catch (e) { return { st: "fehler", v: await stat() }; }
}
if (!REG.extSums) { REG.extSums = extSums; REG.extSpans = SPANS; }
const R4 = ["today", "last:7d", "last:14d", "month"];
/* Werte je Zeitraum: intern = Sensoren, extern = Zaehlerstand (DB -> HA-Statistik -> null); Hinweise landen in notes */
function srcVals(mod, h, obj, ents, qk, zk, ranges, notes, name) {
  const iv = (ents || []).map((id) => kwh(h, id));
  if (!obj || obj[qk] !== "extern") return iv;
  const r = mod._ext(obj[zk], ranges, obj[zk + "_statistik"]);
  if (!r) { notes.push({ k: "load", t: `${name}: lade vom DB-Server…` }); return ranges.map(() => null); }
  if (r.st === "ok") { notes.push({ k: "db", ok: true, t: `${name}: DB-Server` }); return r.v; }
  if (r.st === "nozaehler") { notes.push({ k: "warn", w: true, t: `${name}: kein Zählerstand · intern` }); return iv; }
  notes.push({ k: "warn", w: true, t: `${name}: ${r.st === "leer" ? "extern ohne Daten" : "extern nicht erreichbar"} · ${Array.isArray(r.v) ? "HA-Statistik" : "keine Daten"}` });
  return Array.isArray(r.v) ? r.v : ranges.map(() => null);
}
const noteHtml = (notes) => {
  if (!notes.length) return "";
  const ok = notes.filter((n) => n.k === "db"), rest = notes.filter((n) => n.k !== "db");
  const p = [...(ok.length ? [qIcon("db", ok.map((n) => n.t).join("\n"))] : []), ...rest.map((n) => qIcon(n.k, n.t, n.k === "warn" ? n.t.split(":")[0] : ""))];
  return `<div class="sub qs${rest.some((n) => n.w) ? " wq" : ""}">${p.join("")}</div>`;
};

const BASE_CSS = `
  :host { display:block; }
  .glass { color: #000; box-sizing: border-box;
    font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
  .title { display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:600; margin-bottom:10px; }
  .title ha-icon { --mdc-icon-size: 20px; color:#000080; }
  .sub { font-size:11px; opacity:.6; text-align:center; margin-top:6px; }
  .inner { background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.10); border-radius:12px; }
  .num { font-variant-numeric: tabular-nums; }
  .err { color:#a11a1a; font-size:13px; }
  .load { opacity:.6; font-size:13px; text-align:center; padding:12px; }
  .kl { font-size:12px; opacity:.72; }
  .kv { font-size:18px; font-weight:700; }
  svg text { fill:#000; font-size:11px; }
  .chartw { position:relative; }
  .tip { position:absolute; pointer-events:none; background: rgba(255,255,255,0.9); border:1px solid rgba(0,0,0,0.1); border-radius:8px;
    padding:6px 8px; font-size:12px; white-space:nowrap; display:none; box-shadow:0 4px 14px rgba(0,0,0,0.15); z-index:2; }
  .tip b { display:block; margin-bottom:2px; }
  .tip i { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
  .legend { display:flex; justify-content:center; gap:12px; flex-wrap:wrap; font-size:12px; margin-top:6px; }
  .legend span { display:inline-flex; align-items:center; gap:6px; }
  .legend i { width:12px; height:6px; border-radius:2px; display:inline-block; }
  .hb { height:6px; border-radius:3px; background: rgba(0,0,0,0.08); overflow:hidden; }
  .hb i { display:block; height:100%; border-radius:3px; transition: width .8s; }
  .pills { display:flex; flex-wrap:wrap; gap:6px; }
  .pill { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:12px; font-size:12px; font-weight:600;
    background: rgba(255,255,255,0.45); border:1px solid rgba(255,255,255,0.45); white-space:nowrap; }
  .pill ha-icon { --mdc-icon-size:15px; }
  .pill.ok { color:#1b6b1b; } .pill.warn { color:#a35200; } .pill.bad { color:#a11a1a; background: rgba(255,205,205,0.6); }
  .box { padding:8px 10px; display:flex; flex-direction:column; }
  .box .kv { font-size:16px; }
  .g4 { display:grid; grid-template-columns: repeat(4, 1fr); gap:6px; }
  .qi { display:inline-flex; align-items:center; gap:2px; cursor:help; opacity:.6; flex:none; } .qi ha-icon { --mdc-icon-size:14px; color:#000; }
  .qi.w, .qi.w ha-icon { color:#a11a1a; opacity:1; }
  .sub.qs { display:flex; justify-content:center; gap:8px; flex-wrap:wrap; opacity:1; }
  .sub.wq { color:#a11a1a; opacity:.9; }
`;

class WrBase {
  constructor(c, el, ctx) {
    this.el = el; this._ds = (ctx && ctx.ds) || {};
    this._config = JSON.parse(JSON.stringify({ ...(this.constructor.defaults || {}), ...(c || {}) }));
    this.shadowRoot = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}${this.constructor.css || ""}</style><div class="glass"><div class="load">Lade…</div></div>`;
    this._dirty = true; this._at = 0;
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver((e) => {
        const w = Math.round(e[0].contentRect.width);
        if (w > 0 && Math.abs(w - (this._w || 0)) > 12) { this._w = w; this._dirty = true; this._resized = true; this._update(true); }
      });
      this._ro.observe(el);
    }
  }
  set hass(h) {
    if (!this.el.isConnected && this._seen) { if (this._ro) this._ro.disconnect(); return; }
    if (this.el.isConnected) this._seen = true;
    this._hass = h; if (!this._last || Date.now() - this._last > (this.constructor.throttle || 3000)) this._update(false);
  }
  _compact() { return (this._w || this.el.clientWidth || 800) < COMPACT_W; }
  /* extern-Werte je Zaehler + Zeitraeume, alle 5 min neu; bis zur ersten Antwort undefined */
  _ext(zaehler, ranges, sid) {
    if (!zaehler) return { st: "nozaehler" };
    const k = `${zaehler}|${sid || ""}|${(ranges || []).join(",")}`;
    this._xc = this._xc || {};
    const e = this._xc[k] || (this._xc[k] = {});
    if (!e.loading && (!e.at || Date.now() - e.at > 5 * 60e3)) {
      e.loading = true;
      extSums(this._hass, this._ds, zaehler, SPANS(ranges), sid).then((r) => { e.r = r; }).catch(() => { e.r = { st: "fehler", v: null }; })
        .finally(() => { e.at = Date.now(); e.loading = false; if (this._hass && this.el.isConnected) this._update(true); });
    }
    return e.r;
  }
  get box() { return this.shadowRoot.querySelector(".glass"); }
  $(id) { return this.shadowRoot.getElementById(id); }
  _update(force) {
    if (!this._hass || !this.shadowRoot) return;
    this._last = Date.now();
    this.box.classList.toggle("compact", this._compact());
    try { this.update(force); } catch (e) { this.box.innerHTML = `<div class="err">Fehler: ${e.message || e}</div>`; this._dirty = true; }
  }
  async _load(fn) {
    if (this._loading) return; /* laeuft schon: der laufende Abruf liefert frische Daten, kein zweiter */
    this._loading = true;
    try { await fn(); this._err = null; } catch (e) { this._err = e.message || String(e); }
    finally { this._at = Date.now(); this._loading = false; if (this._again) { this._again = false; this._load(fn); } else this._draw(); }
  }
  _today(ids) {
    this._t0 = midnight();
    return this._hass.callWS({ type: "recorder/statistics_during_period", start_time: this._t0.toISOString(), end_time: new Date().toISOString(),
      statistic_ids: ids.filter(Boolean), period: "5minute", types: ["mean"], units: { power: "W" } });
  }
  _series(id) {
    const n = 288, t0 = this._t0.getTime(), out = new Array(n).fill(null);
    for (const r of (this._res && this._res[id]) || []) {
      const ts = typeof r.start === "number" ? r.start : Date.parse(r.start), i = Math.round((ts - t0) / 300e3);
      if (i >= 0 && i < n && r.mean != null) out[i] = Math.max(0, Math.abs(r.mean));
    }
    return out;
  }
  _sunRange(n) {
    const s = this._hass.states["sun.sun"]; if (!s || !s.attributes.next_rising || !s.attributes.next_setting) return [0, n - 1];
    const idx = (iso) => { const d = new Date(iso); return Math.round(((d.getHours() * 60 + d.getMinutes()) / 1440) * (n - 1)); };
    return [Math.max(0, idx(s.attributes.next_rising) - 12), Math.min(n - 1, idx(s.attributes.next_setting) + 12)];
  }
}

/* ===================================================================== */
/* wr-overview                                                            */
/* ===================================================================== */
class WrOverview extends WrBase {
  static get defaults() {
    return { inverters: INV, total_power: "", total_invert: true,
      total_energy: E("pv_alt_einspeisung_gefiltert"), warn_ratio: 50, min_kwh: 0.3 };
  }
  static get css() {
    return `
    .top { display:grid; grid-template-columns: 1fr 1.3fr; gap:12px; align-items:stretch; }
    .compact .top { grid-template-columns: 1fr; }
    .hero { padding:12px 14px; display:flex; flex-direction:column; justify-content:center; }
    .big { font-size:40px; font-weight:800; line-height:1.05; color:${C.solar}; letter-spacing:-.5px; }
    .compact .big { font-size:32px; }
    .load2 { margin:8px 0 4px; }
    .rank { padding:8px 12px; }
    .rk { display:grid; grid-template-columns: 112px 1fr 92px; align-items:center; gap:8px; padding:4px 0; font-size:13px; }
    .compact .rk { grid-template-columns: 92px 1fr 82px; }
    .rk .n { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:6px; }
    .rk .n i { width:8px; height:8px; border-radius:50%; flex:none; }
    .rk .bar { height:14px; border-radius:7px; background: rgba(0,0,0,0.07); overflow:hidden; position:relative; }
    .rk .bar i { position:absolute; left:0; top:0; bottom:0; border-radius:7px; transition: width .8s; }
    .rk .bar .med { position:absolute; top:-2px; bottom:-2px; width:2px; background:#000080; opacity:.5; }
    .rk .v { text-align:right; font-variant-numeric: tabular-nums; font-weight:700; }
    .rk .v small { font-weight:400; opacity:.65; font-size:11px; }
    `;
  }
  update() {
    const h = this._hass, c = this._config, I = c.inverters || [], notes = [];
    const rows = I.map((u) => {
      const p = power(h, u), t = srcVals(this, h, u, [(u.energy || [])[0]], "quelle", "zaehler", ["today"], notes, u.name)[0];
      return { u, p, t, spec: t != null && u.kwp ? t / u.kwp : null, util: u.kwp && p != null ? (p / (u.kwp * 1000)) * 100 : null };
    });
    let tp = c.total_power ? pw(h, c.total_power) : null;
    tp = tp == null ? rows.reduce((a, r) => a + (r.p || 0), 0) : Math.max(0, tp * (c.total_invert ? -1 : 1));
    const kwp = I.reduce((a, u) => a + (u.kwp || 0), 0);
    const te = srcVals(this, h, c, c.total_energy || [], "total_quelle", "total_zaehler", c.ranges || R4, notes, "Gesamt");
    const med = median(rows.map((r) => r.spec));
    const sorted = [...rows].sort((a, b) => (b.spec ?? -1) - (a.spec ?? -1));
    const mx = Math.max(0.01, ...rows.map((r) => r.spec || 0));
    // Auffaellig: spezifischer Ertrag deutlich unter Median (nur wenn genug Ertrag am Tag)
    const odd = med != null && med * Math.max(...I.map((u) => u.kwp || 0)) >= c.min_kwh
      ? rows.filter((r) => r.spec != null && r.spec < med * (c.warn_ratio / 100)) : [];
    const offline = rows.filter((r) => st(h, r.u.power) == null || ["unavailable", "unknown"].includes(st(h, r.u.power).state));
    const rk = sorted.map((r) => `<div class="rk">
        <span class="n"><i style="background:${r.u.color}"></i>${r.u.name}</span>
        <span class="bar"><i style="width:${(((r.spec || 0) / mx) * 100).toFixed(1)}%;background:${odd.includes(r) ? C.bad : r.u.color}"></i>${med ? `<span class="med" style="left:${((med / mx) * 100).toFixed(1)}%"></span>` : ""}</span>
        <span class="v">${fmtN(r.spec, 2)} <small>kWh/kWp</small></span></div>`).join("");
    const pills = [];
    if (odd.length) pills.push(...odd.map((r) => `<span class="pill bad"><ha-icon icon="mdi:alert-outline"></ha-icon>${r.u.name}: nur ${fmtN((r.spec / med) * 100, 0)} % vom Median</span>`));
    if (offline.length) pills.push(...offline.map((r) => `<span class="pill warn"><ha-icon icon="mdi:lan-disconnect"></ha-icon>${r.u.name} ohne Messwert</span>`));
    if (!pills.length) pills.push(`<span class="pill ok"><ha-icon icon="mdi:check-circle-outline"></ha-icon>Alle Wechselrichter im Rahmen</span>`);
    const active = rows.filter((r) => (r.p || 0) > 5).length;
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:solar-power-variant"></ha-icon>PV-Altanlage · ${I.length} Wechselrichter</div>
      <div class="top">
        <div class="inner hero">
          <span class="kl">Leistung jetzt</span>
          <span class="big num">${fmtW(tp)}</span>
          <div class="hb load2"><i style="width:${kwp ? Math.min(100, (tp / (kwp * 1000)) * 100).toFixed(1) : 0}%;background:linear-gradient(90deg,#ffe08a,${C.solar},#e86a1c)"></i></div>
          <span class="kl num">${fmtN(kwp ? (tp / (kwp * 1000)) * 100 : null, 0)} % von ${fmtN(kwp, 1)} kW Nennleistung · ${active} von ${I.length} aktiv</span>
          <div class="g4" style="margin-top:10px">${COLS.map((l, i) => `<div class="inner box"><span class="kl">${l}</span><span class="kv num">${fmtKwh(te[i])}</span></div>`).join("")}</div>
          <span class="kl" style="margin-top:4px;text-align:center">kWh PV-Altanlage (Shelly, gefiltert)</span>
        </div>
        <div class="inner rank">
          <div class="kl" style="margin-bottom:4px">Spezifischer Ertrag heute · Strich = Median</div>
          ${rk}
        </div>
      </div>
      <div class="pills" style="margin-top:10px;justify-content:center">${pills.join("")}</div>
      <div class="sub">kWh/kWp macht unterschiedlich große Anlagen vergleichbar · rot = unter ${c.warn_ratio} % des Medians · Ausrichtung (Ost/West/Süd) und Speicher-Kopplung beachten</div>${noteHtml(notes)}`;
  }
}

/* ===================================================================== */
/* wr-day                                                                 */
/* ===================================================================== */
class WrDay extends WrBase {
  static get defaults() { return { inverters: INV.map((u) => ({ name: u.name, color: u.color, power: u.power })) }; }
  static get throttle() { return 30000; }
  update(force) {
    if (!this._at || Date.now() - this._at > 5 * 60e3 || midnight().getTime() !== (this._t0 && this._t0.getTime())) {
      this._load(async () => { this._res = await this._today((this._config.inverters || []).map((u) => u.power)); });
    } else if (force || this._resized) { this._resized = false; this._draw(); }
  }
  _draw() {
    if (this._err) { this.box.innerHTML = `<div class="err">Fehler: ${this._err}</div>`; return; }
    if (!this._res) return;
    const c = this._config, I = c.inverters || [], compact = this._compact(), n = 288, t0 = this._t0.getTime();
    const data = I.map((u) => this._series(u.power));
    let acc = new Array(n).fill(0); const stack = [];
    data.forEach((a) => { const top = acc.map((v, i) => v + (a[i] || 0)); stack.push({ lo: acc, hi: top }); acc = top; });
    const has = acc.map((v, i) => data.some((a) => a[i] != null));
    const last = has.lastIndexOf(true);
    let [a0, a1] = this._sunRange(n); a1 = Math.max(a1, Math.min(n - 1, last));
    const W = Math.max(300, (this._w || 600) - (compact ? 20 : 32)), H = compact ? 200 : 230;
    const pL = 40, pR = 6, pT = 10, pB = 22, pwid = W - pL - pR, ph = H - pT - pB, span = Math.max(1, a1 - a0);
    let mx = Math.max(500, ...acc); const u = mx > 4000 ? 1000 : mx > 1500 ? 500 : 250; mx = Math.ceil(mx / u) * u;
    const X = (i) => pL + ((i - a0) / span) * pwid, Y = (v) => pT + ((mx - v) / mx) * ph;
    let g = "";
    for (let v = 0; v <= mx; v += u) g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,${v ? 0.1 : 0.35})"/><text x="${pL - 4}" y="${Y(v) + 4}" text-anchor="end">${v >= 1000 ? fmtN(v / 1000, 1) + "k" : v}</text>`;
    for (let hh = 0; hh <= 24; hh++) { const i = hh * 12; if (i < a0 || i > a1 || hh % (compact ? 3 : 2)) continue; g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${String(hh).padStart(2, "0")}</text>`; }
    /* Abschnitte mit Daten; wo kein WR einen Wert hat, bleibt eine sichtbare Luecke (grau hinterlegt) */
    const segs = []; let sg0 = -1;
    for (let i = a0; i <= Math.min(last, a1) + 1; i++) { const ok = i <= Math.min(last, a1) && has[i]; if (ok && sg0 < 0) sg0 = i; if (!ok && sg0 >= 0) { segs.push([sg0, i - 1]); sg0 = -1; } }
    for (let i = a0; i < Math.min(last, a1); i++) if (!has[i]) g += `<rect x="${X(i).toFixed(1)}" y="${pT}" width="${Math.max(0.5, X(i + 1) - X(i)).toFixed(2)}" height="${ph}" fill="rgba(0,0,0,0.05)"/>`;
    if (last >= a0) stack.forEach((sl, k) => {
      let area = "", line = "";
      for (const [s0, s1] of segs) {
        let top = "", bot = "";
        for (let i = s0; i <= s1; i++) top += `${i === s0 ? "M" : "L"}${X(i).toFixed(1)},${Y(sl.hi[i]).toFixed(1)} `;
        for (let i = s1; i >= s0; i--) bot += `L${X(i).toFixed(1)},${Y(sl.lo[i]).toFixed(1)} `;
        area += `${top}${bot}Z `; line += top;
      }
      if (area) g += `<path d="${area}" fill="${I[k].color}" fill-opacity=".6"/><path d="${line}" fill="none" stroke="${I[k].color}" stroke-width="1.2"/>`;
    });
    g += `<line class="cx" x1="0" x2="0" y1="${pT}" y2="${pT + ph}" stroke="#000080" stroke-dasharray="3,3" style="display:none"/><rect class="hit" x="${pL}" y="${pT}" width="${pwid}" height="${ph}" fill="transparent"/>`;
    const pk = Math.max(...acc), pki = acc.indexOf(pk);
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:chart-areaspline"></ha-icon>Tagesverlauf Wechselrichter</div>
      <div class="chartw"><svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg><div class="tip"></div></div>
      <div class="legend">${I.map((u) => `<span><i style="background:${u.color}"></i>${u.name}</span>`).join("")}</div>
      <div class="sub">Gestapelt · 5-Min-Mittel · Spitze ${fmtW(pk)} um ${hhmm(new Date(t0 + pki * 300e3))} · Zeitachse Sonnenauf- bis -untergang</div>`;
    const svg = this.shadowRoot.querySelector("svg"), tip = this.shadowRoot.querySelector(".tip"), cx = this.shadowRoot.querySelector(".cx"), hit = this.shadowRoot.querySelector(".hit");
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(a0, Math.min(a1, Math.round(a0 + ((((ev.clientX - r.left) / r.width) * W - pL) / pwid) * span)));
      cx.setAttribute("x1", X(i)); cx.setAttribute("x2", X(i)); cx.style.display = "";
      if (i > last) { tip.style.display = "none"; return; }
      tip.innerHTML = `<b>${hhmm(new Date(t0 + i * 300e3))} · ${fmtW(acc[i])}</b>` + I.map((u, k) => `<div><i style="background:${u.color}"></i>${u.name}: ${fmtW(data[k][i])}</div>`).join("");
      tip.style.display = "block";
      const left = (X(i) / W) * r.width;
      tip.style.left = (left > r.width / 2 ? Math.max(4, left - tip.offsetWidth - 10) : left + 10) + "px"; tip.style.top = "8px";
    };
    hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", () => { tip.style.display = "none"; cx.style.display = "none"; });
  }
}

/* ===================================================================== */
/* wr-compare                                                             */
/* ===================================================================== */
class WrCompare extends WrBase {
  constructor(c, el, ctx) { super(c, el); this._ds = (ctx && ctx.ds) || {}; }
  static get defaults() { return { mode: "spec", ranges: ["today", "last:7d", "last:14d", "month"], inverters: INV.map((u) => ({ name: u.name, color: u.color, kwp: u.kwp, energy: u.energy })) }; }
  async _fetchExt() {
    this._xLoading = true;
    const out = {};
    try {
      const I = this._config.inverters || [], spans = SPANS(this._config.ranges);
      await Promise.all(I.map(async (u, i) => { if (!u || u.quelle !== "extern") return; out[i] = u.zaehler ? await extSums(this._hass, this._ds, u.zaehler, spans) : { st: "nozaehler" }; }));
    } finally {
      this._ext = out; this._xAt = Date.now(); this._xLoading = false;
      if (this._hass && this.el.isConnected) this._update(true);
    }
  }
  static get throttle() { return 10000; }
  static get css() {
    return `
    .tbl { padding:6px 10px; }
    .tr { display:grid; grid-template-columns: 1.3fr repeat(4, 1fr); gap:4px; align-items:center; padding:3px 0; font-size:13px; }
    .tr.h { font-size:11px; opacity:.65; } .tr.h span { text-align:center; }
    .tr .n { font-weight:600; display:flex; align-items:center; gap:6px; white-space:nowrap; overflow:hidden; }
    .tr .n i { width:8px; height:8px; border-radius:50%; flex:none; }
    .cl { text-align:center; border-radius:7px; padding:5px 2px; font-variant-numeric: tabular-nums; font-weight:700; line-height:1.15; }
    .cl small { display:block; font-weight:400; font-size:10px; opacity:.7; }
    .tr.sum { border-top:1px solid rgba(0,0,0,0.1); margin-top:4px; padding-top:6px; }
    .seg { display:flex; justify-content:center; gap:6px; margin-bottom:8px; }
    .seg button { cursor:pointer; border:1px solid rgba(0,0,0,0.15); background: rgba(255,255,255,0.4); border-radius:12px; padding:3px 12px; font-size:12px; color:#000; }
    .seg button.on { background:#000080; color:#fff; border-color:#000080; }
    .sub.wq { color:#a11a1a; opacity:.9; }
    `;
  }
  update() {
    const h = this._hass, c = this._config, I = c.inverters || [], mode = this._mode || c.mode;
    if (I.some((u) => u && u.quelle === "extern") && !this._xLoading && (!this._xAt || Date.now() - this._xAt > 5 * 60e3)) this._fetchExt();
    const X = this._ext || {}, notes = [], qk = {}, anyX = I.some((u) => u && u.quelle === "extern");
    const vals = I.map((u, i) => {
      const iv = (u.energy || []).map((id) => kwh(h, id));
      if (u.quelle !== "extern") { if (anyX) qk[i] = ["ha", `${u.name}: intern (Home Assistant)`]; return iv; }
      const x = X[i];
      if (!x) { qk[i] = ["load", `${u.name}: lade vom DB-Server…`]; return iv.map(() => null); }
      if (x.st === "ok") { qk[i] = ["db", `${u.name}: DB-Server`]; return x.v; }
      if (x.st === "nozaehler") { qk[i] = ["warn", `${u.name}: kein Zählerstand · intern`]; return iv; }
      qk[i] = ["warn", `${u.name}: ${x.st === "leer" ? "extern ohne Daten" : "extern nicht erreichbar"} · ${Array.isArray(x.v) ? "HA-Statistik" : "keine Daten"}`];
      return Array.isArray(x.v) ? x.v : iv.map(() => null);
    });
    const show = (v, u) => (v == null ? null : mode === "spec" && u.kwp ? v / u.kwp : v);
    // Heatmap je Spalte: bester Wert gruen, schwaechster rot
    const colScale = COLS.map((_, j) => { const a = I.map((u, i) => show(vals[i][j], u)).filter((x) => x != null); return [Math.min(...a), Math.max(...a)]; });
    const bg = (v, j) => { if (v == null) return "transparent"; const [lo, hi] = colScale[j]; const t = hi > lo ? (v - lo) / (hi - lo) : 1;
      const r = Math.round(220 - 150 * t), g = Math.round(90 + 110 * t); return `rgba(${r},${g},70,0.35)`; };
    const rows = I.map((u, i) => `<div class="tr"><span class="n"><i style="background:${u.color}"></i>${qk[i] ? qIcon(qk[i][0], qk[i][1]) : ""}${u.name}</span>${COLS.map((_, j) => {
      const v = show(vals[i][j], u);
      return `<span class="cl" style="background:${bg(v, j)}">${fmtN(v, mode === "spec" ? 2 : 1)}<small>${mode === "spec" ? fmtKwh(vals[i][j]) + " kWh" : u.kwp ? fmtN(vals[i][j] != null ? vals[i][j] / u.kwp : null, 2) + "/kWp" : ""}</small></span>`;
    }).join("")}</div>`).join("");
    const sums = COLS.map((_, j) => vals.reduce((a, v) => a + (v[j] || 0), 0));
    const kwp = I.reduce((a, u) => a + (u.kwp || 0), 0);
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:table-large"></ha-icon>Erträge im Vergleich</div>
      <div class="seg"><button data-m="spec" class="${mode === "spec" ? "on" : ""}">kWh/kWp</button><button data-m="abs" class="${mode === "abs" ? "on" : ""}">kWh</button></div>
      <div class="inner tbl">
        <div class="tr h"><span></span>${COLS.map((l) => `<span>${l}</span>`).join("")}</div>${rows}
        <div class="tr sum"><span class="n">Summe</span>${sums.map((s) => `<span class="cl">${fmtKwh(s)}<small>${fmtN(kwp ? s / kwp : null, 2)}/kWp</small></span>`).join("")}</div>
      </div>
      <div class="sub">Farbe je Spalte: grün = bester, rot = schwächster Wert · Summe in kWh</div>`;
    this.shadowRoot.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => { this._mode = b.dataset.m; this._update(true); }));
  }
}

/* ===================================================================== */
/* wr-unit                                                                */
/* ===================================================================== */
class WrUnit extends WrBase {
  static get defaults() { return { name: "Wechselrichter", kwp: 1, energy: [] }; }
  static getStubConfig() { return JSON.parse(JSON.stringify(INV[0])); }
  static get throttle() { return 3000; }
  static get css() {
    return `
    .hd { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
    .ic { width:42px; height:42px; border-radius:12px; display:flex; align-items:center; justify-content:center; background: var(--c); flex:none; box-shadow: 0 4px 12px -6px var(--c); }
    .ic ha-icon { --mdc-icon-size:24px; color:#fff; }
    .hn { font-size:16px; font-weight:800; line-height:1.15; } .hn small { display:block; font-size:12px; font-weight:400; opacity:.65; }
    .hp { margin-left:auto; text-align:right; } .hp b { display:block; font-size:24px; font-weight:800; line-height:1.1; }
    .spark { margin:6px 0 4px; }
    .ports { display:grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap:6px; margin-top:8px; }
    .ports div { padding:6px 8px; } .ports b { display:block; font-size:14px; }
    `;
  }
  update(force) {
    const h = this._hass, c = this._config;
    const p = power(h, c), util = c.kwp && p != null ? Math.min(100, (p / (c.kwp * 1000)) * 100) : null;
    const notes = [], en = srcVals(this, h, c, c.energy || [], "quelle", "zaehler", c.ranges || R4, notes, c.name || "WR");
    const cmp = c.compare ? pw(h, c.compare) : null, cmpOk = c.compare && cmp != null;
    let dev = "";
    if (cmpOk && Math.max(p || 0, Math.abs(cmp)) >= 30) {
      const pct = ((Math.abs(cmp) - (p || 0)) / Math.max(p || 0, Math.abs(cmp))) * 100;
      dev = `<span class="pill ${Math.abs(pct) > 15 ? "bad" : Math.abs(pct) > 6 ? "warn" : "ok"}"><ha-icon icon="mdi:scale-balance"></ha-icon>WR meldet ${fmtW(Math.abs(cmp))} · ${pct > 0 ? "+" : ""}${fmtN(pct, 0)} %</span>`;
    } else if (c.compare) dev = `<span class="pill"><ha-icon icon="mdi:scale-balance"></ha-icon>WR meldet ${cmp == null ? "nichts" : fmtW(Math.abs(cmp))}</span>`;
    const t = num(h, c.temp);
    const tp = c.temp ? `<span class="pill ${t != null && t >= 70 ? "bad" : t != null && t >= 60 ? "warn" : ""}"><ha-icon icon="mdi:thermometer"></ha-icon>${t == null ? "–" : fmtN(t, 0) + " °C"}</span>` : "";
    const vi = c.voltage || c.current ? `<span class="pill"><ha-icon icon="mdi:sine-wave"></ha-icon>${fmtN(num(h, c.voltage), 0)} V · ${fmtN(num(h, c.current), 1)} A</span>` : "";
    const ports = (c.ports || []).length ? `<div class="ports">${c.ports.map((pt) => { const v = pw(h, pt.power);
      return `<div class="inner"><span class="kl">${pt.name}</span><b class="num">${fmtW(v)}</b><div class="hb" style="margin-top:4px"><i style="width:${c.kwp ? Math.min(100, ((v || 0) / ((c.kwp * 1000) / c.ports.length)) * 100) : 0}%;background:${c.color || C.solar}"></i></div></div>`; }).join("")}</div>` : "";
    if (this._dirty || !this._built) {
      this.box.innerHTML = `<div id="top"></div><div class="spark" id="sp"><div class="load">…</div></div><div id="bot"></div>`;
      this._built = true; this._dirty = false; if (this._res) this._draw();
    }
    this.$("top").innerHTML = `
      <div class="hd" style="--c:${c.color || C.solar}">
        <div class="ic"><ha-icon icon="${c.icon || "mdi:solar-panel"}"></ha-icon></div>
        <div class="hn">${c.name}<small>${c.sub || ""}${c.kwp ? " · " + fmtN(c.kwp, 1) + " kW" : ""}</small></div>
        <div class="hp"><b class="num" style="color:${(p || 0) > 5 ? C.solar : "#777"}">${fmtW(p)}</b><span class="kl num">${util == null ? "" : fmtN(util, 0) + " % Last"}</span></div>
      </div>
      <div class="hb"><i style="width:${util || 0}%;background:${c.color || C.solar}"></i></div>
      <div class="pills" style="margin-top:8px">${dev}${tp}${vi}</div>${ports}`;
    this.$("bot").innerHTML = `<div class="g4" style="margin-top:8px">${COLS.map((l, i) => `<div class="inner box"><span class="kl">${l}</span><span class="kv num">${fmtKwh(en[i])}</span><span class="kl num" style="font-size:10px">${c.kwp && en[i] != null ? fmtN(en[i] / c.kwp, 2) + " /kWp" : "kWh"}</span></div>`).join("")}</div>${noteHtml(notes)}`;
    if (!this._at || Date.now() - this._at > 5 * 60e3 || midnight().getTime() !== (this._t0 && this._t0.getTime())) {
      this._load(async () => { this._res = await this._today([c.power]); });
    } else if (force || this._resized) { this._resized = false; this._draw(); }
  }
  _draw() {
    const box = this.$("sp"); if (!box) return;
    if (this._err) { box.innerHTML = `<div class="err">Fehler: ${this._err}</div>`; return; }
    if (!this._res) return;
    const c = this._config, n = 288, d = this._series(c.power), [a0, a1] = this._sunRange(n), span = Math.max(1, a1 - a0);
    const W = Math.max(260, (this._w || 400) - 32), H = 64, mx = Math.max(c.kwp ? c.kwp * 1000 : 100, ...d.filter((v) => v != null));
    const X = (i) => ((i - a0) / span) * W, Y = (v) => H - 2 - (v / mx) * (H - 6);
    /* Linie und Flaeche je Abschnitt - fehlende Werte bleiben Luecke */
    let top = "", area = "", first = -1, last = -1, sA = -1, prev = false;
    for (let i = a0; i <= a1 + 1; i++) {
      const ok = i <= a1 && d[i] != null;
      if (ok) { if (first < 0) first = i; last = i; top += `${prev ? "L" : "M"}${X(i).toFixed(1)},${Y(d[i]).toFixed(1)} `; if (sA < 0) sA = i; }
      else if (sA >= 0) { let seg = ""; for (let q = sA; q < i; q++) seg += `${q === sA ? "M" : "L"}${X(q).toFixed(1)},${Y(d[q]).toFixed(1)} `; area += `${seg}L${X(i - 1).toFixed(1)},${H} L${X(sA).toFixed(1)},${H} Z `; sA = -1; }
      prev = ok;
    }
    const pk = Math.max(0, ...d.filter((v) => v != null));
    box.innerHTML = first < 0 ? `<div class="kl" style="text-align:center">heute noch keine Daten</div>` :
      `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="display:block;height:${H}px">
        <line x1="0" x2="${W}" y1="${Y(c.kwp ? c.kwp * 1000 : mx)}" y2="${Y(c.kwp ? c.kwp * 1000 : mx)}" stroke="rgba(0,0,0,0.15)" stroke-dasharray="3 3"/>
        <path d="${area}" fill="${c.color || C.solar}" fill-opacity=".25"/>
        <path d="${top}" fill="none" stroke="${c.color || C.solar}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
       <div class="kl" style="display:flex;justify-content:space-between"><span>${hhmm(new Date(this._t0.getTime() + a0 * 300e3))}</span><span>Spitze heute ${fmtW(pk)}</span><span>${hhmm(new Date(this._t0.getTime() + a1 * 300e3))}</span></div>`;
  }
  getCardSize() { return 5; }
}

const ENT = { entity: {} }, ENTS = { entity: { multiple: true } }, TXT = { text: {} }, ICON = { icon: {} }, COLOR = { text: { type: "color" } }, BOOL = { boolean: {} };
const NUM = (min, max, step = 1) => ({ number: { min, max, step, mode: "box" } });
const f = (name, label, selector) => ({ name, label, selector });
const SEL = (o) => ({ select: { mode: "dropdown", options: o.map(([value, label]) => ({ value, label })) } });
const EN4 = (k, l) => [0, 1, 2, 3].map((i) => f(`${k}__${i}`, `${l}: ${COLS[i]}`, ENT));
const flat = (o, k) => { const d = { ...o }; (o[k] || []).forEach((v, i) => (d[`${k}__${i}`] = v)); for (let i = 0; i < 4; i++) d[`${k}__${i}`] = d[`${k}__${i}`] ?? ""; delete d[k]; return d; };
const unflat = (d, k) => { const o = { ...d }; o[k] = [0, 1, 2, 3].map((i) => d[`${k}__${i}`] || ""); for (let i = 0; i < 4; i++) delete o[`${k}__${i}`]; return o; };
const INV_FIELDS = [f("name", "Name", TXT), f("sub", "Untertitel", TXT), f("color", "Farbe", COLOR), f("icon", "Icon", ICON), f("kwp", "Nennleistung (kW)", NUM(0, 100, 0.1)),
  f("power", "Leistung (W, Shelly)", ENT), ...EN4("energy", "kWh")];
const SCHEMA = {
  "wr-overview": { fields: [f("total_power", "Gesamtleistung (W)", ENT), f("total_invert", "Vorzeichen umdrehen", BOOL), ...EN4("total_energy", "Gesamt kWh"),
      f("warn_ratio", "Warnung unter % vom Median", NUM(10, 100)), f("min_kwh", "Warnung erst ab Tagesertrag (kWh)", NUM(0, 10, 0.1)),
      f("total_quelle", "Gesamt: Datenquelle", SEL([["intern", "intern (Sensoren)"], ["extern", "extern (DB-Server, Zählerstand)"]])), f("total_zaehler", "Gesamt: Zählerstand für extern", ENT),
      f("total_zaehler_statistik", "Gesamt: Statistik für Fallback (leer = Zählerstand)", ENT), f("ranges", "Zeiträume für extern", { object: {} })], flat: "total_energy",
    lists: [{ key: "inverters", title: "Wechselrichter", add: "Wechselrichter hinzufügen", fields: INV_FIELDS, flat: "energy", blank: () => ({ name: "Neu", color: "#666666", kwp: 1, power: "", energy: ["", "", "", ""] }) }] },
  "wr-day": { fields: [],
    lists: [{ key: "inverters", title: "Kurven", add: "Kurve hinzufügen", fields: [f("name", "Name", TXT), f("color", "Farbe", COLOR), f("power", "Leistung (W)", ENT)], blank: () => ({ name: "Neu", color: "#666666", power: "" }) }] },
  "wr-compare": { fields: [f("mode", "Standardansicht", SEL([["spec", "kWh/kWp"], ["abs", "kWh"]])), f("ranges", "Zeiträume für extern (today, week, month, year, last:7d …)", { object: {} })],
    lists: [{ key: "inverters", title: "Wechselrichter", add: "Zeile hinzufügen", fields: [f("name", "Name", TXT), f("color", "Farbe", COLOR), f("kwp", "Nennleistung (kW)", NUM(0, 100, 0.1)), ...EN4("energy", "kWh")], flat: "energy",
      blank: () => ({ name: "Neu", color: "#666666", kwp: 1, energy: ["", "", "", ""] }) }] },
  "wr-unit": { fields: [...INV_FIELDS, f("quelle", "Datenquelle", SEL([["intern", "intern (Sensoren)"], ["extern", "extern (DB-Server, Zählerstand)"]])), f("zaehler", "Zählerstand für extern", ENT),
    f("zaehler_statistik", "Statistik für Fallback (leer = Zählerstand)", ENT), f("ranges", "Zeiträume für extern", { object: {} }), f("compare", "WR-eigene Leistung (Vergleich)", ENT), f("temp", "Temperatur", ENT), f("voltage", "String-Spannung", ENT), f("current", "String-Strom", ENT)], flat: "energy",
    lists: [{ key: "ports", title: "Eingänge / Module", add: "Eingang hinzufügen", fields: [f("name", "Name", TXT), f("power", "Leistung (W)", ENT)], blank: () => ({ name: "Modul", power: "" }) }] },
};
const defs = [["wr-overview", WrOverview, "Wechselrichter Glas: Übersicht"], ["wr-day", WrDay, "Wechselrichter Glas: Tagesverlauf"],
  ["wr-compare", WrCompare, "Wechselrichter Glas: Ertragsvergleich"], ["wr-unit", WrUnit, "Wechselrichter Glas: Einzelner WR"]];
const OBJ_ = { object: {} };
for (const [type, K, label] of defs) {
  const S = SCHEMA[type] || { fields: [] };
  const fields = (S.fields || []).filter((x) => !x.name.includes("__"));
  if (S.flat) fields.push(f(S.flat, `${S.flat} (Liste: Heute, 7 Tage, 14 Tage, Monat)`, OBJ_));
  for (const Li of S.lists || []) fields.push(f(Li.key, `${Li.title} (YAML-Liste)`, OBJ_));
  REG.modules[type] = K;
  REG.editors[type] = { label: label.replace(/ Glas:/, ":"), group: "Wechselrichter", groupIcon: "mdi:solar-power-variant", fields, blank: () => ({ type }) };
}
REG.labels = REG.labels || {};
for (const t of ["wr-compare", "wr-overview"]) REG.labels[t] = { ...(REG.labels[t] || {}), quelle: "Datenquelle (intern / extern)", zaehler: "Zählerstand für extern (kWh, in ltss)", zaehler_statistik: "Statistik für Fallback (leer = Zählerstand)", ranges: "Zeitraum für extern" };
REG.ver = (REG.ver || 0) + 1;

customElements.whenDefined("energie-atlas").then(() => {
  const PR = customElements.get("energie-atlas").prototype;
  if (PR.__regHook) return;
  const d = Object.getOwnPropertyDescriptor(PR, "hass");
  if (!d || !d.set) return;
  PR.__regHook = true;
  Object.defineProperty(PR, "hass", {
    configurable: true, get: d.get,
    set(h) {
      const v = REG.ver || 0;
      if (this._config && this._regV !== v) {
        this._regV = v;
        if ((this._config.modules || []).some((m) => m && REG.modules[m.type])) { this._hass = h; this._build(); return; }
      }
      d.set.call(this, h);
    },
  });
});
})();

/* ===== energie-atlas-sigenergy ===== */
/* energie-atlas-sigenergy – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const C = { solar: "#e0a000", sun: "#f5b400", import: "#b22222", export: "#228b22", batt: "#1e6fd9", dis: "#e07000", home: "#000080", soc: "#7b3fb5", ac: "#0f8b8d" };
const COMPACT_W = 560;

const st = (h, id) => (h && id && h.states[id]) || null;
const num = (h, id) => { const s = st(h, id); if (!s) return null; const v = parseFloat(s.state); return isNaN(v) ? null : v; };
const unit = (h, id) => { const s = st(h, id); return s ? String(s.attributes.unit_of_measurement || "") : ""; };
const pw = (h, id) => { const v = num(h, id); if (v == null) return null; const u = unit(h, id); return u === "kW" ? v * 1000 : u === "MW" ? v * 1e6 : v; };
const kwh = (h, id) => { const v = num(h, id); if (v == null) return null; const u = unit(h, id); return u === "MWh" ? v * 1000 : u === "Wh" ? v / 1000 : v; };
const txt = (h, id) => { const s = st(h, id); return s ? s.state : null; };
const fmtN = (v, d = 0) => (v == null || isNaN(v) ? "–" : v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtW = (v, signed = false) => {
  if (v == null || isNaN(v)) return "–";
  const a = signed ? v : Math.abs(v), s = signed && a > 0 ? "+" : "";
  return Math.abs(a) >= 1200 ? `${s}${fmtN(a / 1000, 2)} kW` : `${s}${fmtN(a, 0)} W`;
};
const fmtKwh = (v) => (v == null ? "–" : fmtN(v, v < 10 ? 2 : v < 100 ? 1 : 0));
const fmtE = (v) => (v == null ? "–" : Math.abs(v) >= 1000 ? `${fmtN(v / 1000, 2)} MWh` : `${fmtKwh(v)} kWh`);
const hhmm = (d) => (d ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–");
const hm = (h) => { const m = Math.max(0, Math.round(h * 60)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`; };
const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const socColor = (p) => (p == null ? "#888" : p >= 60 ? "#2e9d3a" : p >= 30 ? "#e0a000" : "#c0392b");
const TR = {
  Running: "In Betrieb", Standby: "Standby", Shutdown: "Aus", Fault: "Störung", Starting: "Startet", Stopped: "Gestoppt",
  "On Grid": "Netzparallel", "Off Grid": "Inselbetrieb", "Maximum Self Consumption": "Max. Eigenverbrauch",
  "AI Mode": "KI-Modus", TOU: "Zeittarif", "Fully Fed to Grid": "Volleinspeisung", "Remote EMS": "Fern-EMS",
  Custom: "Benutzerdefiniert", unavailable: "nicht erreichbar", unknown: "unbekannt",
};
const tr = (s) => (s == null ? "–" : TR[s] || s);
const ledColor = (s) => (/Running/i.test(s || "") ? "#2e9d3a" : /Fault|Alarm/i.test(s || "") ? "#c0392b" : "#e0a000");

// Statistik-Ergebnis auf festes Raster legen
const bucket = (rows, t0, bms, n, key = "mean", fn) => {
  const out = new Array(n).fill(null);
  for (const r of rows || []) {
    const ts = typeof r.start === "number" ? r.start : Date.parse(r.start);
    const i = Math.round((ts - t0) / bms);
    if (i >= 0 && i < n && r[key] != null) out[i] = fn ? fn(r[key]) : r[key];
  }
  return out;
};

const BASE_CSS = `
  :host { display:block; }
  .glass { color: #000; box-sizing: border-box;
    font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
  .title { display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:600; margin-bottom:10px; }
  .title ha-icon { --mdc-icon-size: 20px; color:#000080; }
  .sub { font-size:11px; opacity:.6; text-align:center; margin-top:6px; }
  .inner { background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.10); border-radius:12px; }
  .num { font-variant-numeric: tabular-nums; }
  .err { color:#a11a1a; font-size:13px; }
  .load { opacity:.6; font-size:13px; text-align:center; padding:12px; }
  .kl { font-size:12px; opacity:.72; }
  .kv { font-size:18px; font-weight:700; }
  svg text { fill:#000; font-size:11px; }
  .chartw { position:relative; }
  .tip { position:absolute; pointer-events:none; background: rgba(255,255,255,0.9); border:1px solid rgba(0,0,0,0.1);
    border-radius:8px; padding:6px 8px; font-size:12px; white-space:nowrap; display:none; box-shadow:0 4px 14px rgba(0,0,0,0.15); z-index:2; }
  .tip b { display:block; margin-bottom:2px; }
  .tip i { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
  .legend { display:flex; justify-content:center; gap:14px; flex-wrap:wrap; font-size:12px; margin-top:6px; }
  .legend span { display:inline-flex; align-items:center; gap:6px; }
  .legend i { width:12px; height:6px; border-radius:2px; display:inline-block; }
  .bidi { position:relative; height:6px; border-radius:3px; background: rgba(0,0,0,0.08); overflow:hidden; }
  .bidi::after { content:""; position:absolute; left:50%; top:-2px; bottom:-2px; width:1px; background: rgba(0,0,0,0.35); }
  .bidi i { position:absolute; top:0; bottom:0; border-radius:3px; transition: all .6s; }
  .pills { display:flex; flex-wrap:wrap; gap:6px; }
  .pill { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:12px; font-size:12px; font-weight:600;
    background: rgba(255,255,255,0.45); border:1px solid rgba(255,255,255,0.45); white-space:nowrap; }
  .pill ha-icon { --mdc-icon-size:15px; }
  .pill.ok { color:#1b6b1b; } .pill.warn { color:#a35200; } .pill.bad { color:#a11a1a; background: rgba(255,205,205,0.6); }
  .ring { width:42px; height:42px; border-radius:50%; flex:none; display:flex; align-items:center; justify-content:center;
    background: conic-gradient(var(--c) calc(var(--p) * 1%), rgba(0,0,0,0.08) 0); position:relative; transition: all .6s; }
  .ring::after { content:""; width:32px; height:32px; border-radius:50%; background: rgba(255,255,255,0.75); position:absolute; }
  .ring ha-icon { position:relative; z-index:1; --mdc-icon-size:18px; color: var(--c); }
  .ico { width:42px; height:42px; border-radius:50%; flex:none; display:flex; align-items:center; justify-content:center; background: rgba(255,255,255,0.55); }
  .ico ha-icon { --mdc-icon-size:22px; color: var(--c); }
  .kpis { display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
  .kpi { padding:10px 12px; display:flex; align-items:center; gap:10px; }
`;

class SigBase {
  constructor(c, el) {
    this.el = el;
    this._config = JSON.parse(JSON.stringify({ ...(this.constructor.defaults || {}), ...(c || {}) }));
    this.shadowRoot = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}${this.constructor.css || ""}</style><div class="glass"><div class="load">Lade…</div></div>`;
    this._dirty = true; this._at = 0;
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver((e) => {
        const w = Math.round(e[0].contentRect.width);
        if (w > 0 && Math.abs(w - (this._w || 0)) > 12) { this._w = w; this._dirty = true; this._resized = true; this._update(true); }
      });
      this._ro.observe(el);
    }
  }
  set hass(h) {
    if (!this.el.isConnected && this._seen) { if (this._ro) this._ro.disconnect(); return; }
    if (this.el.isConnected) this._seen = true;
    this._hass = h; if (!this._last || Date.now() - this._last > (this.constructor.throttle || 2000)) this._update(false);
  }
  _compact() { return (this._w || this.el.clientWidth || 800) < COMPACT_W; }
  get box() { return this.shadowRoot.querySelector(".glass"); }
  $(id) { return this.shadowRoot.getElementById(id); }
  _update(force) {
    if (!this._hass || !this.shadowRoot) return;
    this._last = Date.now();
    this.box.classList.toggle("compact", this._compact());
    try { this.update(force); } catch (e) { this.box.innerHTML = `<div class="err">Fehler: ${e.message || e}</div>`; this._dirty = true; }
  }
  _stats(ids, start, period, types, end, units) {
    return this._hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: start.toISOString(), end_time: (end || new Date()).toISOString(),
      statistic_ids: ids.filter(Boolean), period, types, ...(units ? { units } : {}),
    });
  }
  // Datenabruf mit Schutz gegen Doppelaufrufe; danach this._draw()
  async _load(fn) {
    if (this._loading) return; /* laeuft schon: der laufende Abruf liefert frische Daten, kein zweiter */
    this._loading = true;
    try { await fn(); this._at = Date.now(); this._err = null; }
    catch (e) { this._err = e.message || String(e); this._at = Date.now(); }
    finally {
      this._loading = false;
      if (this._again) { this._again = false; this._load(fn); } else this._draw();
    }
  }
  // Hover-Tooltip fuer Diagramme
  _hover(wrap, W, pL, pwid, n, X, html) {
    const svg = wrap.querySelector("svg"), tip = wrap.querySelector(".tip"), cx = wrap.querySelector(".cx"), hit = wrap.querySelector(".hit");
    if (!svg || !tip || !cx || !hit) return;
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - pL) / pwid) * (n - 1))));
      cx.setAttribute("x1", X(i)); cx.setAttribute("x2", X(i)); cx.style.display = "";
      const c = html(i);
      if (!c) { tip.style.display = "none"; return; }
      tip.innerHTML = c; tip.style.display = "block";
      const left = (X(i) / W) * r.width;
      tip.style.left = (left > r.width / 2 ? Math.max(4, left - tip.offsetWidth - 10) : left + 10) + "px";
      tip.style.top = "8px";
    };
    const leave = () => { tip.style.display = "none"; cx.style.display = "none"; };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", leave);
  }
  _nightRects(X, pL, pT, ph, Wr, n) {
    const s = this._hass.states[this._config.sun || "sun.sun"];
    if (!s || !s.attributes.next_rising || !s.attributes.next_setting) return "";
    const idx = (iso) => { const d = new Date(iso); return ((d.getHours() * 60 + d.getMinutes()) / 1440) * (n - 1); };
    const ri = idx(s.attributes.next_rising), si = idx(s.attributes.next_setting);
    return `<rect x="${pL}" y="${pT}" width="${Math.max(0, X(ri) - pL).toFixed(1)}" height="${ph}" fill="rgba(0,0,60,0.06)"/>` +
      `<rect x="${X(si).toFixed(1)}" y="${pT}" width="${Math.max(0, Wr - X(si)).toFixed(1)}" height="${ph}" fill="rgba(0,0,60,0.06)"/>`;
  }
}

/* ===================================================================== */
/* sig-hero: SigenStor live                                               */
/* ===================================================================== */
const ALARMS = [1, 2, 3, 4, 5, 6, 7].map((i) => `sensor.sigen_plant_general_alarm_${i}`)
  .concat([1, 2, 3, 4, 5].map((i) => `sensor.sigen_inverter_alarm_${i}`));

class SigHero extends SigBase {
  static get defaults() {
    return {
      name: "Hausspeicher",
      strings: [
        { name: "String 1", sub: "Ost", power: "" },
        { name: "String 2", sub: "Ost", power: "" },
        { name: "String 3", sub: "West", power: "" },
      ],
      pv_power: "",
      battery_power: "",
      soc: "",
      capacity: "",
      ac_power: "",
      shelly: "",
      shelly_invert: true,
      running: "",
      grid_status: "",
      ems_mode: "",
      pcs_temp: "",
      cell_temp: "",
      alarms: ALARMS,
      alarm_ok: "No Problem",
      pv_today: "",
      pv_yesterday: "",
      charge_today: "",
      discharge_today: "",
      pv_max: 16000,
    };
  }
  static get throttle() { return 1500; }
  static get css() {
    return `
    .hero { display:grid; grid-template-columns: 1.45fr 1fr; gap:14px; align-items:stretch; }
    .compact .hero { grid-template-columns: 1fr; gap:10px; }
    .flow { position:relative; height: 370px; }
    .compact .flow { height: 320px; }
    .flow svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
    .ln { fill:none; stroke-width:2; vector-effect: non-scaling-stroke; opacity:.2; }
    .ln.on { opacity:1; stroke-width:4; stroke-linecap:round; stroke-dasharray: 0.1 13; animation: sigflow linear infinite; }
    .ln.on.rev { animation-direction: reverse; }
    @keyframes sigflow { to { stroke-dashoffset: -26.2; } }
    .node { --s:62px; position:absolute; transform: translate(-50%, calc(var(--s) / -2)); display:flex; flex-direction:column; align-items:center; gap:1px; text-align:center; }
    .circ { width:var(--s); height:var(--s); border-radius:50%; display:flex; align-items:center; justify-content:center;
      background: rgba(255,255,255,0.84); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      border: 3px solid var(--c); box-shadow: 0 0 0 4px rgba(255,255,255,0.15), 0 0 18px -6px var(--c); position:relative; transition: border-color .6s; }
    .compact .node { --s:52px; }
    .circ ha-icon { --mdc-icon-size: 26px; color: var(--c); }
    .compact .circ ha-icon { --mdc-icon-size: 22px; }
    .node.big { --s:80px; }
    .compact .node.big { --s:64px; }
    .node.big .circ ha-icon { --mdc-icon-size: 32px; }
    .node.off .circ { opacity:.55; }
    .soc { position:absolute; inset:-8px; border-radius:50%;
      background: conic-gradient(var(--sc) calc(var(--p) * 1%), rgba(0,0,0,0.08) 0);
      -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
              mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px)); transition: all .8s; }
    .nv { font-size:15px; font-weight:700; white-space:nowrap; margin-top:3px; }
    .compact .nv { font-size:13px; }
    .nl { font-size:11px; opacity:.75; white-space:nowrap; }
    .dev { position:absolute; transform: translate(-50%, -50%); }
    .devbox { width:124px; padding:10px 8px 14px; border-radius:16px; text-align:center; position:relative;
      background: linear-gradient(160deg, rgba(255,255,255,0.94), rgba(232,238,248,0.84));
      border:2px solid #2b2f3a; box-shadow: 0 8px 24px -10px rgba(0,0,0,0.5), inset 0 0 0 3px rgba(255,255,255,0.6); }
    .devbox::after { content:""; position:absolute; left:50%; bottom:6px; transform:translateX(-50%); width:36px; height:3px; border-radius:2px;
      background: var(--led, #2e9d3a); box-shadow: 0 0 8px var(--led, #2e9d3a); }
    .compact .devbox { width:100px; padding:8px 6px 12px; }
    .dn { font-size:10px; font-weight:800; letter-spacing:1.5px; opacity:.55; }
    .dv { font-size:21px; font-weight:800; margin:2px 0 0; }
    .compact .dv { font-size:16px; }
    .dl { font-size:11px; opacity:.7; }
    .side { display:flex; flex-direction:column; gap:10px; }
    .head { padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .hn { font-size:17px; font-weight:800; }
    .cmp { padding:10px 12px; }
    .cmp .row { display:flex; justify-content:space-between; font-size:13px; padding:2px 0; }
    .cmp .row b { font-variant-numeric: tabular-nums; }
    .cmp .dif { font-size:12px; margin-top:6px; display:flex; justify-content:space-between; }
    .kpi .kl small { opacity:.85; }
    `;
  }
  _build() {
    const c = this._config;
    const n = Math.max(1, (c.strings || []).length);
    const SP = (c.strings || []).map((_, i) => [n === 1 ? 50 : 14 + (72 * i) / (n - 1), 13]);
    const INV = [50, 50], BAT = [20, 84], AC = [80, 84];
    const q = (a, b, cx, cy) => `M ${a[0]} ${a[1]} Q ${cx} ${cy} ${b[0]} ${b[1]}`;
    let paths = SP.map((p, i) => `<path class="ln" id="p-s${i}" d="${q(p, INV, p[0], 40)}" stroke="${C.solar}"/>`).join("");
    paths += `<path class="ln" id="p-bat" d="${q(INV, BAT, 20, 50)}" stroke="${C.batt}"/>`;
    paths += `<path class="ln" id="p-ac" d="${q(INV, AC, 80, 50)}" stroke="${C.ac}"/>`;
    const node = (id, pos, icon, label, color, cls = "", extra = "") => `
      <div class="node ${cls}" id="n-${id}" style="left:${pos[0]}%;top:${pos[1]}%;--c:${color}">
        <div class="circ">${extra}<ha-icon icon="${icon}" id="i-${id}"></ha-icon></div>
        <div class="nv num" id="v-${id}">–</div><div class="nl" id="l-${id}">${label}</div>
      </div>`;
    const strs = (c.strings || []).map((s, i) => node(`s${i}`, SP[i], "mdi:solar-panel", `${s.name}${s.sub ? " · " + s.sub : ""}`, C.solar)).join("");
    const short = String(c.name || "").replace(/^SigenStor\s*/i, "") || "WR";
    this.box.innerHTML = `
      <div class="hero">
        <div class="flow">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">${paths}</svg>
          ${strs}
          <div class="dev" style="left:${INV[0]}%;top:${INV[1]}%"><div class="devbox" id="devbox">
            <div class="dn">${short.toUpperCase()}</div><div class="dv num" id="v-inv">–</div><div class="dl" id="l-inv">PV gesamt</div>
          </div></div>
          ${node("bat", BAT, "mdi:home-battery", "Akku", C.batt, "big", '<div class="soc" id="soc"></div>')}
          ${node("ac", AC, "mdi:home-lightning-bolt", "AC-Ausgang", C.ac, "big")}
        </div>
        <div class="side">
          <div class="inner head"><div><div class="hn">${c.name || "Sigenergy"}</div><div class="kl num" id="h-sub">–</div></div>
            <span class="pill" id="p-run">–</span></div>
          <div class="pills">
            <span class="pill" id="p-grid"><ha-icon icon="mdi:transmission-tower"></ha-icon><span>–</span></span>
            <span class="pill" id="p-ems"><ha-icon icon="mdi:cog-transfer-outline"></ha-icon><span>–</span></span>
            <span class="pill" id="p-alarm"><ha-icon icon="mdi:shield-check-outline"></ha-icon><span>–</span></span>
            <span class="pill" id="p-pcs"><ha-icon icon="mdi:thermometer"></ha-icon><span>–</span></span>
            <span class="pill" id="p-cell"><ha-icon icon="mdi:battery-heart-variant"></ha-icon><span>–</span></span>
          </div>
          <div class="inner cmp">
            <div class="kl" style="margin-bottom:4px">Messvergleich AC-Seite</div>
            <div class="row"><span>Wechselrichter meldet</span><b id="c-wr">–</b></div>
            <div class="row"><span>Shelly misst</span><b id="c-sh">–</b></div>
            <div class="bidi" style="margin-top:6px"><i id="c-bar"></i></div>
            <div class="dif"><span class="kl">Abweichung</span><b class="num" id="c-d">–</b></div>
          </div>
          <div class="kpis">
            <div class="inner kpi"><div class="ring" id="r-pv" style="--c:${C.solar};--p:0"><ha-icon icon="mdi:white-balance-sunny"></ha-icon></div>
              <div><div class="kv num" id="k-pv">–</div><div class="kl" id="k-pvl">PV heute</div></div></div>
            <div class="inner kpi"><div class="ico" style="--c:#8a6d00"><ha-icon icon="mdi:calendar-arrow-left"></ha-icon></div>
              <div><div class="kv num" id="k-y">–</div><div class="kl">PV gestern</div></div></div>
            <div class="inner kpi"><div class="ico" style="--c:${C.batt}"><ha-icon icon="mdi:battery-arrow-up"></ha-icon></div>
              <div><div class="kv num" id="k-c">–</div><div class="kl">Geladen heute</div></div></div>
            <div class="inner kpi"><div class="ico" style="--c:${C.dis}"><ha-icon icon="mdi:battery-arrow-down"></ha-icon></div>
              <div><div class="kv num" id="k-d">–</div><div class="kl">Entladen heute</div></div></div>
          </div>
        </div>
      </div>`;
    this._dirty = false;
  }
  _line(id, w, rev) {
    const p = this.$(id);
    if (!p) return;
    const on = Math.abs(w || 0) > 15;
    p.classList.toggle("on", on);
    p.classList.toggle("rev", on && !!rev);
    if (on) {
      const dur = Math.max(0.45, Math.min(4, 26 / Math.sqrt(Math.abs(w)))).toFixed(2) + "s";
      if (p.style.animationDuration !== dur) p.style.animationDuration = dur;
    }
  }
  _pill(id, text, cls, icon) {
    const p = this.$(id);
    if (!p) return;
    p.className = `pill ${cls || ""}`;
    const s = p.querySelector("span");
    if (s) s.textContent = text; else p.textContent = text;
    if (icon) { const i = p.querySelector("ha-icon"); if (i) i.setAttribute("icon", icon); }
  }
  update() {
    if (this._dirty) this._build();
    const h = this._hass, c = this._config, $ = (id) => this.$(id);
    let sum = 0;
    (c.strings || []).forEach((s, i) => {
      const w = Math.max(0, pw(h, s.power) || 0);
      sum += w;
      this._line(`p-s${i}`, w);
      $(`v-s${i}`).textContent = fmtW(w);
      $(`n-s${i}`).classList.toggle("off", w <= 15);
    });
    const pv = c.pv_power ? Math.max(0, pw(h, c.pv_power) ?? sum) : sum;
    const batR = pw(h, c.battery_power), bat = batR || 0;
    const acR = pw(h, c.ac_power), ac = acR || 0;
    const soc = num(h, c.soc), cap = kwh(h, c.capacity);
    this._line("p-bat", bat, bat < 0);
    this._line("p-ac", ac, ac < 0);

    $("v-inv").textContent = fmtW(pv);
    $("l-inv").textContent = pv > 15 ? `PV · ${fmtN(Math.min(100, (pv / (c.pv_max || 16000)) * 100), 0)} % Last` : "PV ruht";
    $("v-bat").textContent = fmtW(batR, true);
    $("l-bat").textContent = `${bat > 15 ? "lädt" : bat < -15 ? "entlädt" : "Ruhe"}${soc != null ? " · " + fmtN(soc, 0) + " %" : ""}`;
    $("n-bat").style.setProperty("--c", bat < -15 ? C.dis : C.batt);
    $("soc").style.setProperty("--p", soc == null ? 0 : soc);
    $("soc").style.setProperty("--sc", socColor(soc));
    $("i-bat").setAttribute("icon", soc == null ? "mdi:home-battery" : bat > 15 ? "mdi:battery-charging-high" : soc > 90 ? "mdi:battery" : soc > 60 ? "mdi:battery-70" : soc > 30 ? "mdi:battery-40" : "mdi:battery-10");
    $("v-ac").textContent = fmtW(acR);
    $("l-ac").textContent = ac > 15 ? "AC-Ausgang" : ac < -15 ? "AC-Laden" : "AC";
    $("n-ac").style.setProperty("--c", ac < -15 ? C.export : C.ac);

    const run = txt(h, c.running);
    $("devbox").style.setProperty("--led", ledColor(run));
    this._pill("p-run", tr(run), /Running/i.test(run || "") ? "ok" : /Fault/i.test(run || "") ? "bad" : "warn");
    const gs = txt(h, c.grid_status);
    this._pill("p-grid", tr(gs), /On Grid/i.test(gs || "") ? "ok" : "warn");
    this._pill("p-ems", tr(txt(h, c.ems_mode)), "");
    const al = (c.alarms || []).map((id) => txt(h, id)).filter((v) => v != null && v !== "unavailable" && v !== "unknown");
    const bad = al.filter((v) => v !== (c.alarm_ok || "No Problem"));
    this._pill("p-alarm", bad.length ? `${bad.length} Alarm${bad.length > 1 ? "e" : ""}` : "Keine Alarme", bad.length ? "bad" : "ok",
      bad.length ? "mdi:alert-octagon-outline" : "mdi:shield-check-outline");
    if (bad.length) $("p-alarm").title = bad.join("\n");
    const pt = num(h, c.pcs_temp), ct = num(h, c.cell_temp);
    this._pill("p-pcs", `WR ${fmtN(pt, 0)} °C`, pt != null && pt >= 70 ? "bad" : pt != null && pt >= 60 ? "warn" : "");
    this._pill("p-cell", `Zellen ${fmtN(ct, 0)} °C`, ct != null && (ct >= 45 || ct <= 3) ? "bad" : ct != null && (ct >= 38 || ct <= 8) ? "warn" : "");
    $("h-sub").textContent = cap != null && soc != null ? `Akku ${fmtKwh((soc / 100) * cap)} von ${fmtKwh(cap)} kWh` : "";

    // Messvergleich Wechselrichter vs. Shelly
    const sh0 = pw(h, c.shelly);
    const sh = sh0 == null ? null : sh0 * (c.shelly_invert ? -1 : 1);
    $("c-wr").textContent = fmtW(acR, true);
    $("c-sh").textContent = fmtW(sh, true);
    if (sh == null) { $("c-d").textContent = "–"; $("c-bar").style.width = "0"; }
    else {
      const d = sh - ac, ref = Math.max(Math.abs(ac), Math.abs(sh));
      if (ref < 30) { $("c-d").textContent = "zu gering für Vergleich"; $("c-d").style.color = ""; $("c-bar").style.width = "0"; }
      else {
        const pct = (Math.abs(d) / ref) * 100;
        $("c-d").textContent = `${fmtW(d, true)} · ${fmtN(pct, pct < 10 ? 1 : 0)} %`;
        $("c-d").style.color = pct > 15 ? "#a11a1a" : pct > 6 ? "#a35200" : "#1b6b1b";
        const w = Math.min(50, (pct / 30) * 50), bar = $("c-bar");
        bar.style.background = pct > 15 ? "#c0392b" : pct > 6 ? C.dis : C.export;
        bar.style.width = w + "%";
        bar.style.left = d >= 0 ? "50%" : 50 - w + "%";
      }
    }

    const pt0 = num(h, c.pv_today), py = num(h, c.pv_yesterday);
    $("k-pv").textContent = fmtKwh(pt0) + " kWh";
    $("r-pv").style.setProperty("--p", pt0 != null && py ? Math.min(100, (pt0 / py) * 100) : 0);
    $("k-pvl").innerHTML = pt0 != null && py ? `PV heute <small>· ${fmtN((pt0 / py) * 100, 0)} % v. gestern</small>` : "PV heute";
    $("k-y").textContent = fmtKwh(py) + " kWh";
    $("k-c").textContent = fmtKwh(kwh(h, c.charge_today)) + " kWh";
    $("k-d").textContent = fmtKwh(kwh(h, c.discharge_today)) + " kWh";
  }
  getCardSize() { return 7; }
}

/* ===================================================================== */
/* sig-strings: MPPT-Strings                                              */
/* ===================================================================== */
const STR = (i, sub, color) => ({
  name: `String ${i}`, sub, color,
  power: `sensor.sigen_inverter_pv${i}_power`, voltage: `sensor.sigen_inverter_pv${i}_voltage`, current: `sensor.sigen_inverter_pv${i}_current`,
  today: `sensor.sigen_inverter_pv${i}_daily_energy`, week: `sensor.sigen_pv${i}_energie_7_tage_hka`,
  two_weeks: `sensor.sigen_pv${i}_energie_14_tage_hka`, month: `sensor.sigen_pv${i}_energie_monat_hka`,
});
class SigStrings extends SigBase {
  static get defaults() {
    return {
      kwp: 16, sun: "sun.sun", total_today: "",
      strings: [STR(1, "Ost", "#f5b400"), STR(2, "Ost", "#ff8a00"), STR(3, "West", "#d84315")],
    };
  }
  static get throttle() { return 3000; }
  static get css() {
    return `
    .tiles { display:grid; grid-template-columns: repeat(var(--n,3), 1fr); gap:8px; }
    .compact .tiles { grid-template-columns: 1fr; }
    .tile { padding:10px 12px; border-top:3px solid var(--c); }
    .tn { display:flex; align-items:center; gap:6px; font-size:14px; font-weight:700; }
    .tn i { width:9px; height:9px; border-radius:50%; background:var(--c); display:inline-block; }
    .tn small { font-weight:400; opacity:.65; }
    .tp { font-size:24px; font-weight:800; margin:4px 0 0; }
    .compact .tp { font-size:20px; }
    .tui { font-size:12px; opacity:.78; display:flex; gap:12px; }
    .share { height:6px; border-radius:3px; background: rgba(0,0,0,0.08); overflow:hidden; margin:8px 0 6px; }
    .share i { display:block; height:100%; background: var(--c); border-radius:3px; transition: width .6s; }
    .per { display:grid; grid-template-columns: 1fr 1fr; gap:3px 12px; font-size:12px; }
    .per span { display:flex; justify-content:space-between; gap:4px; }
    .per span em { font-style:normal; opacity:.7; }
    .per b { font-variant-numeric: tabular-nums; }
    .tot { display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; padding:10px 12px; margin:8px 0; }
    .compact .tot { grid-template-columns: 1fr 1fr; }
    .tot > div { display:flex; flex-direction:column; }
    .tot .kv { font-size:16px; }
    `;
  }
  _build() {
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:solar-panel-large"></ha-icon>Strings (MPPT)</div>
      <div class="tiles" id="tiles" style="--n:${Math.max(1, (this._config.strings || []).length)}"></div>
      <div class="inner tot" id="tot"></div>
      <div id="chart"><div class="load">Lade Tagesverlauf…</div></div>`;
    this._dirty = false;
    if (this._res) this._draw();
  }
  update(force) {
    if (this._dirty) this._build();
    const h = this._hass, c = this._config, S = c.strings || [];
    const vals = S.map((s) => ({ p: Math.max(0, pw(h, s.power) || 0), u: num(h, s.voltage), i: num(h, s.current),
      t: kwh(h, s.today), w: kwh(h, s.week), w2: kwh(h, s.two_weeks), m: kwh(h, s.month) }));
    const sumT = vals.reduce((a, v) => a + (v.t || 0), 0) || 0;
    const sumP = vals.reduce((a, v) => a + v.p, 0);
    const per = (lbl, v) => `<span><em>${lbl}</em><b>${fmtKwh(v)}</b></span>`;
    this.$("tiles").innerHTML = S.map((s, k) => {
      const v = vals[k], share = sumT ? ((v.t || 0) / sumT) * 100 : 0;
      return `<div class="inner tile" style="--c:${s.color || C.solar}">
        <div class="tn"><i></i>${s.name}<small>${s.sub ? "· " + s.sub : ""}</small></div>
        <div class="tp num">${fmtW(v.p)}</div>
        <div class="tui num"><span>${fmtN(v.u, 0)} V</span><span>${fmtN(v.i, 2)} A</span><span>${fmtN(share, 0)} % v. Tag</span></div>
        <div class="share"><i style="width:${share.toFixed(1)}%"></i></div>
        <div class="per">${per("heute", v.t)}${per("7 T", v.w)}${per("14 T", v.w2)}${per("Monat", v.m)}</div>
      </div>`;
    }).join("");
    // Verteilung nach Ausrichtung (Untertitel)
    const dir = {};
    S.forEach((s, k) => { const key = s.sub || s.name; dir[key] = (dir[key] || 0) + (vals[k].t || 0); });
    const dirTxt = Object.entries(dir).map(([k, v]) => `${k} ${fmtN(sumT ? (v / sumT) * 100 : 0, 0)} %`).join(" · ");
    const tt = c.total_today ? kwh(h, c.total_today) : sumT;
    this.$("tot").innerHTML = `
      <div><span class="kl">Strings jetzt</span><span class="kv num" style="color:${C.solar}">${fmtW(sumP)}</span></div>
      <div><span class="kl">Auslastung</span><span class="kv num">${c.kwp ? fmtN(Math.min(100, (sumP / (c.kwp * 1000)) * 100), 0) + " %" : "–"}</span></div>
      <div><span class="kl">Heute gesamt</span><span class="kv num">${fmtKwh(tt)} kWh</span></div>
      <div><span class="kl">Verteilung heute</span><span class="kv num" style="font-size:13px">${dirTxt || "–"}</span></div>`;
    if (!this._at || Date.now() - this._at > 5 * 60e3 || midnight().getTime() !== (this._t0 && this._t0.getTime())) {
      this._load(async () => {
        this._t0 = midnight();
        this._res = await this._stats((c.strings || []).map((s) => s.power), this._t0, "5minute", ["mean"], null, { power: "W" });
      });
    } else if (force || this._resized) { this._resized = false; this._draw(); }
  }
  _draw() {
    const box = this.$("chart");
    if (!box) return;
    if (this._err) { box.innerHTML = `<div class="err">Fehler: ${this._err}</div>`; return; }
    if (!this._res) return;
    const c = this._config, S = c.strings || [], compact = this._compact();
    const n = 288, t0 = this._t0.getTime(), bms = 300e3;
    const data = S.map((s) => bucket(this._res[s.power], t0, bms, n, "mean", (v) => Math.max(0, v)));
    const stack = []; let acc = new Array(n).fill(0);
    const has = new Array(n).fill(false);
    data.forEach((a) => { a.forEach((v, i) => { if (v != null) has[i] = true; }); });
    data.forEach((a) => { const top = acc.map((v, i) => v + (a[i] || 0)); stack.push({ lo: acc, hi: top }); acc = top; });
    const W = Math.max(300, (this._w || 600) - (compact ? 20 : 32)), H = compact ? 190 : 220;
    const pL = 40, pR = 6, pT = 10, pB = 22, pwid = W - pL - pR, ph = H - pT - pB;
    let mx = Math.max(1000, ...acc);
    const u = mx > 8000 ? 2000 : mx > 3000 ? 1000 : 500;
    mx = Math.ceil(mx / u) * u;
    const X = (i) => pL + (i / (n - 1)) * pwid, Y = (v) => pT + ((mx - v) / mx) * ph;
    let g = this._nightRects(X, pL, pT, ph, W - pR, n);
    for (let v = 0; v <= mx + 1; v += u) {
      g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,${v === 0 ? 0.35 : 0.1})"/>`;
      g += `<text x="${pL - 4}" y="${Y(v) + 4}" text-anchor="end">${v >= 1000 ? fmtN(v / 1000, 0) + "k" : fmtN(v, 0)}</text>`;
    }
    for (let hh = 0; hh <= 24; hh += compact ? 6 : 3) g += `<text x="${X(Math.min(n - 1, hh * 12))}" y="${H - 6}" text-anchor="middle">${String(hh).padStart(2, "0")}</text>`;
    const last = has.lastIndexOf(true);
    /* Abschnitte mit Daten; wo kein String einen Wert hat, bleibt eine Luecke */
    const segs = []; let s0 = -1;
    for (let i = 0; i <= last + 1; i++) { const ok = i <= last && has[i]; if (ok && s0 < 0) s0 = i; if (!ok && s0 >= 0) { segs.push([s0, i - 1]); s0 = -1; } }
    for (let i = 0; i < last; i++) if (!has[i]) g += `<rect x="${X(i).toFixed(1)}" y="${pT}" width="${Math.max(0.5, X(i + 1) - X(i)).toFixed(2)}" height="${ph}" fill="rgba(0,0,0,0.06)"/>`;
    stack.forEach((sl, k) => {
      if (last < 0) return;
      let area = "", line = "";
      for (const [a0, a1] of segs) {
        let top = "", bot = "";
        for (let i = a0; i <= a1; i++) top += `${i === a0 ? "M" : "L"}${X(i).toFixed(1)},${Y(sl.hi[i]).toFixed(1)} `;
        for (let i = a1; i >= a0; i--) bot += `L${X(i).toFixed(1)},${Y(sl.lo[i]).toFixed(1)} `;
        area += `${top}${bot}Z `; line += top;
      }
      const col = S[k].color || C.solar;
      if (area) g += `<path d="${area}" fill="${col}" fill-opacity=".55"/><path d="${line}" fill="none" stroke="${col}" stroke-width="1.4"/>`;
    });
    const nowI = (Date.now() - t0) / bms;
    if (nowI < n) g += `<line x1="${X(nowI)}" x2="${X(nowI)}" y1="${pT}" y2="${pT + ph}" stroke="#000080" stroke-opacity=".5"/>`;
    g += `<line class="cx" x1="0" x2="0" y1="${pT}" y2="${pT + ph}" stroke="#000080" stroke-dasharray="3,3" style="display:none"/>`;
    g += `<rect class="hit" x="${pL}" y="${pT}" width="${pwid}" height="${ph}" fill="transparent"/>`;
    const legend = S.map((s) => `<span><i style="background:${s.color || C.solar}"></i>${s.name}${s.sub ? " · " + s.sub : ""}</span>`).join("");
    box.innerHTML = `<div class="chartw"><svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg><div class="tip"></div></div>
      <div class="legend">${legend}</div><div class="sub">Tagesverlauf gestapelt · 5-Min-Mittel · Nacht hinterlegt</div>`;
    this._hover(box, W, pL, pwid, n, X, (i) => {
      if (i > last) return "";
      const rows = S.map((s, k) => `<div><i style="background:${s.color || C.solar}"></i>${s.name}: ${fmtW(data[k][i])}</div>`).join("");
      return `<b>${hhmm(new Date(t0 + i * bms))} · ${fmtW(acc[i])}</b>${rows}`;
    });
  }
  getCardSize() { return 7; }
}

/* ===================================================================== */
/* sig-battery: Akku                                                      */
/* ===================================================================== */
class SigBattery extends SigBase {
  static get defaults() {
    return {
      name: "Sigenergy Akku",
      soc: "",
      power: "",
      capacity: "",
      soh: "",
      cell_temp: "",
      rated_charge: "",
      rated_discharge: "",
      min_soc: 0,
      charge: ["", "", "", ""],
      discharge: ["", "", "", ""],
      cols: ["Heute", "7 Tage", "14 Tage", "Monat"],
      total_charge: "",
      total_discharge: "",
      hours: 24,
    };
  }
  static get throttle() { return 2000; }
  static get css() {
    return `
    .btop { display:grid; grid-template-columns: 90px 1fr; gap:14px; align-items:center; }
    .bcell { position:relative; width:72px; height:134px; border:3px solid rgba(0,0,0,0.6); border-radius:12px; padding:4px; box-sizing:border-box; margin:10px auto 0; background: rgba(255,255,255,0.35); }
    .bcell::before { content:""; position:absolute; top:-10px; left:23px; width:20px; height:7px; border-radius:3px 3px 0 0; background: rgba(0,0,0,0.6); }
    .liq { position:absolute; left:4px; right:4px; bottom:4px; border-radius:7px; transition: height .8s, background .8s; overflow:hidden; }
    .liq::after { content:""; position:absolute; inset:0; background: linear-gradient(90deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 45%, rgba(255,255,255,0.18)); }
    .liq.chg::before, .liq.dis::before { content:""; position:absolute; left:0; right:0; height:40%;
      background: linear-gradient(0deg, rgba(255,255,255,0), rgba(255,255,255,0.45), rgba(255,255,255,0)); }
    .liq.chg::before { animation: sigrise 2.2s linear infinite; }
    .liq.dis::before { animation: sigfall 2.2s linear infinite; }
    @keyframes sigrise { from { top:100% } to { top:-40% } }
    @keyframes sigfall { from { top:-40% } to { top:100% } }
    .pct { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:800; text-shadow: 0 0 5px rgba(255,255,255,0.95); }
    .bp { font-size:28px; font-weight:800; line-height:1.1; }
    .bs { font-size:13px; opacity:.8; margin:2px 0 8px; }
    .chips { display:grid; grid-template-columns: repeat(4, 1fr); gap:6px; margin-top:10px; }
    .compact .chips { grid-template-columns: 1fr 1fr; }
    .chip { padding:7px 9px; display:flex; flex-direction:column; }
    .chip .kv { font-size:15px; }
    .tbl { margin-top:8px; padding:6px 12px; }
    .tr { display:grid; grid-template-columns: 88px repeat(4, 1fr); gap:6px; align-items:center; padding:4px 0; font-size:13px; }
    .tr + .tr { border-top:1px solid rgba(0,0,0,0.06); }
    .tr.h { font-size:11px; opacity:.6; }
    .tr.h span, .tr b { text-align:right; }
    .tr b { font-variant-numeric: tabular-nums; }
    .tr .lb { display:flex; align-items:center; gap:6px; font-weight:600; }
    .tr .lb i { width:8px; height:8px; border-radius:50%; display:inline-block; }
    .life { display:grid; grid-template-columns: repeat(3, 1fr); gap:6px; margin-top:8px; }
    .life > div { padding:7px 9px; display:flex; flex-direction:column; }
    .life .kv { font-size:15px; }
    `;
  }
  _build() {
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:home-battery"></ha-icon><span id="bt">Akku</span></div>
      <div class="btop"><div class="bcell"><div class="liq" id="liq"></div><div class="pct num" id="pct">–</div></div><div id="binfo"></div></div>
      <div id="rest"></div><div id="chart" style="margin-top:10px"><div class="load">Lade Verlauf…</div></div>`;
    this._dirty = false;
    if (this._res) this._draw();
  }
  update(force) {
    if (this._dirty) this._build();
    const h = this._hass, c = this._config;
    this.$("bt").textContent = c.name || "Akku";
    const soc = num(h, c.soc), p = pw(h, c.power), cap = kwh(h, c.capacity);
    const e = soc != null && cap != null ? (soc / 100) * cap : null;
    const rc = pw(h, c.rated_charge), rd = pw(h, c.rated_discharge);
    const cls = p > 15 ? "chg" : p < -15 ? "dis" : "";
    const col = p > 15 ? C.batt : p < -15 ? C.dis : "#555";
    let rest = "";
    if (soc != null && cap && p != null && Math.abs(p) > 50) {
      if (p > 0) rest = `voll in ≈ ${hm((((100 - soc) / 100) * cap) / (p / 1000))}`;
      else { const ms = c.min_soc || 0; rest = soc > ms ? `${ms ? ms + " % " : "leer "}in ≈ ${hm((((soc - ms) / 100) * cap) / (-p / 1000))}` : ""; }
    }
    const max = p >= 0 ? rc || 3000 : rd || 3000;
    const w = Math.min(50, (Math.abs(p || 0) / max) * 50);
    const bidi = p >= 0 ? `<i style="left:50%;width:${w}%;background:${C.batt}"></i>` : `<i style="left:${50 - w}%;width:${w}%;background:${C.dis}"></i>`;
    const tc = kwh(h, c.total_charge), td = kwh(h, c.total_discharge);
    const cyc = td != null && cap ? td / cap : null;
    const eff = tc && td != null ? (td / tc) * 100 : null;
    const row = (lbl, color, ids) => `<div class="tr"><span class="lb"><i style="background:${color}"></i>${lbl}</span>${(ids || []).map((id) => `<b>${fmtKwh(kwh(h, id))}</b>`).join("")}</div>`;
    const liq = this.$("liq");
    if (liq.className !== `liq ${cls}`.trim()) liq.className = `liq ${cls}`.trim();
    liq.style.height = `calc(${soc || 0}% - 8px * ${(soc || 0) / 100})`;
    liq.style.background = socColor(soc);
    this.$("pct").textContent = `${fmtN(soc, 0)}%`;
    this.$("binfo").innerHTML = `
          <div class="bp num" style="color:${col}">${fmtW(p, true)}</div>
          <div class="bs">${p > 15 ? "lädt" : p < -15 ? "entlädt" : "Ruhe"}${rest ? " · " + rest : ""}</div>
          <div class="kl num">${fmtKwh(e)} von ${fmtKwh(cap)} kWh gespeichert</div>
          <div class="bidi" style="margin-top:8px">${bidi}</div>
          <div class="kl" style="display:flex;justify-content:space-between;margin-top:3px"><span>− ${fmtW(rd)}</span><span>+ ${fmtW(rc)}</span></div>`;
    this.$("rest").innerHTML = `
      <div class="chips">
        <div class="inner chip"><span class="kl">Gesundheit</span><span class="kv num">${fmtN(num(h, c.soh), 0)} %</span></div>
        <div class="inner chip"><span class="kl">Zelltemperatur</span><span class="kv num">${fmtN(num(h, c.cell_temp), 1)} °C</span></div>
        <div class="inner chip"><span class="kl">Zyklen (äquiv.)</span><span class="kv num">${fmtN(cyc, 0)}</span></div>
        <div class="inner chip"><span class="kl">Wirkungsgrad</span><span class="kv num">${fmtN(eff, 1)} %</span></div>
      </div>
      <div class="inner tbl">
        <div class="tr h"><span></span>${(c.cols || []).map((x) => `<span>${x}</span>`).join("")}</div>
        ${row("Geladen", C.batt, c.charge)}${row("Entladen", C.dis, c.discharge)}
      </div>
      <div class="sub">Zyklen = Σ entladen ÷ Kapazität · Wirkungsgrad = Σ entladen ÷ Σ geladen (Lebenszeit) · Durchsatz ${fmtE(td)}</div>`;
    if (!this._at || Date.now() - this._at > 5 * 60e3) {
      this._load(async () => {
        const end = new Date(); this._t0 = new Date(Math.floor((end.getTime() - c.hours * 3600e3) / 300e3) * 300e3);
        this._res = await this._stats([c.soc, c.power], this._t0, "5minute", ["mean"], end, { power: "W" });
      });
    } else if (force || this._resized) { this._resized = false; this._draw(); }
  }
  _draw() {
    const box = this.$("chart");
    if (!box) return;
    if (this._err) { box.innerHTML = `<div class="err">Fehler: ${this._err}</div>`; return; }
    if (!this._res) return;
    const c = this._config, compact = this._compact();
    const bms = 300e3, t0 = this._t0.getTime(), n = Math.round((c.hours * 3600e3) / bms) + 1;
    const P = bucket(this._res[c.power], t0, bms, n), S = bucket(this._res[c.soc], t0, bms, n);
    const W = Math.max(300, (this._w || 600) - (compact ? 20 : 32)), H = compact ? 170 : 190;
    const pL = 40, pR = 34, pT = 10, pB = 22, pwid = W - pL - pR, ph = H - pT - pB;
    const vals = P.filter((v) => v != null);
    let mx = Math.max(500, ...vals), mn = Math.min(-500, ...vals);
    const u = mx - mn > 5000 ? 2000 : mx - mn > 2000 ? 1000 : 500;
    mx = Math.ceil(mx / u) * u; mn = Math.floor(mn / u) * u;
    const X = (i) => pL + (i / (n - 1)) * pwid, Y = (v) => pT + ((mx - v) / (mx - mn)) * ph, YS = (p) => pT + ((100 - p) / 100) * ph;
    let g = "";
    for (let v = mn; v <= mx + 1; v += u) {
      g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,${v === 0 ? 0.35 : 0.1})"/>`;
      g += `<text x="${pL - 4}" y="${Y(v) + 4}" text-anchor="end">${Math.abs(v) >= 1000 ? fmtN(v / 1000, 0) + "k" : fmtN(v, 0)}</text>`;
    }
    for (const p of [0, 50, 100]) g += `<text x="${W - pR + 4}" y="${YS(p) + 4}" style="fill:${C.soc}">${p}%</text>`;
    for (let i = 0; i < n; i++) {
      const d = new Date(t0 + i * bms);
      if (d.getMinutes() === 0 && d.getHours() % (compact ? 6 : 3) === 0) {
        g += `<line x1="${X(i)}" x2="${X(i)}" y1="${pT}" y2="${pT + ph}" stroke="rgba(0,0,0,0.06)"/>`;
        g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${String(d.getHours()).padStart(2, "0")}:00</text>`;
      }
    }
    // Leistung als Balken (laden blau nach oben, entladen orange nach unten)
    const bw = Math.max(1, pwid / n);
    P.forEach((v, i) => {
      if (v == null || Math.abs(v) < 5) return;
      const y0 = Y(0), y1 = Y(v);
      g += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(2)}" height="${Math.abs(y1 - y0).toFixed(1)}" fill="${v > 0 ? C.batt : C.dis}" fill-opacity=".55"/>`;
    });
    let d = "", on = false;
    S.forEach((v, i) => { if (v == null) { on = false; return; } d += `${on ? "L" : "M"}${X(i).toFixed(1)},${YS(v).toFixed(1)} `; on = true; });
    g += `<path d="${d}" fill="none" stroke="${C.soc}" stroke-width="2" stroke-dasharray="4 3"/>`;
    g += `<line class="cx" x1="0" x2="0" y1="${pT}" y2="${pT + ph}" stroke="#000080" stroke-dasharray="3,3" style="display:none"/>`;
    g += `<rect class="hit" x="${pL}" y="${pT}" width="${pwid}" height="${ph}" fill="transparent"/>`;
    box.innerHTML = `<div class="chartw"><svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg><div class="tip"></div></div>
      <div class="legend"><span><i style="background:${C.batt}"></i>Laden</span><span><i style="background:${C.dis}"></i>Entladen</span><span><i style="background:${C.soc}"></i>SoC</span></div>
      <div class="sub">Letzte ${c.hours} h · 5-Min-Mittel</div>`;
    this._hover(box, W, pL, pwid, n, X, (i) => (P[i] == null && S[i] == null ? "" :
      `<b>${hhmm(new Date(t0 + i * bms))}</b><div><i style="background:${(P[i] || 0) >= 0 ? C.batt : C.dis}"></i>${fmtW(P[i], true)}</div><div><i style="background:${C.soc}"></i>SoC ${fmtN(S[i], 0)} %</div>`));
  }
  getCardSize() { return 8; }
}

/* ===================================================================== */
/* sig-flow: Tagesbilanz als Energiefluss                                 */
/* ===================================================================== */
class SigFlow extends SigBase {
  static get defaults() {
    return {
      pv: "",
      discharge: "",
      import: "",
      load: "",
      charge: "",
      export: "",
    };
  }
  static get throttle() { return 15000; }
  static get css() {
    return `
    .kp3 { display:grid; grid-template-columns: repeat(3, 1fr); gap:6px; margin-top:8px; }
    .kp3 > div { padding:8px 10px; display:flex; flex-direction:column; }
    .kp3 .kv { font-size:16px; }
    svg text.v { font-weight:700; font-size:12px; }
    `;
  }
  update() {
    const h = this._hass, c = this._config, compact = this._compact();
    const v = (id) => Math.max(0, kwh(h, id) || 0);
    const P = v(c.pv), D = v(c.discharge), G = v(c.import), L = v(c.load), Ch = v(c.charge), E = v(c.export);
    // vereinfachte Zuordnung: Netz + Akku decken zuerst die Last, PV fuellt den Rest
    const g2l = Math.min(G, L), d2l = Math.min(D, L - g2l), p2l = Math.max(0, L - g2l - d2l);
    const p2c = Math.min(Math.max(0, P - p2l), Ch), g2c = Math.max(0, Math.min(G - g2l, Ch - p2c));
    const p2e = Math.max(0, P - p2l - p2c), d2e = Math.max(0, D - d2l);
    const src = [["Solar", P, C.solar], ["Akku entladen", D, C.dis], ["Netzbezug", G, C.import]];
    const snk = [["Verbrauch", L, C.home], ["Akku laden", Ch, C.batt], ["Einspeisung", E, C.export]];
    const links = [[0, 0, p2l], [0, 1, p2c], [0, 2, p2e], [1, 0, d2l], [1, 2, d2e], [2, 0, g2l], [2, 1, g2c]].filter((l) => l[2] > 0.005);
    const W = Math.max(300, (this._w || 600) - (compact ? 20 : 32)), H = compact ? 220 : 250;
    const lw = compact ? 92 : 120, nw = 12, gap = 12;
    const x0 = lw, x1 = W - lw - nw;
    const tot = Math.max(0.01, src.reduce((a, s) => a + s[1], 0), snk.reduce((a, s) => a + s[1], 0));
    const k = (H - 20 - gap * 2) / tot;
    const place = (arr) => { let y = 10; return arr.map((s) => { const hh = Math.max(s[1] > 0 ? 3 : 1, s[1] * k); const r = { y, h: hh, off: 0 }; y += hh + gap; return r; }); };
    const ps = place(src), pt = place(snk);
    let g = "";
    links.forEach(([a, b, val]) => {
      const hh = val * k, s = ps[a], t = pt[b];
      const ys = s.y + s.off, yt = t.y + t.off; s.off += hh; t.off += hh;
      const mx = (x0 + nw + x1) / 2;
      g += `<path d="M${x0 + nw},${ys.toFixed(1)} C${mx},${ys.toFixed(1)} ${mx},${yt.toFixed(1)} ${x1},${yt.toFixed(1)} L${x1},${(yt + hh).toFixed(1)} C${mx},${(yt + hh).toFixed(1)} ${mx},${(ys + hh).toFixed(1)} ${x0 + nw},${(ys + hh).toFixed(1)} Z"
        fill="${src[a][2]}" fill-opacity=".32"><title>${src[a][0]} → ${snk[b][0]}: ${fmtKwh(val)} kWh</title></path>`;
    });
    const lbl = (arr, pos, x, anchor, dx) => arr.map((s, i) => {
      const p = pos[i], cy = p.y + p.h / 2;
      return `<rect x="${x}" y="${p.y.toFixed(1)}" width="${nw}" height="${p.h.toFixed(1)}" rx="3" fill="${s[2]}"/>
        <text x="${x + dx}" y="${(cy - 2).toFixed(1)}" text-anchor="${anchor}">${s[0]}</text>
        <text class="v" x="${x + dx}" y="${(cy + 12).toFixed(1)}" text-anchor="${anchor}" style="fill:${s[2]}">${fmtKwh(s[1])} kWh</text>`;
    }).join("");
    g += lbl(src, ps, x0, "end", -6) + lbl(snk, pt, x1, "start", nw + 6);
    const selfuse = P ? ((P - p2e) / P) * 100 : null;
    const aut = L ? ((L - g2l) / L) * 100 : null;
    const pvShare = L ? (p2l / L) * 100 : null;
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:chart-sankey"></ha-icon>Tagesbilanz Sigenergy</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg>
      <div class="kp3">
        <div class="inner"><span class="kl">PV selbst genutzt</span><span class="kv num">${fmtN(selfuse, 0)} %</span></div>
        <div class="inner"><span class="kl">Autarkie (Sigen-Sicht)</span><span class="kv num" style="color:${C.export}">${fmtN(aut, 0)} %</span></div>
        <div class="inner"><span class="kl">Verbrauch aus PV direkt</span><span class="kv num" style="color:${C.solar}">${fmtN(pvShare, 0)} %</span></div>
      </div>
      <div class="sub">Sigenergy-Tageszähler · Zuordnung vereinfacht: Netz und Akku decken zuerst den Verbrauch</div>`;
  }
  getCardSize() { return 6; }
}

/* ===================================================================== */
/* sig-history: letzte Tage aus Langzeitstatistik                         */
/* ===================================================================== */
class SigHistory extends SigBase {
  static get defaults() {
    return {
      days: 14,
      series: [
        { name: "PV", color: C.solar, total: "", today: "" },
        { name: "Geladen", color: C.batt, total: "", today: "" },
        { name: "Entladen", color: C.dis, total: "", today: "" },
      ],
    };
  }
  static get throttle() { return 30000; }
  static get css() {
    return `
    .stats { display:grid; grid-template-columns: repeat(4, 1fr); gap:6px; margin-bottom:8px; }
    .compact .stats { grid-template-columns: 1fr 1fr; }
    .stats > div { padding:8px 10px; display:flex; flex-direction:column; }
    .stats .kv { font-size:16px; }
    `;
  }
  update(force) {
    if (!this._at || Date.now() - this._at > 30 * 60e3 || midnight().getTime() !== (this._t0 && this._t0.getTime())) {
      const c = this._config;
      this._load(async () => {
        const t = midnight(), start = new Date(t); start.setDate(start.getDate() - (c.days - 1));
        this._start = start; this._t0 = t;
        this._res = await this._stats((c.series || []).map((s) => s.total), start, "day", ["change"], t, { energy: "kWh" });
      });
    } else this._draw();
  }
  _draw() {
    if (this._err) { this.box.innerHTML = `<div class="err">Fehler: ${this._err}</div>`; return; }
    if (!this._res) return;
    const c = this._config, S = c.series || [], compact = this._compact(), h = this._hass;
    const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    const days = Array.from({ length: c.days }, (_, i) => { const d = new Date(this._start); d.setDate(d.getDate() + i); return d; });
    const data = S.map((s) => days.map((d, i) => {
      if (i === c.days - 1) return kwh(h, s.today);
      const r = (this._res[s.total] || []).find((x) => new Date(typeof x.start === "number" ? x.start : Date.parse(x.start)).toDateString() === d.toDateString());
      return r && r.change != null ? Math.max(0, r.change) : null;
    }));
    const pv = data[0] || [];
    const past = pv.slice(0, -1).filter((v) => v != null);
    const avg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : null;
    const best = Math.max(0, ...pv.filter((v) => v != null));
    const bestI = pv.indexOf(best);
    const sumPv = pv.reduce((a, v) => a + (v || 0), 0);
    const sumDis = (data[2] || []).reduce((a, v) => a + (v || 0), 0);
    const all = data.flat().filter((v) => v != null);
    const W = Math.max(300, (this._w || 600) - (compact ? 20 : 32)), H = compact ? 190 : 210;
    const pL = 34, pR = 4, pT = 16, pB = 22, pwid = W - pL - pR, ph = H - pT - pB;
    const top = Math.max(1, ...all);
    const u = top > 80 ? 20 : top > 40 ? 10 : 5, tmax = Math.max(u, Math.ceil(top / u) * u);
    const Y = (v) => pT + ph - (v / tmax) * ph;
    const step = pwid / c.days, gw = step * 0.8, bw = gw / Math.max(1, S.length);
    let g = "";
    for (let v = 0; v <= tmax; v += u) g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,0.1)"/><text x="${pL - 4}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
    days.forEach((d, i) => {
      const x0 = pL + step * i + (step - gw) / 2, today = i === c.days - 1;
      S.forEach((s, k) => {
        const v = data[k][i];
        if (v == null) return;
        g += `<rect x="${(x0 + k * bw).toFixed(1)}" y="${Y(v).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${(pT + ph - Y(v)).toFixed(1)}" rx="2"
          fill="${s.color}" fill-opacity="${today ? 0.5 : 0.9}" ${k === 0 && i === bestI ? 'stroke="#e86a1c" stroke-width="1.5"' : ""}><title>${WD[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}. ${s.name}: ${fmtN(v, 1)} kWh</title></rect>`;
      });
      if (pv[i] != null && (!compact || i === bestI || today)) g += `<text x="${(x0 + bw / 2).toFixed(1)}" y="${(Y(pv[i]) - 4).toFixed(1)}" text-anchor="middle" style="font-size:10px;font-weight:600">${fmtN(pv[i], 0)}</text>`;
      if (!compact || i % 2 === (c.days - 1) % 2) g += `<text x="${(x0 + gw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" style="font-size:10px${today ? ";font-weight:700" : ""}">${today ? "Heute" : compact ? d.getDate() : WD[d.getDay()] + " " + d.getDate()}</text>`;
    });
    if (avg != null) g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(avg)}" y2="${Y(avg)}" stroke="#000080" stroke-dasharray="5 4" stroke-opacity=".7"/>`;
    const legend = S.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join("");
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:chart-bar"></ha-icon>Letzte ${c.days} Tage</div>
      <div class="stats">
        <div class="inner"><span class="kl">Ø PV pro Tag</span><span class="kv num">${fmtKwh(avg)} kWh</span></div>
        <div class="inner"><span class="kl">Bester Tag</span><span class="kv num" style="color:#e86a1c">${fmtKwh(best)} kWh</span></div>
        <div class="inner"><span class="kl">PV ${c.days} Tage</span><span class="kv num">${fmtN(sumPv, 0)} kWh</span></div>
        <div class="inner"><span class="kl">Akku-Durchsatz</span><span class="kv num">${fmtN(sumDis, 0)} kWh</span></div>
      </div>
      <svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg>
      <div class="legend">${legend}</div>
      <div class="sub">Gestrichelt: Ø PV der Vortage · Vortage aus Langzeitstatistik, heute live</div>`;
  }
  getCardSize() { return 6; }
}

/* ===================================================================== */
/* sig-system: Lebenszeit + Systemzustand                                 */
/* ===================================================================== */
class SigSystem extends SigBase {
  static get defaults() {
    return {
      kwp: 16,
      pv_total: "",
      export_total: "",
      import_total: "",
      model: "",
      firmware: "",
      running: "",
      plant_running: "",
      grid_status: "",
      ems_mode: "",
      max_power: "",
      pcs_temp: "",
      cell_temp: "",
      fetch_time: "",
      alarms: ALARMS,
      alarm_ok: "No Problem",
    };
  }
  static get throttle() { return 10000; }
  static get css() {
    return `
    .cols { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
    .compact .cols { grid-template-columns: 1fr; }
    .h2 { font-size:12px; font-weight:700; opacity:.7; margin:0 2px 6px; display:flex; align-items:center; gap:6px; }
    .h2 ha-icon { --mdc-icon-size:16px; color:#000080; }
    .lt { display:grid; grid-template-columns: 1fr 1fr; gap:6px; }
    .lt > div { padding:9px 11px; display:flex; flex-direction:column; }
    .lt small { font-size:11px; opacity:.6; }
    .list { padding:4px 12px; }
    .it { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 0; font-size:13px; }
    .it + .it { border-top:1px solid rgba(0,0,0,0.06); }
    .it span:first-child { opacity:.75; }
    .it b { text-align:right; font-variant-numeric: tabular-nums; }
    .dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; vertical-align:middle; }
    .alm { display:grid; grid-template-columns: repeat(auto-fill, minmax(26px, 1fr)); gap:4px; margin-top:8px; }
    .alm i { height:10px; border-radius:3px; display:block; }
    `;
  }
  update() {
    const h = this._hass, c = this._config;
    const pv = kwh(h, c.pv_total), ex = kwh(h, c.export_total), im = kwh(h, c.import_total);
    const flh = pv != null && c.kwp ? pv / c.kwp : null;
    const al = (c.alarms || []).map((id) => ({ id, s: txt(h, id) }));
    const bad = al.filter((a) => a.s != null && a.s !== "unavailable" && a.s !== "unknown" && a.s !== (c.alarm_ok || "No Problem"));
    const na = al.filter((a) => a.s == null || a.s === "unavailable" || a.s === "unknown").length;
    const run = txt(h, c.running), prun = txt(h, c.plant_running), gs = txt(h, c.grid_status);
    const pt = num(h, c.pcs_temp), ct = num(h, c.cell_temp);
    const dot = (col) => `<span class="dot" style="background:${col}"></span>`;
    const it = (l, v) => `<div class="it"><span>${l}</span><b>${v}</b></div>`;
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:information-outline"></ha-icon>System &amp; Lebenszeit</div>
      <div class="cols">
        <div>
          <div class="h2"><ha-icon icon="mdi:infinity"></ha-icon>Seit Inbetriebnahme</div>
          <div class="lt">
            <div class="inner"><span class="kl">PV erzeugt</span><span class="kv num" style="color:${C.solar}">${fmtE(pv)}</span><small>Sigenergy-WR</small></div>
            <div class="inner"><span class="kl">Volllaststunden</span><span class="kv num">${fmtN(flh, 0)} h</span><small>bezogen auf ${fmtN(c.kwp, 1)} kWp</small></div>
            <div class="inner"><span class="kl">Einspeisung</span><span class="kv num" style="color:${C.export}">${fmtE(ex)}</span><small>ganzes Haus · Sigen-Netzzähler</small></div>
            <div class="inner"><span class="kl">Netzbezug</span><span class="kv num" style="color:${C.import}">${fmtE(im)}</span><small>ganzes Haus · Sigen-Netzzähler</small></div>
          </div>
        </div>
        <div>
          <div class="h2"><ha-icon icon="mdi:cog-outline"></ha-icon>Systemzustand</div>
          <div class="inner list">
            ${it("Wechselrichter", dot(ledColor(run)) + tr(run))}
            ${it("Anlage", dot(ledColor(prun)) + tr(prun))}
            ${it("Netz", dot(/On Grid/i.test(gs || "") ? "#2e9d3a" : "#e0a000") + tr(gs))}
            ${it("EMS-Modus", tr(txt(h, c.ems_mode)))}
            ${it("Temperatur WR / Zellen", `${fmtN(pt, 1)} °C / ${fmtN(ct, 1)} °C`)}
            ${it("Max. Wirkleistung", fmtW(pw(h, c.max_power)))}
            ${it("Modell · Firmware", `${txt(h, c.model) || "–"} · ${txt(h, c.firmware) || "–"}`)}
            ${it("Modbus max. Abrufzeit", `${fmtN(num(h, c.fetch_time), 1)} s`)}
            ${it("Alarme", bad.length ? `<span style="color:#a11a1a">${bad.map((a) => a.s).join(", ")}</span>` : `<span style="color:#1b6b1b">keine</span>${na ? ` <span class="kl">(${na} n. v.)</span>` : ""}`)}
          </div>
          <div class="alm" title="Alarmregister">${al.map((a) => `<i title="${a.id}: ${a.s ?? "–"}" style="background:${a.s == null || a.s === "unavailable" || a.s === "unknown" ? "rgba(0,0,0,0.15)" : a.s === (c.alarm_ok || "No Problem") ? "#2e9d3a" : "#c0392b"}"></i>`).join("")}</div>
        </div>
      </div>`;
  }
  getCardSize() { return 5; }
}

const ENT = { entity: {} }, ENTS = { entity: { multiple: true } }, TXT = { text: {} }, ICON = { icon: {} };
const COLOR = { text: { type: "color" } }, BOOL = { boolean: {} };
const NUM = (min, max, step = 1) => ({ number: { min, max, step, mode: "box" } });
const f = (name, label, selector) => ({ name, label, selector });
const flatArr = (key, n) => ({
  to: (o, d) => { const a = o[key] || []; for (let i = 0; i < n; i++) d[`${key}__${i}`] = a[i] ?? ""; delete d[key]; },
  from: (d, o) => { o[key] = Array.from({ length: n }, (_, i) => d[`${key}__${i}`] ?? ""); for (let i = 0; i < n; i++) delete o[`${key}__${i}`]; },
});
const toForm = (obj, xf) => { const d = { ...obj }; for (const x of xf || []) x.to(obj, d); return d; };
const fromForm = (data, xf) => { const o = { ...data }; for (const x of xf || []) x.from(data, o); return o; };
const P4 = (key, lbl) => [0, 1, 2, 3].map((i) => f(`${key}__${i}`, `${lbl} Spalte ${i + 1}`, ENT));

const SCHEMA = {
  "sig-hero": {
    fields: [
      f("name", "Name", TXT), f("pv_power", "PV-Leistung gesamt", ENT), f("pv_max", "PV-Maximum (W)", NUM(0, 100000, 100)),
      f("battery_power", "Akku-Leistung (+ laden / − entladen)", ENT), f("soc", "Akku-Ladestand (%)", ENT), f("capacity", "Akku-Kapazität", ENT),
      f("ac_power", "AC-Leistung Wechselrichter (+ Ausgang)", ENT), f("shelly", "Unabhängige Messung (Shelly)", ENT), f("shelly_invert", "Shelly-Vorzeichen umdrehen", BOOL),
      f("running", "Betriebszustand", ENT), f("grid_status", "Netzstatus", ENT), f("ems_mode", "EMS-Modus", ENT),
      f("pcs_temp", "Temperatur Wechselrichter", ENT), f("cell_temp", "Temperatur Zellen", ENT),
      f("alarms", "Alarm-Entitäten", ENTS), f("alarm_ok", "Zustand „kein Alarm“", TXT),
      f("pv_today", "PV heute", ENT), f("pv_yesterday", "PV gestern", ENT), f("charge_today", "Geladen heute", ENT), f("discharge_today", "Entladen heute", ENT),
    ],
    lists: [{ key: "strings", title: "Strings", add: "String hinzufügen",
      fields: [f("name", "Name", TXT), f("sub", "Ausrichtung", TXT), f("power", "Leistung", ENT)],
      blank: () => ({ name: "Neu", sub: "", power: "" }) }],
  },
  "sig-strings": {
    fields: [f("kwp", "Anlagengröße (kWp)", NUM(0, 1000, 0.1)), f("total_today", "PV heute gesamt", ENT), f("sun", "Sonne", { entity: { domain: "sun" } })],
    lists: [{ key: "strings", title: "Strings", add: "String hinzufügen",
      fields: [f("name", "Name", TXT), f("sub", "Ausrichtung", TXT), f("color", "Farbe", COLOR), f("power", "Leistung", ENT),
        f("voltage", "Spannung", ENT), f("current", "Strom", ENT), f("today", "kWh heute", ENT), f("week", "kWh 7 Tage", ENT),
        f("two_weeks", "kWh 14 Tage", ENT), f("month", "kWh Monat", ENT)],
      blank: () => ({ name: "Neu", sub: "", color: "#e0a000", power: "" }) }],
  },
  "sig-battery": {
    fields: [
      f("name", "Name", TXT), f("soc", "Ladestand (%)", ENT), f("power", "Leistung (+ laden / − entladen)", ENT), f("capacity", "Kapazität", ENT),
      f("soh", "Gesundheit (%)", ENT), f("cell_temp", "Zelltemperatur", ENT), f("rated_charge", "Max. Ladeleistung", ENT), f("rated_discharge", "Max. Entladeleistung", ENT),
      f("min_soc", "Entladegrenze für Restzeit (%)", NUM(0, 100)), f("hours", "Verlauf (Stunden)", NUM(1, 168)),
      f("total_charge", "Σ geladen (Lebenszeit)", ENT), f("total_discharge", "Σ entladen (Lebenszeit)", ENT),
      ...[0, 1, 2, 3].map((i) => f(`cols__${i}`, `Spaltentitel ${i + 1}`, TXT)),
      ...P4("charge", "Geladen"), ...P4("discharge", "Entladen"),
    ],
    xf: [flatArr("cols", 4), flatArr("charge", 4), flatArr("discharge", 4)],
  },
  "sig-flow": {
    fields: [f("pv", "PV heute", ENT), f("discharge", "Akku entladen heute", ENT), f("import", "Netzbezug heute", ENT),
      f("load", "Verbrauch heute", ENT), f("charge", "Akku geladen heute", ENT), f("export", "Einspeisung heute", ENT)],
  },
  "sig-history": {
    fields: [f("days", "Anzahl Tage", NUM(3, 60))],
    lists: [{ key: "series", title: "Reihen (erste = Hauptreihe)", add: "Reihe hinzufügen",
      fields: [f("name", "Name", TXT), f("color", "Farbe", COLOR), f("total", "Gesamtzähler (Langzeitstatistik)", ENT), f("today", "Tageswert heute", ENT)],
      blank: () => ({ name: "Neu", color: "#666666", total: "", today: "" }) }],
  },
  "sig-system": {
    fields: [
      f("kwp", "Anlagengröße (kWp)", NUM(0, 1000, 0.1)), f("pv_total", "PV gesamt", ENT), f("export_total", "Einspeisung gesamt", ENT), f("import_total", "Bezug gesamt", ENT),
      f("running", "Betriebszustand WR", ENT), f("plant_running", "Betriebszustand Anlage", ENT), f("grid_status", "Netzstatus", ENT), f("ems_mode", "EMS-Modus", ENT),
      f("pcs_temp", "Temperatur WR", ENT), f("cell_temp", "Temperatur Zellen", ENT), f("max_power", "Max. Wirkleistung", ENT),
      f("model", "Modell", ENT), f("firmware", "Firmware", ENT), f("fetch_time", "Modbus-Abrufzeit", ENT),
      f("alarms", "Alarm-Entitäten", ENTS), f("alarm_ok", "Zustand „kein Alarm“", TXT),
    ],
  },
};

const defs = [
  ["sig-hero", SigHero, "Sigenergy Glas: Live-Anlage"],
  ["sig-strings", SigStrings, "Sigenergy Glas: Strings"],
  ["sig-battery", SigBattery, "Sigenergy Glas: Akku"],
  ["sig-flow", SigFlow, "Sigenergy Glas: Tagesbilanz"],
  ["sig-history", SigHistory, "Sigenergy Glas: Letzte Tage"],
  ["sig-system", SigSystem, "Sigenergy Glas: System & Lebenszeit"],
];
const OBJ_ = { object: {} };
for (const [type, K, label] of defs) {
  const F_ = (name, label, selector) => ({ name, label, selector });
  const S = SCHEMA[type];
  let fields;
  if (S) {
    fields = (S.fields || []).filter((x) => !x.name.includes("__"));
    const grp = [...new Set((S.fields || []).filter((x) => x.name.includes("__")).map((x) => x.name.split("__")[0]))];
    for (const k of grp) fields.push(F_(k, `${k} (Liste)`, OBJ_));
    for (const Li of S.lists || []) fields.push(F_(Li.key, `${Li.title} (YAML-Liste)`, OBJ_));
  } else {
    /* kein eigenes Schema: Felder aus den Standardwerten ableiten */
    fields = Object.entries(K.defaults || {}).map(([k, v]) =>
      typeof v === "string" && /^[a-z_]+\.[a-z0-9_]+$/.test(v) ? F_(k, k, { entity: {} })
      : typeof v === "number" ? F_(k, k, { number: { mode: "box", step: "any" } })
      : typeof v === "boolean" ? F_(k, k, { boolean: {} })
      : typeof v === "string" ? F_(k, k, { text: {} }) : F_(k, `${k} (YAML)`, OBJ_));
  }
  REG.modules[type] = K;
  REG.editors[type] = { label: label.replace(/ Glas:/, ":"), group: "Sigenergy", groupIcon: "mdi:home-battery", fields, blank: () => ({ type }) };
}
REG.ver = (REG.ver || 0) + 1;

customElements.whenDefined("energie-atlas").then(() => {
  const PR = customElements.get("energie-atlas").prototype;
  if (PR.__regHook) return;
  const d = Object.getOwnPropertyDescriptor(PR, "hass");
  if (!d || !d.set) return;
  PR.__regHook = true;
  Object.defineProperty(PR, "hass", {
    configurable: true, get: d.get,
    set(h) {
      const v = REG.ver || 0;
      if (this._config && this._regV !== v) {
        this._regV = v;
        if ((this._config.modules || []).some((m) => m && REG.modules[m.type])) { this._hass = h; this._build(); return; }
      }
      d.set.call(this, h);
    },
  });
});
})();

/* ===== energie-atlas-marstek ===== */
/* energie-atlas-marstek – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const C = { solar: "#e0a000", import: "#b22222", export: "#228b22", batt: "#1e6fd9", dis: "#e07000", home: "#000080", soc: "#7b3fb5" };
const COMPACT_W = 560;
const st = (h, id) => (h && id && h.states[id]) || null;
const num = (h, id) => { const s = st(h, id); if (!s) return null; const v = parseFloat(s.state); return isNaN(v) ? null : v; };
const unit = (h, id) => { const s = st(h, id); return s ? String(s.attributes.unit_of_measurement || "") : ""; };
const pw = (h, id) => { const v = num(h, id); if (v == null) return null; return unit(h, id) === "kW" ? v * 1000 : v; };
const kwh = (h, id) => { const v = num(h, id); if (v == null) return null; const u = unit(h, id); return u === "MWh" ? v * 1000 : u === "Wh" ? v / 1000 : v; };
const txt = (h, id) => { const s = st(h, id); return s ? s.state : null; };
const fmtN = (v, d = 0) => (v == null || isNaN(v) ? "–" : v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtW = (v, signed = false) => {
  if (v == null || isNaN(v)) return "–";
  const a = signed ? v : Math.abs(v), s = signed && a > 0 ? "+" : "";
  return Math.abs(a) >= 1200 ? `${s}${fmtN(a / 1000, 2)} kW` : `${s}${fmtN(a, 0)} W`;
};
const fmtKwh = (v) => (v == null ? "–" : fmtN(v, v < 10 ? 2 : v < 100 ? 1 : 0));
const hhmm = (d) => (d ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–");
const hm = (h) => { const m = Math.max(0, Math.round(h * 60)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`; };
const socColor = (p) => (p == null ? "#888" : p >= 60 ? "#2e9d3a" : p >= 30 ? "#e0a000" : "#c0392b");
const pcol = (p) => (p > 15 ? C.batt : p < -15 ? C.dis : "#555");
const pstate = (p) => (p == null ? "–" : p > 15 ? "lädt" : p < -15 ? "entlädt" : "Ruhe");
const TR = { manual: "Manuell", auto: "Automatik", Idle: "Ruhe", idle: "Ruhe", Standby: "Standby", no_slots: "kein Fenster", collecting_data: "sammelt Daten",
  None: "keine", green: "gut", yellow: "mittel", red: "schlecht", on: "an", off: "aus", unavailable: "nicht erreichbar", unknown: "unbekannt", custom: "Benutzerdefiniert" };
const tr = (s) => (s == null ? "–" : TR[s] || s);
// Leistung einer Einheit: eigene Entitaet (+ laden) oder PV-Eingaenge minus Ausgang
const unitPower = (h, u) => {
  if (u.power) { const p = pw(h, u.power); return p == null ? null : p * (u.power_invert ? -1 : 1); }
  const pv = (u.pv || []).map((id) => pw(h, id)).filter((v) => v != null);
  const out = pw(h, u.output);
  if (!pv.length && out == null) return null;
  return pv.reduce((a, v) => a + v, 0) - (out || 0);
};
const unitEnergy = (h, u) => {
  const soc = num(h, u.soc);
  let e = u.energy ? kwh(h, u.energy) : null;
  const cap = u.capacity ? kwh(h, u.capacity) : u.capacity_kwh || null;
  if (e == null && soc != null && cap) e = (soc / 100) * cap;
  return { soc, e, cap };
};

const BASE_CSS = `
  :host { display:block; }
  .glass { color: #000; box-sizing: border-box;
    font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
  .title { display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:600; margin-bottom:10px; }
  .title ha-icon { --mdc-icon-size: 20px; color:#000080; }
  .sub { font-size:11px; opacity:.6; text-align:center; margin-top:6px; }
  .inner { background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.10); border-radius:12px; }
  .num { font-variant-numeric: tabular-nums; }
  .err { color:#a11a1a; font-size:13px; }
  .load { opacity:.6; font-size:13px; text-align:center; padding:12px; }
  .kl { font-size:12px; opacity:.72; }
  .kv { font-size:18px; font-weight:700; }
  svg text { fill:#000; font-size:11px; }
  .chartw { position:relative; }
  .tip { position:absolute; pointer-events:none; background: rgba(255,255,255,0.9); border:1px solid rgba(0,0,0,0.1); border-radius:8px;
    padding:6px 8px; font-size:12px; white-space:nowrap; display:none; box-shadow:0 4px 14px rgba(0,0,0,0.15); z-index:2; }
  .tip b { display:block; margin-bottom:2px; }
  .tip i { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
  .legend { display:flex; justify-content:center; gap:14px; flex-wrap:wrap; font-size:12px; margin-top:6px; }
  .legend span { display:inline-flex; align-items:center; gap:6px; }
  .legend i { width:12px; height:6px; border-radius:2px; display:inline-block; }
  .bidi { position:relative; height:6px; border-radius:3px; background: rgba(0,0,0,0.08); overflow:hidden; }
  .bidi::after { content:""; position:absolute; left:50%; top:-2px; bottom:-2px; width:1px; background: rgba(0,0,0,0.35); }
  .bidi i { position:absolute; top:0; bottom:0; border-radius:3px; transition: all .6s; }
  .hb { height:8px; border-radius:4px; background: rgba(0,0,0,0.08); overflow:hidden; }
  .hb i { display:block; height:100%; border-radius:4px; transition: width .8s; }
  .pills { display:flex; flex-wrap:wrap; gap:6px; }
  .pill { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:12px; font-size:12px; font-weight:600;
    background: rgba(255,255,255,0.45); border:1px solid rgba(255,255,255,0.45); white-space:nowrap; }
  .pill ha-icon { --mdc-icon-size:15px; }
  .pill.ok { color:#1b6b1b; } .pill.warn { color:#a35200; } .pill.bad { color:#a11a1a; background: rgba(255,205,205,0.6); }
  .list { padding:4px 12px; }
  .it { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 0; font-size:13px; }
  .it + .it { border-top:1px solid rgba(0,0,0,0.06); }
  .it span:first-child { opacity:.75; }
  .it b { text-align:right; font-variant-numeric: tabular-nums; }
  .g2 { display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
  .g3 { display:grid; grid-template-columns: repeat(3, 1fr); gap:6px; }
  .g4 { display:grid; grid-template-columns: repeat(4, 1fr); gap:6px; }
  .compact .g4 { grid-template-columns: 1fr 1fr; }
  .compact .g2.st { grid-template-columns: 1fr; }
  .box { padding:8px 10px; display:flex; flex-direction:column; }
  .box .kv { font-size:16px; }
`;
const bidi = (p, max) => {
  const w = Math.min(50, (Math.abs(p || 0) / (max || 1000)) * 50);
  return (p || 0) >= 0 ? `<i style="left:50%;width:${w}%;background:${C.batt}"></i>` : `<i style="left:${50 - w}%;width:${w}%;background:${C.dis}"></i>`;
};

class MstBase {
  constructor(c, el) {
    this.el = el;
    this._config = JSON.parse(JSON.stringify({ ...(this.constructor.defaults || {}), ...(c || {}) }));
    this.shadowRoot = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}${this.constructor.css || ""}</style><div class="glass"><div class="load">Lade…</div></div>`;
    this.shadowRoot.addEventListener("click", (e) => this._click(e));
    this._dirty = true; this._at = 0;
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver((e) => {
        const w = Math.round(e[0].contentRect.width);
        if (w > 0 && Math.abs(w - (this._w || 0)) > 12) { this._w = w; this._dirty = true; this._resized = true; this._update(true); }
      });
      this._ro.observe(el);
    }
  }
  set hass(h) {
    if (!this.el.isConnected && this._seen) { if (this._ro) this._ro.disconnect(); return; }
    if (this.el.isConnected) this._seen = true;
    this._hass = h; if (!this._last || Date.now() - this._last > (this.constructor.throttle || 2000)) this._update(false);
  }
  _compact() { return (this._w || this.el.clientWidth || 800) < COMPACT_W; }
  get box() { return this.shadowRoot.querySelector(".glass"); }
  $(id) { return this.shadowRoot.getElementById(id); }
  _click() {}
  _update(force) {
    if (!this._hass || !this.shadowRoot) return;
    this._last = Date.now();
    this.box.classList.toggle("compact", this._compact());
    try { this.update(force); } catch (e) { this.box.innerHTML = `<div class="err">Fehler: ${e.message || e}</div>`; this._dirty = true; }
  }
  _stats(ids, start, end) {
    return this._hass.callWS({ type: "recorder/statistics_during_period", start_time: start.toISOString(), end_time: end.toISOString(),
      statistic_ids: ids.filter(Boolean), period: "5minute", types: ["mean"], units: { power: "W" } });
  }
  async _load(fn) {
    if (this._loading) return; /* laeuft schon: der laufende Abruf liefert frische Daten, kein zweiter */
    this._loading = true;
    try { await fn(); this._err = null; } catch (e) { this._err = e.message || String(e); }
    finally { this._at = Date.now(); this._loading = false; if (this._again) { this._again = false; this._load(fn); } else this._draw(); }
  }
  // Liniendiagramm 0..100 % bzw. Leistung; series: [{name,color,data,pct,bars}]
  _chart(box, t0, bms, n, series, opt = {}) {
    const compact = this._compact();
    const W = Math.max(300, (this._w || 600) - (compact ? 20 : 32)), H = opt.h || (compact ? 180 : 200);
    const hasP = series.some((s) => !s.pct), hasS = series.some((s) => s.pct);
    const pL = hasP ? 40 : 34, pR = hasP && hasS ? 34 : 6, pT = 10, pB = 22, pwid = W - pL - pR, ph = H - pT - pB;
    const pv = series.filter((s) => !s.pct).flatMap((s) => s.data).filter((v) => v != null);
    let mx = Math.max(200, ...pv), mn = Math.min(hasP ? -200 : 0, ...pv);
    const u = mx - mn > 3000 ? 1000 : mx - mn > 1200 ? 500 : 200;
    mx = Math.ceil(mx / u) * u; mn = Math.floor(mn / u) * u;
    const X = (i) => pL + (i / (n - 1)) * pwid, Y = (v) => pT + ((mx - v) / (mx - mn)) * ph, YS = (p) => pT + ((100 - p) / 100) * ph;
    let g = "";
    if (hasP) for (let v = mn; v <= mx + 1; v += u) {
      g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,${v === 0 ? 0.35 : 0.1})"/>`;
      g += `<text x="${pL - 4}" y="${Y(v) + 4}" text-anchor="end">${Math.abs(v) >= 1000 ? fmtN(v / 1000, 1) + "k" : fmtN(v, 0)}</text>`;
    }
    if (hasS) for (const p of [0, 25, 50, 75, 100]) {
      if (!hasP) g += `<line x1="${pL}" x2="${W - pR}" y1="${YS(p)}" y2="${YS(p)}" stroke="rgba(0,0,0,0.1)"/>`;
      if (hasP ? p % 50 === 0 : true) g += `<text x="${hasP ? W - pR + 4 : pL - 4}" y="${YS(p) + 4}" text-anchor="${hasP ? "start" : "end"}" style="fill:${hasP ? C.soc : "#000"}">${p}%</text>`;
    }
    for (let i = 0; i < n; i++) {
      const d = new Date(t0 + i * bms);
      if (d.getMinutes() === 0 && d.getHours() % (compact ? 6 : 3) === 0) {
        g += `<line x1="${X(i)}" x2="${X(i)}" y1="${pT}" y2="${pT + ph}" stroke="rgba(0,0,0,0.06)"/><text x="${X(i)}" y="${H - 6}" text-anchor="middle">${String(d.getHours()).padStart(2, "0")}:00</text>`;
      }
    }
    const bw = Math.max(1, pwid / n);
    series.forEach((s) => {
      if (s.bars) { s.data.forEach((v, i) => { if (v == null || Math.abs(v) < 3) return; const y0 = Y(0), y1 = Y(v);
        g += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(2)}" height="${Math.abs(y1 - y0).toFixed(1)}" fill="${v > 0 ? C.batt : C.dis}" fill-opacity=".55"/>`; }); return; }
      const yf = s.pct ? YS : Y; let d = "", on = false;
      s.data.forEach((v, i) => { if (v == null) { on = false; return; } d += `${on ? "L" : "M"}${X(i).toFixed(1)},${yf(v).toFixed(1)} `; on = true; });
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w || 2}" ${s.dash ? 'stroke-dasharray="4 3"' : ""} stroke-linejoin="round"/>`;
    });
    g += `<line class="cx" x1="0" x2="0" y1="${pT}" y2="${pT + ph}" stroke="#000080" stroke-dasharray="3,3" style="display:none"/><rect class="hit" x="${pL}" y="${pT}" width="${pwid}" height="${ph}" fill="transparent"/>`;
    box.innerHTML = `<div class="chartw"><svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg><div class="tip"></div></div>
      <div class="legend">${series.map((s) => `<span><i style="background:${s.bars ? `linear-gradient(90deg,${C.batt} 50%,${C.dis} 50%)` : s.color}"></i>${s.name}</span>`).join("")}</div>${opt.sub ? `<div class="sub">${opt.sub}</div>` : ""}`;
    const svg = box.querySelector("svg"), tip = box.querySelector(".tip"), cx = box.querySelector(".cx"), hit = box.querySelector(".hit");
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.round(((((ev.clientX - r.left) / r.width) * W - pL) / pwid) * (n - 1))));
      cx.setAttribute("x1", X(i)); cx.setAttribute("x2", X(i)); cx.style.display = "";
      if (series.every((s) => s.data[i] == null)) { tip.style.display = "none"; return; }
      tip.innerHTML = `<b>${hhmm(new Date(t0 + i * bms))}</b>` + series.map((s) => `<div><i style="background:${s.bars ? pcol(s.data[i] || 0) : s.color}"></i>${s.name}: ${s.pct ? fmtN(s.data[i], 0) + " %" : fmtW(s.data[i], true)}</div>`).join("");
      tip.style.display = "block";
      const left = (X(i) / W) * r.width;
      tip.style.left = (left > r.width / 2 ? Math.max(4, left - tip.offsetWidth - 10) : left + 10) + "px"; tip.style.top = "8px";
    };
    hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", () => { tip.style.display = "none"; cx.style.display = "none"; });
  }
}
const grid5 = (rows, t0, bms, n) => {
  const out = new Array(n).fill(null);
  for (const r of rows || []) { const ts = typeof r.start === "number" ? r.start : Date.parse(r.start); const i = Math.round((ts - t0) / bms); if (i >= 0 && i < n && r.mean != null) out[i] = r.mean; }
  return out;
};

/* Einheiten (Reihenfolge wie im alten Marstek-Tab; SP1/SP2-Entitaeten bewusst ueberkreuz) */
const UNITS = [
  { name: "Speicher 2", color: "#d63384", soc: "", energy: "",
    capacity: "", power: "" },
  { name: "SP1", color: "#1e88e5", soc: "", energy: "", capacity_kwh: 2.24,
    pv: ["", ""], output: "" },
  { name: "SP2", color: "#00a3a3", soc: "", energy: "", capacity_kwh: 2.24,
    pv: ["", ""], output: "" },
  { name: "SP3", color: "#7cb342", soc: "", energy: "", capacity_kwh: 2.24,
    pv: ["", ""], output: "" },
];

/* ===================================================================== */
/* mst-fleet                                                              */
/* ===================================================================== */
class MstFleet extends MstBase {
  static get defaults() { return { units: UNITS, scale_w: 2500 }; }
  static get css() {
    return `
    .top { display:grid; grid-template-columns: 1.1fr 1fr; gap:12px; align-items:center; }
    .compact .top { grid-template-columns: 1fr; }
    .big { font-size:38px; font-weight:800; line-height:1.05; letter-spacing:-.5px; }
    .compact .big { font-size:30px; }
    .stack { display:flex; height:34px; border-radius:10px; overflow:hidden; background: rgba(0,0,0,0.08); margin:8px 0 4px; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.08); }
    .stack i { display:block; height:100%; transition: width .8s; position:relative; }
    .stack i + i { box-shadow: inset 1px 0 0 rgba(255,255,255,0.7); }
    .stack i span { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; color:#fff; text-shadow:0 0 3px rgba(0,0,0,0.5); white-space:nowrap; overflow:hidden; }
    .units { display:grid; grid-template-columns: repeat(var(--n,4), 1fr); gap:8px; margin-top:10px; }
    .compact .units { grid-template-columns: 1fr 1fr; }
    .u { padding:10px 12px; border-left:4px solid var(--c); }
    .un { display:flex; justify-content:space-between; align-items:baseline; font-size:14px; font-weight:700; }
    .un b { font-size:18px; }
    .up { font-size:15px; font-weight:700; margin:4px 0 2px; }
    `;
  }
  update() {
    const h = this._hass, c = this._config, U = c.units || [];
    const rows = U.map((u) => ({ u, ...unitEnergy(h, u), p: unitPower(h, u) }));
    const E = rows.reduce((a, r) => a + (r.e || 0), 0), CAP = rows.reduce((a, r) => a + (r.cap || 0), 0);
    const P = rows.reduce((a, r) => a + (r.p || 0), 0);
    const soc = CAP ? (E / CAP) * 100 : null;
    let reach = "";
    if (P < -30 && E) reach = `reicht bei ${fmtW(P)} noch ≈ ${hm(E / (-P / 1000))}`;
    else if (P > 30 && CAP) reach = `voll in ≈ ${hm((CAP - E) / (P / 1000))}`;
    const seg = rows.map((r) => {
      const w = CAP ? ((r.e || 0) / CAP) * 100 : 0;
      return `<i style="width:${w.toFixed(2)}%;background:${r.u.color || C.batt}" title="${r.u.name}: ${fmtKwh(r.e)} kWh"><span>${w > 9 ? r.u.name : ""}</span></i>`;
    }).join("");
    const units = rows.map((r) => `<div class="inner u" style="--c:${r.u.color || C.batt}">
        <div class="un"><span>${r.u.name}</span><b class="num" style="color:${socColor(r.soc)}">${fmtN(r.soc, 0)} %</b></div>
        <div class="up num" style="color:${pcol(r.p)}">${fmtW(r.p, true)}</div>
        <div class="kl num">${pstate(r.p)} · ${fmtKwh(r.e)} / ${fmtKwh(r.cap)} kWh</div>
        <div class="hb" style="margin-top:6px"><i style="width:${r.soc || 0}%;background:${socColor(r.soc)}"></i></div>
      </div>`).join("");
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:battery-charging-high"></ha-icon>Marstek Speicherpark</div>
      <div class="top">
        <div>
          <div class="kl">Gespeichert gesamt</div>
          <div class="big num">${fmtKwh(E)} <span style="font-size:.5em;font-weight:600;opacity:.7">von ${fmtKwh(CAP)} kWh</span></div>
          <div class="stack">${seg}</div>
          <div class="kl num">${fmtN(soc, 0)} % Gesamt-SoC</div>
        </div>
        <div class="inner box">
          <span class="kl">Netto-Leistung alle Marstek</span>
          <span class="kv num" style="font-size:26px;color:${pcol(P)}">${fmtW(P, true)}</span>
          <div class="bidi" style="margin:6px 0 4px">${bidi(P, c.scale_w)}</div>
          <span class="kl">${pstate(P)}${reach ? " · " + reach : ""}</span>
        </div>
      </div>
      <div class="units" style="--n:${Math.max(1, rows.length)}">${units}</div>
      <div class="sub">+ laden / − entladen · B2500 ≈ PV-Eingang − Ausgang · Nennkapazität B2500 je ${fmtN((U[1] || {}).capacity_kwh || 2.24, 2)} kWh</div>`;
  }
  getCardSize() { return 5; }
}

/* ===================================================================== */
/* mst-venus                                                              */
/* ===================================================================== */
const V = (s) => `sensor.marstek_venus_a_${s}`;
class MstVenus extends MstBase {
  static get defaults() {
    return {
      name: "Speicher 2", soc: V("batterie_soc"), power: V("batterieleistung"), ac_power: V("ac_leistung"),
      stored: V("gespeicherte_energie"), capacity: V("batteriegesamtenergie"), voltage: V("batteriespannung"),
      cell_max: V("maximale_zellenspannung"), cell_min: V("minimale_zellenspannung"), temp: V("innentemperatur"),
      cycles: V("batteriezyklen"), cycles_calc: V("batteriezyklen_berechnet"), efficiency: V("gesamtwirkungsgrad"),
      charge_today: V("tagliche_ladeenergie"), discharge_today: V("tagliche_entladeenergie"),
      total_charge: V("gesamte_ladeenergie"), total_discharge: V("gesamte_entladeenergie"),
      solar: V("solarleistung"), mppt: [V("mppt1_leistung"), V("mppt2_leistung"), V("mppt3_leistung"), V("mppt4_leistung")],
      status: V("wechselrichterstatus"), mode: "", balance: V("balance_status"),
      soc_min: "", soc_max: "",
      max_charge: "", max_discharge: "",
      hours: 24,
    };
  }
  static get css() {
    return `
    .vt { display:grid; grid-template-columns: 90px 1fr; gap:14px; align-items:center; }
    .cell { position:relative; width:72px; height:130px; border:3px solid rgba(0,0,0,0.6); border-radius:12px; padding:4px; box-sizing:border-box; margin:10px auto 0; background: rgba(255,255,255,0.35); }
    .cell::before { content:""; position:absolute; top:-10px; left:23px; width:20px; height:7px; border-radius:3px 3px 0 0; background: rgba(0,0,0,0.6); }
    .lim { position:absolute; left:-6px; right:-6px; height:0; border-top:2px dashed rgba(0,0,0,0.55); }
    .liq { position:absolute; left:4px; right:4px; bottom:4px; border-radius:7px; transition: height .8s, background .8s; overflow:hidden; }
    .liq::after { content:""; position:absolute; inset:0; background: linear-gradient(90deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 45%, rgba(255,255,255,0.18)); }
    .liq.chg::before, .liq.dis::before { content:""; position:absolute; left:0; right:0; height:40%; background: linear-gradient(0deg, rgba(255,255,255,0), rgba(255,255,255,0.45), rgba(255,255,255,0)); }
    .liq.chg::before { animation: mrise 2.2s linear infinite; } .liq.dis::before { animation: mfall 2.2s linear infinite; }
    @keyframes mrise { from { top:100% } to { top:-40% } } @keyframes mfall { from { top:-40% } to { top:100% } }
    .pct { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:800; text-shadow: 0 0 5px rgba(255,255,255,0.95); }
    .bp { font-size:28px; font-weight:800; line-height:1.1; }
    .bs { font-size:13px; opacity:.8; margin:2px 0 6px; }
    .mp { display:grid; grid-template-columns: repeat(4,1fr); gap:6px; }
    .mp div { padding:6px 8px; text-align:center; } .mp b { display:block; font-size:14px; }
    .h2 { font-size:12px; font-weight:700; opacity:.7; margin:10px 2px 6px; }
    `;
  }
  _build() {
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:home-battery-outline"></ha-icon><span id="nm"></span></div>
      <div class="vt"><div class="cell"><div class="liq" id="liq"></div><div class="lim" id="lmin"></div><div class="lim" id="lmax"></div><div class="pct num" id="pct">–</div></div><div id="info"></div></div>
      <div id="rest"></div><div id="chart" style="margin-top:10px"><div class="load">Lade Verlauf…</div></div>`;
    this._dirty = false;
    if (this._res) this._draw();
  }
  update(force) {
    if (this._dirty) this._build();
    const h = this._hass, c = this._config, $ = (id) => this.$(id);
    $("nm").textContent = c.name || "Speicher 2";
    const soc = num(h, c.soc), p = pw(h, c.power), ac = pw(h, c.ac_power), e = kwh(h, c.stored), cap = kwh(h, c.capacity);
    const smin = num(h, c.soc_min), smax = num(h, c.soc_max), mc = num(h, c.max_charge), md = num(h, c.max_discharge);
    const cls = p > 15 ? "chg" : p < -15 ? "dis" : "";
    const liq = $("liq");
    if (liq.className !== `liq ${cls}`.trim()) liq.className = `liq ${cls}`.trim();
    liq.style.height = `calc(${soc || 0}% - 8px * ${(soc || 0) / 100})`; liq.style.background = socColor(soc);
    $("pct").textContent = `${fmtN(soc, 0)}%`;
    const lim = (el, v) => { el.style.display = v == null || v <= 0 || v >= 100 ? "none" : ""; el.style.bottom = `calc(4px + (100% - 8px) * ${(v || 0) / 100})`; };
    lim($("lmin"), smin); lim($("lmax"), smax);
    let rest = "";
    if (soc != null && cap && p != null && Math.abs(p) > 30) {
      if (p > 0) rest = `bis ${fmtN(smax ?? 100, 0)} % ≈ ${hm(((((smax ?? 100) - soc) / 100) * cap) / (p / 1000))}`;
      else if (soc > (smin || 0)) rest = `bis ${fmtN(smin || 0, 0)} % ≈ ${hm((((soc - (smin || 0)) / 100) * cap) / (-p / 1000))}`;
    }
    const cmax = num(h, c.cell_max), cmin = num(h, c.cell_min), dmv = cmax != null && cmin != null ? (cmax - cmin) * 1000 : null;
    $("info").innerHTML = `
      <div class="bp num" style="color:${pcol(p)}">${fmtW(p, true)}</div>
      <div class="bs">${pstate(p)}${rest ? " · " + rest : ""}</div>
      <div class="kl num">${fmtKwh(e)} von ${fmtKwh(cap)} kWh · AC ${fmtW(ac)}</div>
      <div class="bidi" style="margin-top:8px">${bidi(p, p >= 0 ? mc : md)}</div>
      <div class="kl" style="display:flex;justify-content:space-between;margin-top:3px"><span>− ${fmtW(md)}</span><span>+ ${fmtW(mc)}</span></div>
      <div class="pills" style="margin-top:8px">
        <span class="pill">${tr(txt(h, c.status))}</span><span class="pill">${tr(txt(h, c.mode))}</span>
        <span class="pill">SoC ${fmtN(smin, 0)}–${fmtN(smax, 0)} %</span>
      </div>`;
    const ms = (c.mppt || []).map((id, i) => `<div class="inner"><span class="kl">MPPT ${i + 1}</span><b class="num">${fmtW(pw(h, id))}</b></div>`).join("");
    const bal = txt(h, c.balance);
    $("rest").innerHTML = `
      <div class="g4" style="margin-top:10px">
        <div class="inner box"><span class="kl">Zellspannung</span><span class="kv num">${fmtN(cmin, 3)}–${fmtN(cmax, 3)} V</span></div>
        <div class="inner box"><span class="kl">Zelldrift</span><span class="kv num" style="color:${dmv == null ? "" : dmv > 30 ? "#a11a1a" : dmv > 15 ? "#a35200" : "#1b6b1b"}">${fmtN(dmv, 0)} mV</span></div>
        <div class="inner box"><span class="kl">Spannung · Temp.</span><span class="kv num">${fmtN(num(h, c.voltage), 1)} V · ${fmtN(num(h, c.temp), 0)} °C</span></div>
        <div class="inner box"><span class="kl">Balance</span><span class="kv">${tr(bal)}</span></div>
      </div>
      <div class="h2">Solar direkt · ${fmtW(pw(h, c.solar))}</div>
      <div class="mp">${ms}</div>
      <div class="h2">Energie</div>
      <div class="g4">
        <div class="inner box"><span class="kl">Geladen heute</span><span class="kv num" style="color:${C.batt}">${fmtKwh(kwh(h, c.charge_today))} kWh</span></div>
        <div class="inner box"><span class="kl">Entladen heute</span><span class="kv num" style="color:${C.dis}">${fmtKwh(kwh(h, c.discharge_today))} kWh</span></div>
        <div class="inner box"><span class="kl">Zyklen (Gerät / ber.)</span><span class="kv num">${fmtN(num(h, c.cycles), 0)} / ${fmtN(num(h, c.cycles_calc), 1)}</span></div>
        <div class="inner box"><span class="kl">Wirkungsgrad</span><span class="kv num">${fmtN(num(h, c.efficiency), 1)} %</span></div>
      </div>
      <div class="sub">Σ geladen ${fmtKwh(kwh(h, c.total_charge))} kWh · Σ entladen ${fmtKwh(kwh(h, c.total_discharge))} kWh · gestrichelt in der Zelle: SoC-Grenzen</div>`;
    if (!this._at || Date.now() - this._at > 5 * 60e3) {
      this._load(async () => {
        const end = new Date(); this._t0 = new Date(Math.floor((end.getTime() - c.hours * 3600e3) / 300e3) * 300e3);
        this._res = await this._stats([c.soc, c.power], this._t0, end);
      });
    } else if (force || this._resized) { this._resized = false; this._draw(); }
  }
  _draw() {
    const box = this.$("chart"); if (!box) return;
    if (this._err) { box.innerHTML = `<div class="err">Fehler: ${this._err}</div>`; return; }
    if (!this._res) return;
    const c = this._config, bms = 300e3, t0 = this._t0.getTime(), n = Math.round((c.hours * 3600e3) / bms) + 1;
    this._chart(box, t0, bms, n, [
      { name: "Leistung", bars: true, data: grid5(this._res[c.power], t0, bms, n) },
      { name: "SoC", pct: true, color: C.soc, dash: true, data: grid5(this._res[c.soc], t0, bms, n) },
    ], { h: this._compact() ? 160 : 180, sub: `Letzte ${c.hours} h · 5-Min-Mittel` });
  }
  getCardSize() { return 9; }
}

/* ===================================================================== */
/* mst-b2500                                                              */
/* ===================================================================== */
const B = (hw, sfx, name, today) => ({
  name, soc: `sensor.b2500_${hw}_b2500_${hw}_soc${sfx}`, energy: `sensor.b2500_${hw}_b2500_${hw}_capacity${sfx}`, capacity_kwh: 2.24,
  pv: [`sensor.b2500_${hw}_b2500_${hw}_pv1_power${sfx}`, `sensor.b2500_${hw}_b2500_${hw}_pv2_power${sfx}`],
  output: `sensor.b2500_${hw}_b2500_${hw}_output_power${sfx}`,
  temp: `sensor.b2500_${hw}_b2500_${hw}_temp_high${sfx}`,
  timer_power: `number.b2500_${hw}_b2500_${hw}_timer_1_output_power${hw === "sp1" ? "_2" : ""}`,
  timer_switch: `switch.b2500_${hw}_b2500_${hw}_timer_1_enabled`,
  dod: `number.b2500_${hw}_b2500_${hw}_depth_of_discharge${hw === "sp1" ? "_2" : ""}`,
  ...today,
});
class MstB2500 extends MstBase {
  static get defaults() {
    return {
      step: 10,
      units: [
        B("sp2", "_2", "SP1", { today_pv: [""], today_out: "", today_charge: "", today_discharge: "" }),
        B("sp1", "", "SP2", { today_pv: [""], today_out: "", today_charge: "", today_discharge: "" }),
        B("sp3", "", "SP3", { today_pv: ["", ""], today_out: "", today_charge: "", today_discharge: "" }),
      ],
    };
  }
  static get css() {
    return `
    .bu { padding:10px 12px; }
    .bu + .bu { margin-top:8px; }
    .bh { display:grid; grid-template-columns: 1fr auto; align-items:center; gap:8px; }
    .bh .n { font-size:15px; font-weight:800; display:flex; align-items:center; gap:6px; }
    .bh .n ha-icon { --mdc-icon-size:18px; color:#000080; }
    .bh .s { font-size:20px; font-weight:800; }
    .flow { display:grid; grid-template-columns: 1fr auto 1fr auto 1fr; align-items:center; gap:4px; margin:8px 0 6px; text-align:center; }
    .flow > div { display:flex; flex-direction:column; }
    .flow b { font-size:15px; } .flow ha-icon { --mdc-icon-size:18px; opacity:.5; }
    .days { display:grid; grid-template-columns: repeat(4,1fr); gap:4px; font-size:12px; margin-top:6px; }
    .days span { display:flex; flex-direction:column; text-align:center; } .days b { font-size:13px; }
    .tm { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.06); font-size:13px; }
    .tm .ctl { display:flex; align-items:center; gap:6px; }
    .tm button { cursor:pointer; width:30px; height:30px; border-radius:50%; border:1px solid rgba(0,0,0,0.15); background: rgba(255,255,255,0.6); display:flex; align-items:center; justify-content:center; padding:0; color:#000080; }
    .tm button:active { transform: scale(.92); }
    .tm button ha-icon { --mdc-icon-size:18px; }
    .tm .tv { min-width:62px; text-align:center; font-weight:800; font-size:15px; }
    .tm .sw { cursor:pointer; }
    `;
  }
  _click(e) {
    const b = e.target.closest("[data-act]"); if (!b || !this._hass) return;
    const id = b.dataset.id, act = b.dataset.act;
    if (act === "toggle") { this._hass.callService("switch", "toggle", { entity_id: id }); return; }
    const s = st(this._hass, id); if (!s) return;
    const step = (this._config.step || 10) * (act === "dec" ? -1 : 1);
    const mn = s.attributes.min ?? 0, mx = s.attributes.max ?? 800;
    const v = Math.max(mn, Math.min(mx, (parseFloat(s.state) || 0) + step));
    this._hass.callService("number", "set_value", { entity_id: id, value: v });
  }
  update() {
    const h = this._hass, c = this._config;
    const units = (c.units || []).map((u) => {
      const { soc, e, cap } = unitEnergy(h, u);
      const pvs = (u.pv || []).map((id) => pw(h, id)).filter((v) => v != null), pvin = pvs.reduce((a, v) => a + v, 0);
      const out = pw(h, u.output), net = unitPower(h, u);
      const sum = (ids) => { const v = (ids || []).map((id) => kwh(h, id)).filter((x) => x != null); return v.length ? v.reduce((a, x) => a + x, 0) : null; };
      const tp = num(h, u.timer_power), tsw = txt(h, u.timer_switch), dod = num(h, u.dod);
      return `<div class="inner bu">
        <div class="bh"><span class="n"><ha-icon icon="mdi:battery-sync-outline"></ha-icon>${u.name}<span class="kl" style="font-weight:400">${fmtKwh(e)} / ${fmtKwh(cap)} kWh${u.temp ? " · " + fmtN(num(h, u.temp), 0) + " °C" : ""}</span></span>
          <span class="s num" style="color:${socColor(soc)}">${fmtN(soc, 0)} %</span></div>
        <div class="hb"><i style="width:${soc || 0}%;background:${socColor(soc)}"></i></div>
        <div class="flow">
          <div><span class="kl">PV ein</span><b class="num" style="color:${C.solar}">${fmtW(pvin)}</b></div><ha-icon icon="mdi:chevron-right"></ha-icon>
          <div><span class="kl">Akku</span><b class="num" style="color:${pcol(net)}">${fmtW(net, true)}</b></div><ha-icon icon="mdi:chevron-right"></ha-icon>
          <div><span class="kl">Ausgang</span><b class="num" style="color:${C.home}">${fmtW(out)}</b></div>
        </div>
        <div class="days">
          <span><em class="kl">PV heute</em><b class="num">${fmtKwh(sum(u.today_pv))}</b></span>
          <span><em class="kl">Ausgang</em><b class="num">${fmtKwh(kwh(h, u.today_out))}</b></span>
          <span><em class="kl">Geladen</em><b class="num">${fmtKwh(kwh(h, u.today_charge))}</b></span>
          <span><em class="kl">Entladen</em><b class="num">${fmtKwh(kwh(h, u.today_discharge))}</b></span>
        </div>
        ${u.timer_power ? `<div class="tm">
          <span class="sw" data-act="toggle" data-id="${u.timer_switch || ""}" title="Timer 1 ein/aus"><span class="pill ${tsw === "on" ? "ok" : "warn"}"><ha-icon icon="mdi:timer-outline"></ha-icon>Timer 1 ${tr(tsw)}</span></span>
          <span class="kl">${dod != null ? "Entladetiefe " + fmtN(dod, 0) + " %" : ""}</span>
          <span class="ctl"><button data-act="dec" data-id="${u.timer_power}" title="− ${c.step} W"><ha-icon icon="mdi:minus"></ha-icon></button>
            <span class="tv num">${fmtN(tp, 0)} W</span>
            <button data-act="inc" data-id="${u.timer_power}" title="+ ${c.step} W"><ha-icon icon="mdi:plus"></ha-icon></button></span>
        </div>` : ""}
      </div>`;
    }).join("");
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:battery-sync-outline"></ha-icon>B2500</div>${units}
      <div class="sub">Tageswerte in kWh · Akku ≈ PV-Eingang − Ausgang · +/− ändert die Timer-1-Ausgabeleistung um ${c.step} W</div>`;
  }
  getCardSize() { return 9; }
}

/* ===================================================================== */
/* mst-day                                                                */
/* ===================================================================== */
class MstDay extends MstBase {
  static get defaults() { return { hours: 24, units: UNITS.map((u) => ({ name: u.name, color: u.color, soc: u.soc })) }; }
  static get throttle() { return 30000; }
  update(force) {
    if (!this._at || Date.now() - this._at > 5 * 60e3) {
      const c = this._config;
      this._load(async () => {
        const end = new Date(); this._t0 = new Date(Math.floor((end.getTime() - c.hours * 3600e3) / 300e3) * 300e3);
        this._res = await this._stats((c.units || []).map((u) => u.soc), this._t0, end);
      });
    } else if (force || this._resized) { this._resized = false; this._draw(); }
  }
  _draw() {
    if (this._err) { this.box.innerHTML = `<div class="err">Fehler: ${this._err}</div>`; return; }
    if (!this._res) return;
    const c = this._config, bms = 300e3, t0 = this._t0.getTime(), n = Math.round((c.hours * 3600e3) / bms) + 1;
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:chart-line"></ha-icon>Ladestand ${c.hours} h</div><div id="ch"></div>`;
    this._chart(this.$("ch"), t0, bms, n, (c.units || []).map((u) => ({ name: u.name, color: u.color, pct: true, data: grid5(this._res[u.soc], t0, bms, n) })),
      { h: this._compact() ? 200 : 230, sub: "5-Min-Mittel" });
  }
  getCardSize() { return 5; }
}

/* ===================================================================== */
/* mst-control: Omnibattery                                               */
/* ===================================================================== */
const S = (s) => `sensor.marstek_venus_system_${s}`;
class MstControl extends MstBase {
  static get defaults() {
    return {
      solar_today: S("tagliche_solarproduktion"), home_today: S("taglicher_haushaltsverbrauch"),
      import_today: S("taglicher_netzbezug"), export_today: S("tagliche_netzeinspeisung"),
      charge_today: S("tagliche_system_ladeenergie"), discharge_today: S("tagliche_system_entladeenergie"),
      home_now: S("haushaltsverbrauch"), solar_now: S("solar_power"),
      status: S("integrationsstatus"), active: S("aktive_batterien"), delay: S("ladeverzogerung"), window: S("entladefenster"),
      quality: S("pd_regelqualitat"), unresponsive: S("nicht_reagierende_batterien"),
      peak_switch: "", peak_active: "",
      peak_limit: "", target: "",
      deadband: "", rs485: "",
    };
  }
  static get throttle() { return 5000; }
  update() {
    const h = this._hass, c = this._config;
    const it = (l, v) => `<div class="it"><span>${l}</span><b>${v}</b></div>`;
    const kw = (id) => fmtKwh(kwh(h, id)) + " kWh";
    const pk = txt(h, c.peak_switch), pka = txt(h, c.peak_active), un = txt(h, c.unresponsive), rs = txt(h, c.rs485);
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:tune-variant"></ha-icon>Omnibattery-Steuerung</div>
      <div class="g3">
        <div class="inner box"><span class="kl">Solar heute</span><span class="kv num" style="color:${C.solar}">${kw(c.solar_today)}</span></div>
        <div class="inner box"><span class="kl">Haus heute</span><span class="kv num" style="color:${C.home}">${kw(c.home_today)}</span></div>
        <div class="inner box"><span class="kl">Speicher ± heute</span><span class="kv num"><span style="color:${C.batt}">${fmtKwh(kwh(h, c.charge_today))}</span> / <span style="color:${C.dis}">${fmtKwh(kwh(h, c.discharge_today))}</span></span></div>
        <div class="inner box"><span class="kl">Netzbezug heute</span><span class="kv num" style="color:${C.import}">${kw(c.import_today)}</span></div>
        <div class="inner box"><span class="kl">Einspeisung heute</span><span class="kv num" style="color:${C.export}">${kw(c.export_today)}</span></div>
        <div class="inner box"><span class="kl">Jetzt Haus / Solar</span><span class="kv num">${fmtW(pw(h, c.home_now))} / ${fmtW(pw(h, c.solar_now))}</span></div>
      </div>
      <div class="pills" style="margin:10px 0">
        <span class="pill ${pk === "on" ? "ok" : ""}"><ha-icon icon="mdi:chart-bell-curve"></ha-icon>Spitzenlast ${tr(pk)}${pka === "on" ? " · greift" : ""} · ${fmtW(num(h, c.peak_limit))}</span>
        <span class="pill ${un && un !== "None" ? "bad" : "ok"}"><ha-icon icon="mdi:lan-connect"></ha-icon>${un && un !== "None" ? "reagiert nicht: " + un : "alle reagieren"}</span>
        <span class="pill ${rs === "on" ? "warn" : ""}"><ha-icon icon="mdi:serial-port"></ha-icon>RS485 ${tr(rs)}</span>
      </div>
      <div class="inner list">
        ${it("Integrationsstatus", tr(txt(h, c.status)))}
        ${it("Aktive Batterien", tr(txt(h, c.active)))}
        ${it("Ladeverzögerung", tr(txt(h, c.delay)))}
        ${it("Entladefenster", tr(txt(h, c.window)))}
        ${it("Ziel-Netzleistung · Totband", `${fmtW(num(h, c.target))} · ${fmtW(num(h, c.deadband))}`)}
        ${it("Regelqualität", tr(txt(h, c.quality)))}
      </div>
      <div class="sub">Werte der Omnibattery-Integration (Venus-System)</div>`;
  }
  getCardSize() { return 6; }
}

const ENT = { entity: {} }, ENTS = { entity: { multiple: true } }, TXT = { text: {} }, COLOR = { text: { type: "color" } }, BOOL = { boolean: {} };
const NUM = (min, max, step = 1) => ({ number: { min, max, step, mode: "box" } });
const f = (name, label, selector) => ({ name, label, selector });
const UNIT_FIELDS = [f("name", "Name", TXT), f("color", "Farbe", COLOR), f("soc", "Ladestand (%)", ENT), f("energy", "Gespeicherte Energie", ENT),
  f("capacity", "Kapazität (Entität)", ENT), f("capacity_kwh", "Kapazität (kWh, falls keine Entität)", NUM(0, 100, 0.01)),
  f("power", "Leistung (+ laden / − entladen)", ENT), f("power_invert", "Vorzeichen umdrehen", BOOL),
  f("pv", "oder: PV-Eingänge (W)", ENTS), f("output", "oder: Ausgang (W)", ENT)];
const SCHEMA = {
  "mst-fleet": { fields: [f("scale_w", "Skala Netto-Balken (W)", NUM(100, 20000, 100))],
    lists: [{ key: "units", title: "Speicher", add: "Speicher hinzufügen", fields: UNIT_FIELDS, blank: () => ({ name: "Neu", color: "#666666", soc: "" }) }] },
  "mst-venus": { fields: [
    f("name", "Name", TXT), f("soc", "Ladestand", ENT), f("power", "Akku-Leistung (+ laden)", ENT), f("ac_power", "AC-Leistung", ENT),
    f("stored", "Gespeichert", ENT), f("capacity", "Kapazität", ENT), f("voltage", "Spannung", ENT), f("cell_max", "Zellspannung max", ENT), f("cell_min", "Zellspannung min", ENT),
    f("temp", "Temperatur", ENT), f("cycles", "Zyklen Gerät", ENT), f("cycles_calc", "Zyklen berechnet", ENT), f("efficiency", "Wirkungsgrad", ENT),
    f("charge_today", "Geladen heute", ENT), f("discharge_today", "Entladen heute", ENT), f("total_charge", "Σ geladen", ENT), f("total_discharge", "Σ entladen", ENT),
    f("solar", "Solarleistung", ENT), f("mppt", "MPPT-Leistungen", ENTS), f("status", "WR-Status", ENT), f("mode", "Arbeitsmodus", ENT), f("balance", "Balance-Status", ENT),
    f("soc_min", "Entlade-SoC-Grenze", ENT), f("soc_max", "Lade-SoC-Grenze", ENT), f("max_charge", "Max. Ladeleistung", ENT), f("max_discharge", "Max. Entladeleistung", ENT),
    f("hours", "Verlauf (Stunden)", NUM(1, 168))] },
  "mst-b2500": { fields: [f("step", "Schrittweite +/− (W)", NUM(1, 200))],
    lists: [{ key: "units", title: "Einheiten", add: "Einheit hinzufügen",
      fields: [f("name", "Name", TXT), f("soc", "Ladestand", ENT), f("energy", "Gespeichert", ENT), f("capacity_kwh", "Kapazität (kWh)", NUM(0, 100, 0.01)),
        f("pv", "PV-Eingänge (W)", ENTS), f("output", "Ausgang (W)", ENT), f("temp", "Temperatur", ENT),
        f("today_pv", "PV heute (kWh, Summe)", ENTS), f("today_out", "Ausgang heute", ENT), f("today_charge", "Geladen heute", ENT), f("today_discharge", "Entladen heute", ENT),
        f("timer_power", "Timer-Leistung (number)", ENT), f("timer_switch", "Timer-Schalter", ENT), f("dod", "Entladetiefe (number)", ENT)],
      blank: () => ({ name: "Neu", soc: "", pv: [], output: "" }) }] },
  "mst-day": { fields: [f("hours", "Zeitraum (Stunden)", NUM(1, 168))],
    lists: [{ key: "units", title: "Kurven", add: "Kurve hinzufügen", fields: [f("name", "Name", TXT), f("color", "Farbe", COLOR), f("soc", "Ladestand (%)", ENT)],
      blank: () => ({ name: "Neu", color: "#666666", soc: "" }) }] },
  "mst-control": { fields: Object.keys(MstControl.defaults).map((k) => f(k, k.replace(/_/g, " "), ENT)) },
};
const defs = [
  ["mst-fleet", MstFleet, "Marstek Glas: Speicherpark"], ["mst-venus", MstVenus, "Marstek Glas: Venus A"],
  ["mst-b2500", MstB2500, "Marstek Glas: B2500"], ["mst-day", MstDay, "Marstek Glas: Ladestand-Verlauf"],
  ["mst-control", MstControl, "Marstek Glas: Omnibattery-Steuerung"],
];
const OBJ_ = { object: {} };
for (const [type, K, label] of defs) {
  const S = SCHEMA[type] || { fields: [] };
  const fields = (S.fields || []).filter((x) => !x.name.includes("__"));
  if (S.flat) fields.push(f(S.flat, `${S.flat} (Liste: Heute, 7 Tage, 14 Tage, Monat)`, OBJ_));
  for (const Li of S.lists || []) fields.push(f(Li.key, `${Li.title} (YAML-Liste)`, OBJ_));
  REG.modules[type] = K;
  REG.editors[type] = { label: label.replace(/ Glas:/, ":"), group: "Marstek", groupIcon: "mdi:home-battery", fields, blank: () => ({ type }) };
}
REG.ver = (REG.ver || 0) + 1;

customElements.whenDefined("energie-atlas").then(() => {
  const PR = customElements.get("energie-atlas").prototype;
  if (PR.__regHook) return;
  const d = Object.getOwnPropertyDescriptor(PR, "hass");
  if (!d || !d.set) return;
  PR.__regHook = true;
  Object.defineProperty(PR, "hass", {
    configurable: true, get: d.get,
    set(h) {
      const v = REG.ver || 0;
      if (this._config && this._regV !== v) {
        this._regV = v;
        if ((this._config.modules || []).some((m) => m && REG.modules[m.type])) { this._hass = h; this._build(); return; }
      }
      d.set.call(this, h);
    },
  });
});
})();

/* ===== energie-atlas-zaehler ===== */
/* energie-atlas-zaehler – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const REFETCH_MS = 30 * 60 * 1000, LIVE_MS = 10 * 1000, COMPACT_W = 560, DAY = 86400000;
const CACHE = {};
const PRESET = {
  wasser: { entity: "", zaehler: "", gueltig: "",
    name: "Wasser", icon: "mdi:water", farben: ["#000080", "#2a6fb5", "#6aa5d8", "#a9c9e6", "#cfdff0"], rate_faktor: 1000, rate_einheit: "L/Tag", rate_dez: 0 },
  gas: { entity: "", zaehler: "", gueltig: "",
    name: "Gas", icon: "mdi:fire", farben: ["#9a2a00", "#cc5a1e", "#e08f55", "#efbb92", "#f6d9c2"], rate_faktor: 1, rate_einheit: "m³/Tag", rate_dez: 2 },
};
const fmt = (v, d = 0) => (v == null || isNaN(v) ? "–" : v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function series(rows, liveState) {
  const pts = (rows || []).filter((r) => r.sum != null).map((r) => ({ t: new Date(r.end).getTime(), s: r.sum, st: r.state })).sort((a, b) => a.t - b.t);
  if (pts.length && liveState != null && !isNaN(liveState)) {
    const last = pts[pts.length - 1];
    if (last.st != null && liveState > last.st) { const now = Date.now(); if (now > last.t) pts.push({ t: now, s: last.s + (liveState - last.st), st: liveState }); }
  }
  return pts;
}
function sumAt(pts, t) {
  const n = pts.length;
  if (n < 2) return null;
  const MAXX = 45 * DAY;
  const rate = (i, dir) => { let j = i; while (pts[j + dir] && Math.abs(pts[j].t - pts[i].t) < 60 * DAY) j += dir; return j === i ? 0 : Math.abs(pts[j].s - pts[i].s) / Math.abs(pts[j].t - pts[i].t); };
  if (t < pts[0].t) return pts[0].t - t > MAXX ? null : pts[0].s - rate(0, 1) * (pts[0].t - t);
  if (t > pts[n - 1].t) return t - pts[n - 1].t > MAXX ? null : pts[n - 1].s + rate(n - 1, -1) * (t - pts[n - 1].t);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid; }
  const a = pts[lo], b = pts[hi];
  if (b.t === a.t) return a.s;
  return a.s + ((b.s - a.s) * (t - a.t)) / (b.t - a.t);
}
function diff(pts, t0, t1) { const a = sumAt(pts, t0), b = sumAt(pts, t1); if (a == null || b == null) return null; return Math.max(0, b - a); }
const jan = (y) => new Date(y, 0, 1).getTime();
const frac = (y, t) => (t - jan(y)) / (jan(y + 1) - jan(y));
const atFrac = (y, f) => jan(y) + f * (jan(y + 1) - jan(y));

function model(pts, nPrev) {
  const now = Date.now(), y = new Date().getFullYear(), last = pts.length ? pts[pts.length - 1] : null, years = [];
  for (let yy = y; yy >= y - nPrev; yy--) {
    const base = sumAt(pts, jan(yy));
    if (base == null) continue;
    const end = Math.min(jan(yy + 1), last ? last.t : now);
    const total = yy < y ? diff(pts, jan(yy), jan(yy + 1)) : null;
    const curve = [{ f: 0, v: 0 }];
    for (const p of pts) if (p.t > jan(yy) && p.t < end) curve.push({ f: frac(yy, p.t), v: p.s - base, real: true });
    if (yy < y && total != null) curve.push({ f: 1, v: total });
    else if (last && last.t >= jan(yy)) curve.push({ f: frac(yy, last.t), v: last.s - base, real: true });
    years.push({ yy, base, total, curve });
  }
  const cur = years.find((r) => r.yy === y);
  const fulls = years.filter((r) => r.yy < y && r.total > 0);
  const share = (f) => { if (!fulls.length) return null; let s = 0; for (const r of fulls) s += (sumAt(pts, atFrac(r.yy, f)) - r.base) / r.total; return s / fulls.length; };
  let proj = null;
  if (cur && last && last.t > jan(y)) {
    const f0 = frac(y, last.t), ytd = last.s - cur.base, s0 = share(f0), linear = f0 > 0.03 ? ytd / f0 : null;
    let value = null, method = null;
    if (s0 != null && s0 > 0.03) { value = ytd / s0; method = "saison"; } else if (linear != null) { value = linear; method = "linear"; }
    if (value != null) {
      const curve = [];
      for (let f = f0; f < 1; f += 1 / 104) curve.push({ f, v: method === "saison" ? ytd + ((value - ytd) * (share(f) - s0)) / (1 - s0) : (ytd * f) / f0 });
      curve.push({ f: 1, v: value });
      proj = { value, linear, method, f0, ytd, curve, n: fulls.length, lastT: last.t };
    }
  }
  return { y, years, proj, last };
}

const STYLE = `
  :host { display:block; }
  .glass { color:#000; box-sizing:border-box; font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
  .title { display:flex; align-items:center; justify-content:center; gap:8px; font-size: 15px; font-weight: 600; margin-bottom: 10px; }
  .title ha-icon { --mdc-icon-size: 20px; color: var(--wjc-c0,#000080); }
  .sub { font-size: 11px; opacity: .6; text-align:center; margin-top: 6px; }
  .tiles { display:grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; }
  .tile { background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.10); border-radius: 12px; padding: 10px 12px; min-width:0; }
  .tile[data-e] { cursor:pointer; }
  .tile h4 { margin:0 0 6px 0; font-size: 13px; font-weight: 600; display:flex; align-items:center; gap:6px; }
  .tile h4 ha-icon { --mdc-icon-size: 18px; color:var(--wjc-c0,#000080); flex:none; }
  .val { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; white-space:nowrap; }
  .val small { font-size: 11px; font-weight: 400; opacity:.7; margin-left:3px; }
  .cmp { font-size: 11px; opacity:.85; font-variant-numeric: tabular-nums; margin-top:2px; }
  .good { color: #1b7a1b; } .bad { color: #a11a1a; } .neutral { opacity:.6; }
  .bar { height: 6px; border-radius: 3px; background: rgba(0,0,0,0.08); overflow:hidden; margin-top:8px; }
  .bar > div { height:100%; background:var(--wjc-c0,#000080); border-radius:3px; }
  .legend { display:flex; justify-content:center; gap:14px; font-size:12px; margin-top:6px; flex-wrap:wrap; }
  .legend span { display:inline-flex; align-items:center; gap:6px; }
  .legend i { width:14px; height:3px; border-radius:2px; display:inline-block; }
  .legend i.dash { background: repeating-linear-gradient(90deg,var(--wjc-c0,#000080) 0 4px,transparent 4px 7px) !important; }
  svg { display:block; }
  svg text { fill:#000; font-size:11px; }
  table { width:100%; border-collapse:collapse; font-variant-numeric: tabular-nums; }
  th, td { padding: 8px 6px; font-size: 13px; text-align:right; white-space:nowrap; }
  th { font-weight:600; font-size:12px; opacity:.7; border-bottom:1px solid rgba(0,0,0,0.15); }
  th i { display:inline-block; width:10px; height:3px; border-radius:2px; margin-right:5px; vertical-align:middle; }
  td:first-child, th:first-child { text-align:left; }
  tr + tr td { border-top: 1px solid rgba(0,0,0,0.06); }
  tr.sum td { border-top: 2px solid rgba(0,0,0,0.18); font-weight:600; }
  td .d { display:block; font-size:10px; font-weight:400; opacity:.65; }
  td.cur { font-weight:600; }
  .err { color:#a11a1a; font-size:13px; }
  .load { opacity:.6; font-size:13px; text-align:center; padding:12px; }
  .scroll { overflow-x:auto; }
  .compact .title { font-size: 14px; margin-bottom: 8px; }
  .compact .tiles { grid-template-columns: 1fr 1fr; gap: 6px; }
  .compact .tile { padding: 8px 8px; }
  .compact .tile h4 { font-size: 12px; margin-bottom: 4px; }
  .compact .val { font-size: 18px; }
  .compact .cmp { font-size: 10px; }
  .compact .legend { font-size: 11px; gap: 8px; }
  .compact th, .compact td { padding: 6px 3px; font-size: 12px; }
  .compact th { font-size: 11px; }
  /* Eingabe */
  .rows { display:flex; flex-direction:column; gap:2px; }
  .er { display:grid; grid-template-columns: 28px minmax(0,1fr) auto; align-items:center; gap:10px; padding:7px 6px; border-radius:10px; }
  .er:nth-child(odd) { background: rgba(255,255,255,0.10); }
  .er ha-icon { --mdc-icon-size:22px; color:#000080; justify-self:center; }
  .en { font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; }
  .ev { display:flex; align-items:center; gap:6px; font-size:14px; font-weight:600; font-variant-numeric: tabular-nums; white-space:nowrap; }
  .ev small { font-size:12px; font-weight:400; opacity:.7; }
  .ev input { width:120px; box-sizing:border-box; padding:6px 8px; border-radius:8px; border:1px solid rgba(0,0,0,0.25);
    background: rgba(255,255,255,0.55); font: inherit; font-weight:600; text-align:right; color:#000; }
  .ev input:focus { outline:2px solid #000080; outline-offset:0; }
  .ev input.bad { border-color:#a11a1a; outline-color:#a11a1a; }
  .ev input.ok { border-color:#1b7a1b; }
  .sec { font-size:12px; font-weight:600; opacity:.65; margin:10px 6px 2px; }
  .compact .ev input { width:96px; }
`;

/* ---------- Jahres-Module (Atlas-Schnittstelle: constructor(config, el) + set hass) ---------- */
class JahrMod {
  constructor(c, el) {
    const p = PRESET[c && c.medium === "gas" ? "gas" : "wasser"];
    this._config = { jahre: 3, ...p, ...(c || {}), part: this.constructor.part };
    if (!Array.isArray(this._config.farben) || !this._config.farben.length) this._config.farben = p.farben;
    const f = this._config.farben;
    this._col = (y, yy) => f[Math.min(y - yy, f.length - 1)];
    this.el = el;
    this.shadowRoot = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="glass"><div class="load">Lade…</div></div>`;
    this._lastRender = 0;
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver((e) => { const w = Math.round(e[0].contentRect.width); if (w > 0 && Math.abs(w - (this._w || 0)) > 16) { this._w = w; this._render(); } });
      this._ro.observe(el);
    }
  }
  _alive() {
    if (this.el.isConnected) { this._seen = true; return true; }
    if (this._seen && !this._gone) { this._gone = true; if (this._ro) this._ro.disconnect(); }
    return !this._seen;
  }
  set hass(hass) {
    if (!this._alive()) return;
    const prev = this._hass;
    this._hass = hass;
    const now = Date.now(), id = this._config.entity;
    const changed = prev && prev.states[id] && hass.states[id] && prev.states[id].state !== hass.states[id].state;
    if (!this._raw || now - this._fetched > REFETCH_MS || changed) this._load(changed);
    else if (now - this._lastRender > LIVE_MS) this._render();
  }
  _compact() { return (this._w || this.el.clientWidth || 800) < COMPACT_W; }
  async _load(force) {
    if (this._loading) return;
    this._loading = true;
    const c = this._config, key = `${c.entity}|${c.jahre}`;
    try {
      let entry = CACHE[key];
      if (force || !entry || Date.now() - entry.time > REFETCH_MS) {
        const y = new Date().getFullYear();
        entry = { time: Date.now(), promise: this._hass.callWS({ type: "recorder/statistics_during_period", start_time: new Date(y - c.jahre - 1, 9, 1).toISOString(),
          end_time: new Date().toISOString(), statistic_ids: [c.entity], period: "day", types: ["sum", "state"] }) };
        CACHE[key] = entry;
      }
      this._raw = await entry.promise;
      this._fetched = Date.now();
      this._render();
    } catch (e) {
      delete CACHE[key];
      this.shadowRoot.querySelector(".glass").innerHTML = `<div class="err">Fehler: ${esc(e.message || e)}</div>`;
    } finally { this._loading = false; }
  }
  _pts() { const id = this._config.entity, s = this._hass && this._hass.states[id]; return series(this._raw[id], s ? parseFloat(s.state) : null); }
  _render() {
    if (!this._raw || !this.shadowRoot || !this._hass) return;
    this._lastRender = Date.now();
    const pts = this._pts(), box = this.shadowRoot.querySelector(".glass"), compact = this._compact();
    box.classList.toggle("compact", compact);
    box.style.setProperty("--wjc-c0", this._config.farben[0]);
    if (pts.length < 2) { box.innerHTML = `<div class="err">Keine Statistik für ${esc(this._config.entity)}.</div>`; return; }
    const m = model(pts, Number(this._config.jahre) || 3), part = this._config.part;
    try {
      box.innerHTML = part === "kurve" ? this._renderKurve(m, compact) : part === "quartale" ? this._renderQuartale(pts, m, compact) : this._renderKpi(pts, m, compact);
    } catch (e) { box.innerHTML = `<div class="err">Fehler: ${esc(e.message || e)}</div>`; }
  }
  _pct(cur, prev) {
    if (cur == null || prev == null || prev <= 0) return `<span class="neutral">–</span>`;
    const p = ((cur - prev) / prev) * 100, cls = Math.abs(p) < 1 ? "neutral" : p < 0 ? "good" : "bad";
    return `<span class="${cls}">${p >= 0 ? "▲" : "▼"} ${fmt(Math.abs(p), 0)} %</span>`;
  }
  _renderKpi(pts, m, compact) {
    const { y, years, proj, last } = m, t = last.t, c = this._config;
    const prevSame = (yy) => new Date(new Date(t).setFullYear(yy)).getTime();
    const cur = years.find((r) => r.yy === y), prevY = years.find((r) => r.yy === y - 1);
    const ytd = cur ? last.s - cur.base : null;
    const ytdP = prevY ? diff(pts, jan(y - 1), prevSame(y - 1)) : null;
    const r90 = diff(pts, t - 90 * DAY, t), r90P = diff(pts, prevSame(y - 1) - 90 * DAY, prevSame(y - 1));
    const lpd = (v) => (v == null ? null : (v * c.rate_faktor) / 90);
    const zs = this._hass.states[c.zaehler], gs = this._hass.states[c.gueltig];
    let lastRead = null;
    for (let i = pts.length - 1; i > 0; i--) {
      if (pts[i].st != null && pts[i - 1].st != null && pts[i].st !== pts[i - 1].st) {
        lastRead = Date.now() - pts[i].t < 3600000 && gs ? new Date(gs.last_changed) : new Date(pts[i].t - 1);
        break;
      }
    }
    const readTxt = lastRead ? lastRead.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "–";
    const age = lastRead ? Math.floor((Date.now() - lastRead.getTime()) / DAY) : null;
    const yearPct = frac(y, Date.now()) * 100;
    const tile = (icon, title, val, unit, cmp, e) => `<div class="tile"${e ? ` data-e="${esc(e)}"` : ""}>
      <h4><ha-icon icon="${icon}"></ha-icon>${title}</h4>
      <div class="val">${val}<small>${unit}</small></div>
      <div class="cmp">${cmp}</div></div>`;
    return `<div class="title"><ha-icon icon="${esc(c.icon)}"></ha-icon>${esc(c.name)} ${y}</div>
      <div class="tiles">
        ${tile("mdi:crystal-ball", compact ? `Prognose ${y}` : `Hochrechnung ${y}`, proj ? "≈ " + fmt(proj.value, 1) : "–", "m³",
          proj ? `${this._pct(proj.value, prevY && prevY.total)} vs. ${y - 1} (${fmt(prevY && prevY.total, 0)})${compact ? "" : ` · linear ${fmt(proj.linear, 1)}`}` : "zu wenig Daten")}
        ${tile("mdi:calendar-start", compact ? "Seit 1.1." : `Seit 1. Januar ${y}`, fmt(ytd, 1), "m³", `${this._pct(ytd, ytdP)} vs. ${y - 1} (${fmt(ytdP, 1)})`, c.entity)}
        ${tile("mdi:speedometer", compact ? "Ø 90 Tage" : "Ø letzte 90 Tage", fmt(lpd(r90), c.rate_dez), esc(c.rate_einheit), `${this._pct(r90, r90P)} vs. Vorjahr (${fmt(lpd(r90P), c.rate_dez)})`)}
        ${tile("mdi:counter", "Letzte Ablesung", zs ? fmt(parseFloat(zs.state), 3) : "–", "m³", `${readTxt}${age != null ? ` · vor ${age} ${age === 1 ? "Tag" : "Tagen"}` : ""}`, c.zaehler)}
      </div>
      <div class="bar"><div style="width:${yearPct.toFixed(1)}%"></div></div>
      <div class="sub">${compact ? `Hochrechnung aus ${proj ? proj.n : 0} Vorjahresverläufen`
        : `${fmt(yearPct, 1)} % von ${y} vorbei · Hochrechnung = bisher ÷ Ø Anteil der Vorjahre zum gleichen Stichtag (${proj ? proj.n : 0} Jahre)`}</div>`;
  }
  _renderKurve(m, compact) {
    const { y, years, proj } = m;
    let max = 1;
    years.forEach((r) => r.curve.forEach((p) => (max = Math.max(max, p.v))));
    if (proj) max = Math.max(max, proj.value);
    const W = Math.max(300, Math.min(1400, this._w || this.el.clientWidth || 640));
    const H = compact ? 240 : Math.min(380, Math.max(260, W * 0.42));
    const pL = compact ? 32 : 42, pB = 22, pT = 18, pR = compact ? 6 : 10;
    const plotW = W - pL - pR, plotH = H - pT - pB;
    const raw = max / 5, p10 = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p10;
    const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p10;
    const tmax = Math.ceil((max * 1.04) / step) * step;
    const X = (f) => pL + f * plotW, Y = (v) => pT + plotH - (v / tmax) * plotH;
    const fsz = compact ? 10 : 11;
    let g = "";
    for (let q = 0; q < 4; q++) {
      if (q % 2) g += `<rect x="${X(q / 4)}" y="${pT}" width="${plotW / 4}" height="${plotH}" fill="${this._config.farben[0]}" fill-opacity="0.04"/>`;
      g += `<text x="${X(q / 4 + 0.125)}" y="${pT - 5}" text-anchor="middle" style="font-size:${fsz}px;font-weight:700;opacity:.55">Q${q + 1}</text>`;
    }
    for (let v = 0; v <= tmax + 1e-9; v += step) {
      g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,0.10)"/>`;
      g += `<text x="${pL - 4}" y="${Y(v) + 4}" text-anchor="end" style="font-size:${fsz}px">${fmt(v, 0)}</text>`;
    }
    const mf = (i) => (new Date(2025, i, 1) - new Date(2025, 0, 1)) / (365 * DAY);
    MON.forEach((mn, i) => {
      const a = mf(i), b = mf(i + 1);
      if (i % 3 === 0 && i) g += `<line x1="${X(a)}" x2="${X(a)}" y1="${pT}" y2="${pT + plotH}" stroke="rgba(0,0,0,0.18)"/>`;
      g += `<text x="${(X(a) + X(b)) / 2}" y="${H - 6}" text-anchor="middle" style="font-size:${fsz}px">${compact ? mn.charAt(0) : mn}</text>`;
    });
    const path = (c) => c.map((p, i) => `${i ? "L" : "M"}${X(p.f).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
    const col = (yy) => this._col(y, yy);
    [...years].reverse().forEach((r) => {
      const isCur = r.yy === y;
      if (isCur && proj) g += `<path d="${path(proj.curve)}" fill="none" stroke="${col(r.yy)}" stroke-width="2" stroke-dasharray="6 5" opacity=".8"/>`;
      if (isCur) { const lp = r.curve[r.curve.length - 1]; g += `<path d="${path(r.curve)}L${X(lp.f)},${Y(0)}L${X(0)},${Y(0)}Z" fill="${col(r.yy)}" fill-opacity="0.08"/>`; }
      g += `<path d="${path(r.curve)}" fill="none" stroke="${col(r.yy)}" stroke-width="${isCur ? 3 : 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (isCur) {
        r.curve.filter((p) => p.real).forEach((p) => (g += `<circle cx="${X(p.f)}" cy="${Y(p.v)}" r="2.2" fill="${col(r.yy)}"/>`));
        const lp = r.curve[r.curve.length - 1];
        g += `<circle cx="${X(lp.f)}" cy="${Y(lp.v)}" r="5" fill="#fff" stroke="${col(r.yy)}" stroke-width="2.5"/>`;
        if (proj) {
          g += `<circle cx="${X(1)}" cy="${Y(proj.value)}" r="3.5" fill="${col(r.yy)}"/>`;
          g += `<text x="${X(1) - 6}" y="${Y(proj.value) - 8}" text-anchor="end" style="font-size:${fsz + 1}px;font-weight:700;fill:${col(r.yy)}">≈ ${fmt(proj.value, 0)} m³</text>`;
        }
      }
    });
    const valAt = (r, f) => {
      const c = r.curve;
      if (f > c[c.length - 1].f) {
        if (r.yy === y && proj) { const p = proj.curve.find((q) => q.f >= f) || proj.curve[proj.curve.length - 1]; return { v: p.v, p: true }; }
        return null;
      }
      for (let i = 1; i < c.length; i++) if (c[i].f >= f) { const a = c[i - 1], b = c[i]; return { v: b.f === a.f ? b.v : a.v + ((b.v - a.v) * (f - a.f)) / (b.f - a.f) }; }
      return null;
    };
    MON.forEach((mn, i) => {
      const a = mf(i), b = mf(i + 1);
      const lines = years.map((r) => { const v = valAt(r, b); return v ? `${r.yy}${v.p ? " (Prognose)" : ""}: ${fmt(v.v, 1)} m³` : null; }).filter(Boolean).join("\n");
      g += `<rect x="${X(a)}" y="${pT}" width="${X(b) - X(a)}" height="${plotH}" fill="transparent"><title>Ende ${mn}\n${lines}</title></rect>`;
    });
    const legend = years.map((r) => `<span><i style="background:${col(r.yy)}"></i>${r.yy}${r.total != null ? `: ${fmt(r.total, 0)} m³` : r.yy === y ? " bisher" : ""}</span>`).join("")
      + (proj ? `<span><i class="dash"></i>Hochrechnung</span>` : "");
    return `<div class="title"><ha-icon icon="mdi:chart-bell-curve-cumulative"></ha-icon>Kumulierter Verbrauch je Jahr</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${g}</svg>
      <div class="legend">${legend}</div>
      <div class="sub">m³ seit 1. Januar${compact ? "" : " · Maus über einen Monat zeigt die Stände am Monatsende"}</div>`;
  }
  _renderQuartale(pts, m, compact) {
    const { y, proj, last, years } = m, cols = [];
    for (let yy = y - (Number(this._config.jahre) || 3); yy <= y; yy++) cols.push(yy);
    const col = (yy) => this._col(y, yy);
    const q = (yy, i) => {
      const s = new Date(yy, i * 3, 1).getTime(), e = new Date(yy, i * 3 + 3, 1).getTime();
      if (s > last.t) return null;
      if (e > last.t) { const v = diff(pts, s, last.t); return v == null ? null : { v, run: true }; }
      const v = diff(pts, s, e);
      return v == null ? null : { v };
    };
    const shiftY = (t, n) => new Date(new Date(t).setFullYear(new Date(t).getFullYear() - n)).getTime();
    let body = "";
    for (let i = 0; i < 4; i++) {
      let cur = null;
      const cells = cols.map((yy) => {
        const d = q(yy, i);
        if (yy === y) cur = d;
        if (!d) return `<td class="neutral">–</td>`;
        return `<td class="${yy === y ? "cur" : ""}">${fmt(d.v, 1)}${d.run ? `<span class="d">läuft</span>` : ""}</td>`;
      }).join("");
      let ref = null;
      if (cur) { const s = new Date(y - 1, i * 3, 1).getTime(); ref = cur.run ? diff(pts, s, shiftY(last.t, 1)) : (q(y - 1, i) || {}).v; }
      body += `<tr><td>Q${i + 1}${compact ? "" : ` <span class="neutral" style="font-size:11px">${MON[i * 3]}–${MON[i * 3 + 2]}</span>`}</td>${cells}<td>${cur ? this._pct(cur.v, ref) : "–"}</td></tr>`;
    }
    const sumCells = cols.map((yy) => {
      if (yy === y) return `<td class="cur">${proj ? "≈ " + fmt(proj.value, 1) + `<span class="d">Prognose</span>` : "–"}</td>`;
      const r = years.find((x) => x.yy === yy);
      return `<td>${r && r.total != null ? fmt(r.total, 1) : "–"}</td>`;
    }).join("");
    const prevT = (years.find((x) => x.yy === y - 1) || {}).total;
    const head = cols.map((yy) => `<th><i style="background:${col(yy)}"></i>${compact ? "’" + String(yy).slice(2) : yy}</th>`).join("");
    return `<div class="title"><ha-icon icon="mdi:table-large"></ha-icon>Quartalsvergleich</div>
      <div class="scroll"><table>
        <tr><th>Quartal</th>${head}<th>Δ Vorj.</th></tr>
        ${body}
        <tr class="sum"><td>Jahr</td>${sumCells}<td>${proj ? this._pct(proj.value, prevT) : "–"}</td></tr>
      </table></div>
      <div class="sub">m³ · Δ laufendes Quartal gegen den gleichen Zeitraum im Vorjahr · Werte zwischen Ablesungen interpoliert</div>`;
  }
}
class ZKpi extends JahrMod { static get part() { return "kpi"; } }
class ZKurve extends JahrMod { static get part() { return "kurve"; } }
class ZQuartale extends JahrMod { static get part() { return "quartale"; } }

/* ---------- zaehler-eingabe: Ablesung eintragen ---------- */
const DOMICON = { input_number: "mdi:ray-vertex", counter: "mdi:counter", sensor: "mdi:gauge", input_text: "mdi:form-textbox" };
const decOf = (step) => { const s = String(step ?? 1); return s.includes(".") ? s.split(".")[1].length : 0; };
class ZEingabe {
  constructor(c, el) {
    this._config = { name: "Ablesung eintragen", icon: "mdi:counter", rows: [], ...(c || {}) };
    this.el = el;
    this.shadowRoot = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="glass"></div>`;
    this._built = false;
  }
  set hass(h) {
    this._hass = h;
    const box = this.shadowRoot.querySelector(".glass"), c = this._config, rows = c.rows || [];
    if (!this._built) {
      box.innerHTML = `<div class="title"><ha-icon icon="${esc(c.icon)}"></ha-icon>${esc(c.name)}</div><div class="rows">${rows.map((r, i) => {
        if (!r || (!r.entity && r.label)) return `<div class="sec">${esc(r && r.label)}</div>`;
        const s = h.states[r.entity], dom = String(r.entity).split(".")[0];
        const icon = r.icon || (s && s.attributes.icon) || DOMICON[dom] || "mdi:information-outline";
        const name = r.name || (s && s.attributes.friendly_name) || r.entity;
        const val = dom === "input_number" && !r.readonly
          ? `<input type="number" inputmode="decimal" data-i="${i}"${s ? ` min="${esc(s.attributes.min)}" max="${esc(s.attributes.max)}" step="${esc(s.attributes.step)}"` : ""}><small data-u="${i}"></small>`
          : `<span data-v="${i}"></span>`;
        return `<div class="er"><ha-icon icon="${esc(icon)}"></ha-icon><span class="en" data-e="${esc(r.entity)}" title="${esc(r.entity)}">${esc(name)}</span><span class="ev">${val}</span></div>`;
      }).join("")}</div>`;
      box.querySelectorAll("input[data-i]").forEach((inp) => {
        const r = rows[Number(inp.dataset.i)];
        const commit = () => {
          const v = parseFloat(String(inp.value).replace(",", "."));
          if (isNaN(v)) { inp.classList.add("bad"); inp.title = "keine Zahl"; return; }
          const s = this._hass.states[r.entity];
          if (s && String(v) === String(parseFloat(s.state))) return;
          inp.classList.remove("bad", "ok");
          this._hass.callService("input_number", "set_value", { entity_id: r.entity, value: v })
            .then(() => { inp.classList.add("ok"); inp.title = "übernommen"; setTimeout(() => inp.classList.remove("ok"), 2000); })
            .catch((e) => { inp.classList.add("bad"); inp.title = e.message || String(e); });
        };
        inp.addEventListener("change", commit);
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
        inp.addEventListener("click", (e) => e.stopPropagation());
      });
      this._built = true;
    }
    const focused = this.shadowRoot.activeElement;
    rows.forEach((r, i) => {
      if (!r || !r.entity) return;
      const s = h.states[r.entity];
      const inp = box.querySelector(`input[data-i="${i}"]`);
      if (inp) {
        const u = box.querySelector(`[data-u="${i}"]`);
        if (u) u.textContent = s ? s.attributes.unit_of_measurement || "" : "";
        if (inp !== focused) inp.value = s && !isNaN(parseFloat(s.state)) ? parseFloat(s.state).toFixed(decOf(s.attributes.step)) : "";
        return;
      }
      const vEl = box.querySelector(`[data-v="${i}"]`);
      if (!vEl) return;
      if (!s || s.state === "unavailable" || s.state === "unknown") { vEl.innerHTML = "–"; return; }
      const v = parseFloat(s.state), u = s.attributes.unit_of_measurement || "";
      const d = r.decimals != null ? Number(r.decimals) : s.attributes.step != null ? decOf(s.attributes.step) : Math.min(3, (String(s.state).split(".")[1] || "").length);
      vEl.innerHTML = isNaN(v) ? esc(s.state) : `${fmt(v, d)}${u ? ` <small>${esc(u)}</small>` : ""}`;
    });
  }
}

/* ======================= Anmeldung beim Atlas ======================= */
const ENT = { entity: {} }, TXT = { text: {} }, ICON = { icon: {} }, OBJ = { object: {} };
const NUM = (min, max) => ({ number: { min, max, step: 1, mode: "box" } });
const f = (name, label, selector) => ({ name, label, selector });
const MEDIUM = f("medium", "Medium (Voreinstellung)", { select: { mode: "dropdown", options: [{ value: "wasser", label: "Wasser" }, { value: "gas", label: "Gas" }] } });
const JF = [MEDIUM, f("entity", "Kumulierter Sensor (leer = Voreinstellung)", ENT), f("zaehler", "Zählerstand Original", ENT), f("gueltig", "Letzter gültiger Stand", ENT),
  f("jahre", "Vorjahre", NUM(1, 5)), f("name", "Name", TXT), f("icon", "Icon", ICON), f("rate_einheit", "Einheit Tagesverbrauch", TXT)];
const LIST = [
  ["zaehler-kpi", ZKpi, "Zähler: Kennzahlen", JF, () => ({ type: "zaehler-kpi", medium: "wasser" })],
  ["zaehler-kurve", ZKurve, "Zähler: Jahreskurven", JF, () => ({ type: "zaehler-kurve", medium: "wasser" })],
  ["zaehler-quartale", ZQuartale, "Zähler: Quartale", JF, () => ({ type: "zaehler-quartale", medium: "wasser" })],
  ["zaehler-eingabe", ZEingabe, "Zähler: Ablesung eintragen", [f("name", "Titel", TXT), f("icon", "Icon", ICON),
    f("rows", "Zeilen (YAML: - entity, name, icon, decimals, readonly  |  - label: Abschnitt)", OBJ)],
    () => ({ type: "zaehler-eingabe", name: "Ablesung eintragen", icon: "mdi:counter", rows: [] })],
];
for (const [type, K, label, fields, blank] of LIST) { REG.modules[type] = K; REG.editors[type] = { label, fields, blank }; }
REG.ver = (REG.ver || 0) + 1;

customElements.whenDefined("energie-atlas").then(() => {
  const P = customElements.get("energie-atlas").prototype;
  if (P.__regHook) return;
  const d = Object.getOwnPropertyDescriptor(P, "hass");
  if (!d || !d.set) return;
  P.__regHook = true;
  Object.defineProperty(P, "hass", {
    configurable: true,
    get: d.get,
    set(h) {
      const v = REG.ver || 0;
      if (this._config && this._regV !== v) {
        this._regV = v;
        if ((this._config.modules || []).some((m) => m && REG.modules[m.type])) { this._hass = h; this._build(); return; }
      }
      d.set.call(this, h);
    },
  });
});
})();

/* ===== energie-atlas-heizung ===== */
/* energie-atlas-heizung – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const DEF = { soll: "", aussen: "", roh: "",
  tage: 14, fenster_min: 30, norm_aussen: -10, wp_gut: 55, wp_grenz: 65 };
const fmt = (v, d = 1) => (v == null || !isFinite(v) ? "–" : Number(v).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const poly = (d) => 1.4347 + 0.021 * d + 247.9e-6 * d * d;
const kurve = (at, n, niv, rs) => { const d = at - rs; return rs + niv - n * d * poly(d); };
const neigungFuer = (ziel, at, niv, rs) => { const d = at - rs; return (ziel - rs - niv) / (-d * poly(d)); };
const X0 = -15, X1 = 20, Y0 = 15, Y1 = 80;
const W = 640, H = 300, ML = 36, MR = 10, MT = 10, MB = 30;
const cx = (x) => Math.min(X1, Math.max(X0, x));
const sx = (x) => ML + ((cx(x) - X0) / (X1 - X0)) * (W - ML - MR);
const sy = (y) => MT + (1 - (Math.min(Y1, Math.max(Y0, y)) - Y0) / (Y1 - Y0)) * (H - MT - MB);

const STYLE = `
  :host { display:block; }
  .box { color:#000; font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
  svg { width:100%; height:auto; display:block; }
  .gl { stroke:rgba(0,0,0,0.08); stroke-width:1; }
  .ax { font-size:11px; fill:rgba(0,0,0,0.6); }
  .zl { font-size:10px; font-weight:700; }
  .kn { fill:none; stroke:#000080; stroke-width:1.8; }
  .kr { fill:none; stroke:#000080; stroke-width:1.4; stroke-dasharray:5 4; opacity:.45; }
  .fit { stroke:#d84315; stroke-width:1.8; stroke-dasharray:6 4; }
  .pn { fill:#ff7043; } .pr { fill:#616161; } .px { fill:none; stroke:#9e9e9e; stroke-width:1; }
  .nm { stroke:rgba(0,0,0,0.45); stroke-width:1; stroke-dasharray:2 3; }
  .jetzt { stroke:#42a5f5; stroke-width:1.5; }
  .facts { display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap:8px; margin-top:10px; }
  .f { background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.18); border-radius:10px; padding:8px 10px; text-align:center; }
  .f .k { display:block; font-size:11px; opacity:.75; }
  .f b { font-size:18px; font-variant-numeric: tabular-nums; }
  .verdict { display:flex; align-items:flex-start; gap:8px; border-radius:10px; padding:8px 12px; margin-top:10px; font-size:13px; font-weight:600; }
  .verdict ha-icon { --mdc-icon-size:20px; flex:none; }
  .verdict.good { background:rgba(27,122,27,0.10); } .verdict.warn { background:rgba(255,166,0,0.16); } .verdict.bad { background:rgba(198,40,40,0.14); }
  .good { color:#1b7a1b; } .warn { color:#a35200; } .bad { color:#a11a1a; }
  .legend { display:flex; flex-wrap:wrap; justify-content:center; gap:4px 14px; font-size:11px; margin-top:8px; }
  .legend span { display:inline-flex; align-items:center; gap:5px; }
  .sub { font-size:11px; opacity:.6; text-align:center; margin-top:8px; }
  .err { color:#a11a1a; font-size:13px; }
`;

class HeizKurve {
  constructor(c, el) {
    this._c = { ...DEF, ...(c || {}) };
    this.el = el;
    this.shadowRoot = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="box"><div class="sub">Lade Historie…</div></div>`;
    this._pts = null;
  }
  onDisconnect() { if (this._iv) { clearInterval(this._iv); this._iv = null; } }
  set hass(h) {
    if (!this.el.isConnected && this._seen) { if (this._iv) { clearInterval(this._iv); this._iv = null; } return; }
    if (this.el.isConnected) this._seen = true;
    this._hass = h;
    if (!this._iv) this._iv = setInterval(() => this._load(), 15 * 60e3);
    if (!this._pts && !this._busy && !this._tried) { this._tried = true; this._load(); }
    const r = h.states[this._c.roh], a = r ? r.attributes : {}, au = h.states[this._c.aussen];
    const sig = [a.neigung, a.niveau, a.raum_soll, a.raum_red, au && au.state].join("|");
    if (sig !== this._sig) { this._sig = sig; this._render(); }
  }
  _par() {
    const c = this._c, r = this._hass && this._hass.states[c.roh], a = (r && r.attributes) || {};
    const pick = (k, ak, d) => (c[k] != null && c[k] !== "" && isFinite(+c[k]) ? +c[k] : a[ak] != null && isFinite(+a[ak]) ? +a[ak] : d);
    return { n: pick("neigung", "neigung", 1.4), niv: pick("niveau", "niveau", 0), rs: pick("raum_soll", "raum_soll", 21), rr: pick("raum_red", "raum_red", null) };
  }
  async _load() {
    if (this._seen && !this.el.isConnected) { this.onDisconnect(); return; }
    if (this._busy || !this._hass) return;
    this._busy = true;
    const c = this._c, end = Date.now(), start = end - Math.max(1, +c.tage || 14) * 864e5;
    try {
      const r = await this._hass.callWS({ type: "history/history_during_period", start_time: new Date(start).toISOString(),
        end_time: new Date(end).toISOString(), entity_ids: [c.soll, c.aussen], minimal_response: true, no_attributes: true, significant_changes_only: false });
      this._pts = this._fenster(r[c.soll] || [], r[c.aussen] || [], start, end);
      this._err = null; this._stand = end;
    } catch (e) { this._err = e.message || String(e); }
    this._busy = false;
    this._render();
  }
  _fenster(soll, aus, start, end) {
    const Wm = Math.max(5, +this._c.fenster_min || 30) * 60e3;
    const seg = (arr) => arr.map((x) => ({ t: Math.max(start, (x.lu ?? x.lc ?? 0) * 1000), v: parseFloat(x.s) }))
      .map((p, i, A) => ({ ...p, e: i + 1 < A.length ? A[i + 1].t : end }));
    const B = new Map();
    for (const p of seg(soll)) {
      if (!isFinite(p.v) || p.v < 15 || p.v > 95 || p.e <= p.t) continue;
      for (let k = Math.floor(p.t / Wm); k * Wm < p.e; k++) {
        const b = B.get(k) || { k, max: -Infinity };
        if (p.v > b.max) b.max = p.v;
        B.set(k, b);
      }
    }
    const A = seg(aus), out = [];
    let j = 0;
    for (const b of [...B.values()].sort((x, y) => x.k - y.k)) {
      const tm = (b.k + 0.5) * Wm;
      while (j + 1 < A.length && A[j + 1].t <= tm) j++;
      const a = A[j];
      if (!a || a.t > tm || !isFinite(a.v)) continue;
      out.push({ t: tm, at: a.v, v: b.max });
    }
    return out;
  }
  _render() {
    if (!this._hass) return;
    const box = this.shadowRoot.querySelector(".box");
    try { box.innerHTML = this._html(); } catch (e) { box.innerHTML = `<div class="err">Fehler: ${esc(e.message || e)}</div>`; }
  }
  _html() {
    const c = this._c, P = this._par();
    if (this._err && !this._pts) return `<div class="err">Historie nicht lesbar: ${esc(this._err)}</div>`;
    if (!this._pts) return `<div class="sub">Lade Historie…</div>`;
    const gut = +c.wp_gut, grenz = +c.wp_grenz, NA = +c.norm_aussen;
    const norm = [], red = [], sonst = [];
    for (const p of this._pts) {
      const tn = kurve(p.at, P.n, P.niv, P.rs), tr = P.rr != null ? kurve(p.at, P.n, P.niv, P.rr) : null;
      if (p.v > tn + 8 || p.v < (tr != null ? tr : tn) - 8) sonst.push(p);
      else if (tr == null || Math.abs(p.v - tn) <= Math.abs(p.v - tr)) norm.push(p);
      else red.push(p);
    }
    let fit = null;
    if (norm.length >= 12) {
      const xs = norm.map((p) => p.at), ys = norm.map((p) => p.v);
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let sxx = 0, sxy = 0;
      xs.forEach((x, i) => { sxx += (x - mx) ** 2; sxy += (x - mx) * (ys[i] - my); });
      const xmin = Math.min(...xs), xmax = Math.max(...xs);
      if (xmax - xmin >= 3 && sxx > 0) { const b = sxy / sxx, a = my - b * mx; fit = { xmin, xmax, f: (x) => a + b * x }; }
    }
    const vForm = kurve(NA, P.n, P.niv, P.rs), vFit = fit ? fit.f(NA) : null;
    const nZiel = neigungFuer(gut, NA, P.niv, P.rs);
    const vRef = vFit != null ? vFit : vForm;
    const zone = vRef <= gut ? ["good", "mdi:check-circle", `Bei ${NA} °C reicht voraussichtlich ein Vorlauf um ${fmt(vRef, 0)} °C – für eine Wärmepumpe gut geeignet.`]
      : vRef <= grenz ? ["warn", "mdi:alert-circle-outline", `Bei ${NA} °C braucht das Haus voraussichtlich ~${fmt(vRef, 0)} °C Vorlauf – mit Wärmepumpe machbar, an Frosttagen weniger sparsam.`]
      : ["bad", "mdi:alert", `Bei ${NA} °C braucht das Haus voraussichtlich ~${fmt(vRef, 0)} °C Vorlauf – für eine Wärmepumpe kritisch (Heizkörper/Dämmung prüfen).`];

    const now = Date.now(), span = Math.max(1, +c.tage) * 864e5;
    const op = (p) => (0.25 + 0.7 * Math.max(0, 1 - (now - p.t) / span)).toFixed(2);
    const band = (y0, y1, col) => `<rect x="${ML}" y="${sy(y1)}" width="${W - ML - MR}" height="${sy(y0) - sy(y1)}" fill="${col}"/>`;
    let g = band(Y0, gut, "rgba(27,122,27,0.10)") + band(gut, grenz, "rgba(255,166,0,0.15)") + band(grenz, Y1, "rgba(198,40,40,0.10)");
    g += `<text x="${W - MR - 4}" y="${sy(gut) + 12}" text-anchor="end" class="zl good">WP gut ≤ ${gut} °C</text>`;
    g += `<text x="${W - MR - 4}" y="${sy(grenz) + 12}" text-anchor="end" class="zl warn">WP machbar ≤ ${grenz} °C</text>`;
    g += `<text x="${W - MR - 4}" y="${sy(Y1) + 12}" text-anchor="end" class="zl bad">WP kritisch</text>`;
    for (let x = X0; x <= X1; x += 5) g += `<line x1="${sx(x)}" y1="${MT}" x2="${sx(x)}" y2="${H - MB}" class="gl"/><text x="${sx(x)}" y="${H - MB + 14}" class="ax" text-anchor="middle">${x}</text>`;
    for (let y = 20; y <= Y1; y += 10) g += `<line x1="${ML}" y1="${sy(y)}" x2="${W - MR}" y2="${sy(y)}" class="gl"/><text x="${ML - 5}" y="${sy(y) + 4}" class="ax" text-anchor="end">${y}</text>`;
    g += `<text x="${(ML + W - MR) / 2}" y="${H - 3}" class="ax" text-anchor="middle">Außentemperatur °C</text>`;
    g += `<text x="${ML + 4}" y="${MT + 11}" class="ax">Kessel-Soll / Vorlauf °C</text>`;
    const path = (f) => { let d = ""; for (let x = X0; x <= X1 + 0.01; x += 0.5) d += (d ? "L" : "M") + sx(x).toFixed(1) + "," + sy(f(x)).toFixed(1); return d; };
    if (P.rr != null) g += `<path d="${path((x) => kurve(x, P.n, P.niv, P.rr))}" class="kr"/>`;
    g += `<path d="${path((x) => kurve(x, P.n, P.niv, P.rs))}" class="kn"/>`;
    const dot = (p, cls) => `<circle cx="${sx(p.at).toFixed(1)}" cy="${sy(p.v).toFixed(1)}" r="2.6" class="${cls}"${cls === "px" ? "" : ` fill-opacity="${op(p)}"`}/>`;
    g += red.map((p) => dot(p, "pr")).join("") + sonst.map((p) => dot(p, "px")).join("") + norm.map((p) => dot(p, "pn")).join("");
    if (fit) g += `<line x1="${sx(NA)}" y1="${sy(fit.f(NA))}" x2="${sx(fit.xmax)}" y2="${sy(fit.f(fit.xmax))}" class="fit"/>`;
    g += `<line x1="${sx(NA)}" y1="${MT}" x2="${sx(NA)}" y2="${H - MB}" class="nm"/>`;
    g += `<circle cx="${sx(NA)}" cy="${sy(vForm)}" r="4.5" fill="none" stroke="#000080" stroke-width="2"/>`;
    if (vFit != null) g += `<circle cx="${sx(NA)}" cy="${sy(vFit)}" r="4.5" fill="#d84315"/>`;
    g += `<text x="${sx(NA) + 7}" y="${sy(vRef) - 7}" class="ax" style="font-weight:700;fill:#000">${fmt(vRef, 0)} °C</text>`;
    const au = this._hass.states[c.aussen], atNow = au ? parseFloat(au.state) : NaN;
    if (isFinite(atNow)) g += `<line x1="${sx(atNow)}" y1="${H - MB - 6}" x2="${sx(atNow)}" y2="${H - MB}" class="jetzt"/><text x="${sx(atNow)}" y="${H - MB - 9}" class="ax" text-anchor="middle" style="fill:#1e88e5">jetzt</text>`;

    const allX = this._pts.map((p) => p.at);
    const rng = allX.length ? `${fmt(Math.min(...allX), 1)} … ${fmt(Math.max(...allX), 1)} °C` : "–";
    const sw = (svg) => `<svg width="22" height="10" viewBox="0 0 22 10" style="width:22px;height:10px;display:inline">${svg}</svg>`;
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${g}</svg>
      <div class="facts">
        <div class="f"><span class="k">bei ${NA} °C laut Einstellung</span><b>${fmt(vForm, 0)} °C</b></div>
        <div class="f"><span class="k">bei ${NA} °C aus Messpunkten</span><b>${vFit != null ? fmt(vFit, 0) + " °C" : "noch zu wenig"}</b></div>
        <div class="f"><span class="k">für ≤ ${gut} °C bei ${NA} °C nötig</span><b>Neigung ≈ ${fmt(nZiel, 1)}</b></div>
      </div>
      <div class="verdict ${zone[0]}"><ha-icon icon="${zone[1]}"></ha-icon><div>${zone[2]}${vFit == null ? " (Hochrechnung aus der Einstellung – Messpunkte reichen noch nicht)" : ""}</div></div>
      <div class="legend">
        <span>${sw('<circle cx="11" cy="5" r="3.5" fill="#ff7043"/>')}Normalbetrieb (${norm.length})</span>
        <span>${sw('<circle cx="11" cy="5" r="3.5" fill="#616161"/>')}Absenkung (${red.length})</span>
        <span>${sw('<circle cx="11" cy="5" r="3.2" fill="none" stroke="#9e9e9e"/>')}Sonderfälle (${sonst.length})</span>
        <span>${sw('<line x1="0" y1="5" x2="22" y2="5" stroke="#000080" stroke-width="2"/>')}Kurve Neigung ${fmt(P.n, 1)} · Niveau ${fmt(P.niv, 0)} · ${fmt(P.rs, 0)} °C</span>
        ${P.rr != null ? `<span>${sw('<line x1="0" y1="5" x2="22" y2="5" stroke="#000080" stroke-width="2" stroke-dasharray="5 3" opacity=".5"/>')}Absenkung ${fmt(P.rr, 0)} °C</span>` : ""}
        ${fit ? `<span>${sw('<line x1="0" y1="5" x2="22" y2="5" stroke="#d84315" stroke-width="2" stroke-dasharray="5 3"/>')}Trend aus Messpunkten</span>` : ""}
      </div>
      <div class="sub">Letzte ${fmt(+c.tage, 0)} Tage · Außen gemessen ${rng} · je ${fmt(+c.fenster_min, 0)} min zählt der höchste Kessel-Soll (Takten, Warmwasser, Anfahren gefiltert) · Punkte verblassen mit dem Alter${this._err ? " · letzte Aktualisierung fehlgeschlagen" : ""} · Stand ${this._stand ? new Date(this._stand).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–"}</div>`;
  }
}

const N = (name, label, min, max, step) => ({ name, label, selector: { number: { min, max, step, mode: "box" } } });
const E = (name, label) => ({ name, label, selector: { entity: { domain: "sensor" } } });
REG.modules["heiz-kurve"] = HeizKurve;
REG.editors["heiz-kurve"] = {
  label: "Heizung: Heizkurve & WP-Check", group: "Heizung", groupIcon: "mdi:radiator",
  fields: [E("soll", "Kessel-Soll (Vorlauf-Soll)"), E("aussen", "Außentemperatur"), E("roh", "Rohdaten (Attribute neigung, niveau, raum_soll, raum_red)"),
    N("tage", "Zeitraum in Tagen", 1, 120, 1), N("fenster_min", "Zeitfenster je Punkt (min)", 10, 120, 5),
    N("norm_aussen", "Norm-Außentemperatur °C", -20, 0, 1), N("wp_gut", "WP gut bis … °C Vorlauf", 40, 65, 1), N("wp_grenz", "WP machbar bis … °C Vorlauf", 50, 75, 1),
    N("neigung", "Neigung überschreiben (leer = aus Rohdaten)", 0.2, 3.5, 0.1), N("niveau", "Niveau überschreiben (leer = aus Rohdaten)", -13, 40, 1)],
  blank: () => ({ type: "heiz-kurve" }),
};
REG.ver = (REG.ver || 0) + 1;

customElements.whenDefined("energie-atlas").then(() => {
  const P = customElements.get("energie-atlas").prototype;
  if (P.__regHook) return;
  const d = Object.getOwnPropertyDescriptor(P, "hass");
  if (!d || !d.set) return;
  P.__regHook = true;
  Object.defineProperty(P, "hass", {
    configurable: true, get: d.get,
    set(h) {
      const v = REG.ver || 0;
      if (this._config && this._regV !== v) {
        this._regV = v;
        if ((this._config.modules || []).some((m) => m && REG.modules[m.type])) { this._hass = h; this._build(); return; }
      }
      d.set.call(this, h);
    },
  });
});
})();

/* ===== energie-atlas-klima ===== */
/* energie-atlas-klima – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const COMPACT_W = 560;
const st = (h, id) => (h && id && h.states[id]) || null;
const num = (h, id) => { const s = st(h, id); if (!s) return null; const v = parseFloat(s.state); return isNaN(v) ? null : v; };
const fmtN = (v, d = 1) => (v == null || isNaN(v) ? "–" : v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ago = (ms) => { const m = Math.floor(ms / 60000); if (m < 60) return `${m} min`; const h = Math.floor(m / 60); return h < 48 ? `${h} h` : `${Math.floor(h / 24)} T`; };
const psat = (t) => 6.112 * Math.exp((17.62 * t) / (243.12 + t));
const dewp = (t, rh) => { if (t == null || rh == null || rh <= 0) return null; const g = Math.log(rh / 100) + (17.62 * t) / (243.12 + t); return (243.12 * g) / (17.62 - g); };
const absH = (t, rh) => (t == null || rh == null ? null : (psat(t) * rh * 2.1674) / (273.15 + t));
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const ramp = (stops, v) => {
  if (v == null) return "#9e9e9e";
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i], k = (v - a) / (b - a), A = hex(ca), B = hex(cb);
    return "#" + A.map((x, j) => Math.round(x + (B[j] - x) * k).toString(16).padStart(2, "0")).join("");
  }
  return stops[stops.length - 1][1];
};
const IN = [[14, "#2f5fd0"], [17, "#4aa3e0"], [19, "#46b8b0"], [20.5, "#3fae5a"], [22.5, "#3fae5a"], [24, "#e3b02f"], [26, "#e0702a"], [28, "#c0392b"]];
const OUT = [[-10, "#5a3fd8"], [0, "#2f5fd0"], [8, "#4aa3e0"], [15, "#46b8b0"], [20, "#3fae5a"], [25, "#e3b02f"], [30, "#e0702a"], [35, "#c0392b"]];
const tCol = (v, out) => ramp(out ? OUT : IN, v);

const roomInfo = (h, r, fl, c) => {
  const sT = st(h, r.temp), t = num(h, r.temp), rh = num(h, r.hum), bat = r.bat ? num(h, r.bat) : null;
  const out = !!fl.outdoor;
  const tsOf = (o) => (o ? Date.parse(o.last_reported || o.last_updated) : NaN);
  const ref = Math.max(...[tsOf(sT), tsOf(st(h, r.hum))].filter((x) => !isNaN(x)), -1);
  const age = ref < 0 ? null : Date.now() - ref;
  const na = !sT || t == null;
  const stale = !na && age != null && age > (c.stale_h || 12) * 3600e3;
  const batLow = bat != null && bat < (c.bat_warn || 30);
  let hum = "ok";
  if (rh == null) hum = "na";
  else if (!out) hum = rh >= (c.hum_bad || 70) ? "bad" : rh >= (c.hum_warn || 60) ? "warn" : rh < (c.hum_dry || 35) ? "dry" : "ok";
  return { r, t, rh, bat, out, na, stale, batLow, age, hum, dp: dewp(t, rh), ah: absH(t, rh), col: tCol(t, out) };
};
const HUMTXT = { ok: "ok", warn: "erhöht", bad: "Schimmel!", dry: "trocken", na: "–" };
const HC = { ok: "#2e9d3a", warn: "#e0a000", bad: "#c0392b", dry: "#e07000", na: "#9e9e9e" };

const R = (name, icon, id, bat = true) => ({ name, icon, temp: `sensor.${id}_temperatur`, hum: `sensor.${id}_luftfeuchtigkeit`, bat: bat ? `sensor.${id}_batterie` : "" });
const FLOORS = [
  { name: "Obergeschoss", short: "OG", icon: "mdi:home-floor-1", rooms: [
    R("Kind Schlaf", "mdi:bed-single", "kind_schlaf"), R("Kind EDV", "mdi:desktop-tower-monitor", "kind_edv"), R("Umkleide", "mdi:hanger", "umkleide"),
    R("Schlafzimmer", "mdi:bed-king", "schlaf_eltern"), R("Flur Oben", "mdi:stairs", "flur_oben")] },
  { name: "Erdgeschoss", short: "EG", icon: "mdi:home-floor-0", rooms: [
    R("Küche", "mdi:silverware-fork-knife", "kuche"), R("Wohnzimmer", "mdi:sofa", "wohnzimmer"), R("HWR", "mdi:washing-machine", "hwk"),
    R("Flur", "mdi:door-open", "flur_eg"), R("Aquarium", "mdi:fishbowl", "aquarium")] },
  { name: "Keller", short: "KG", icon: "mdi:home-floor-negative-1", basement: true, rooms: [
    R("Flur Keller", "mdi:stairs-down", "flur_keller"), R("Heizung", "mdi:radiator", "heizung"), R("Party Keller", "mdi:party-popper", "party_keller"),
    R("Werkzeug", "mdi:hammer-wrench", "venus_temperatur"), R("Technik", "mdi:server", "tz3000_xr3htd96_ts0201")] },
  { name: "Draußen", short: "AUSSEN", icon: "mdi:tree", outdoor: true, rooms: [
    R("Pavillon", "mdi:umbrella-outline", "pavilion"), R("Schuppen", "mdi:warehouse", "schuppen"), R("Nebengebäude", "mdi:greenhouse", "gewachshaus"),
    R("Garage", "mdi:garage", "garage"), R("Carport", "mdi:car", "carport")] },
];
const OUTREF = { outdoor_temp: "", outdoor_hum: "", outdoor_dew: "" };
const LIMITS = { hum_warn: 60, hum_bad: 70, hum_dry: 35, bat_warn: 30, stale_h: 12 };

const BASE_CSS = `
  :host { display:block; }
  .glass { color:#000; box-sizing:border-box; height:100%;
    font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
  .title { display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:600; margin-bottom:10px; }
  .title ha-icon { --mdc-icon-size: 20px; color:#000080; }
  .sub { font-size:11px; opacity:.6; text-align:center; margin-top:6px; }
  .inner { background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.10); border-radius:12px; }
  .num { font-variant-numeric: tabular-nums; }
  .err { color:#a11a1a; font-size:13px; }
  .load { opacity:.6; font-size:13px; text-align:center; padding:12px; }
  .kl { font-size:12px; opacity:.72; }
  .kv { font-size:18px; font-weight:700; }
  .pills { display:flex; flex-wrap:wrap; gap:6px; justify-content:center; }
  .pill { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:12px; font-size:12px; font-weight:600;
    background: rgba(255,255,255,0.45); border:1px solid rgba(255,255,255,0.45); white-space:nowrap; }
  .pill ha-icon { --mdc-icon-size:15px; }
  .pill.ok { color:#1b6b1b; } .pill.warn { color:#a35200; } .pill.bad { color:#a11a1a; background: rgba(255,205,205,0.6); } .pill.dry { color:#a35200; }
  .box { padding:8px 10px; display:flex; flex-direction:column; min-width:0; }
  .box .kv { font-size:16px; }
  .kpis { display:grid; grid-template-columns: repeat(6, 1fr); gap:8px; margin-bottom:12px; }
  .compact .kpis { grid-template-columns: repeat(2, 1fr); }
`;

/* ---------- Modul-Basis (Atlas-Schnittstelle) ---------- */
class KlBase {
  constructor(c, el) {
    const K = this.constructor;
    this._config = JSON.parse(JSON.stringify({ ...(K.defaults || {}), ...(c || {}) }));
    this.el = el;
    this.shadowRoot = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}${K.css || ""}</style><div class="glass"><div class="load">Lade…</div></div>`;
    this._dirty = true;
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver((e) => {
        const w = Math.round(e[0].contentRect.width);
        if (w > 0 && Math.abs(w - (this._w || 0)) > 12) { const wasC = this._compact(); this._w = w; if (wasC !== this._compact()) this._dirty = true; this._update(true); }
      });
      this._ro.observe(el);
    }
  }
  set hass(h) { this._hass = h; if (!this._last || Date.now() - this._last > (this.constructor.throttle || 5000)) this._update(false); }
  _alive() {
    if (this.el.isConnected) { this._seen = true; return true; }
    if (this._seen && !this._gone) { this._gone = true; if (this._ro) this._ro.disconnect(); }
    return !this._seen;
  }
  _compact() { return (this._w || this.el.clientWidth || 800) < COMPACT_W; }
  get box() { return this.shadowRoot.querySelector(".glass"); }
  $(id) { return this.shadowRoot.getElementById(id); }
  _update(force) {
    if (!this._hass || !this._alive()) return;
    this._last = Date.now();
    this.box.classList.toggle("compact", this._compact());
    try { this.update(force); } catch (e) { this.box.innerHTML = `<div class="err">Fehler: ${esc(e.message || e)}</div>`; this._dirty = true; }
  }
  /* Stundenwerte (Statistik, Fallback: Verlauf). Punkte aus der Statistik tragen s:true (fuer Lueckenerkennung) */
  async _history(ids, hours = 24) {
    const end = new Date(), start = new Date(end.getTime() - hours * 3600e3);
    const out = {};
    if (!ids.length) return out;
    let stats = {};
    try {
      stats = await this._hass.callWS({ type: "recorder/statistics_during_period", start_time: start.toISOString(), end_time: end.toISOString(),
        statistic_ids: ids, period: "hour", types: ["mean", "min", "max"] });
    } catch (e) { stats = {}; }
    const miss = [];
    for (const id of ids) {
      const rows = (stats[id] || []).filter((r) => r.mean != null);
      if (rows.length >= 2) out[id] = rows.map((r) => ({ t: typeof r.start === "number" ? r.start : Date.parse(r.start), v: r.mean, lo: r.min ?? r.mean, hi: r.max ?? r.mean, s: true }));
      else miss.push(id);
    }
    if (miss.length) {
      try {
        const hs = await this._hass.callWS({ type: "history/history_during_period", start_time: start.toISOString(), end_time: end.toISOString(),
          entity_ids: miss, minimal_response: true, no_attributes: true, significant_changes_only: false });
        for (const id of miss) {
          const pts = (hs[id] || []).map((p) => ({ t: (p.lu || p.lc || 0) * 1000, v: parseFloat(p.s) })).filter((p) => !isNaN(p.v));
          if (pts.length) out[id] = pts.map((p) => ({ ...p, lo: p.v, hi: p.v }));
        }
      } catch (e) { /* ohne Verlauf */ }
    }
    return out;
  }
  async _load(fn) {
    if (this._loading) { this._again = true; return; }
    this._loading = true;
    try { await fn(); this._err = null; } catch (e) { this._err = e.message || String(e); }
    finally { this._at = Date.now(); this._loading = false; if (this._again) { this._again = false; this._load(fn); } else this._draw(); }
  }
  _draw() {}
}

/* ===================================================================== */
/* klima-house                                                            */
/* ===================================================================== */
class KlHouse extends KlBase {
  static get defaults() { return { name: "Klima im Haus", floors: FLOORS, ...OUTREF, ...LIMITS }; }
  static get css() {
    return `
    .wrap { display:grid; grid-template-columns: 1fr minmax(220px, 0.42fr); gap:14px; align-items:end; }
    .compact .wrap { grid-template-columns: 1fr; }
    .house { position:relative; }
    .roof { height:56px; margin:0 6%; clip-path: polygon(50% 0, 100% 100%, 0 100%);
      background: linear-gradient(180deg, rgba(120,40,30,.55), rgba(160,70,50,.35)); position:relative; }
    .chimney { position:absolute; right:22%; top:4px; width:16px; height:30px; background: rgba(120,40,30,.55); border-radius:2px 2px 0 0; }
    .roof .lbl { position:absolute; left:0; right:0; bottom:8px; text-align:center; font-size:12px; font-weight:600; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,.4); }
    .walls { border:2px solid rgba(255,255,255,.55); border-top:none; border-bottom:none; margin:0 9%; background: rgba(255,255,255,.12); }
    .compact .walls { margin:0 3%; } .compact .roof { margin:0; }
    .fl { display:grid; grid-template-columns: 54px 1fr; border-top:2px solid rgba(255,255,255,.55); }
    .compact .fl { grid-template-columns: 1fr; }
    .fl .fh { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; padding:4px; border-right:1px dashed rgba(255,255,255,.5);
      font-size:11px; text-align:center; }
    .compact .fl .fh { flex-direction:row; justify-content:flex-start; gap:8px; border-right:none; border-bottom:1px dashed rgba(255,255,255,.5); padding:4px 8px; }
    .fl .fh b { font-size:13px; } .fl .fh .num { font-weight:700; font-size:13px; }
    .rooms { display:grid; grid-template-columns: repeat(var(--n,5), 1fr); gap:6px; padding:6px; }
    .compact .rooms { grid-template-columns: repeat(3, 1fr); }
    .ground { height:10px; margin:0 2%; border-radius:3px; background: linear-gradient(180deg, rgba(76,140,60,.75), rgba(110,80,50,.6)); }
    .bsmt { margin:0 9%; background: linear-gradient(180deg, rgba(110,80,50,.28), rgba(80,60,40,.22)); border:2px solid rgba(110,80,50,.45); border-top:none; border-radius:0 0 10px 10px; }
    .compact .bsmt { margin:0 3%; }
    .bsmt .fl { border-top:none; }
    .tile { position:relative; border-radius:10px; padding:6px 6px 5px; min-width:0; overflow:hidden; cursor:pointer;
      background: linear-gradient(160deg, color-mix(in srgb, var(--c) 42%, rgba(255,255,255,.55)), color-mix(in srgb, var(--c) 22%, rgba(255,255,255,.25)));
      border:1px solid rgba(255,255,255,.55); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 30%, transparent); transition: transform .15s; }
    .tile:hover { transform: translateY(-2px); }
    .tile .nm { display:flex; align-items:center; gap:4px; font-size:11px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .tile .nm ha-icon { --mdc-icon-size:14px; flex:none; color:#000080; }
    .tile .t { font-size:20px; font-weight:800; line-height:1.15; } .tile .t small { font-size:11px; font-weight:600; opacity:.7; }
    .tile .h { font-size:11px; display:flex; align-items:center; gap:4px; }
    .tile .h i { width:7px; height:7px; border-radius:50%; display:inline-block; }
    .tile .fl2 { position:absolute; top:4px; right:4px; display:flex; gap:2px; }
    .tile .fl2 ha-icon { --mdc-icon-size:14px; }
    .tile.na { filter: grayscale(1); opacity:.6; }
    .tile.bad { animation: tpulse 2.4s infinite; }
    @keyframes tpulse { 0%,100% { box-shadow: inset 0 0 0 1px rgba(192,57,43,.5) } 50% { box-shadow: inset 0 0 0 2px rgba(192,57,43,.95), 0 0 10px rgba(192,57,43,.35) } }
    .yard { border-radius:12px; overflow:hidden; border:1px solid rgba(255,255,255,.35);
      background: linear-gradient(180deg, rgba(120,180,240,.30), rgba(160,210,250,.14) 60%, rgba(76,140,60,.25)); }
    .yard .yh { display:flex; align-items:center; gap:10px; padding:10px 12px 4px; }
    .yard .yh ha-icon { --mdc-icon-size:30px; color:#000080; }
    .yard .yh .big { font-size:26px; font-weight:800; line-height:1; } .yard .yh .big small { font-size:13px; opacity:.7; }
    .yard .ys { font-size:12px; padding:0 12px 6px; opacity:.85; }
    .yard .rooms { grid-template-columns: repeat(2, 1fr); }
    .compact .yard .rooms { grid-template-columns: repeat(3, 1fr); }
    .scale { display:flex; align-items:center; gap:6px; justify-content:center; font-size:11px; margin-top:10px; flex-wrap:wrap; }
    .scale .bar { width:160px; height:8px; border-radius:4px; }
    .issues { margin-top:10px; }
    `;
  }
  update() {
    const h = this._hass, c = this._config;
    if (this._dirty) {
      this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:home-thermometer"></ha-icon>${esc(c.name)}</div>
        <div class="kpis" id="kpi"></div><div class="wrap"><div class="house" id="house"></div><div id="yard"></div></div>
        <div class="issues pills" id="iss"></div>
        <div class="scale"><span>innen</span><span class="bar" style="background:linear-gradient(90deg,${IN.map((s) => s[1]).join(",")})"></span><span>14 – 28 °C</span>
        <span style="width:10px"></span><span>außen</span><span class="bar" style="background:linear-gradient(90deg,${OUT.map((s) => s[1]).join(",")})"></span><span>−10 – 35 °C</span></div>`;
      this._dirty = false;
    }
    const floors = (c.floors || []).map((fl) => ({ fl, rs: (fl.rooms || []).map((r) => roomInfo(h, r, fl, c)) }));
    const tile = (x) => {
      const flags = [];
      if (x.na) flags.push(`<ha-icon icon="mdi:lan-disconnect" title="keine Daten" style="color:#a11a1a"></ha-icon>`);
      else if (x.stale) flags.push(`<ha-icon icon="mdi:clock-alert-outline" title="seit ${ago(x.age)} kein Wert" style="color:#a35200"></ha-icon>`);
      if (x.batLow) flags.push(`<ha-icon icon="mdi:battery-alert-variant-outline" title="Batterie ${fmtN(x.bat, 0)} %" style="color:#a11a1a"></ha-icon>`);
      const cls = x.na ? "na" : x.hum === "bad" || x.batLow ? "bad" : "";
      return `<div class="tile ${cls}" style="--c:${x.col}" data-e="${esc(x.r.temp)}" title="${esc(x.r.name)}: ${fmtN(x.t)} °C, ${fmtN(x.rh, 0)} % rF, Taupunkt ${fmtN(x.dp)} °C${x.bat != null ? `, Batterie ${fmtN(x.bat, 0)} %` : ""}">
        <div class="fl2">${flags.join("")}</div>
        <div class="nm"><ha-icon icon="${esc(x.r.icon || "mdi:thermometer")}"></ha-icon>${esc(x.r.name)}</div>
        <div class="t num">${fmtN(x.t)}<small> °C</small></div>
        <div class="h num">${x.out ? "" : `<i style="background:${HC[x.hum]}"></i>`}${fmtN(x.rh, 0)} %${x.dp != null ? ` · Tp ${fmtN(x.dp, 0)}°` : ""}</div></div>`;
    };
    const avg = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    const floorHtml = (f) => `<div class="fl"><div class="fh"><ha-icon icon="${esc(f.fl.icon || "mdi:home")}"></ha-icon><b>${esc(f.fl.short || f.fl.name)}</b>
      <span class="num" style="color:${tCol(avg(f.rs.map((x) => x.t)))}">Ø ${fmtN(avg(f.rs.map((x) => x.t)))}°</span><span class="num">${fmtN(avg(f.rs.map((x) => x.rh)), 0)} %</span></div>
      <div class="rooms" style="--n:${Math.max(1, f.rs.length)}">${f.rs.map(tile).join("")}</div></div>`;
    const up = floors.filter((f) => !f.fl.outdoor && !f.fl.basement), down = floors.filter((f) => f.fl.basement), yard = floors.filter((f) => f.fl.outdoor);
    this.$("house").innerHTML = `<div class="roof"><div class="chimney"></div><div class="lbl">${esc(c.name)}</div></div>
      <div class="walls">${up.map(floorHtml).join("")}</div><div class="ground"></div>${down.length ? `<div class="bsmt">${down.map(floorHtml).join("")}</div>` : ""}`;
    const ot = num(h, c.outdoor_temp), oh = num(h, c.outdoor_hum), od = c.outdoor_dew ? num(h, c.outdoor_dew) : dewp(ot, oh);
    this.$("yard").innerHTML = `<div class="yard"><div class="yh" data-e="${esc(c.outdoor_temp)}"><ha-icon icon="mdi:weather-partly-cloudy"></ha-icon>
      <div><div class="big num" style="color:${tCol(ot, true)}">${fmtN(ot)}<small> °C</small></div><div class="kl">Wetterstation</div></div></div>
      <div class="ys num">${fmtN(oh, 0)} % rF · Taupunkt ${fmtN(od)} °C · ${fmtN(absH(ot, oh))} g/m³</div>
      ${yard.map((f) => `<div class="rooms">${f.rs.map(tile).join("")}</div>`).join("")}</div>`;
    const ins = floors.filter((f) => !f.fl.outdoor).flatMap((f) => f.rs).filter((x) => x.t != null);
    const all = floors.flatMap((f) => f.rs);
    const hot = ins.reduce((a, x) => (!a || x.t > a.t ? x : a), null), cold = ins.reduce((a, x) => (!a || x.t < a.t ? x : a), null);
    const wet = ins.filter((x) => x.hum === "bad" || x.hum === "warn");
    const bats = all.filter((x) => x.bat != null), bmin = bats.reduce((a, x) => (!a || x.bat < a.bat ? x : a), null);
    const k = (l, v, s, col, e) => `<div class="inner box"${e ? ` data-e="${esc(e)}" style="cursor:pointer"` : ""}><span class="kl">${l}</span><span class="kv num" ${col ? `style="color:${col}"` : ""}>${v}</span><span class="kl num" style="font-size:11px">${s}</span></div>`;
    const ai = avg(ins.map((x) => x.t));
    this.$("kpi").innerHTML =
      k("Ø innen", `${fmtN(ai)} °C`, `${fmtN(avg(ins.map((x) => x.rh)), 0)} % rF · ${ins.length} Räume`, tCol(ai)) +
      k("Wärmster Raum", hot ? `${fmtN(hot.t)} °C` : "–", hot ? esc(hot.r.name) : "", hot && hot.col, hot && hot.r.temp) +
      k("Kältester Raum", cold ? `${fmtN(cold.t)} °C` : "–", cold ? esc(cold.r.name) : "", cold && cold.col, cold && cold.r.temp) +
      k("Feuchte ≥ " + (c.hum_warn || 60) + " %", `${wet.length}`, wet.filter((x) => x.hum === "bad").length + ` davon ≥ ${c.hum_bad || 70} %`, wet.some((x) => x.hum === "bad") ? "#c0392b" : wet.length ? "#a35200" : "#1b6b1b") +
      k("Batterie min.", bmin ? `${fmtN(bmin.bat, 0)} %` : "–", bmin ? esc(bmin.r.name) : "", bmin && bmin.batLow ? "#c0392b" : "#1b6b1b", bmin && bmin.r.bat) +
      k("Innen − Außen", ai != null && ot != null ? `${ai - ot >= 0 ? "+" : ""}${fmtN(ai - ot)} K` : "–", `Außen ${fmtN(ot)} °C`, "#000080");
    const iss = [];
    for (const x of all) {
      if (x.na) iss.push(`<span class="pill bad" data-e="${esc(x.r.temp)}"><ha-icon icon="mdi:lan-disconnect"></ha-icon>${esc(x.r.name)}: keine Daten</span>`);
      else if (x.stale) iss.push(`<span class="pill warn" data-e="${esc(x.r.temp)}"><ha-icon icon="mdi:clock-alert-outline"></ha-icon>${esc(x.r.name)}: seit ${ago(x.age)} still</span>`);
      if (x.batLow) iss.push(`<span class="pill bad" data-e="${esc(x.r.bat)}"><ha-icon icon="mdi:battery-alert-variant-outline"></ha-icon>${esc(x.r.name)}: Batterie ${fmtN(x.bat, 0)} %</span>`);
      if (!x.out && x.hum === "bad") iss.push(`<span class="pill bad" data-e="${esc(x.r.hum)}"><ha-icon icon="mdi:water-alert"></ha-icon>${esc(x.r.name)}: ${fmtN(x.rh, 0)} % rF</span>`);
      if (!x.out && x.hum === "dry") iss.push(`<span class="pill dry" data-e="${esc(x.r.hum)}"><ha-icon icon="mdi:water-off-outline"></ha-icon>${esc(x.r.name)}: trocken ${fmtN(x.rh, 0)} %</span>`);
    }
    this.$("iss").innerHTML = iss.length ? iss.join("") : `<span class="pill ok"><ha-icon icon="mdi:check-circle-outline"></ha-icon>Alle Sensoren melden, keine Auffälligkeiten</span>`;
  }
}

/* ===================================================================== */
/* klima-floors  (eine oder mehrere Etagen, auto-fit nebeneinander)       */
/* ===================================================================== */
class KlFloors extends KlBase {
  static get defaults() { return { min_width: 440, hours: 24, floors: FLOORS.map((fl) => ({ ...fl })), ...LIMITS }; }
  static get css() {
    return `
    .g { display:grid; gap:8px; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--mw, 440px)), 1fr)); align-items:stretch; }
    .fbox { container-type: inline-size; padding:10px 12px; min-width:0; }
    .hd { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; }
    .hd .title { margin:0; justify-content:flex-start; }
    .hd .avg { display:flex; gap:12px; font-size:12px; } .hd .avg b { font-size:15px; }
    .row { display:grid; grid-template-columns: 34px minmax(80px,1fr) 104px 74px 92px 46px; align-items:center; gap:8px;
      padding:7px 8px; border-radius:10px; margin-top:6px; cursor:pointer;
      background: linear-gradient(90deg, color-mix(in srgb, var(--c) 30%, rgba(255,255,255,.35)), rgba(255,255,255,.06) 55%);
      border:1px solid rgba(255,255,255,.28); }
    .row:hover { border-color: rgba(255,255,255,.6); }
    .row.na { filter: grayscale(1); opacity:.6; }
    .ic { width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center;
      background: radial-gradient(circle at 35% 30%, #fff, var(--c) 130%); }
    .ic ha-icon { --mdc-icon-size:18px; color:#000080; }
    .nm { min-width:0; } .nm b { display:block; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .nm span { font-size:11px; opacity:.72; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block; }
    .sp { display:flex; flex-direction:column; align-items:stretch; }
    .sp svg { width:100%; height:26px; display:block; overflow:visible; }
    .sp .mm { font-size:10px; opacity:.7; display:flex; justify-content:space-between; }
    .tv { text-align:right; font-size:20px; font-weight:800; line-height:1; white-space:nowrap; }
    .tv small { font-size:11px; font-weight:600; opacity:.7; } .tv .tr { font-size:14px; margin-left:2px; }
    .hv { display:flex; flex-direction:column; gap:3px; }
    .hv .hb { height:6px; border-radius:3px; background: rgba(0,0,0,.08); position:relative; overflow:hidden; }
    .hv .hb i { position:absolute; left:0; top:0; bottom:0; border-radius:3px; }
    .hv .hl { display:flex; justify-content:space-between; font-size:11px; } .hv .hl b { font-size:13px; }
    .bt { text-align:center; font-size:11px; line-height:1.1; } .bt ha-icon { --mdc-icon-size:18px; display:block; margin:0 auto; }
    @container (max-width: 520px) {
      .row { grid-template-columns: 30px minmax(70px,1fr) 66px 80px 34px; } .sp { display:none; } .ic { width:28px; height:28px; }
    }
    @container (max-width: 360px) { .row { grid-template-columns: minmax(70px,1fr) 62px 70px 30px; gap:6px; } .ic { display:none; } }
    `;
  }
  update() {
    const h = this._hass, c = this._config, fls = c.floors || [];
    if (this._dirty) {
      this.box.innerHTML = `<div class="g" style="--mw:${Number(c.min_width) || 440}px">${fls.map((fl, i) => `<div class="inner fbox">
        <div class="hd"><div class="title"><ha-icon icon="${esc(fl.icon || "mdi:home-floor-0")}"></ha-icon>${esc(fl.name)}</div><div class="avg num" data-a="${i}"></div></div>
        <div data-r="${i}"></div></div>`).join("")}</div>`;
      this._dirty = false;
    }
    const byH = {};
    for (const fl of fls) { const hrs = Number(fl.hours || c.hours) || 24; for (const r of fl.rooms || []) if (st(h, r.temp)) (byH[hrs] = byH[hrs] || new Set()).add(r.temp); }
    if (Object.keys(byH).length && (!this._hist || Date.now() - (this._hAt || 0) > 15 * 60e3)) {
      this._hAt = Date.now(); if (!this._hist) this._hist = {};
      this._load(async () => { const o = {}; for (const [hrs, ids] of Object.entries(byH)) Object.assign(o, await this._history([...ids], Number(hrs))); this._hist = o; });
    }
    this._render();
  }
  _draw() { if (this._hass && !this._dirty) this._render(); }
  _render() {
    const h = this._hass, c = this._config, hist = this._hist || {};
    (c.floors || []).forEach((fl, i) => {
      const cfg = { ...c, ...fl }, hrs = Number(fl.hours || c.hours) || 24;
      const avgEl = this.shadowRoot.querySelector(`[data-a="${i}"]`), rowsEl = this.shadowRoot.querySelector(`[data-r="${i}"]`);
      if (!avgEl || !rowsEl) return;
      const rs = (fl.rooms || []).map((r) => roomInfo(h, r, fl, cfg));
      const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
      const at = avg(rs.filter((x) => x.t != null).map((x) => x.t)), ar = avg(rs.filter((x) => x.rh != null).map((x) => x.rh));
      avgEl.innerHTML = `<span>Ø <b style="color:${tCol(at, fl.outdoor)}">${fmtN(at)} °C</b></span><span>Ø <b>${fmtN(ar, 0)} %</b></span>`;
      const spark = (x) => {
        const p = hist[x.r.temp];
        if (!p || p.length < 2) return { svg: `<svg viewBox="0 0 100 26"></svg>`, lo: null, hi: null, tr: null };
        const lo = Math.min(...p.map((q) => q.lo)), hi = Math.max(...p.map((q) => q.hi)), rg = Math.max(0.6, hi - lo);
        const t0 = Date.now() - hrs * 3600e3, t1 = Date.now();
        const pts = p.map((q) => [Math.max(0, ((q.t - t0) / (t1 - t0)) * 100), 24 - ((q.v - lo) / rg) * 22, q.t, q.s]);
        /* Luecken (nur Statistik-Stundenwerte): Abstand > 90 min trennt die Linie */
        const segs = []; let cur = [];
        for (const q of pts) { if (cur.length && q[3] && q[2] - cur[cur.length - 1][2] > 90 * 60e3) { segs.push(cur); cur = []; } cur.push(q); }
        if (cur.length) segs.push(cur);
        const ln = (s) => s.map((q, j) => `${j ? "L" : "M"}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join("") + (s.length === 1 ? "h0.1" : "");
        const id = "g" + Math.random().toString(36).slice(2, 7);
        const fill = segs.filter((s) => s.length > 1).map((s) => `${ln(s)}L${s[s.length - 1][0].toFixed(1)},26L${s[0][0].toFixed(1)},26Z`).join("");
        const ref = p.filter((q) => q.t <= Date.now() - 3 * 3600e3 + 1800e3).pop();
        const tr = ref && x.t != null ? x.t - ref.v : null;
        return { lo, hi, tr, svg: `<svg viewBox="0 0 100 26" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="${x.col}" stop-opacity=".45"/><stop offset="1" stop-color="${x.col}" stop-opacity="0"/></linearGradient></defs>
          <path d="${fill}" fill="url(#${id})"/><path d="${segs.map(ln).join("")}" fill="none" stroke="${x.col}" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>` };
      };
      rowsEl.innerHTML = rs.map((x) => {
        const s = spark(x);
        const arrow = s.tr == null ? "" : s.tr > 0.3 ? `<span class="tr" style="color:#c0392b" title="+${fmtN(s.tr)} K in 3 h">↗</span>` : s.tr < -0.3 ? `<span class="tr" style="color:#1d4fb0" title="${fmtN(s.tr)} K in 3 h">↘</span>` : `<span class="tr" style="opacity:.5" title="stabil">→</span>`;
        const sub = x.na ? `<span style="color:#a11a1a">keine Daten</span>` : x.stale ? `<span style="color:#a35200">seit ${ago(x.age)} kein Wert</span>`
          : `<span class="num">Taupunkt ${fmtN(x.dp)} ° · ${fmtN(x.ah)} g/m³</span>`;
        const bcol = x.bat == null ? "#9e9e9e" : x.batLow ? "#c0392b" : x.bat < 60 ? "#a35200" : "#1b6b1b";
        const bicon = x.bat == null ? "mdi:battery-unknown" : x.batLow ? "mdi:battery-alert-variant-outline" : `mdi:battery${x.bat >= 95 ? "" : "-" + Math.max(10, Math.round(x.bat / 10) * 10)}`;
        const hcol = x.out ? "#4aa3e0" : HC[x.hum];
        return `<div class="row ${x.na ? "na" : ""}" style="--c:${x.col}" data-e="${esc(x.r.temp)}">
          <div class="ic"><ha-icon icon="${esc(x.r.icon || "mdi:thermometer")}"></ha-icon></div>
          <div class="nm"><b>${esc(x.r.name)}</b>${sub}</div>
          <div class="sp">${s.svg}<div class="mm num"><span>↓${fmtN(s.lo)}</span><span>${hrs} h</span><span>↑${fmtN(s.hi)}</span></div></div>
          <div class="tv num" style="color:${x.col}">${fmtN(x.t)}<small>°</small>${arrow}</div>
          <div class="hv" title="${x.out ? "" : HUMTXT[x.hum]}"${x.r.hum ? ` data-e="${esc(x.r.hum)}"` : ""}><div class="hl num"><b>${fmtN(x.rh, 0)} %</b><span style="color:${hcol}">${x.out ? "rF" : HUMTXT[x.hum]}</span></div>
            <div class="hb"><i style="width:${Math.min(100, x.rh || 0)}%;background:${hcol}"></i></div></div>
          <div class="bt" style="color:${bcol}"${x.r.bat ? ` data-e="${esc(x.r.bat)}"` : ""}><ha-icon icon="${bicon}"></ha-icon><span class="num">${x.bat == null ? "–" : fmtN(x.bat, 0) + "%"}</span></div></div>`;
      }).join("");
    });
  }
}

/* ===================================================================== */
/* klima-air  Lueftungsberater                                            */
/* ===================================================================== */
class KlAir extends KlBase {
  static get defaults() { return { name: "Lüftungsberater", floors: FLOORS, outdoor_temp: OUTREF.outdoor_temp, outdoor_hum: OUTREF.outdoor_hum, min_rh: 55, delta: 1 }; }
  static get css() {
    return `
    .top { display:grid; grid-template-columns: 1.1fr 1fr; gap:12px; margin-bottom:10px; }
    .compact .top { grid-template-columns: 1fr; }
    .verdict { padding:12px 14px; display:flex; align-items:center; gap:12px; }
    .verdict .orb { width:54px; height:54px; border-radius:50%; flex:none; display:flex; align-items:center; justify-content:center;
      background: radial-gradient(circle at 35% 30%, #fff, var(--c) 125%); box-shadow: 0 0 0 4px rgba(255,255,255,.3), 0 0 22px -4px var(--c); }
    .verdict .orb ha-icon { --mdc-icon-size:28px; color:#fff; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
    .verdict .vt { font-size:18px; font-weight:800; line-height:1.15; } .verdict .vs { font-size:12px; opacity:.8; margin-top:3px; }
    .bars { padding:4px 0; }
    .br { display:grid; grid-template-columns: 112px 1fr 92px; align-items:center; gap:8px; padding:3px 4px; font-size:12px; cursor:pointer; }
    .compact .br { grid-template-columns: 90px 1fr 80px; }
    .br .n { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .br .trk { position:relative; height:12px; border-radius:6px; background: rgba(0,0,0,.07); }
    .br .trk i { position:absolute; left:0; top:0; bottom:0; border-radius:6px; }
    .br .trk .ol { position:absolute; top:-3px; bottom:-3px; width:2px; background:#000080; border-radius:1px; }
    .br .v { text-align:right; white-space:nowrap; }
    .fh { font-size:11px; font-weight:700; opacity:.7; text-transform:uppercase; letter-spacing:.04em; margin:8px 4px 2px; }
    .legend { display:flex; justify-content:center; gap:14px; flex-wrap:wrap; font-size:11px; margin-top:8px; }
    .legend span { display:inline-flex; align-items:center; gap:5px; } .legend i { width:12px; height:8px; border-radius:2px; display:inline-block; }
    `;
  }
  update() {
    const h = this._hass, c = this._config;
    if (this._dirty) { this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:window-open-variant"></ha-icon>${esc(c.name)}</div><div id="b"></div>`; this._dirty = false; }
    const ot = num(h, c.outdoor_temp), oh = num(h, c.outdoor_hum), oa = absH(ot, oh);
    const floors = (c.floors || []).filter((f) => !f.outdoor).map((fl) => ({ fl, rs: (fl.rooms || []).map((r) => roomInfo(h, r, fl, {})).filter((x) => x.ah != null) }));
    const all = floors.flatMap((f) => f.rs);
    const rate = (x) => (oa == null ? "na" : oa < x.ah - (c.delta || 1) ? (x.rh >= (c.min_rh || 55) ? "go" : "may") : oa > x.ah + 0.3 ? "no" : "eq");
    const COL = { go: "#2e9d3a", may: "#7fbf6a", eq: "#9e9e9e", no: "#c0392b", na: "#9e9e9e" };
    const go = all.filter((x) => rate(x) === "go"), no = all.filter((x) => rate(x) === "no");
    let vt, vs, vc, vi;
    if (oa == null) { vt = "Keine Außenwerte"; vs = "Wetterstation prüfen"; vc = "#9e9e9e"; vi = "mdi:help"; }
    else if (go.length) { vt = `Lüften lohnt sich in ${go.length} ${go.length === 1 ? "Raum" : "Räumen"}`; vs = go.map((x) => x.r.name).join(", "); vc = "#2e9d3a"; vi = "mdi:window-open-variant"; }
    else if (no.length > all.length / 2) { vt = "Fenster besser zu"; vs = `Außenluft ist feuchter als in ${no.length} Räumen – Lüften bringt Feuchte ins Haus`; vc = "#c0392b"; vi = "mdi:window-closed-variant"; }
    else { vt = "Kein Lüftungsbedarf"; vs = "Feuchte innen unauffällig oder kein Trocknungseffekt"; vc = "#000080"; vi = "mdi:check"; }
    const mx = Math.max(12, oa || 0, ...all.map((x) => x.ah)) * 1.08;
    const bar = (x) => {
      const k = rate(x), d = oa == null ? null : x.ah - oa;
      return `<div class="br" data-e="${esc(x.r.hum || x.r.temp)}" title="${esc(x.r.name)}: ${fmtN(x.t)} °C / ${fmtN(x.rh, 0)} % → ${fmtN(x.ah)} g/m³"><span class="n">${esc(x.r.name)}</span>
        <div class="trk"><i style="width:${(x.ah / mx) * 100}%;background:${COL[k]}"></i>${oa != null ? `<span class="ol" style="left:${(oa / mx) * 100}%"></span>` : ""}</div>
        <span class="v num"><b>${fmtN(x.ah)}</b> ${d == null ? "" : `<span style="color:${COL[k]}">${Math.abs(d) < 0.05 ? "±" : d > 0 ? "+" : ""}${fmtN(Math.abs(d) < 0.05 ? 0 : d)}</span>`}</span></div>`;
    };
    this.$("b").innerHTML = `<div class="top"><div class="inner verdict"><div class="orb" style="--c:${vc}"><ha-icon icon="${vi}"></ha-icon></div>
      <div><div class="vt">${esc(vt)}</div><div class="vs">${esc(vs)}</div></div></div>
      <div class="kpis" style="grid-template-columns:repeat(3,1fr);margin:0">
        <div class="inner box"><span class="kl">Außenluft</span><span class="kv num">${fmtN(oa)} <small style="font-size:11px">g/m³</small></span><span class="kl num" style="font-size:11px">${fmtN(ot)} °C · ${fmtN(oh, 0)} %</span></div>
        <div class="inner box"><span class="kl">Ø innen</span><span class="kv num">${fmtN(all.length ? all.reduce((s, x) => s + x.ah, 0) / all.length : null)} <small style="font-size:11px">g/m³</small></span><span class="kl num" style="font-size:11px">${all.length} Räume</span></div>
        <div class="inner box"><span class="kl">Feuchtester</span><span class="kv num">${all.length ? fmtN(Math.max(...all.map((x) => x.rh)), 0) + " %" : "–"}</span><span class="kl" style="font-size:11px">${all.length ? esc(all.reduce((a, x) => (x.rh > a.rh ? x : a)).r.name) : ""}</span></div>
      </div></div>
      <div class="inner bars">${floors.map((f) => `<div class="fh">${esc(f.fl.name)}</div>${f.rs.map(bar).join("")}`).join("")}</div>
      <div class="legend"><span><i style="background:${COL.go}"></i>lüften trocknet (rF ≥ ${c.min_rh || 55} %)</span><span><i style="background:${COL.may}"></i>würde trocknen</span>
      <span><i style="background:${COL.eq}"></i>kein Effekt</span><span><i style="background:${COL.no}"></i>außen feuchter</span><span><i style="background:#000080;width:3px"></i>Außenluft</span></div>
      <div class="sub">Vergleich der absoluten Feuchte (g Wasser pro m³ Luft). Grün: Außenluft mind. ${fmtN(c.delta || 1)} g/m³ trockener.</div>`;
  }
}

/* ======================= Anmeldung beim Atlas ======================= */
const ENT = { entity: { domain: "sensor" } }, TXT = { text: {} }, OBJ = { object: {} };
const NUM = (min, max, step = 1) => ({ number: { min, max, step, mode: "box" } });
const f = (name, label, selector) => ({ name, label, selector });
const LIM = [f("hum_warn", "Feuchte erhöht ab (%)", NUM(30, 100)), f("hum_bad", "Schimmelgefahr ab (%)", NUM(30, 100)), f("hum_dry", "Trocken unter (%)", NUM(0, 60)),
  f("bat_warn", "Batterie-Warnung unter (%)", NUM(0, 100)), f("stale_h", "Funkausfall nach (Stunden)", NUM(1, 72))];
const LIST = [
  ["klima-house", KlHouse, "Klima: Haus", [f("name", "Titel", TXT), f("outdoor_temp", "Außentemperatur (Wetterstation)", ENT), f("outdoor_hum", "Außenfeuchte", ENT),
    f("outdoor_dew", "Außen-Taupunkt (optional)", ENT), ...LIM, f("floors", "Etagen (YAML: name, short, icon, basement, outdoor, rooms[name, icon, temp, hum, bat])", OBJ)]],
  ["klima-floors", KlFloors, "Klima: Etagen", [f("min_width", "Mindestbreite je Etage (px)", NUM(280, 1200, 10)), f("hours", "Verlauf (Stunden)", NUM(3, 168)), ...LIM,
    f("floors", "Etagen (YAML: name, icon, outdoor, hours, rooms[name, icon, temp, hum, bat])", OBJ)]],
  ["klima-air", KlAir, "Klima: Lüftungsberater", [f("name", "Titel", TXT), f("outdoor_temp", "Außentemperatur", ENT), f("outdoor_hum", "Außenfeuchte", ENT),
    f("min_rh", "Lüften empfehlen ab rF innen (%)", NUM(30, 100)), f("delta", "Mindest-Unterschied (g/m³)", NUM(0, 5, 0.1)),
    f("floors", "Etagen (YAML wie Haus, Außenbereiche werden ignoriert)", OBJ)]],
];
for (const [type, K, label, fields] of LIST) {
  REG.modules[type] = K;
  REG.editors[type] = { label, fields, blank: () => ({ type, ...JSON.parse(JSON.stringify(K.defaults)) }) };
}
REG.ver = (REG.ver || 0) + 1;

customElements.whenDefined("energie-atlas").then(() => {
  const P = customElements.get("energie-atlas").prototype;
  if (P.__regHook) return;
  const d = Object.getOwnPropertyDescriptor(P, "hass");
  if (!d || !d.set) return;
  P.__regHook = true;
  Object.defineProperty(P, "hass", {
    configurable: true,
    get: d.get,
    set(h) {
      const v = REG.ver || 0;
      if (this._config && this._regV !== v) {
        this._regV = v;
        if ((this._config.modules || []).some((m) => m && REG.modules[m.type])) { this._hass = h; this._build(); return; }
      }
      d.set.call(this, h);
    },
  });
});
})();

/* ===== energie-atlas-wetter ===== */
/* energie-atlas-wetter – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const C = { warm: "#d35400", cold: "#2980b9", rain: "#1e6fd9", navy: "#000080", press: "#104E8B", sun: "#f5b400", gust: "#8e44ad", tide: "#1f7fbf", ok: "#228b22", bad: "#b22222" };
const COMPACT_W = 560;
const DOW = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const num = (hass, id) => { const s = hass && id && hass.states[id]; if (!s) return null; const v = parseFloat(s.state); return isNaN(v) ? null : v; };
const str = (hass, id) => (hass && id && hass.states[id] ? hass.states[id].state : null);
const fmtN = (v, d = 0) => (v == null || isNaN(v) ? "–" : v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const hhmm = (d) => (d ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–");
const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const ts = (v) => (typeof v === "number" ? v : Date.parse(v));
const hm = (m) => { m = Math.max(0, Math.round(m)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tempColor = (t) => (t == null ? "#888" : t < 0 ? "#5b6dd9" : t < 8 ? C.cold : t < 16 ? "#16a085" : t < 24 ? "#e0a000" : C.warm);
const DIRS16 = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const dirName = (d) => (d == null ? "–" : DIRS16[Math.round(((d % 360) + 360) % 360 / 22.5) % 16]);
const absHum = (t, rh) => (t == null || rh == null ? null : (6.112 * Math.exp((17.67 * t) / (t + 243.5)) * rh * 2.1674) / (273.15 + t));
const beaufort = (k) => {
  const b = [[1, 0, "Windstille"], [6, 1, "leiser Zug"], [12, 2, "leichte Brise"], [20, 3, "schwache Brise"], [29, 4, "mäßige Brise"], [39, 5, "frische Brise"],
    [50, 6, "starker Wind"], [62, 7, "steifer Wind"], [75, 8, "stürmischer Wind"], [89, 9, "Sturm"], [103, 10, "schwerer Sturm"], [118, 11, "orkanartiger Sturm"]];
  for (const [lim, n, t] of b) if ((k || 0) < lim) return [n, t];
  return [12, "Orkan"];
};
const COND = { sunny: "Sonnig", "clear-night": "Klar", partlycloudy: "Teils bewölkt", cloudy: "Bewölkt", rainy: "Regen", pouring: "Starkregen",
  snowy: "Schnee", "snowy-rainy": "Schneeregen", fog: "Nebel", hail: "Hagel", lightning: "Gewitter", "lightning-rainy": "Gewitter", windy: "Windig", "windy-variant": "Windig", exceptional: "Unwetter" };

/* Catmull-Rom -> Bezier (glatte Kurven) */
const smooth = (pts) => {
  if (!pts.length) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
};
/* Luecken: Punkte [x, y, t] an Zeitspruengen > gap ms trennen */
const split = (pts, gap) => {
  const out = []; let cur = [];
  for (const p of pts) { if (cur.length && p[2] - cur[cur.length - 1][2] > gap) { out.push(cur); cur = []; } cur.push(p); }
  if (cur.length) out.push(cur);
  return out;
};
const lineD = (segs) => segs.map((s) => (s.length > 1 ? smooth(s) : `M${s[0][0].toFixed(1)},${s[0][1].toFixed(1)} h0.1`)).join(" ");
const areaD = (segs, H) => segs.filter((s) => s.length > 1).map((s) => `${smooth(s)} L${s[s.length - 1][0].toFixed(1)},${H} L${s[0][0].toFixed(1)},${H} Z`).join(" ");

/* Mondphase 0..1 (0 Neumond, 0.5 Vollmond) */
const SYN = 29.530588853;
const moonP = (d = new Date()) => { let p = ((d - Date.UTC(2000, 0, 6, 18, 14)) / 864e5 / SYN) % 1; return p < 0 ? p + 1 : p; };
const moonName = (p) => p < 0.03 || p > 0.97 ? "Neumond" : p < 0.22 ? "Zunehmende Sichel" : p < 0.28 ? "Erstes Viertel"
  : p < 0.47 ? "Zunehmender Mond" : p < 0.53 ? "Vollmond" : p < 0.72 ? "Abnehmender Mond" : p < 0.78 ? "Letztes Viertel" : "Abnehmende Sichel";
const moonSVG = (p, r) => {
  const k = Math.cos(2 * Math.PI * p), rx = Math.abs(k) * r, wax = p < 0.5;
  const s1 = wax ? 1 : 0, s2 = wax ? (k > 0 ? 0 : 1) : (k > 0 ? 1 : 0);
  return `<circle r="${r}" fill="#26304a" fill-opacity=".85"/>` +
    `<path d="M0,${-r} A${r},${r} 0 0 ${s1} 0,${r} A${rx.toFixed(2)},${r} 0 0 ${s2} 0,${-r} Z" fill="#f6f2dc"/>` +
    `<circle r="${r}" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="${(r / 14).toFixed(2)}"/>`;
};

/* animierte Wetter-Icons (SVG 64x64) */
const CLOUD = "M17 47h30a10 10 0 0 0 1-20a14 14 0 0 0-27-4a10 10 0 0 0-4 24z";
const wIcon = (cond, size = 64, anim = true) => {
  const a = anim ? "" : " st";
  const sun = (x, y, r) => `<g class="wi-rays${a}"><g stroke="${C.sun}" stroke-width="3" stroke-linecap="round">${Array.from({ length: 8 }, (_, i) => {
    const an = (i * Math.PI) / 4; return `<line x1="${(x + Math.cos(an) * (r + 4)).toFixed(1)}" y1="${(y + Math.sin(an) * (r + 4)).toFixed(1)}" x2="${(x + Math.cos(an) * (r + 9)).toFixed(1)}" y2="${(y + Math.sin(an) * (r + 9)).toFixed(1)}"/>`; }).join("")}</g></g>
    <circle cx="${x}" cy="${y}" r="${r}" fill="${C.sun}"/>`;
  const moon = (x, y, r) => `<path d="M${x + r * 0.3},${y - r} a${r},${r} 0 1 0 ${r * 0.7},${r * 1.6} a${r * 0.85},${r * 0.85} 0 1 1 ${-r * 0.7},${-r * 1.6}z" fill="#f2e6a6" stroke="#d9c870" stroke-width="1"/>`;
  const cloud = (dx, dy, s, col, op = 1) => `<g class="wi-cloud${a}"><path d="${CLOUD}" transform="translate(${dx} ${dy}) scale(${s})" fill="${col}" fill-opacity="${op}" stroke="rgba(0,0,0,.12)" stroke-width="1"/></g>`;
  const drops = (n, col = C.rain) => Array.from({ length: n }, (_, i) => `<line class="wi-drop${a}" style="animation-delay:${(i * 0.27).toFixed(2)}s" x1="${22 + i * 8}" y1="50" x2="${19 + i * 8}" y2="57" stroke="${col}" stroke-width="2.6" stroke-linecap="round"/>`).join("");
  const flakes = (n) => Array.from({ length: n }, (_, i) => `<circle class="wi-drop${a}" style="animation-delay:${(i * 0.35).toFixed(2)}s" cx="${22 + i * 9}" cy="53" r="2.3" fill="#9fc3ff"/>`).join("");
  const bolt = `<path class="wi-flash${a}" d="M33 44l-6 10h5l-3 8 9-12h-5l3-6z" fill="#f5c400" stroke="#c99a00" stroke-width=".8"/>`;
  let g;
  switch (cond) {
    case "sunny": g = sun(32, 32, 11); break;
    case "clear-night": g = moon(30, 30, 13); break;
    case "partlycloudy": g = sun(24, 24, 9) + cloud(4, 8, 0.85, "#fff"); break;
    case "partlycloudy-night": g = moon(22, 22, 10) + cloud(4, 8, 0.85, "#eef1f6"); break;
    case "cloudy": g = cloud(-6, -2, 0.8, "#d5dbe4") + cloud(4, 6, 0.9, "#fff"); break;
    case "rainy": g = cloud(2, -4, 0.95, "#e8edf3") + drops(3); break;
    case "pouring": g = cloud(2, -4, 0.95, "#cfd6e0") + drops(4, "#1559c0"); break;
    case "snowy": case "snowy-rainy": g = cloud(2, -4, 0.95, "#eef2f7") + flakes(3); break;
    case "hail": g = cloud(2, -4, 0.95, "#d5dbe4") + flakes(3); break;
    case "lightning": case "lightning-rainy": g = cloud(2, -6, 0.95, "#aeb7c4") + bolt + (cond === "lightning-rainy" ? drops(2) : ""); break;
    case "fog": g = cloud(2, -6, 0.9, "#e8edf3") + `<g stroke="#9aa5b1" stroke-width="3" stroke-linecap="round"><line class="wi-cloud${a}" x1="12" y1="50" x2="52" y2="50"/><line x1="16" y1="57" x2="48" y2="57"/></g>`; break;
    case "windy": case "windy-variant": g = `<g class="wi-cloud${a}" fill="none" stroke="#5d6d7e" stroke-width="3.2" stroke-linecap="round"><path d="M8 26h30a7 7 0 1 0-7-7"/><path d="M8 36h40a7 7 0 1 1-7 7"/><path d="M8 46h22"/></g>`; break;
    default: g = cloud(4, 2, 0.9, "#fff");
  }
  return `<svg class="wi" viewBox="0 0 64 64" width="${size}" height="${size}">${g}</svg>`;
};

const BASE_CSS = `
  :host { display:block; }
  .glass { color:#000; box-sizing:border-box; height:100%;
    font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
  .title { display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:600; margin-bottom:10px; }
  .title ha-icon { --mdc-icon-size: 20px; color:#000080; }
  .sub { font-size:11px; opacity:.6; text-align:center; margin-top:6px; }
  .inner { background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.10); border-radius:12px; }
  .num { font-variant-numeric: tabular-nums; }
  .err { color:#a11a1a; font-size:13px; }
  .load { opacity:.6; font-size:13px; text-align:center; padding:12px; }
  .kl { font-size:12px; opacity:.72; }
  .kv { font-size:18px; font-weight:700; }
  svg text { fill:#000; font-size:11px; }
  .tip { position:absolute; pointer-events:none; background: rgba(255,255,255,0.9); border:1px solid rgba(0,0,0,0.1);
    border-radius:8px; padding:6px 8px; font-size:12px; white-space:nowrap; display:none; box-shadow:0 4px 14px rgba(0,0,0,0.15); z-index:2; }
  .tip b { display:block; margin-bottom:2px; }
  .tip i { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
  .legend { display:flex; justify-content:center; gap:14px; flex-wrap:wrap; font-size:12px; margin-top:6px; }
  .legend span { display:inline-flex; align-items:center; gap:6px; }
  .legend i { width:12px; height:4px; border-radius:2px; display:inline-block; }
  .tiles { display:grid; gap:8px; }
  .tile { padding:9px 11px; display:flex; flex-direction:column; gap:2px; }
  .tile .kv small { font-size:12px; font-weight:400; opacity:.7; margin-left:2px; }
  .wi { overflow:visible; display:block; }
  .wi-rays { transform-box: fill-box; transform-origin: center; animation: wspin 30s linear infinite; }
  .wi-cloud { animation: wdrift 7s ease-in-out infinite; }
  .wi-drop { animation: wdrop 1.1s linear infinite; }
  .wi-flash { animation: wflash 3.2s linear infinite; }
  .st { animation: none !important; }
  @keyframes wspin { to { transform: rotate(360deg); } }
  @keyframes wdrift { 0%,100% { transform: translateX(0); } 50% { transform: translateX(2.5px); } }
  @keyframes wdrop { 0% { transform: translateY(-5px); opacity:0; } 30% { opacity:1; } 100% { transform: translateY(8px); opacity:0; } }
  @keyframes wflash { 0%,86%,100% { opacity:1; } 88%,93% { opacity:.15; } }
  @keyframes wpulse { 0%,100% { opacity:.35; } 50% { opacity:.9; } }
`;

/* ---------- Modul-Basis: Schnittstelle des Atlas (constructor(config, el) + set hass) ---------- */
class WxBase {
  constructor(c, el) {
    const K = this.constructor;
    this._config = { ...(K.defaults || {}), ...(c || {}) };
    this.el = el;
    this.shadowRoot = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}${K.css || ""}</style><div class="glass"><div class="load">Lade…</div></div>`;
    this._dirty = true;
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver((e) => {
        const w = Math.round(e[0].contentRect.width);
        if (w > 0 && Math.abs(w - (this._w || 0)) > 12) {
          const wasC = this._compact();
          this._w = w;
          if (wasC !== this._compact()) this._dirty = true;
          this._update(true);
        }
      });
      this._ro.observe(el);
    }
  }
  set hass(h) {
    this._hass = h;
    const now = Date.now();
    if (!this._last || now - this._last > (this.constructor.throttle || 2000)) this._update(false);
  }
  _alive() {
    if (this.el.isConnected) { this._seen = true; return true; }
    if (this._seen && !this._gone) { this._gone = true; if (this._ro) this._ro.disconnect(); if (this.onDisconnect) this.onDisconnect(); }
    return !this._seen;
  }
  _compact() { return (this._w || this.el.clientWidth || 800) < COMPACT_W; }
  get box() { return this.shadowRoot.querySelector(".glass"); }
  $(id) { return this.shadowRoot.getElementById(id); }
  _update(force) {
    if (!this._hass || !this._alive()) return;
    this._last = Date.now();
    this.box.classList.toggle("compact", this._compact());
    try { this.update(force); } catch (e) { this.box.innerHTML = `<div class="err">Fehler: ${esc(e.message || e)}</div>`; }
  }
  _width() { return Math.max(260, this._w || this.el.clientWidth || 600); }
  async _stats(ids, start, period, types, end) {
    return this._hass.callWS({
      type: "recorder/statistics_during_period",
      start_time: start.toISOString(), end_time: (end || new Date()).toISOString(),
      statistic_ids: ids, period, types,
    });
  }
  /* periodisches Nachladen: key, maxAge ms, async loader -> setzt this[key] */
  _poll(key, maxAge, loader) {
    const st = (this._pl = this._pl || {});
    const s = st[key] || (st[key] = {});
    if (s.loading || (s.at && Date.now() - s.at < maxAge)) return;
    s.loading = true;
    loader().then((v) => { this[key] = v; s.err = null; }).catch((e) => { s.err = e.message || String(e); })
      .finally(() => { s.loading = false; s.at = Date.now(); this._update(true); });
  }
  /* einfache Hover-Tooltips fuer Linien-Charts */
  _hover(svgSel, W, pL, pw, n, html) {
    const svg = this.shadowRoot.querySelector(svgSel); if (!svg) return;
    const wrap = svg.parentElement, tip = wrap.querySelector(".tip"), cx = svg.querySelector(".cx"), hit = svg.querySelector(".hit");
    if (!tip || !hit) return;
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - pL) / pw) * (n - 1))));
      const x = pL + (i / (n - 1)) * pw;
      if (cx) { cx.setAttribute("x1", x); cx.setAttribute("x2", x); cx.style.display = ""; }
      tip.innerHTML = html(i); tip.style.display = "block";
      const left = (x / W) * r.width;
      tip.style.left = (left > r.width / 2 ? Math.max(4, left - tip.offsetWidth - 10) : left + 10) + "px";
      tip.style.top = "6px";
    };
    const leave = () => { tip.style.display = "none"; if (cx) cx.style.display = "none"; };
    hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move); hit.addEventListener("pointerleave", leave);
  }
}

/* ======================= wx-now: Aktuelles Wetter ======================= */
class WxNow extends WxBase {
  static get defaults() {
    return {
      temp: "", feels: "",
      humidity: "", dewpoint: "", pressure: "",
      press_trend: "", wind: "", gust: "", wind_dir: "",
      rain_today: "", rain_rate: "", uv: "",
      rain_24h: "", max_gust: "", vpd: "",
      light_text: "", trend_text: "", weather: "", sun: "sun.sun",
    };
  }
  static get throttle() { return 15000; }
  static get css() {
    return `
    .hero { display:grid; grid-template-columns: 1.15fr 1fr; gap:14px; }
    .compact .hero { grid-template-columns: 1fr; gap:10px; }
    .main { padding:14px 16px; display:flex; flex-direction:column; gap:8px; position:relative; overflow:hidden; }
    .top { display:flex; align-items:center; gap:14px; }
    .tbig { font-size:64px; font-weight:800; line-height:1; letter-spacing:-2px; }
    .compact .tbig { font-size:52px; }
    .tbig sup { font-size:26px; font-weight:600; letter-spacing:0; vertical-align: top; position:relative; top:6px; }
    .cond { font-size:19px; font-weight:700; }
    .cond2 { font-size:13px; opacity:.75; }
    .trend { display:inline-flex; align-items:center; gap:3px; font-size:13px; font-weight:600; padding:2px 8px; border-radius:10px; background: rgba(255,255,255,.35); }
    .range { display:flex; align-items:center; gap:8px; font-size:13px; }
    .rbar { position:relative; flex:1; height:8px; border-radius:4px; background: linear-gradient(90deg, ${C.cold}, #16a085, #e0a000, ${C.warm}); opacity:.85; }
    .rbar i { position:absolute; top:-4px; width:4px; height:16px; margin-left:-2px; border-radius:2px; background:#000; box-shadow: 0 0 0 2px rgba(255,255,255,.8); transition:left .6s; }
    .spark { width:100%; height:64px; display:block; }
    .tiles { grid-template-columns: repeat(3, 1fr); }
    .compact .tiles { grid-template-columns: repeat(2, 1fr); }
    .tile .kl { display:flex; align-items:center; gap:5px; }
    .tile ha-icon { --mdc-icon-size:16px; color:#000080; }
    .tile .k2 { font-size:11px; opacity:.65; }
    .side { display:flex; flex-direction:column; gap:8px; }
    .side .tiles { flex:1; grid-auto-rows: 1fr; }
    `;
  }
  _cond() {
    const h = this._hass, c = this._config;
    let cond = str(h, c.weather) || "cloudy";
    const night = str(h, c.sun) === "below_horizon";
    const rr = num(h, c.rain_rate) || 0;
    if (rr > 0) cond = rr > 7.5 ? "pouring" : "rainy";
    if (night && cond === "sunny") cond = "clear-night";
    if (night && cond === "partlycloudy") cond = "partlycloudy-night";
    return cond;
  }
  update() {
    const h = this._hass, c = this._config;
    this._poll("_hist", 5 * 60e3, async () => {
      const r = await this._stats([c.temp], new Date(Date.now() - 24 * 3600e3), "5minute", ["mean", "min", "max"]);
      return r[c.temp] || [];
    });
    const t = num(h, c.temp), hist = this._hist || [];
    const m0 = midnight().getTime();
    const today = hist.filter((r) => ts(r.start) >= m0);
    let tmin = Math.min(...today.map((r) => r.min).filter((v) => v != null), t ?? 99);
    let tmax = Math.max(...today.map((r) => r.max).filter((v) => v != null), t ?? -99);
    if (!isFinite(tmin)) tmin = null; if (!isFinite(tmax)) tmax = null;
    const hAgo = hist.filter((r) => ts(r.start) <= Date.now() - 3600e3).pop();
    const dT = hAgo && t != null && hAgo.mean != null ? t - hAgo.mean : null;
    const cond = this._cond();
    const condTxt = COND[cond.replace("-night", "")] || cond;
    const compact = this._compact();

    const good = hist.filter((r) => r.mean != null);
    let spark = "";
    if (good.length > 2) {
      const W = 300, H = 64, t0 = Date.now() - 24 * 3600e3, vals = good.map((r) => r.mean), mn = Math.min(...vals) - 0.5, mx = Math.max(...vals) + 0.5;
      const pts = good.map((r) => [((ts(r.start) - t0) / (24 * 3600e3)) * W, H - 4 - ((r.mean - mn) / (mx - mn)) * (H - 14), ts(r.start)]);
      const segs = split(pts, 11 * 60e3);
      spark = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs><linearGradient id="gsp" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${tempColor(t)}" stop-opacity=".35"/><stop offset="1" stop-color="${tempColor(t)}" stop-opacity="0"/></linearGradient></defs>
        <path d="${areaD(segs, H)}" fill="url(#gsp)"/>
        <path d="${lineD(segs)}" fill="none" stroke="${tempColor(t)}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </svg><div class="kl" style="display:flex;justify-content:space-between;margin-top:-2px"><span>vor 24 h</span><span>jetzt</span></div>`;
    }
    const pos = tmin != null && tmax != null && tmax > tmin ? ((t - tmin) / (tmax - tmin)) * 100 : 50;
    const arrow = dT == null ? "" : Math.abs(dT) < 0.2 ? "→" : dT > 0 ? "↗" : "↘";
    const pt = num(h, c.press_trend);
    const wdir = num(h, c.wind_dir);
    const tile = (icon, label, val, unit, sub = "") => `<div class="inner tile"><span class="kl"><ha-icon icon="${icon}"></ha-icon>${label}</span>
      <span class="kv num">${val}<small>${unit}</small></span>${sub ? `<span class="k2">${sub}</span>` : ""}</div>`;
    this.box.innerHTML = `
      <div class="hero">
        <div class="inner main">
          <div class="top">
            ${wIcon(cond, compact ? 76 : 96)}
            <div>
              <div class="tbig num" style="color:${tempColor(t)}">${fmtN(t, 1)}<sup>°C</sup></div>
              <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
                <span class="cond2">Gefühlt ${fmtN(num(h, c.feels), 1)}°</span>
                ${dT != null ? `<span class="trend num">${arrow} ${dT > 0 ? "+" : ""}${fmtN(dT, 1)}° / h</span>` : ""}
              </div>
            </div>
          </div>
          <div><div class="cond">${esc(str(h, c.light_text) || condTxt)}</div><div class="cond2">${condTxt} · ${esc(str(h, c.trend_text) || "")}</div></div>
          <div class="range num"><span>${fmtN(tmin, 1)}°</span><div class="rbar"><i style="left:${Math.max(0, Math.min(100, pos)).toFixed(1)}%"></i></div><span>${fmtN(tmax, 1)}°</span></div>
          <div class="kl" style="text-align:center;margin-top:-4px">Tief / Hoch heute</div>
          ${spark}
        </div>
        <div class="side">
          <div class="tiles">
            ${tile("mdi:water-percent", "Feuchte", fmtN(num(h, c.humidity), 0), "%")}
            ${tile("mdi:water-thermometer", "Taupunkt", fmtN(num(h, c.dewpoint), 1), "°C")}
            ${tile("mdi:gauge", "Luftdruck", fmtN(num(h, c.pressure), 0), "hPa", pt == null ? "" : `${pt > 0.3 ? "↗" : pt < -0.3 ? "↘" : "→"} ${pt > 0 ? "+" : ""}${fmtN(pt, 1)} hPa / 3 h`)}
            ${tile("mdi:weather-windy", "Wind", fmtN(num(h, c.wind), 0), "km/h", `aus ${dirName(wdir)} · Böe ${fmtN(num(h, c.gust), 0)}`)}
            ${tile("mdi:weather-rainy", "Regen heute", fmtN(num(h, c.rain_today), 1), "mm", (num(h, c.rain_rate) || 0) > 0 ? `aktuell ${fmtN(num(h, c.rain_rate), 1)} mm/h` : "trocken")}
            ${tile("mdi:weather-cloudy", "Bewölkung", fmtN((h.states[c.weather] || { attributes: {} }).attributes.cloud_coverage, 0), "%", "laut met.no")}
            ${tile("mdi:weather-windy-variant", "Max. Böe heute", fmtN(num(h, c.max_gust), 0), "km/h")}
            ${tile("mdi:water-outline", "Regen 24 h", fmtN(num(h, c.rain_24h), 1), "mm", `Dampfdruckdefizit ${fmtN(num(h, c.vpd), 1)} hPa`)}
            ${tile("mdi:weather-sunny-alert", "UV-Index", fmtN(num(h, c.uv), 0), "", ["niedrig", "niedrig", "niedrig", "mäßig", "mäßig", "mäßig", "hoch", "hoch", "sehr hoch", "sehr hoch", "sehr hoch", "extrem"][Math.min(11, Math.round(num(h, c.uv) || 0))])}
          </div>
        </div>
      </div>`;
  }
}

/* ======================= wx-forecast: Vorhersage ======================= */
class WxForecast extends WxBase {
  static get defaults() { return { weather: "", hours: 24, days: 0, sun: "sun.sun" }; }
  static get throttle() { return 60000; }
  static get css() {
    return `
    .wrap { position:relative; }
    .days { display:flex; flex-direction:column; margin-top:8px; padding:4px 12px; }
    .day { display:grid; grid-template-columns: 62px 34px 58px 40px 1fr 40px; align-items:center; gap:8px; padding:5px 0; font-size:14px; }
    .compact .day { grid-template-columns: 46px 30px 48px 34px 1fr 34px; gap:5px; font-size:13px; }
    .day + .day { border-top:1px solid rgba(0,0,0,0.06); }
    .day .pp { font-size:12px; color:${C.rain}; font-weight:600; }
    .day .tl { text-align:right; opacity:.7; }
    .day .th { font-weight:700; }
    .tr { position:relative; height:7px; border-radius:4px; background: rgba(0,0,0,0.08); }
    .tr i { position:absolute; top:0; bottom:0; border-radius:4px; }
    `;
  }
  onDisconnect() { for (const k of ["_unH", "_unD"]) { if (this[k]) { this[k].then((u) => u && u()).catch(() => {}); this[k] = null; } } }
  _sub() {
    const c = this._config, conn = this._hass.connection;
    if (!this._unH) this._unH = conn.subscribeMessage((m) => { this._fh = m.forecast || []; this._update(true); }, { type: "weather/subscribe_forecast", forecast_type: "hourly", entity_id: c.weather }).catch((e) => { this._err = e.message; });
    if (!this._unD && c.days > 0) this._unD = conn.subscribeMessage((m) => { this._fd = m.forecast || []; this._update(true); }, { type: "weather/subscribe_forecast", forecast_type: "daily", entity_id: c.weather }).catch(() => {});
  }
  update() {
    this._sub();
    if (!this._fh) { if (this._err) this.box.innerHTML = `<div class="err">Vorhersage: ${esc(this._err)}</div>`; return; }
    if (!this._fh.length) { this.box.innerHTML = `<div class="err">Vorhersage: keine Daten</div>`; return; }
    const c = this._config, compact = this._compact();
    const sun = this._hass.states[c.sun];
    const isNight = (d) => {
      if (!sun || !sun.attributes.next_rising || !sun.attributes.next_setting) return false;
      const r = new Date(sun.attributes.next_rising), s = new Date(sun.attributes.next_setting);
      const mins = d.getHours() * 60 + d.getMinutes(), rm = r.getHours() * 60 + r.getMinutes(), sm = s.getHours() * 60 + s.getMinutes();
      return mins < rm || mins >= sm;
    };
    const nH = Math.min(this._fh.length, compact ? Math.min(12, c.hours) : c.hours);
    const H = this._fh.slice(0, nH);
    const W = this._width(), HH = 168, pL = 14, pR = 14, pw = W - pL - pR;
    const temps = H.map((f) => f.temperature);
    const tmn = Math.min(...temps), tmx = Math.max(...temps);
    const X = (i) => pL + (i + 0.5) * (pw / nH);
    const Y = (t) => 50 + (1 - (t - tmn) / Math.max(1, tmx - tmn)) * 52;
    const pts = H.map((f, i) => [X(i), Y(f.temperature)]);
    const d = smooth(pts);
    const step = compact ? 2 : nH > 16 ? 3 : 2;
    let g = `<defs><linearGradient id="gft" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${C.warm}" stop-opacity=".28"/><stop offset="1" stop-color="${C.warm}" stop-opacity="0"/></linearGradient></defs>`;
    g += `<path d="${d} L${pts[pts.length - 1][0]},118 L${pts[0][0]},118 Z" fill="url(#gft)"/><path d="${d}" fill="none" stroke="${C.warm}" stroke-width="2.2"/>`;
    H.forEach((f, i) => {
      const dt = new Date(f.datetime), x = X(i);
      const pp = f.precipitation_probability || 0, mm = f.precipitation || 0;
      const bh = Math.max(pp > 0 ? 2 : 0, (pp / 100) * 24);
      g += `<rect x="${(x - (pw / nH) * 0.32).toFixed(1)}" y="${(146 - bh).toFixed(1)}" width="${((pw / nH) * 0.64).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${C.rain}" fill-opacity="${0.25 + 0.6 * (pp / 100)}"><title>${hhmm(dt)}: ${fmtN(pp, 0)} % · ${fmtN(mm, 1)} mm</title></rect>`;
      if (i % step === 0) {
        let cd = f.condition; if (isNight(dt)) cd = cd === "sunny" ? "clear-night" : cd === "partlycloudy" ? "partlycloudy-night" : cd;
        g += `<g transform="translate(${(x - 15).toFixed(1)} 0)">${wIcon(cd, 30, false).replace('<svg class="wi"', '<svg class="wi" x="0" y="0"')}</g>`;
        g += `<circle cx="${x.toFixed(1)}" cy="${Y(f.temperature).toFixed(1)}" r="2.6" fill="#fff" stroke="${C.warm}" stroke-width="1.5"/>`;
        g += `<text x="${x.toFixed(1)}" y="${(Y(f.temperature) - 7).toFixed(1)}" text-anchor="middle" style="font-size:11px;font-weight:700">${fmtN(f.temperature, 0)}°</text>`;
        g += `<text x="${x.toFixed(1)}" y="162" text-anchor="middle" style="font-size:10px;opacity:.75">${String(dt.getHours()).padStart(2, "0")}h</text>`;
        if (pp >= 10) g += `<text x="${x.toFixed(1)}" y="${(142 - bh).toFixed(1)}" text-anchor="middle" style="font-size:9px;fill:${C.rain}">${fmtN(pp, 0)}%</text>`;
      }
    });
    g += `<line x1="${pL}" x2="${W - pR}" y1="146" y2="146" stroke="rgba(0,0,0,.15)"/>`;

    let days = "";
    if (c.days > 0 && this._fd && this._fd.length) {
      const D = this._fd.slice(0, c.days);
      const lo = Math.min(...D.map((f) => f.templow ?? f.temperature)), hi = Math.max(...D.map((f) => f.temperature));
      const today = new Date().toDateString(), tom = new Date(Date.now() + 864e5).toDateString();
      days = `<div class="inner days">` + D.map((f) => {
        const dt = new Date(f.datetime), tl = f.templow ?? null, th = f.temperature;
        const a = (((tl ?? th) - lo) / Math.max(1, hi - lo)) * 100, b = ((th - lo) / Math.max(1, hi - lo)) * 100;
        const nm = dt.toDateString() === today ? "Heute" : dt.toDateString() === tom ? "Morgen" : DOW[dt.getDay()];
        const pp = f.precipitation_probability, mm = f.precipitation;
        return `<div class="day"><b>${nm}</b>${wIcon(f.condition, 28, false)}
          <span class="pp num">${pp != null && pp >= 5 ? fmtN(pp, 0) + " %" : mm ? fmtN(mm, 1) + " mm" : ""}</span>
          <span class="tl num">${fmtN(tl, 0)}°</span>
          <div class="tr"><i style="left:${a.toFixed(1)}%;width:${Math.max(3, b - a).toFixed(1)}%;background:linear-gradient(90deg, ${tempColor(tl ?? th)}, ${tempColor(th)})"></i></div>
          <span class="th num">${fmtN(th, 0)}°</span></div>`;
      }).join("") + `</div>`;
    }
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:calendar-clock"></ha-icon>Vorhersage</div>
      <div class="wrap"><svg viewBox="0 0 ${W} ${HH}" width="100%">${g}</svg></div>
      ${days}
      <div class="sub">Balken: Regenwahrscheinlichkeit · Quelle met.no</div>`;
  }
}

/* ======================= wx-wind: Kompass + Windrose ======================= */
class WxWind extends WxBase {
  static get defaults() {
    return { speed: "", gust: "", dir: "",
      dir_avg: "", max_gust: "", speed_avg: "" };
  }
  static get throttle() { return 2000; }
  static get css() {
    return `
    .cw { position:relative; max-width:280px; margin:0 auto; }
    .cw svg { width:100%; height:auto; display:block; }
    .needle { transition: transform 1.2s cubic-bezier(.4,1.6,.5,1); transform-origin: 100px 100px; }
    .tiles { grid-template-columns: repeat(2, 1fr); margin-top:10px; }
    `;
  }
  update() {
    const h = this._hass, c = this._config;
    this._poll("_rose", 15 * 60e3, async () => {
      const end = new Date(), start = new Date(end - 24 * 3600e3);
      const [hist, st] = await Promise.all([
        this._hass.callWS({ type: "history/history_during_period", start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: [c.dir], minimal_response: true, no_attributes: true }),
        this._stats([c.speed], start, "5minute", ["mean"]),
      ]);
      const dirs = (hist[c.dir] || []).map((p) => ({ t: p.lu != null ? p.lu * 1000 : Date.parse(p.last_updated || p.last_changed), v: parseFloat(p.s ?? p.state) })).filter((p) => !isNaN(p.v));
      const sec = new Array(16).fill(0);
      let j = 0, cur = dirs.length ? dirs[0].v : null;
      for (const r of st[c.speed] || []) {
        const t = ts(r.start) + 150e3;
        while (j < dirs.length && dirs[j].t <= t) { cur = dirs[j].v; j++; }
        if (cur == null || r.mean == null || r.mean < 0.5) continue;
        sec[Math.round(cur / 22.5) % 16] += r.mean;
      }
      return sec;
    });
    const sp = num(h, c.speed), gu = num(h, c.gust), di = num(h, c.dir), da = num(h, c.dir_avg);
    const [bf, bt] = beaufort(sp);
    const cx = 100, cy = 100, R = 84;
    let g = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="rgba(255,255,255,.18)" stroke="rgba(0,0,128,.35)" stroke-width="1.5"/>`;
    g += `<circle cx="${cx}" cy="${cy}" r="${R - 26}" fill="none" stroke="rgba(0,0,128,.12)" stroke-dasharray="2 4"/>`;
    const rose = this._rose;
    if (rose) {
      const mx = Math.max(...rose, 0.001);
      rose.forEach((v, i) => {
        if (!v) return;
        const len = 14 + (v / mx) * (R - 30), a0 = ((i * 22.5 - 9 - 90) * Math.PI) / 180, a1 = ((i * 22.5 + 9 - 90) * Math.PI) / 180, r0 = 12;
        g += `<path d="M${cx + r0 * Math.cos(a0)},${cy + r0 * Math.sin(a0)} L${cx + len * Math.cos(a0)},${cy + len * Math.sin(a0)} A${len},${len} 0 0 1 ${cx + len * Math.cos(a1)},${cy + len * Math.sin(a1)} L${cx + r0 * Math.cos(a1)},${cy + r0 * Math.sin(a1)} Z" fill="${C.navy}" fill-opacity="${(0.1 + 0.32 * (v / mx)).toFixed(2)}"/>`;
      });
    }
    for (let a = 0; a < 360; a += 10) {
      const rad = ((a - 90) * Math.PI) / 180, big = a % 90 === 0, r1 = R - (big ? 9 : a % 30 === 0 ? 6 : 3);
      g += `<line x1="${cx + R * Math.cos(rad)}" y1="${cy + R * Math.sin(rad)}" x2="${cx + r1 * Math.cos(rad)}" y2="${cy + r1 * Math.sin(rad)}" stroke="#000080" stroke-opacity="${big ? 0.8 : 0.4}" stroke-width="${big ? 2 : 1}"/>`;
    }
    [["N", 0], ["O", 90], ["S", 180], ["W", 270]].forEach(([t, a]) => {
      const rad = ((a - 90) * Math.PI) / 180;
      g += `<text x="${cx + (R + 9) * Math.cos(rad)}" y="${cy + (R + 9) * Math.sin(rad) + 5}" text-anchor="middle" style="font-size:14px;font-weight:800;fill:${a === 0 ? C.bad : "#000"}">${t}</text>`;
    });
    if (da != null) g += `<g class="needle" style="transform: rotate(${da}deg)"><path d="M${cx},${cy - R + 4} l-4,10 h8 z" fill="${C.gust}" fill-opacity=".7"/></g>`;
    g += `<g class="needle" style="transform: rotate(${di ?? 0}deg)"><path d="M${cx},${cy - 33} L${cx - 9},${cy - R + 6} L${cx},${cy - R + 15} L${cx + 9},${cy - R + 6} Z" fill="${C.navy}" stroke="#fff" stroke-width="1.2"/></g>`;
    g += `<circle cx="${cx}" cy="${cy}" r="30" fill="rgba(255,255,255,.75)" stroke="rgba(0,0,128,.25)"/>`;
    g += `<text x="${cx}" y="${cy + 3}" text-anchor="middle" style="font-size:22px;font-weight:800">${fmtN(sp, 0)}</text>`;
    g += `<text x="${cx}" y="${cy + 17}" text-anchor="middle" style="font-size:10px;opacity:.7">km/h</text>`;
    const tile = (l, v, u, s = "") => `<div class="inner tile"><span class="kl">${l}</span><span class="kv num">${v}<small>${u}</small></span>${s ? `<span class="kl">${s}</span>` : ""}</div>`;
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:compass-rose"></ha-icon>Wind</div>
      <div class="cw"><svg viewBox="-12 -12 224 224">${g}</svg></div>
      <div style="text-align:center;margin-top:4px"><b style="font-size:15px">${bt}</b> <span class="kl">· ${bf} Bft · aus ${dirName(di)} (${fmtN(di, 0)}°)</span></div>
      <div class="tiles">
        ${tile("Böe jetzt", fmtN(gu, 0), "km/h")}
        ${tile("Max. Böe heute", fmtN(num(h, c.max_gust), 0), "km/h")}
      </div>
      <div class="sub">Pfeil: Wind kommt aus · lila: 15-min-Mittel · Fläche: Windrose 24 h</div>`;
  }
}

/* ======================= wx-baro: Barometer ======================= */
class WxBaro extends WxBase {
  static get defaults() { return { pressure: "", t3: "", t24: "", text3: "", text24: "", min: 960, max: 1060 }; }
  static get throttle() { return 10000; }
  static get css() {
    return `
    .bw { max-width:280px; margin:0 auto; }
    .bw svg { width:100%; height:auto; display:block; }
    .needle { transition: transform 1.4s cubic-bezier(.4,1.5,.5,1); transform-origin: 100px 100px; }
    .tiles { grid-template-columns: repeat(2, 1fr); margin-top:8px; }
    .spark { width:100%; height:44px; display:block; margin-top:8px; }
    `;
  }
  update() {
    const h = this._hass, c = this._config, vmin = Number(c.min), vmax = Number(c.max);
    this._poll("_h48", 30 * 60e3, async () => (await this._stats([c.pressure], new Date(Date.now() - 48 * 3600e3), "hour", ["mean"]))[c.pressure] || []);
    const p = num(h, c.pressure), t3 = num(h, c.t3), t24 = num(h, c.t24);
    const cx = 100, cy = 100, R = 80, A0 = 150, SW = 240;
    const ang = (v) => A0 + ((Math.max(vmin, Math.min(vmax, v)) - vmin) / (vmax - vmin)) * SW;
    const pt = (a, r) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
    const arc = (v1, v2, r) => { const a1 = ang(v1), a2 = ang(v2), p1 = pt(a1, r), p2 = pt(a2, r); return `M${p1[0].toFixed(1)},${p1[1].toFixed(1)} A${r},${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`; };
    const zones = [[960, 975, "#8e44ad", "Sturm"], [975, 995, "#2980b9", "Regen"], [995, 1015, "#7f8c8d", "Veränderl."], [1015, 1035, "#e0a000", "Schön"], [1035, 1060, "#d35400", "Trocken"]];
    let g = `<circle cx="${cx}" cy="${cy}" r="${R + 10}" fill="rgba(255,255,255,.18)" stroke="rgba(0,0,128,.25)"/>`;
    zones.forEach(([a, b, col, nm]) => {
      g += `<path d="${arc(a, b, R)}" fill="none" stroke="${col}" stroke-width="9" stroke-opacity=".85"/>`;
      const m = pt(ang((a + b) / 2), R - 20);
      g += `<text x="${m[0].toFixed(1)}" y="${(m[1] + 3).toFixed(1)}" text-anchor="middle" style="font-size:8.5px;font-weight:700;fill:${col}">${nm}</text>`;
    });
    for (let v = vmin; v <= vmax; v += 5) {
      const big = v % 20 === 0, p1 = pt(ang(v), R + 5), p2 = pt(ang(v), R + (big ? 11 : 8));
      g += `<line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="#000" stroke-opacity="${big ? 0.7 : 0.35}"/>`;
      if (big) { const q = pt(ang(v), R + 20); g += `<text x="${q[0].toFixed(1)}" y="${(q[1] + 3).toFixed(1)}" text-anchor="middle" style="font-size:8.5px">${v}</text>`; }
    }
    if (p != null && t3 != null) g += `<g class="needle" style="transform: rotate(${ang(p - t3) - 270}deg)"><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - R + 6}" stroke="${C.warm}" stroke-width="2" stroke-dasharray="3 3" stroke-opacity=".8"/></g>`;
    g += `<g class="needle" style="transform: rotate(${ang(p ?? 1013) - 270}deg)"><path d="M${cx - 3},${cy + 14} L${cx},${cy - R + 4} L${cx + 3},${cy + 14} Z" fill="${C.press}"/></g>`;
    g += `<circle cx="${cx}" cy="${cy}" r="7" fill="${C.press}" stroke="#fff" stroke-width="2"/>`;
    g += `<text x="${cx}" y="${cy + 40}" text-anchor="middle" style="font-size:22px;font-weight:800">${fmtN(p, 1)}</text>`;
    g += `<text x="${cx}" y="${cy + 53}" text-anchor="middle" style="font-size:10px;opacity:.7">hPa</text>`;
    const good = (this._h48 || []).filter((r) => r.mean != null);
    let spark = "";
    if (good.length > 2) {
      const W = 300, H = 44, t0 = Date.now() - 48 * 3600e3, vals = good.map((r) => r.mean), mn = Math.min(...vals) - 0.5, mx = Math.max(...vals) + 0.5;
      const pts = good.map((r) => [((ts(r.start) - t0) / (48 * 3600e3)) * W, H - 4 - ((r.mean - mn) / (mx - mn)) * (H - 8), ts(r.start)]);
      spark = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${lineD(split(pts, 90 * 60e3))}" fill="none" stroke="${C.press}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>
        <div class="kl" style="display:flex;justify-content:space-between"><span>vor 48 h · ${fmtN(mn + 0.5, 0)}–${fmtN(mx - 0.5, 0)} hPa</span><span>jetzt</span></div>`;
    }
    const tr = (v) => (v == null ? "–" : `${v > 0.3 ? "↗" : v < -0.3 ? "↘" : "→"} ${v > 0 ? "+" : ""}${fmtN(v, 1)}`);
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:gauge"></ha-icon>Barometer</div>
      <div class="bw"><svg viewBox="-16 -4 232 179">${g}</svg></div>
      <div class="tiles">
        <div class="inner tile"><span class="kl">3 h</span><span class="kv num" style="color:${(t3 || 0) < -1 ? C.cold : (t3 || 0) > 1 ? C.warm : "#000"}">${tr(t3)}<small>hPa</small></span><span class="kl">${esc(str(h, c.text3) || "")}</span></div>
        <div class="inner tile"><span class="kl">24 h</span><span class="kv num">${tr(t24)}<small>hPa</small></span><span class="kl">${esc(str(h, c.text24) || "")}</span></div>
      </div>
      ${spark}
      <div class="sub">gestrichelt: Stand vor 3 h</div>`;
  }
}

/* ======================= wx-rain: Niederschlag ======================= */
class WxRain extends WxBase {
  static get defaults() {
    return { rate: "", hourly: "", daily: "", event: "",
      weekly: "", monthly: "", yearly: "", days: 14 };
  }
  static get throttle() { return 10000; }
  static get css() {
    return `
    .now { padding:10px 12px; display:flex; align-items:center; gap:12px; }
    .now .kv { font-size:22px; }
    .tiles { grid-template-columns: repeat(3, 1fr); margin-top:8px; }
    .tile .kv { font-size:16px; }
    `;
  }
  update() {
    const h = this._hass, c = this._config, nd = Math.max(2, Number(c.days) || 14);
    this._poll("_days", 30 * 60e3, async () => {
      const t0 = midnight(); const start = new Date(t0); start.setDate(start.getDate() - (nd - 1));
      return { start, rows: (await this._stats([c.daily], start, "day", ["change"], t0))[c.daily] || [] };
    });
    const rate = num(h, c.rate) || 0, raining = rate > 0;
    let bars = "", last = "";
    if (this._days) {
      const { start, rows } = this._days;
      const vals = Array.from({ length: nd }, (_, i) => {
        const d = new Date(start); d.setDate(d.getDate() + i);
        if (i === nd - 1) return [d, num(h, c.daily)];
        const r = rows.find((x) => new Date(ts(x.start)).toDateString() === d.toDateString());
        return [d, r && r.change != null ? Math.max(0, r.change) : null];
      });
      const W = this._width(), H = 92, pB = 16, mx = Math.max(2, ...vals.map((v) => v[1] || 0)), step = W / nd, bw = step * 0.62;
      let g = "";
      vals.forEach(([d, v], i) => {
        const x = i * step + (step - bw) / 2, lab = `${DOW[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
        if (v == null) {
          g += `<text x="${(x + bw / 2).toFixed(1)}" y="${(H - pB - 3).toFixed(1)}" text-anchor="middle" style="font-size:10px;opacity:.45"><title>${lab}: keine Daten</title>–</text>`;
        } else {
          const bh = (v / mx) * (H - pB - 14);
          g += `<rect x="${x.toFixed(1)}" y="${(H - pB - Math.max(bh, v > 0 ? 2 : 1)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(bh, v > 0 ? 2 : 1).toFixed(1)}" rx="2" fill="${v > 0 ? C.rain : "rgba(0,0,0,.12)"}" fill-opacity="${i === nd - 1 ? 0.55 : 0.85}"><title>${lab}: ${fmtN(v, 1)} mm</title></rect>`;
          if (v >= 0.5) g += `<text x="${(x + bw / 2).toFixed(1)}" y="${(H - pB - bh - 3).toFixed(1)}" text-anchor="middle" style="font-size:9px">${fmtN(v, v < 10 ? 1 : 0)}</text>`;
        }
        if (i % 2 === (nd - 1) % 2) g += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle" style="font-size:9.5px;opacity:.75">${i === nd - 1 ? "Heute" : d.getDate() + "."}</text>`;
      });
      bars = `<div class="kl" style="margin-top:10px">Letzte ${nd} Tage (mm)</div><svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg>`;
      let k = vals.length - 1; while (k >= 0 && vals[k][1] != null && vals[k][1] < 0.2) k--;
      if (k >= 0 && vals[k][1] == null) last = `${vals.length - 1 - k} Tag${vals.length - 1 - k === 1 ? "" : "e"} trocken, davor Datenlücke`;
      else last = k === vals.length - 1 ? "heute geregnet" : k < 0 ? `seit über ${nd} Tagen trocken` : `${vals.length - 1 - k} Tag${vals.length - 1 - k > 1 ? "e" : ""} trocken`;
    }
    const tile = (l, id) => `<div class="inner tile"><span class="kl">${l}</span><span class="kv num">${fmtN(num(h, id), 1)}<small>mm</small></span></div>`;
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:weather-pouring"></ha-icon>Niederschlag</div>
      <div class="inner now">${wIcon(raining ? (rate > 7.5 ? "pouring" : "rainy") : "cloudy", 48, raining)}
        <div><div class="kv num">${raining ? fmtN(rate, 1) + " mm/h" : "Kein Regen"}</div><div class="kl">${last}</div></div></div>
      <div class="tiles">${tile("Heute", c.daily)}${tile("Stunde", c.hourly)}${tile("Ereignis", c.event)}${tile("Woche", c.weekly)}${tile("Monat", c.monthly)}${tile("Jahr", c.yearly)}</div>
      ${bars}`;
  }
}

/* ======================= wx-light: Licht, UV, Sonne & Mond ======================= */
class WxLight extends WxBase {
  static get defaults() { return { uv: "", lux: "", rad: "", text: "", sun: "sun.sun" }; }
  static get throttle() { return 10000; }
  static get css() {
    return `
    .uvs { position:relative; display:flex; height:10px; border-radius:5px; overflow:hidden; margin:6px 0 2px; }
    .uvs i { display:block; height:100%; }
    .uvm { position:relative; height:12px; }
    .uvm b { position:absolute; top:-2px; width:0; height:0; border-left:6px solid transparent; border-right:6px solid transparent; border-bottom:8px solid #000; margin-left:-6px; transition:left .6s; }
    .row { display:flex; justify-content:space-between; align-items:baseline; }
    .box { padding:10px 12px; margin-top:8px; }
    .lbar { height:6px; border-radius:3px; background: rgba(0,0,0,.08); overflow:hidden; margin-top:4px; }
    .lbar i { display:block; height:100%; background: linear-gradient(90deg, #f7e08a, ${C.sun}); border-radius:3px; transition: width .6s; }
    .moon { display:grid; grid-template-columns: 70px 1fr; gap:12px; align-items:center; }
    .spark { width:100%; height:46px; display:block; margin-top:6px; }
    `;
  }
  update() {
    const h = this._hass, c = this._config;
    this._poll("_rad", 10 * 60e3, async () => (await this._stats([c.rad], midnight(), "5minute", ["mean"]))[c.rad] || []);
    const uv = num(h, c.uv) || 0, lux = num(h, c.lux), rad = num(h, c.rad);
    const segs = [[3, "#3aa655"], [3, "#f1c40f"], [2, "#e67e22"], [3, "#e74c3c"], [1, "#8e44ad"]];
    const risk = uv < 3 ? "niedrig" : uv < 6 ? "mäßig" : uv < 8 ? "hoch" : uv < 11 ? "sehr hoch" : "extrem";
    const luxPct = lux ? Math.min(100, (Math.log10(Math.max(1, lux)) / Math.log10(120000)) * 100) : 0;
    const s = h.states[c.sun];
    let sunTxt = "";
    if (s && s.attributes.next_rising && s.attributes.next_setting) {
      const r = new Date(s.attributes.next_rising), st = new Date(s.attributes.next_setting);
      sunTxt = `<div class="row"><span class="kl">☀ Aufgang</span><b class="num">${hhmm(r)}</b></div><div class="row"><span class="kl">☀ Untergang</span><b class="num">${hhmm(st)}</b></div>
        <div class="row"><span class="kl">Sonnenhöhe</span><b class="num">${fmtN(s.attributes.elevation, 0)}°</b></div>`;
    }
    const p = moonP(), ill = Math.round(((1 - Math.cos(2 * Math.PI * p)) / 2) * 100);
    const dFull = (((0.5 - p) % 1) + 1) % 1 * SYN, dNew = ((1 - p) % 1) * SYN;
    const fmtD = (d) => new Date(Date.now() + d * 864e5).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" });
    const vals = (this._rad || []).filter((r) => r.mean != null);
    let spark = "";
    if (vals.length > 2) {
      const W = 300, H = 46, m0 = midnight().getTime(), mx = Math.max(100, ...vals.map((r) => r.mean));
      const pts = vals.map((r) => [((ts(r.start) - m0) / 864e5) * W, H - 2 - (r.mean / mx) * (H - 6), ts(r.start)]);
      const sg = split(pts, 11 * 60e3);
      spark = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${areaD(sg, H)}" fill="${C.sun}" fill-opacity=".3"/><path d="${lineD(sg)}" fill="none" stroke="${C.sun}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>
        <div class="kl" style="display:flex;justify-content:space-between"><span>00</span><span>Strahlung heute · max ${fmtN(Math.max(...vals.map((r) => r.mean)), 0)} W/m²</span><span>24</span></div>`;
    }
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:white-balance-sunny"></ha-icon>Licht &amp; Himmel</div>
      <div class="inner box">
        <div class="row"><span class="kl">UV-Index</span><span><b class="num" style="font-size:20px">${fmtN(uv, 0)}</b> <span class="kl">${risk}</span></span></div>
        <div class="uvs">${segs.map(([w, col]) => `<i style="width:${(w / 12) * 100}%;background:${col}"></i>`).join("")}</div>
        <div class="uvm"><b style="left:${Math.min(100, (uv / 12) * 100).toFixed(1)}%"></b></div>
      </div>
      <div class="inner box">
        <div class="row"><span class="kl">${esc(str(h, c.text) || "Helligkeit")}</span><b class="num">${fmtN(lux, 0)} lx</b></div>
        <div class="lbar"><i style="width:${luxPct.toFixed(1)}%"></i></div>
        <div class="row" style="margin-top:6px"><span class="kl">Globalstrahlung</span><b class="num">${fmtN(rad, 0)} W/m²</b></div>
        ${spark}
      </div>
      <div class="inner box">${sunTxt}</div>
      <div class="inner box moon">
        <svg viewBox="-36 -36 72 72" width="70" height="70"><circle r="34" fill="#c9d6f5" fill-opacity=".25"/>${moonSVG(p, 26)}</svg>
        <div><b>${moonName(p)}</b><div class="kl">${ill} % beleuchtet</div>
          <div class="kl" style="margin-top:4px">Vollmond ${fmtD(dFull)} · Neumond ${fmtD(dNew)}</div></div>
      </div>`;
  }
}

/* ======================= wx-tide: Gezeiten ======================= */
class WxTide extends WxBase {
  static get defaults() {
    const b = "";
    return { name: "Pegelstation", hw_t: b + "nachstes_hochwasser", hw_v: b + "nachster_hochwasser_pegelstand", nw_t: b + "nachstes_niedrigwasser",
      nw_v: b + "nachster_niedrigwasser_pegelstand", mhw: b + "mittleres_hochwasser", mnw: b + "mittleres_niedrigwasser",
      hw_dev: b + "nachste_hochwasser_abweichung_zum_mittleren_hochwasser", nw_dev: b + "nachste_niedrigwasser_abweichung_zum_mittleren_niedrigwasser", from: b + "prognose_von", back_h: 6, fwd_h: 18 };
  }
  static get throttle() { return 30000; }
  static get css() {
    return `
    .wrap { position:relative; }
    .tiles { grid-template-columns: repeat(4, 1fr); margin-top:8px; }
    .compact .tiles { grid-template-columns: repeat(2, 1fr); }
    .tile .kv { font-size:16px; }
    .state { display:flex; justify-content:center; gap:10px; align-items:baseline; margin-bottom:4px; flex-wrap:wrap; }
    .state b { font-size:18px; }
    .dot { animation: wpulse 2.4s ease-in-out infinite; }
    @keyframes wwave { from { transform: translateX(0); } to { transform: translateX(-40px); } }
    .wave { animation: wwave 6s linear infinite; }
    `;
  }
  update() {
    const h = this._hass, c = this._config;
    const hwT = Date.parse(str(h, c.hw_t)), nwT = Date.parse(str(h, c.nw_t));
    const hwV = num(h, c.hw_v), nwV = num(h, c.nw_v), mhw = num(h, c.mhw) ?? hwV, mnw = num(h, c.mnw) ?? nwV;
    if (isNaN(hwT) || isNaN(nwT) || hwV == null || nwV == null) { this.box.innerHTML = `<div class="err">Keine Gezeitendaten</div>`; return; }
    const half = 6.21 * 3600e3;
    let ev = [{ t: hwT, v: hwV, hi: true, real: true }, { t: nwT, v: nwV, hi: false, real: true }].sort((a, b) => a.t - b.t);
    for (let i = 0; i < 4; i++) { const e = ev[0]; ev.unshift({ t: e.t - half, v: e.hi ? mnw : mhw, hi: !e.hi }); }
    for (let i = 0; i < 4; i++) { const e = ev[ev.length - 1]; ev.push({ t: e.t + half, v: e.hi ? mnw : mhw, hi: !e.hi }); }
    const level = (t) => {
      for (let i = 0; i < ev.length - 1; i++) if (t >= ev[i].t && t <= ev[i + 1].t) {
        const f = (t - ev[i].t) / (ev[i + 1].t - ev[i].t); return ev[i].v + (ev[i + 1].v - ev[i].v) * (1 - Math.cos(Math.PI * f)) / 2;
      }
      return null;
    };
    const now = Date.now(), t0 = now - c.back_h * 3600e3, t1 = now + c.fwd_h * 3600e3;
    const W = this._width(), H = this._compact() ? 150 : 170, pT = 26, pB = 20;
    const lo = Math.min(mnw, nwV) - 40, hi = Math.max(mhw, hwV) + 40;
    const X = (t) => ((t - t0) / (t1 - t0)) * W, Y = (v) => pT + (1 - (v - lo) / (hi - lo)) * (H - pT - pB);
    const pts = []; for (let t = t0; t <= t1; t += 15 * 60e3) { const lv = level(t); if (lv != null) pts.push([X(t), Y(lv)]); }
    const cur = level(now);
    if (pts.length < 2 || cur == null) { this.box.innerHTML = `<div class="err">Gezeitendaten passen nicht zum Zeitraum (veraltet?)</div>`; return; }
    const d = "M" + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L");
    const rising = level(now + 10 * 60e3) > cur;
    let g = `<defs><linearGradient id="gtd" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${C.tide}" stop-opacity=".55"/><stop offset="1" stop-color="${C.tide}" stop-opacity=".08"/></linearGradient>
      <clipPath id="ctd"><path d="${d} L${W},${H} L0,${H} Z"/></clipPath></defs>`;
    [mhw, mnw].forEach((v, i) => { g += `<line x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" stroke="#000" stroke-opacity=".15" stroke-dasharray="4 4"/><text x="${W - 2}" y="${Y(v) - 3}" text-anchor="end" style="font-size:9px;opacity:.55">Ø ${i ? "NW" : "HW"} ${v}</text>`; });
    g += `<path d="${d} L${W},${H - pB} L0,${H - pB} Z" fill="url(#gtd)"/>`;
    g += `<g clip-path="url(#ctd)"><path class="wave" d="${Array.from({ length: Math.ceil(W / 40) + 3 }, (_, i) => `M${i * 40 - 40},${Y(cur) + 2} q10,-4 20,0 t20,0`).join(" ")}" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/></g>`;
    g += `<path d="${d}" fill="none" stroke="${C.tide}" stroke-width="2.4"/>`;
    for (let t = Math.ceil(t0 / 3600e3) * 3600e3; t <= t1; t += 3600e3) {
      const dt = new Date(t); if (dt.getHours() % (this._compact() ? 6 : 3) || X(t) < 12 || X(t) > W - 12) continue;
      g += `<text x="${X(t).toFixed(1)}" y="${H - 5}" text-anchor="middle" style="font-size:10px;opacity:.7">${String(dt.getHours()).padStart(2, "0")}</text>`;
    }
    ev.filter((e) => e.t > t0 + 20 * 60e3 && e.t < t1 - 20 * 60e3).forEach((e) => {
      const x = X(e.t), y = Y(e.v);
      g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${e.hi ? C.tide : "#fff"}" stroke="${C.tide}" stroke-width="1.5"/>`;
      g += `<text x="${x.toFixed(1)}" y="${(e.hi ? y - 8 : y + 15).toFixed(1)}" text-anchor="middle" style="font-size:10px;font-weight:${e.real ? 700 : 400};opacity:${e.real ? 1 : 0.6}">${e.hi ? "HW" : "NW"} ${hhmm(new Date(e.t))}${e.real ? " · " + e.v : ""}</text>`;
    });
    g += `<line x1="${X(now)}" x2="${X(now)}" y1="${pT - 6}" y2="${H - pB}" stroke="#000080" stroke-opacity=".5" stroke-dasharray="3 3"/>`;
    g += `<circle class="dot" cx="${X(now)}" cy="${Y(cur)}" r="9" fill="${C.tide}" fill-opacity=".35"/><circle cx="${X(now)}" cy="${Y(cur)}" r="4.5" fill="#fff" stroke="#000080" stroke-width="2"/>`;
    const nxt = ev.find((e) => e.t > now);
    const tile = (l, v, s) => `<div class="inner tile"><span class="kl">${l}</span><span class="kv num">${v}</span><span class="kl">${s}</span></div>`;
    const dev = (v) => (v == null ? "" : `${v > 0 ? "+" : ""}${v} cm zum Ø`);
    const from = Date.parse(str(h, c.from));
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:waves"></ha-icon>Gezeiten · ${esc(c.name)}</div>
      <div class="state"><b style="color:${C.tide}">${rising ? "↗ Flut – steigend" : "↘ Ebbe – fallend"}</b><span class="kl num">ca. ${fmtN(cur, 0)} cm · ${nxt ? (nxt.hi ? "Hochwasser" : "Niedrigwasser") + " in " + hm((nxt.t - now) / 60e3) + " h" : ""}</span></div>
      <div class="wrap"><svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg></div>
      <div class="tiles">
        ${tile("Hochwasser", hhmm(new Date(hwT)), `${hwV} cm · ${dev(num(h, c.hw_dev))}`)}
        ${tile("Niedrigwasser", hhmm(new Date(nwT)), `${nwV} cm · ${dev(num(h, c.nw_dev))}`)}
        ${tile("Ø Hochwasser", mhw + " cm", "mittel")}
        ${tile("Ø Niedrigwasser", mnw + " cm", "mittel")}
      </div>
      <div class="sub">Fett: BSH-Prognose${isNaN(from) ? "" : " vom " + new Date(from).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · übrige Punkte aus Mittelwerten (12,42-h-Zyklus) geschätzt</div>`;
  }
}

/* ======================= wx-climate: Innen / Aussen ======================= */
class WxClimate extends WxBase {
  static get defaults() {
    return { out_t: "", out_h: "", out_d: "",
      in_t: "", in_h: "", in_d: "" };
  }
  static get throttle() { return 10000; }
  static get css() {
    return `
    .cols { display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
    .col { padding:10px 12px; }
    .col .big { font-size:30px; font-weight:800; line-height:1.1; }
    .col .r { display:flex; justify-content:space-between; font-size:13px; margin-top:4px; }
    .vent { margin-top:8px; padding:10px 12px; display:flex; gap:10px; align-items:center; }
    .vent ha-icon { --mdc-icon-size:26px; }
    .wrap { position:relative; margin-top:8px; }
    `;
  }
  update() {
    const h = this._hass, c = this._config;
    this._poll("_hist", 10 * 60e3, async () => this._stats([c.out_t, c.in_t], new Date(Date.now() - 24 * 3600e3), "5minute", ["mean"]));
    const ot = num(h, c.out_t), oh = num(h, c.out_h), it = num(h, c.in_t), ih = num(h, c.in_h);
    const oa = absHum(ot, oh), ia = absHum(it, ih);
    let vent = "";
    if (oa != null && ia != null) {
      const diff = ia - oa, good = diff > 1;
      const icon = good ? "mdi:window-open-variant" : diff < -0.5 ? "mdi:window-closed-variant" : "mdi:window-shutter-alert";
      const col = good ? C.ok : diff < -0.5 ? C.bad : "#7f8c8d";
      const txt = good ? `Lüften senkt die Feuchte (außen ${fmtN(diff, 1)} g/m³ trockener)` : diff < -0.5 ? `Lüften bringt Feuchte rein (außen ${fmtN(-diff, 1)} g/m³ feuchter)` : "Lüften ändert die Feuchte kaum";
      vent = `<div class="inner vent"><ha-icon icon="${icon}" style="color:${col}"></ha-icon><div><b style="color:${col}">${good ? "Lüften lohnt" : diff < -0.5 ? "Besser nicht lüften" : "Neutral"}</b><div class="kl">${txt}</div></div></div>`;
    }
    const col = (title, icon, t, rh, dp, ah) => `<div class="inner col"><div class="kl" style="display:flex;gap:5px;align-items:center"><ha-icon icon="${icon}" style="--mdc-icon-size:16px;color:#000080"></ha-icon>${title}</div>
      <div class="big num" style="color:${tempColor(t)}">${fmtN(t, 1)}°</div>
      <div class="r"><span class="kl">Feuchte</span><b class="num">${fmtN(rh, 0)} %</b></div>
      <div class="r"><span class="kl">Taupunkt</span><b class="num">${fmtN(dp, 1)}°</b></div>
      <div class="r"><span class="kl">abs. Feuchte</span><b class="num">${fmtN(ah, 1)} g/m³</b></div></div>`;
    let chart = "";
    if (this._hist) {
      const n = 288, t0 = Date.now() - 24 * 3600e3, bms = 300e3;
      const arr = (id) => { const o = new Array(n).fill(null); for (const r of this._hist[id] || []) { const i = Math.round((ts(r.start) - t0) / bms); if (i >= 0 && i < n && r.mean != null) o[i] = r.mean; } return o; };
      const A = arr(c.out_t), B = arr(c.in_t);
      const all = [...A, ...B].filter((v) => v != null);
      if (all.length) {
        const W = this._width(), H = 130, pL = 30, pR = 6, pT = 8, pB = 18, pw = W - pL - pR, ph = H - pT - pB;
        let mn = Math.floor(Math.min(...all) - 1), mx = Math.ceil(Math.max(...all) + 1);
        const X = (i) => pL + (i / (n - 1)) * pw, Y = (v) => pT + ((mx - v) / (mx - mn)) * ph;
        let g = "";
        const stp = mx - mn > 16 ? 5 : mx - mn > 8 ? 2 : 1;
        for (let v = Math.ceil(mn / stp) * stp; v <= mx; v += stp) g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,.08)"/><text x="${pL - 4}" y="${Y(v) + 4}" text-anchor="end" style="font-size:10px">${v}°</text>`;
        for (let t = Math.ceil(t0 / 3600e3) * 3600e3; t < t0 + 24 * 3600e3; t += 3600e3) { const d = new Date(t); if (d.getHours() % (this._compact() ? 6 : 3)) continue; const i = (t - t0) / bms; g += `<text x="${X(i).toFixed(1)}" y="${H - 4}" text-anchor="middle" style="font-size:10px;opacity:.7">${String(d.getHours()).padStart(2, "0")}:00</text>`; }
        /* Luecken: aufeinanderfolgende Indizes bilden ein Segment, null trennt */
        const line = (a) => lineD(split(a.map((v, i) => (v == null ? null : [X(i), Y(v), i])).filter(Boolean), 2));
        g += `<path d="${line(A)}" fill="none" stroke="${C.warm}" stroke-width="2" stroke-linecap="round"/><path d="${line(B)}" fill="none" stroke="${C.bad}" stroke-width="2" stroke-dasharray="5 3" stroke-linecap="round"/>`;
        g += `<line class="cx" x1="0" x2="0" y1="${pT}" y2="${pT + ph}" stroke="#000080" stroke-dasharray="3,3" style="display:none"/><rect class="hit" x="${pL}" y="${pT}" width="${pw}" height="${ph}" fill="transparent"/>`;
        chart = `<div class="wrap"><svg id="cc" viewBox="0 0 ${W} ${H}" width="100%">${g}</svg><div class="tip"></div></div>
          <div class="legend"><span><i style="background:${C.warm}"></i>Außen</span><span><i style="background:${C.bad}"></i>Innen</span></div>`;
        this._chart = { W, pL, pw, n, A, B, t0, bms };
      }
    }
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:home-thermometer"></ha-icon>Innen &amp; Außen</div>
      <div class="cols">${col("Außen", "mdi:tree", ot, oh, num(h, c.out_d), oa)}${col("Innen", "mdi:sofa", it, ih, num(h, c.in_d), ia)}</div>
      ${vent}${chart}`;
    if (chart) { const k = this._chart; this._hover("#cc", k.W, k.pL, k.pw, k.n, (i) => `<b>${hhmm(new Date(k.t0 + i * k.bms))}</b><div><i style="background:${C.warm}"></i>Außen ${fmtN(k.A[i], 1)}°</div><div><i style="background:${C.bad}"></i>Innen ${fmtN(k.B[i], 1)}°</div>`); }
  }
}

/* ======================= Anmeldung beim Atlas ======================= */
const LBL = {
  temp: "Außentemperatur", feels: "Gefühlte Temperatur", humidity: "Luftfeuchte", dewpoint: "Taupunkt", pressure: "Luftdruck", press_trend: "Drucktendenz 3 h",
  wind: "Windgeschwindigkeit", gust: "Böe", wind_dir: "Windrichtung", rain_today: "Regen heute", rain_rate: "Regenrate", uv: "UV-Index", rain_24h: "Regen 24 h",
  max_gust: "Max. Böe heute", vpd: "Dampfdruckdefizit", light_text: "Lichtzustand (Text)", trend_text: "Wettertrend (Text)", weather: "Wetter-Entität", sun: "Sonne",
  hours: "Stunden im Verlauf", days: "Tage", speed: "Windgeschwindigkeit", dir: "Windrichtung", dir_avg: "Windrichtung 15-min-Mittel", speed_avg: "Wind 5-min-Mittel",
  t3: "Tendenz 3 h", t24: "Tendenz 24 h", text3: "Trendtext 3 h", text24: "Trendtext 24 h", min: "Skala min (hPa)", max: "Skala max (hPa)",
  rate: "Regenrate", hourly: "Regen Stunde", daily: "Regen Tag", event: "Regen Ereignis", weekly: "Regen Woche", monthly: "Regen Monat", yearly: "Regen Jahr",
  lux: "Helligkeit", rad: "Globalstrahlung", text: "Lichtzustand (Text)", name: "Ortsname",
  hw_t: "Nächstes Hochwasser (Zeit)", hw_v: "Nächstes Hochwasser (Pegel)", nw_t: "Nächstes Niedrigwasser (Zeit)", nw_v: "Nächstes Niedrigwasser (Pegel)",
  mhw: "Mittleres Hochwasser", mnw: "Mittleres Niedrigwasser", hw_dev: "Abweichung Hochwasser", nw_dev: "Abweichung Niedrigwasser", from: "Prognose von",
  back_h: "Stunden zurück", fwd_h: "Stunden voraus", out_t: "Außen: Temperatur", out_h: "Außen: Feuchte", out_d: "Außen: Taupunkt",
  in_t: "Innen: Temperatur", in_h: "Innen: Feuchte", in_d: "Innen: Taupunkt",
};
const fieldsOf = (K) => Object.entries(K.defaults).map(([k, v]) => ({
  name: k, label: LBL[k] || k,
  selector: typeof v === "number" ? { number: { mode: "box", step: "any" } } : /^[a-z_]+\.[a-z0-9_]+$/.test(v) ? { entity: {} } : { text: {} },
}));
const LIST = [
  ["wx-now", WxNow, "Wetter: Jetzt"], ["wx-forecast", WxForecast, "Wetter: Vorhersage"], ["wx-wind", WxWind, "Wetter: Wind"],
  ["wx-baro", WxBaro, "Wetter: Barometer"], ["wx-rain", WxRain, "Wetter: Niederschlag"], ["wx-light", WxLight, "Wetter: Licht & Himmel"],
  ["wx-tide", WxTide, "Wetter: Gezeiten"], ["wx-climate", WxClimate, "Wetter: Innen & Außen"],
];
for (const [type, K, label] of LIST) {
  REG.modules[type] = K;
  REG.editors[type] = { label, fields: fieldsOf(K), blank: () => ({ type, ...JSON.parse(JSON.stringify(K.defaults)) }) };
}
REG.ver = (REG.ver || 0) + 1;

/* bereits gebaute Atlas-Cards einmal neu aufbauen, wenn ein Modul-Paket nach ihnen geladen wurde */
customElements.whenDefined("energie-atlas").then(() => {
  const P = customElements.get("energie-atlas").prototype;
  if (P.__regHook) return;
  const d = Object.getOwnPropertyDescriptor(P, "hass");
  if (!d || !d.set) return;
  P.__regHook = true;
  Object.defineProperty(P, "hass", {
    configurable: true,
    get: d.get,
    set(h) {
      const v = REG.ver || 0;
      if (this._config && this._regV !== v) {
        this._regV = v;
        if ((this._config.modules || []).some((m) => m && REG.modules[m.type])) { this._hass = h; this._build(); return; }
      }
      d.set.call(this, h);
    },
  });
});
})();

/* ===== energie-atlas-aquarium ===== */
/* energie-atlas-aquarium – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const COMPACT_W = 560, WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const DEF = {
  temp: "", feuchte: "", sensor_batt: "",
  leck: "", leck_batt: "",
  pumpe: "", pumpe_modus: "", pumpe_plan: "",
  pumpe_drehzahl: "", pumpe_timer: "", pumpe_fuetter: "",
  pumpe_prefix: "",
  filter: "", filter_w: "", filter_e: "",
  akku: "", akku_an: 17, akku_aus: 15, fenster_von: 10, fenster_bis: 20,
};
const HEAT = [
  { key: "stab1", name: "Heizstab 1", icon: "mdi:heating-coil", sw: "", w: "",
    heute: "", e: "", prefix: "", color: "#e65100" },
  { key: "stab2", name: "Heizstab 2", icon: "mdi:heating-coil", sw: "", w: "",
    heute: "", e: "", prefix: "", color: "#f9a825" },
  { key: "dle", name: "Durchlauferhitzer", icon: "mdi:water-boiler", sw: "", w: "",
    heute: "", e: "", prefix: "", color: "#c62828" },
  { key: "not", name: "Notstab (Port 3)", icon: "mdi:lifebuoy", sw: "",
    w: "", heute: "",
    e: "", prefix: "", color: "#ad1457" },
];
const HEIZER_DEF = Object.fromEntries(HEAT.map(({ key, ...r }) => [key, r]));
const FILTER_COLOR = "#000080";
const HEAT_FLAGS = [["uberlast", "Überlast"], ["uberspannung", "Überspannung"], ["uberstrom", "Überstrom"], ["uberhitzung", "Überhitzung"]];
const PUMP_FLAGS = [["keine_last", "Keine Last"], ["rotor_blockiert", "Rotor blockiert"], ["uart_kommunikationsfehler", "Kommunikation"],
  ["uberspannungs_fehler", "Überspannung"], ["unterspannungs_fehler", "Unterspannung"], ["uberstrom_fehler", "Überstrom"], ["ubertemperatur_fehler", "Übertemperatur"]];
const fmt = (v, d = 0) => (v == null || isNaN(v) ? "–" : Number(v).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (h, id) => { const s = id && h.states[id]; if (!s) return null; const v = parseFloat(s.state); return isNaN(v) ? null : v; };
const st = (h, id) => (id && h.states[id] ? h.states[id].state : null);
const on = (h, id) => st(h, id) === "on";
const W_ = (v) => (v == null ? "–" : Math.abs(v) >= 1200 ? fmt(v / 1000, 2) + " kW" : fmt(v, v < 10 ? 1 : 0) + " W");
const HHMM = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const heaters = (cfg) => HEAT.map((h) => ({ ...h, ...((cfg.heizer || {})[h.key] || {}) }));
function slotNow(plan) {
  if (!plan || !Array.isArray(plan)) return null;
  const d = new Date(), m = d.getHours() * 60 + d.getMinutes();
  for (const s of plan) { const a = s.start, b = s.end; if (a <= b ? m >= a && m < b : m >= a || m < b) return s; }
  return null;
}
const series = (c, field) => [{ name: "Filter", id: field === "w" ? c.filter_w : c.filter_e, color: FILTER_COLOR },
  ...heaters(c).map((x) => ({ name: x.name, id: x[field], color: x.color }))].filter((s) => s.id);

const STYLE = `
  :host { display:block; }
  .glass { color:#000; box-sizing:border-box; font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
  .title { display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:600; margin-bottom:10px; }
  .title ha-icon { --mdc-icon-size:20px; color:#000080; }
  .sub { font-size:11px; opacity:.6; text-align:center; margin-top:8px; }
  .tiles { display:grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap:8px; }
  .tile { background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.10); border-radius:12px; padding:10px 12px; min-width:0; cursor:pointer; transition: background .15s; }
  .tile:hover { background: rgba(255,255,255,0.16); }
  .tile h4 { margin:0 0 6px 0; font-size:13px; font-weight:600; display:flex; align-items:center; gap:6px; }
  .tile h4 ha-icon { --mdc-icon-size:18px; color:#000080; flex:none; }
  .val { font-size:22px; font-weight:600; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .val small { font-size:11px; font-weight:400; opacity:.7; margin-left:3px; }
  .cmp { font-size:11px; opacity:.85; margin-top:2px; }
  .good { color:#1b7a1b; } .bad { color:#a11a1a; } .warm { color:#c45a00; } .neutral { opacity:.6; }
  .banner { display:flex; align-items:center; gap:8px; border-radius:10px; padding:8px 12px; margin-bottom:10px; font-size:13px; font-weight:600; }
  .banner.ok { background: rgba(27,122,27,0.10); color:#1b7a1b; }
  .banner.alarm { background: rgba(198,40,40,0.16); color:#a11a1a; }
  .banner ha-icon { --mdc-icon-size:20px; }
  .rows { display:flex; flex-direction:column; gap:6px; }
  .row { display:grid; grid-template-columns: 26px 1fr auto auto; align-items:center; gap:10px;
    background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.10); border-radius:12px; padding:8px 12px; cursor:pointer; }
  .row:hover { background: rgba(255,255,255,0.16); }
  .row ha-icon { --mdc-icon-size:22px; }
  .row .nm { font-size:13px; font-weight:600; }
  .row .ds { font-size:11px; opacity:.7; }
  .row .pw { font-size:16px; font-weight:600; font-variant-numeric:tabular-nums; text-align:right; white-space:nowrap; }
  .row .kwh { font-size:11px; opacity:.75; text-align:right; white-space:nowrap; min-width:64px; }
  .pill { display:inline-block; font-size:10px; font-weight:700; border-radius:8px; padding:1px 7px; margin-left:6px; vertical-align:middle; }
  .pill.on { background:rgba(198,40,40,0.15); color:#a11a1a; }
  .pill.idle { background:rgba(0,0,128,0.10); color:#000080; }
  .pill.off { background:rgba(0,0,0,0.08); color:#555; }
  .chips { display:flex; flex-wrap:wrap; gap:5px; margin-top:8px; justify-content:center; }
  .chip { font-size:11px; border-radius:10px; padding:2px 8px; display:inline-flex; align-items:center; gap:4px; cursor:pointer; }
  .chip ha-icon { --mdc-icon-size:13px; }
  .chip.ok { background:rgba(27,122,27,0.10); color:#1b7a1b; }
  .chip.err { background:rgba(198,40,40,0.18); color:#a11a1a; font-weight:700; }
  .rule { font-size:11px; opacity:.8; margin-top:10px; line-height:1.45; text-align:center; }
  .gauge { height:8px; border-radius:4px; background:rgba(0,0,0,0.08); position:relative; margin:6px 0 2px; overflow:visible; }
  .gauge > div { height:100%; border-radius:4px; background:#000080; }
  .gauge i { position:absolute; top:-3px; width:2px; height:14px; background:#a11a1a; }
  .legend { display:flex; justify-content:center; gap:12px; font-size:12px; margin-top:6px; flex-wrap:wrap; }
  .legend span { display:inline-flex; align-items:center; gap:6px; }
  .legend i { width:12px; height:12px; border-radius:3px; display:inline-block; }
  svg { display:block; } svg text { fill:#000; }
  .err { color:#a11a1a; font-size:13px; }
  .load { opacity:.6; font-size:13px; text-align:center; padding:12px; }
  .big { display:flex; align-items:baseline; justify-content:center; gap:10px; margin:2px 0 10px; }
  .big .v { font-size:30px; font-weight:700; font-variant-numeric:tabular-nums; }
  .big .l { font-size:12px; opacity:.7; }
  .compact .title { font-size:14px; margin-bottom:8px; }
  .compact .tiles { grid-template-columns: 1fr 1fr; gap:6px; }
  .compact .tile { padding:8px 8px; }
  .compact .val { font-size:18px; }
  .compact .row { grid-template-columns: 22px 1fr auto; gap:8px; padding:7px 9px; }
  .compact .row .kwh { display:none; }
  .compact .big .v { font-size:24px; }
`;

class Base {
  static get defaults() { return { ...DEF, heizer: HEIZER_DEF }; }
  constructor(c, el) {
    this._config = { ...DEF, ...this.constructor.defaults, ...(c || {}) };
    this.el = el;
    this.shadowRoot = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="glass"><div class="load">Lade…</div></div>`;
    this.shadowRoot.addEventListener("click", (ev) => {
      const n = ev.composedPath().find((x) => x.dataset && x.dataset.entity);
      if (n) { ev.stopPropagation(); this.el.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: n.dataset.entity }, bubbles: true, composed: true })); }
    });
    this._lastRender = 0;
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver((e) => { const w = Math.round(e[0].contentRect.width); if (w > 0 && Math.abs(w - (this._w || 0)) > 16) { this._w = w; this._render(); } });
      this._ro.observe(el);
    }
  }
  _alive() {
    if (this.el.isConnected) { this._seen = true; return true; }
    if (this._seen && !this._gone) { this._gone = true; if (this._ro) this._ro.disconnect(); }
    return !this._seen;
  }
  set hass(h) { if (!this._alive()) return; this._hass = h; this._tick(); }
  _tick() { if (Date.now() - this._lastRender > 2000) this._render(); }
  _compact() { return (this._w || this.el.clientWidth || 800) < COMPACT_W; }
  _width() { return Math.max(300, Math.min(1400, this._w || this.el.clientWidth || 640)); }
  _box() { const b = this.shadowRoot.querySelector(".glass"); b.classList.toggle("compact", this._compact()); return b; }
  _render() {
    if (!this._hass) return;
    this._lastRender = Date.now();
    try { this._box().innerHTML = this._html(this._hass, this._compact()); } catch (e) { this._box().innerHTML = `<div class="err">Fehler: ${esc(e.message || e)}</div>`; }
  }
}

/* ---------- aq-hero ---------- */
class Hero extends Base {
  _html(h, compact) {
    const c = this._config, heat = heaters(c), fw = num(h, c.filter_w) || 0;
    let tot = fw, heating = 0, armed = 0, heute = 0, heuteOk = false;
    heat.forEach((x) => { const w = num(h, x.w) || 0; tot += w; if (on(h, x.sw)) armed++; if (w > 1) heating++; const k = num(h, x.heute); if (k != null) { heute += k; heuteOk = true; } });
    const errs = [];
    if (on(h, c.leck)) errs.push("Wasser erkannt!");
    PUMP_FLAGS.forEach(([s, l]) => { if (on(h, c.pumpe_prefix + s)) errs.push(`Pumpe: ${l}`); });
    heat.forEach((x) => HEAT_FLAGS.forEach(([s, l]) => { if (on(h, x.prefix + s)) errs.push(`${x.name}: ${l}`); }));
    if (st(h, c.pumpe) === "off") errs.push("Pumpe aus");
    if (st(h, c.filter) === "off") errs.push("Filter-Steckdose aus");
    const banner = errs.length ? `<div class="banner alarm"><ha-icon icon="mdi:alert"></ha-icon>${errs.join(" · ")}</div>`
      : `<div class="banner ok"><ha-icon icon="mdi:check-circle"></ha-icon>Alles in Ordnung${compact ? "" : " – Pumpe, Filter und Heizung ohne Störung, kein Wasser am Boden"}</div>`;
    const plan = h.states[c.pumpe_plan] ? h.states[c.pumpe_plan].attributes.schedule : null;
    const slot = slotNow(plan), modus = st(h, c.pumpe_modus), off = st(h, c.pumpe) === "off";
    const pumpVal = off ? "aus" : slot ? fmt(slot.value) : fmt(num(h, c.pumpe_drehzahl));
    const nextSlot = slot && plan ? plan.find((s) => s.start === slot.end) : null;
    const pumpCmp = on(h, c.pumpe_fuetter) ? `<span class="warm">Fütterungsmodus aktiv</span>`
      : `${modus === "auto" ? "Zeitplan" : esc(modus) || "–"}${nextSlot ? ` · ab ${HHMM(nextSlot.start)} ${fmt(nextSlot.value)} %` : ""}`;
    const t = num(h, c.temp), f = num(h, c.feuchte), leckBatt = num(h, c.leck_batt), sBatt = num(h, c.sensor_batt);
    const tile = (ent, icon, title, val, unit, cmp) => `<div class="tile" data-entity="${esc(ent)}">
      <h4><ha-icon icon="${icon}"></ha-icon>${title}</h4><div class="val">${val}<small>${unit}</small></div><div class="cmp">${cmp}</div></div>`;
    return `<div class="title"><ha-icon icon="mdi:fishbowl-outline"></ha-icon>Aquarium</div>${banner}
      <div class="big"><span class="v">${W_(tot)}</span><span class="l">Gesamtleistung jetzt</span></div>
      <div class="tiles">
        ${tile(c.pumpe, "mdi:pump", compact ? "Pumpe" : "Strömungspumpe", pumpVal, off ? "" : "%", pumpCmp)}
        ${tile(c.filter_w, "mdi:air-filter", "Filter", fmt(fw, 1), "W", st(h, c.filter) === "on" ? `<span class="good">Steckdose an</span>` : `<span class="bad">Steckdose aus</span>`)}
        ${tile(heat[2].sw, "mdi:thermometer-water", "Heizung", heating ? `${heating}` : "0", ` von ${armed} heizt`, heuteOk ? `heute ${fmt(heute, 2)} kWh` : "–")}
        ${tile(c.temp, "mdi:thermometer", compact ? "Klima" : "Sensor am Becken", fmt(t, 1), "°C",
          `${fmt(f, 0)} % rel. Feuchte${sBatt != null && sBatt < 25 ? ` · <span class="bad">Batterie ${fmt(sBatt)} %</span>` : ""}`)}
        ${tile(c.leck, "mdi:water-alert", "Leckage", on(h, c.leck) ? "Wasser!" : "trocken", "",
          `Batterie ${fmt(leckBatt)} %${leckBatt != null && leckBatt < 25 ? ` <span class="bad">· wechseln</span>` : ""}`)}
      </div>
      <div class="sub">Kachel antippen öffnet die Details</div>`;
  }
}

/* ---------- aq-heat ---------- */
class Heat extends Base {
  _html(h, compact) {
    const c = this._config, heat = heaters(c), an = Number(c.akku_an), aus = Number(c.akku_aus);
    let sumW = 0, sumK = 0;
    const rows = heat.map((x) => {
      const o = on(h, x.sw), w = num(h, x.w), k = num(h, x.heute);
      sumW += w || 0; if (k != null) sumK += k;
      const heats = o && w != null && w > 1;
      const pill = !o ? `<span class="pill off">aus</span>` : heats ? `<span class="pill on">heizt</span>` : `<span class="pill idle">bereit</span>`;
      const flags = HEAT_FLAGS.filter(([s]) => on(h, x.prefix + s)).map(([, l]) => l);
      const desc = flags.length ? `<span class="bad">⚠ ${flags.join(", ")}</span>` : x.key === "not" ? "springt ein, wenn alle anderen aus sind"
        : x.key === "dle" ? "Zeitfenster + Akku-Überschuss" : o ? "Thermostat regelt selbst" : "abgeschaltet";
      return `<div class="row" data-entity="${esc(x.sw)}"><ha-icon icon="${x.icon}" style="color:${heats ? x.color : o ? "#000080" : "#888"}"></ha-icon>
        <div><div class="nm">${esc(x.name)}${pill}</div><div class="ds">${desc}</div></div>
        <div class="pw">${W_(w)}</div><div class="kwh">${k != null ? fmt(k, 2) + " kWh heute" : ""}</div></div>`;
    }).join("");
    const ak = num(h, c.akku), max = Math.max(an * 1.6, ak || 0, 1), hr = new Date().getHours(), fv = Number(c.fenster_von ?? 10), fb = Number(c.fenster_bis ?? 20), inWin = fv < fb ? hr >= fv && hr < fb : hr >= fv || hr < fb, fz = `${fv}–${fb} Uhr`, dleOn = on(h, heat[2].sw);
    const grund = inWin ? `festes Zeitfenster ${fz}` : ak != null && ak >= an ? `Akku ≥ ${fmt(an)} kWh`
      : dleOn ? "Akku-Überschuss (Hysterese)" : `außerhalb ${fz}, Akku unter ${fmt(an)} kWh`;
    return `<div class="title"><ha-icon icon="mdi:thermometer-water"></ha-icon>Heizung</div>
      <div class="rows">${rows}</div>
      <div class="big" style="margin-top:10px"><span class="v" style="font-size:22px">${W_(sumW)}</span><span class="l">jetzt · ${fmt(sumK, 2)} kWh heute</span></div>
      <div data-entity="${esc(c.akku)}" style="cursor:pointer">
        <div style="display:flex;justify-content:space-between;font-size:12px"><span>Akku-Restkapazität</span><b>${fmt(ak, 1)} kWh</b></div>
        <div class="gauge"><div style="width:${Math.min(100, ((ak || 0) / max) * 100).toFixed(1)}%"></div>
          <i style="left:${((an / max) * 100).toFixed(1)}%" title="an ab ${an} kWh"></i>
          <i style="left:${((aus / max) * 100).toFixed(1)}%;background:#888" title="aus unter ${aus} kWh"></i></div>
      </div>
      <div class="rule">Durchlauferhitzer ist <b>${dleOn ? "freigegeben" : "gesperrt"}</b> – ${grund}.<br>
        ${compact ? "" : `Regel: ${fz} immer an, sonst an ab ${fmt(an)} kWh, aus unter ${fmt(aus)} kWh Akku. `}Notstab übernimmt, wenn alle drei aus sind.</div>`;
  }
}

/* ---------- aq-pump ---------- */
class Pump extends Base {
  _html(h, compact) {
    const c = this._config, ps = h.states[c.pumpe_plan];
    const plan = ps && Array.isArray(ps.attributes.schedule) ? ps.attributes.schedule : [];
    const slot = slotNow(plan), off = st(h, c.pumpe) === "off";
    const now = new Date(), nowM = now.getHours() * 60 + now.getMinutes();
    const W = Math.max(280, Math.min(900, this._w || this.el.clientWidth || 500)), H = 92, pT = 8, pB = 18, plotH = H - pT - pB;
    const X = (m) => (m / 1440) * W, Y = (v) => pT + plotH - (v / 100) * plotH;
    let g = "";
    [25, 50, 75, 100].forEach((v) => (g += `<line x1="0" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,0.08)"/>`));
    const segs = [];
    plan.forEach((s) => { if (s.start <= s.end) segs.push([s.start, s.end, s]); else { segs.push([s.start, 1440, s]); segs.push([0, s.end, s]); } });
    segs.forEach(([a, b, s]) => {
      const v = s.mode === "stop" ? 0 : s.value, col = s.mode === "feeding" ? "#c45a00" : "#000080";
      g += `<rect x="${X(a)}" y="${Y(v)}" width="${Math.max(1, X(b) - X(a))}" height="${Y(0) - Y(v)}" fill="${col}" fill-opacity="${slot === s ? 0.55 : 0.28}" rx="2"><title>${HHMM(s.start)}–${HHMM(s.end)}: ${s.mode === "stop" ? "Stopp" : v + " %"}</title></rect>`;
    });
    if (!plan.length) g += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" style="font-size:12px;opacity:.6">kein Zeitplan verfügbar</text>`;
    for (let hh = 0; hh <= 24; hh += compact ? 6 : 3) g += `<text x="${Math.min(W - 12, Math.max(10, X(hh * 60)))}" y="${H - 4}" text-anchor="middle" style="font-size:10px;opacity:.7">${hh}</text>`;
    g += `<line x1="${X(nowM)}" x2="${X(nowM)}" y1="${pT - 4}" y2="${Y(0)}" stroke="#a11a1a" stroke-width="2"/><circle cx="${X(nowM)}" cy="${pT - 4}" r="3.5" fill="#a11a1a"/>`;
    const flags = PUMP_FLAGS.map(([s, l]) => { const bad = on(h, c.pumpe_prefix + s);
      return `<span class="chip ${bad ? "err" : "ok"}" data-entity="${esc(c.pumpe_prefix + s)}"><ha-icon icon="${bad ? "mdi:alert" : "mdi:check"}"></ha-icon>${l}</span>`; }).join("");
    const nextSlot = slot ? plan.find((s) => s.start === slot.end) : null;
    return `<div class="title"><ha-icon icon="mdi:pump"></ha-icon>Strömungspumpe</div>
      <div class="tiles">
        <div class="tile" data-entity="${esc(c.pumpe)}"><h4><ha-icon icon="mdi:power"></ha-icon>Status</h4>
          <div class="val ${off ? "bad" : "good"}">${off ? "aus" : "läuft"}</div>
          <div class="cmp">${on(h, c.pumpe_fuetter) ? `<span class="warm">Fütterungsmodus</span>` : "Modus: " + (esc(st(h, c.pumpe_modus)) || "–")}</div></div>
        <div class="tile" data-entity="${esc(c.pumpe_plan)}"><h4><ha-icon icon="mdi:speedometer"></ha-icon>Drehzahl jetzt</h4>
          <div class="val">${off ? "–" : slot ? fmt(slot.value) : fmt(num(h, c.pumpe_drehzahl))}<small>%</small></div>
          <div class="cmp">${nextSlot ? `ab ${HHMM(nextSlot.start)} → ${fmt(nextSlot.value)} %` : "laut Zeitplan"}</div></div>
        <div class="tile" data-entity="${esc(c.filter_w)}"><h4><ha-icon icon="mdi:flash"></ha-icon>Filter-Steckdose</h4>
          <div class="val">${fmt(num(h, c.filter_w), 1)}<small>W</small></div><div class="cmp">Leistung jetzt</div></div>
      </div>
      <div style="margin-top:12px;font-size:12px;font-weight:600;text-align:center">Tagesprofil</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${g}</svg>
      <div class="chips">${flags}</div>
      <div class="sub">Profil läuft in der Pumpe selbst – fällt HA oder die Cloud aus, pumpt sie unverändert weiter</div>`;
  }
}

/* ---------- aq-power: Leistung gestapelt (History) ---------- */
class Power extends Base {
  static get defaults() { return { ...super.defaults, stunden: 24 }; }
  _tick() {
    if (!this._data || Date.now() - this._fetched > 5 * 60e3) this._load();
    else if (Date.now() - this._lastRender > 60e3) this._render();
  }
  async _load() {
    if (this._loading || !this._hass) return;
    this._loading = true;
    const hrs = Number(this._config.stunden) || 24, ser = series(this._config, "w");
    try {
      const end = new Date(), start = new Date(end.getTime() - hrs * 3600e3);
      this._data = await this._hass.callWS({ type: "history/history_during_period", start_time: start.toISOString(), end_time: end.toISOString(),
        entity_ids: ser.map((s) => s.id), minimal_response: true, no_attributes: true, significant_changes_only: false });
      this._span = [start.getTime(), end.getTime()];
      this._fetched = Date.now();
      this._render();
    } catch (e) { this._box().innerHTML = `<div class="err">Fehler: ${esc(e.message || e)}</div>`; }
    finally { this._loading = false; }
  }
  _html(h, compact) {
    if (!this._data) return `<div class="load">Lade Verlauf…</div>`;
    const ser = series(this._config, "w"), [t0, t1] = this._span, N = compact ? 144 : 288, step = (t1 - t0) / N;
    /* Stufenfunktion; unavailable/unknown oder kein Wert = null (Luecke) */
    const vals = ser.map((s) => {
      const pts = (this._data[s.id] || []).map((p) => ({ t: (p.lu || p.lc) * 1000, v: parseFloat(p.s) })).sort((a, b) => a.t - b.t);
      const out = new Array(N).fill(null);
      let j = 0, cur = null;
      for (let i = 0; i < N; i++) {
        const t = t0 + (i + 0.5) * step;
        while (j < pts.length && pts[j].t <= t) { cur = isNaN(pts[j].v) ? null : Math.max(0, pts[j].v); j++; }
        out[i] = cur;
      }
      return out;
    });
    const stack = []; let max = 1;
    for (let i = 0; i < N; i++) { let acc = 0; stack[i] = vals.map((v) => (acc += v[i] || 0)); max = Math.max(max, acc); }
    const W = this._width(), H = compact ? 200 : Math.min(300, Math.max(220, W * 0.3));
    const pL = compact ? 34 : 42, pR = 8, pT = 10, pB = 22, pw = W - pL - pR, ph = H - pT - pB;
    const raw = max / 4, p10 = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p10;
    const stp = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p10, tmax = Math.ceil((max * 1.05) / stp) * stp;
    const X = (i) => pL + (i / N) * pw, Y = (v) => pT + ph - (v / tmax) * ph;
    let g = "";
    for (let v = 0; v <= tmax + 1e-9; v += stp) g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,0.10)"/><text x="${pL - 4}" y="${Y(v) + 4}" text-anchor="end" style="font-size:10px">${fmt(v)}</text>`;
    /* je Serie ein Band zwischen Unter- und Oberkante; Luecken der Serie unterbrechen das Band */
    for (let k = ser.length - 1; k >= 0; k--) {
      let d = "", i = 0;
      while (i < N) {
        if (vals[k][i] == null) { i++; continue; }
        let e = i; while (e < N && vals[k][e] != null) e++;
        const lo = (q) => (k ? stack[q][k - 1] : 0);
        let top = "", bot = "";
        for (let q = i; q < e; q++) top += `${q === i ? "M" : "L"}${X(q).toFixed(1)},${Y(stack[q][k]).toFixed(1)}L${X(q + 1).toFixed(1)},${Y(stack[q][k]).toFixed(1)}`;
        for (let q = e - 1; q >= i; q--) bot += `L${X(q + 1).toFixed(1)},${Y(lo(q)).toFixed(1)}L${X(q).toFixed(1)},${Y(lo(q)).toFixed(1)}`;
        d += top + bot + "Z";
        i = e;
      }
      if (d) g += `<path d="${d}" fill="${ser[k].color}" fill-opacity="${k === 0 ? 0.35 : 0.55}" stroke="none"/>`;
    }
    /* Spalten ohne irgendeinen Wert markieren */
    for (let i = 0; i < N; i++) if (vals.every((v) => v[i] == null)) g += `<rect x="${X(i).toFixed(1)}" y="${pT}" width="${(X(i + 1) - X(i)).toFixed(2)}" height="${ph}" fill="rgba(0,0,0,0.05)"/>`;
    const hrs = (t1 - t0) / 3600e3, every = hrs <= 24 ? (compact ? 6 : 3) : compact ? 12 : 6;
    const first = new Date(t0); first.setMinutes(0, 0, 0); first.setHours(first.getHours() + 1);
    for (let t = first.getTime(); t < t1; t += 3600e3) {
      const d = new Date(t); if (d.getHours() % every) continue;
      const x = pL + ((t - t0) / (t1 - t0)) * pw;
      g += `<line x1="${x}" x2="${x}" y1="${pT}" y2="${pT + ph}" stroke="rgba(0,0,0,0.06)"/><text x="${x}" y="${H - 6}" text-anchor="middle" style="font-size:10px">${String(d.getHours()).padStart(2, "0")}:00</text>`;
    }
    const per = Math.max(1, Math.round(1800e3 / step));
    for (let i = 0; i < N; i += per) {
      const tt = new Date(t0 + i * step), lines = ser.map((s, k) => `${s.name}: ${W_(vals[k][i])}`).join("\n");
      g += `<rect x="${X(i)}" y="${pT}" width="${X(Math.min(N, i + per)) - X(i)}" height="${ph}" fill="transparent"><title>${HHMM(tt.getHours() * 60 + tt.getMinutes())}\n${lines}\nSumme: ${W_(stack[i][ser.length - 1])}</title></rect>`;
    }
    const avg = vals.map((v) => { const ok = v.filter((x) => x != null); return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null; });
    const legend = ser.map((s, k) => `<span><i style="background:${s.color};opacity:${k === 0 ? 0.6 : 0.8}"></i>${esc(s.name)} Ø ${W_(avg[k])}</span>`).join("");
    return `<div class="title"><ha-icon icon="mdi:chart-areaspline"></ha-icon>Leistung letzte ${fmt(hrs)} h</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${g}</svg>
      <div class="legend">${legend}</div>
      <div class="sub">gestapelt · Lücken = Gerät nicht erreichbar${compact ? "" : " · Maus über den Graphen zeigt die Werte je halbe Stunde"} · aktualisiert alle 5 Minuten</div>`;
  }
}

/* ---------- aq-week: Energie je Tag (Statistik) ---------- */
class Week extends Power {
  static get defaults() { return { ...super.defaults, tage: 7 }; }
  _tick() {
    if (!this._data || Date.now() - this._fetched > 15 * 60e3) this._load();
    else if (Date.now() - this._lastRender > 60e3) this._render();
  }
  async _load() {
    if (this._loading || !this._hass) return;
    this._loading = true;
    const tage = Number(this._config.tage) || 7, ser = series(this._config, "e");
    try {
      const s = new Date(); s.setHours(0, 0, 0, 0); s.setDate(s.getDate() - (tage - 1));
      this._start = s.getTime();
      this._data = await this._hass.callWS({ type: "recorder/statistics_during_period", start_time: s.toISOString(), end_time: new Date().toISOString(),
        statistic_ids: ser.map((x) => x.id), period: "day", types: ["change"] });
      this._fetched = Date.now();
      this._render();
    } catch (e) { this._box().innerHTML = `<div class="err">Fehler: ${esc(e.message || e)}</div>`; }
    finally { this._loading = false; }
  }
  _html(h, compact) {
    if (!this._data) return `<div class="load">Lade Statistik…</div>`;
    const tage = Number(this._config.tage) || 7, ser = series(this._config, "e"), days = [];
    for (let i = 0; i < tage; i++) { const d = new Date(this._start); d.setDate(d.getDate() + i); days.push(d); }
    const key = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const vals = ser.map((s) => {
      const m = {};
      (this._data[s.id] || []).forEach((r) => { if (r.change == null) return; const d = new Date(r.start); m[key(d)] = (m[key(d)] || 0) + Math.max(0, r.change); });
      return days.map((d) => (key(d) in m ? m[key(d)] : null));
    });
    const tot = days.map((_, i) => { const ok = vals.filter((v) => v[i] != null); return ok.length ? ok.reduce((a, v) => a + v[i], 0) : null; });
    const max = Math.max(0.1, ...tot.map((x) => x || 0));
    const W = this._width(), H = compact ? 200 : 240, pL = compact ? 30 : 38, pR = 8, pT = 18, pB = 34, pw = W - pL - pR, ph = H - pT - pB;
    const raw = max / 4, p10 = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p10;
    const stp = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p10, tmax = Math.ceil((max * 1.08) / stp) * stp;
    const Y = (v) => pT + ph - (v / tmax) * ph, bw = pw / tage, gap = Math.min(14, bw * 0.25);
    let g = "";
    for (let v = 0; v <= tmax + 1e-9; v += stp) g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,0.10)"/><text x="${pL - 4}" y="${Y(v) + 4}" text-anchor="end" style="font-size:10px">${fmt(v, stp < 1 ? 1 : 0)}</text>`;
    const dec = max < 2 ? 2 : 1;
    days.forEach((d, i) => {
      const x = pL + i * bw + gap / 2, w = bw - gap, today = i === tage - 1;
      let acc = 0;
      ser.forEach((s, k) => {
        const v = vals[k][i];
        if (v == null || v <= 0) return;
        g += `<rect x="${x}" y="${Y(acc + v)}" width="${w}" height="${Y(acc) - Y(acc + v)}" fill="${s.color}" fill-opacity="${today ? 0.45 : 0.75}" rx="2"/>`;
        acc += v;
      });
      const lines = ser.map((s, k) => `${s.name}: ${vals[k][i] == null ? "keine Daten" : fmt(vals[k][i], 2) + " kWh"}`).join("\n");
      g += `<rect x="${x}" y="${pT}" width="${w}" height="${ph}" fill="transparent"><title>${d.toLocaleDateString("de-DE")}${today ? " (läuft)" : ""}\n${lines}\nSumme: ${tot[i] == null ? "–" : fmt(tot[i], 2) + " kWh"}</title></rect>`;
      g += `<text x="${x + w / 2}" y="${(tot[i] == null ? Y(0) : Y(tot[i])) - 4}" text-anchor="middle" style="font-size:${compact ? 9 : 10}px;font-weight:700;opacity:${tot[i] == null ? 0.45 : 1}">${tot[i] == null ? "–" : fmt(tot[i], dec)}</text>`;
      g += `<text x="${x + w / 2}" y="${H - 18}" text-anchor="middle" style="font-size:10px;font-weight:${today ? 700 : 400}">${today ? "heute" : WD[d.getDay()]}</text>`;
      g += `<text x="${x + w / 2}" y="${H - 5}" text-anchor="middle" style="font-size:9px;opacity:.6">${d.getDate()}.${d.getMonth() + 1}.</text>`;
    });
    const full = tot.slice(0, -1).filter((x) => x != null), avg = full.length ? full.reduce((a, b) => a + b, 0) / full.length : null;
    const sums = vals.map((v) => v.reduce((a, b) => a + (b || 0), 0)), all = sums.reduce((a, b) => a + b, 0);
    const missing = tot.filter((x) => x == null).length;
    const legend = ser.map((s, k) => `<span><i style="background:${s.color};opacity:.8"></i>${esc(s.name)} ${fmt(sums[k], 1)} kWh${all > 0 && !compact ? ` (${fmt((sums[k] / all) * 100)} %)` : ""}</span>`).join("");
    return `<div class="title"><ha-icon icon="mdi:chart-bar-stacked"></ha-icon>Energie je Tag</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${g}</svg>
      <div class="legend">${legend}</div>
      <div class="sub">${tage} Tage gesamt ${fmt(all, 1)} kWh · Ø ${fmt(avg, 2)} kWh je vollem Tag${avg != null && !compact ? ` ≈ ${fmt(avg * 365)} kWh/Jahr` : ""}${missing ? ` · ${missing} Tag${missing > 1 ? "e" : ""} ohne Daten` : ""}</div>`;
  }
}

/* ======================= Anmeldung beim Atlas ======================= */
const E = (name, label, domain) => ({ name, label, selector: { entity: domain ? { domain } : {} } });
const N = (name, label, min, max, step) => ({ name, label, selector: { number: { min, max, step, mode: "box" } } });
const O = (name, label) => ({ name, label, selector: { object: {} } });
const T_ = (name, label) => ({ name, label, selector: { text: {} } });
const HEIZER = O("heizer", "Heizer (je Gerät: Schalter, Leistung, Energie …)");
const LIST = [
  ["aq-hero", Hero, "Aquarium: Status", [E("temp", "Temperatur", "sensor"), E("feuchte", "Luftfeuchte", "sensor"), E("sensor_batt", "Batterie Temperatursensor", "sensor"),
    E("leck", "Lecksensor", "binary_sensor"), E("leck_batt", "Batterie Lecksensor", "sensor"),
    E("pumpe", "Pumpe Ein/Aus", "switch"), E("pumpe_plan", "Pumpen-Zeitplan", "sensor"), E("pumpe_modus", "Pumpen-Modus", "select"),
    E("pumpe_drehzahl", "Pumpen-Drehzahl", "number"), E("pumpe_fuetter", "Fütterungsmodus", "switch"), T_("pumpe_prefix", "Präfix der Pumpen-Fehler-Sensoren"),
    E("filter", "Filter-Steckdose", "switch"), E("filter_w", "Filter-Leistung", "sensor"), HEIZER]],
  ["aq-heat", Heat, "Aquarium: Heizung", [E("akku", "Akku-Restkapazität", "sensor"), N("akku_an", "Akku-Schwelle an (kWh)", 0, 60, 0.5), N("akku_aus", "Akku-Schwelle aus (kWh)", 0, 60, 0.5),
    N("fenster_von", "Zeitfenster Durchlauferhitzer: von (Uhr)", 0, 24, 1), N("fenster_bis", "Zeitfenster Durchlauferhitzer: bis (Uhr)", 0, 24, 1), HEIZER]],
  ["aq-pump", Pump, "Aquarium: Pumpe", [E("pumpe", "Pumpe Ein/Aus", "switch"), E("pumpe_plan", "Zeitplan-Sensor", "sensor"), E("pumpe_modus", "Modus", "select"),
    E("pumpe_drehzahl", "Drehzahl", "number"), E("pumpe_fuetter", "Fütterungsmodus", "switch"), E("filter_w", "Filter-Leistung", "sensor"),
    T_("pumpe_prefix", "Präfix der Fehler-Sensoren")]],
  ["aq-power", Power, "Aquarium: Leistung", [E("filter_w", "Filter-Leistung", "sensor"), N("stunden", "Zeitraum (Stunden)", 6, 72, 6), HEIZER]],
  ["aq-week", Week, "Aquarium: Energie je Tag", [E("filter_e", "Filter-Energie", "sensor"), N("tage", "Anzahl Tage", 3, 31, 1), HEIZER]],
];
const HL = { sw: "Schalter (Ein/Aus)", w: "Leistung (W)", heute: "Energie heute (kWh-Sensor)", e: "Energiezähler gesamt (kWh)",
  prefix: "Präfix der Fehler-Sensoren", stab1: "Heizstab 1", stab2: "Heizstab 2", dle: "Durchlauferhitzer", not: "Notstab"  };
REG.labels = REG.labels || {};
for (const t of ["aq-hero", "aq-heat", "aq-power", "aq-week"]) REG.labels[t] = HL;
for (const [type, K, label, fields] of LIST) { REG.modules[type] = K; REG.editors[type] = { label, fields, blank: () => ({ type }) }; }
REG.ver = (REG.ver || 0) + 1;

customElements.whenDefined("energie-atlas").then(() => {
  const P = customElements.get("energie-atlas").prototype;
  if (P.__regHook) return;
  const d = Object.getOwnPropertyDescriptor(P, "hass");
  if (!d || !d.set) return;
  P.__regHook = true;
  Object.defineProperty(P, "hass", {
    configurable: true,
    get: d.get,
    set(h) {
      const v = REG.ver || 0;
      if (this._config && this._regV !== v) {
        this._regV = v;
        if ((this._config.modules || []).some((m) => m && REG.modules[m.type])) { this._hass = h; this._build(); return; }
      }
      d.set.call(this, h);
    },
  });
});
})();

/* ===== energie-atlas-netzwerk ===== */
/* energie-atlas-netzwerk – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const C = { down: "#000080", up: "#e07000", ok: "#2e9d3a", warn: "#e0a000", bad: "#c0392b", off: "#9e9e9e", g1: "#2e9d3a", m100: "#e0a000" };
const COMPACT_W = 560;
const st = (h, id) => (h && id && h.states[id]) || null;
const num = (h, id) => { const s = st(h, id); if (!s) return null; const v = parseFloat(s.state); return isNaN(v) ? null : v; };
const attr = (h, id, a) => { const s = st(h, id); return s ? s.attributes[a] : undefined; };
const unit = (h, id) => { const s = st(h, id); return s ? String(s.attributes.unit_of_measurement || "") : ""; };
const toMbit = (v, u) => { if (v == null) return null; switch (u) {
  case "KiB/s": return (v * 1024 * 8) / 1e6; case "kB/s": case "KB/s": return (v * 8) / 1000; case "MB/s": return v * 8; case "MiB/s": return (v * 1048576 * 8) / 1e6;
  case "kbit/s": case "Kbit/s": return v / 1000; case "Gbit/s": return v * 1000; case "bit/s": return v / 1e6; default: return v; } };
const mbit = (h, id) => toMbit(num(h, id), unit(h, id));
const toGB = (v, u) => (v == null ? null : u === "MB" ? v / 1000 : u === "kB" ? v / 1e6 : u === "TB" ? v * 1000 : v);
const fmtN = (v, d = 0) => (v == null || isNaN(v) ? "–" : v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtR = (v) => (v == null ? "–" : v >= 1000 ? `${fmtN(v / 1000, 2)} Gbit/s` : v >= 10 ? `${fmtN(v, 0)} Mbit/s` : v >= 1 ? `${fmtN(v, 1)} Mbit/s` : `${fmtN(v * 1000, 0)} kbit/s`);
const fmtRs = (v) => (v == null ? "–" : v >= 100 ? fmtN(v, 0) : v >= 10 ? fmtN(v, 1) : fmtN(v, 2));
const since = (iso) => {
  const t = Date.parse(iso); if (isNaN(t)) return "–";
  const s = (Date.now() - t) / 1000; if (s < 0) return "–";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d} T ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
};
const hhmm = (d) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
// Port-Info aus TP-Link-Bandbreitensensor
const port = (h, id) => {
  const s = st(h, id); if (!s) return null;
  const a = s.attributes, ls = String(a.link_status || "");
  const speed = /1000M|1G/i.test(ls) ? 1000 : /100M/i.test(ls) ? 100 : /10M/i.test(ls) ? 10 : 0;
  const up = speed > 0 && !/down/i.test(ls) && s.state !== "unavailable";
  return { up, speed, link: ls, total: num(h, id), rx: a.rx_mbps ?? null, tx: a.tx_mbps ?? null,
    err: (Number(a.rx_bad) || 0) + (Number(a.tx_bad) || 0), enabled: a.state !== "Disabled", na: s.state === "unavailable" };
};
const loadCol = (p) => (p == null ? C.off : p > 70 ? C.bad : p > 40 ? C.warn : C.ok);

const BASE_CSS = `
  :host { display:block; }
  .glass { color: #000; box-sizing: border-box;
    font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
  .title { display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:600; margin-bottom:10px; }
  .title ha-icon { --mdc-icon-size: 20px; color:#000080; }
  .sub { font-size:11px; opacity:.6; text-align:center; margin-top:6px; }
  .inner { background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.10); border-radius:12px; }
  .num { font-variant-numeric: tabular-nums; }
  .err { color:#a11a1a; font-size:13px; }
  .load { opacity:.6; font-size:13px; text-align:center; padding:12px; }
  .kl { font-size:12px; opacity:.72; }
  .kv { font-size:18px; font-weight:700; }
  svg text { fill:#000; font-size:11px; }
  .chartw { position:relative; }
  .tip { position:absolute; pointer-events:none; background: rgba(255,255,255,0.92); border:1px solid rgba(0,0,0,0.1); border-radius:8px;
    padding:6px 8px; font-size:12px; white-space:nowrap; display:none; box-shadow:0 4px 14px rgba(0,0,0,0.15); z-index:3; }
  .tip b { display:block; margin-bottom:2px; }
  .tip i { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
  .legend { display:flex; justify-content:center; gap:14px; flex-wrap:wrap; font-size:12px; margin-top:6px; }
  .legend span { display:inline-flex; align-items:center; gap:6px; }
  .legend i { width:12px; height:6px; border-radius:2px; display:inline-block; }
  .hb { height:6px; border-radius:3px; background: rgba(0,0,0,0.08); overflow:hidden; }
  .hb i { display:block; height:100%; border-radius:3px; transition: width .8s; }
  .pills { display:flex; flex-wrap:wrap; gap:6px; }
  .pill { display:inline-flex; align-items:center; gap:5px; padding:4px 10px; border-radius:12px; font-size:12px; font-weight:600;
    background: rgba(255,255,255,0.45); border:1px solid rgba(255,255,255,0.45); white-space:nowrap; }
  .pill ha-icon { --mdc-icon-size:15px; }
  .pill.ok { color:#1b6b1b; } .pill.warn { color:#a35200; } .pill.bad { color:#a11a1a; background: rgba(255,205,205,0.6); }
  .box { padding:8px 10px; display:flex; flex-direction:column; }
  .box .kv { font-size:16px; }
  .dot { display:inline-block; width:9px; height:9px; border-radius:50%; flex:none; }
  .dot.live { box-shadow: 0 0 0 0 currentColor; animation: npulse 2s infinite; }
  @keyframes npulse { 0% { box-shadow: 0 0 0 0 rgba(46,157,58,.6) } 70% { box-shadow: 0 0 0 7px rgba(46,157,58,0) } 100% { box-shadow: 0 0 0 0 rgba(46,157,58,0) } }
`;

class NetBase {
  constructor(c, el) {
    this.el = el;
    this._config = JSON.parse(JSON.stringify({ ...(this.constructor.defaults || {}), ...(c || {}) }));
    this.shadowRoot = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${BASE_CSS}${this.constructor.css || ""}</style><div class="glass"><div class="load">Lade…</div></div>`;
    this._dirty = true; this._at = 0;
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver((e) => {
        const w = Math.round(e[0].contentRect.width);
        if (w > 0 && Math.abs(w - (this._w || 0)) > 12) { this._w = w; this._dirty = true; this._resized = true; this._update(true); }
      });
      this._ro.observe(el);
    }
  }
  set hass(h) {
    if (!this.el.isConnected && this._seen) { if (this._ro) this._ro.disconnect(); return; }
    if (this.el.isConnected) this._seen = true;
    this._hass = h; if (!this._last || Date.now() - this._last > (this.constructor.throttle || 3000)) this._update(false);
  }
  _compact() { return (this._w || this.el.clientWidth || 800) < COMPACT_W; }
  get box() { return this.shadowRoot.querySelector(".glass"); }
  $(id) { return this.shadowRoot.getElementById(id); }
  _update(force) {
    if (!this._hass) return;
    this._last = Date.now();
    this.box.classList.toggle("compact", this._compact());
    try { this.update(force); } catch (e) { this.box.innerHTML = `<div class="err">Fehler: ${e.message || e}</div>`; this._dirty = true; }
  }
  async _load(fn) {
    if (this._loading) return; /* laeuft schon: der laufende Abruf liefert frische Daten, kein zweiter */
    this._loading = true;
    try { await fn(); this._err = null; } catch (e) { this._err = e.message || String(e); }
    finally { this._at = Date.now(); this._loading = false; if (this._again) { this._again = false; this._load(fn); } else this._draw(); }
  }
}

/* ===================================================================== */
/* net-wan                                                                */
/* ===================================================================== */
class NetWan extends NetBase {
  static get defaults() {
    return {
      name: "Router", wan: "", ip: "",
      download: "", upload: "",
      line_down: 1000, line_up: 500,
      today_down: "", today_up: "",
      lan_total: [""], devices: true, hours: 24,
    };
  }
  static get throttle() { return 2000; }
  static get css() {
    return `
    .top { display:grid; grid-template-columns: 1fr 1.6fr; gap:12px; align-items:stretch; }
    .compact .top { grid-template-columns: 1fr; }
    .st { padding:12px 14px; display:flex; flex-direction:column; gap:8px; }
    .net { display:flex; align-items:center; gap:10px; }
    .globe { width:52px; height:52px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex:none;
      background: radial-gradient(circle at 35% 30%, #fff, var(--c) 120%); box-shadow: 0 0 0 4px rgba(255,255,255,.3), 0 0 22px -4px var(--c); }
    .globe ha-icon { --mdc-icon-size:28px; color:#fff; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
    .nt { font-size:20px; font-weight:800; line-height:1.1; } .nt small { display:block; font-size:12px; font-weight:400; opacity:.7; }
    .rates { display:grid; grid-template-columns: 1fr 1fr; gap:8px; }
    .rate { padding:8px 10px; }
    .rate .v { font-size:22px; font-weight:800; line-height:1.1; } .rate .v small { font-size:12px; font-weight:600; opacity:.7; }
    .g3 { display:grid; grid-template-columns: repeat(3,1fr); gap:6px; }
    .ch { padding:10px 12px; }
    `;
  }
  update(force) {
    const h = this._hass, c = this._config;
    if (this._dirty) {
      this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:web"></ha-icon>Internet</div>
        <div class="top"><div class="inner st" id="st"></div><div class="inner ch"><div id="chart"><div class="load">Lade Verlauf…</div></div></div></div>`;
      this._dirty = false; if (this._res) this._draw();
    }
    const w = st(h, c.wan), on = w && w.state === "on";
    const d = mbit(h, c.download), u = mbit(h, c.upload);
    const tdS = st(h, c.today_down), tuS = st(h, c.today_up);
    const td = tdS ? toGB(num(h, c.today_down), unit(h, c.today_down)) : null, tu = tuS ? toGB(num(h, c.today_up), unit(h, c.today_up)) : null;
    const lan = (c.lan_total || []).reduce((a, id) => a + (num(h, id) || 0), 0);
    let dev = "";
    if (c.devices) {
      const tr = Object.keys(h.states).filter((k) => k.startsWith("device_tracker.") && st(h, k).attributes.source_type === "router");
      const home = tr.filter((k) => h.states[k].state === "home").length, away = tr.filter((k) => h.states[k].state === "not_home").length;
      const wlan = tr.filter((k) => h.states[k].state === "home" && /WLAN/i.test(h.states[k].attributes.connection_type || "")).length;
      dev = `<div class="inner box"><span class="kl">Geräte online</span><span class="kv num">${home}</span><span class="kl num" style="font-size:10px">${wlan ? wlan + " WLAN · " : ""}${away} abwesend</span></div>`;
    }
    this.$("st").innerHTML = `
      <div class="net"><div class="globe" style="--c:${on ? C.ok : C.bad}"><ha-icon icon="${on ? "mdi:web-check" : "mdi:web-off"}"></ha-icon></div>
        <div class="nt" style="color:${on ? "#1b6b1b" : "#a11a1a"}">${on ? "Online" : w ? "Offline" : "–"}<small style="color:#000">${c.name} · seit ${w ? since(w.last_changed) : "–"}</small></div></div>
      <div class="kl num">Externe IP <b>${st(h, c.ip) ? h.states[c.ip].state : "–"}</b></div>
      <div class="rates">
        <div class="inner rate"><span class="kl">⬇ Download</span><div class="v num" style="color:${C.down}">${fmtRs(d)} <small>Mbit/s</small></div>
          <div class="hb" style="margin-top:5px"><i style="width:${c.line_down ? Math.min(100, ((d || 0) / c.line_down) * 100) : 0}%;background:${C.down}"></i></div></div>
        <div class="inner rate"><span class="kl">⬆ Upload</span><div class="v num" style="color:${C.up}">${fmtRs(u)} <small>Mbit/s</small></div>
          <div class="hb" style="margin-top:5px"><i style="width:${c.line_up ? Math.min(100, ((u || 0) / c.line_up) * 100) : 0}%;background:${C.up}"></i></div></div>
      </div>
      <div class="g3">
        <div class="inner box"><span class="kl">Heute ⬇</span><span class="kv num">${fmtN(td, 1)}</span><span class="kl" style="font-size:10px">GB</span></div>
        <div class="inner box"><span class="kl">Heute ⬆</span><span class="kv num">${fmtN(tu, 1)}</span><span class="kl" style="font-size:10px">GB</span></div>
        ${dev || `<div class="inner box"><span class="kl">LAN-Last</span><span class="kv num">${fmtRs(lan)}</span><span class="kl" style="font-size:10px">Mbit/s</span></div>`}
      </div>`;
    if (!this._at || Date.now() - this._at > 5 * 60e3) {
      this._load(async () => {
        const end = new Date(); this._t0 = new Date(Math.floor((end.getTime() - c.hours * 3600e3) / 300e3) * 300e3);
        this._units = { d: unit(h, c.download), u: unit(h, c.upload) };
        this._res = await h.callWS({ type: "recorder/statistics_during_period", start_time: this._t0.toISOString(), end_time: end.toISOString(),
          statistic_ids: [c.download, c.upload], period: "5minute", types: ["mean", "max"] });
      });
    } else if (force || this._resized) { this._resized = false; this._draw(); }
  }
  _draw() {
    const box = this.$("chart"); if (!box) return;
    if (this._err) { box.innerHTML = `<div class="err">Fehler: ${this._err}</div>`; return; }
    if (!this._res) return;
    const c = this._config, compact = this._compact(), bms = 300e3, t0 = this._t0.getTime(), n = Math.round((c.hours * 3600e3) / bms) + 1;
    const ser = (id, u, k) => { const o = new Array(n).fill(null); for (const r of this._res[id] || []) { const ts = typeof r.start === "number" ? r.start : Date.parse(r.start); const i = Math.round((ts - t0) / bms); if (i >= 0 && i < n && r[k] != null) o[i] = toMbit(r[k], u); } return o; };
    const D = ser(c.download, this._units.d, "mean"), U = ser(c.upload, this._units.u, "mean"), Dm = ser(c.download, this._units.d, "max");
    const W = Math.max(300, (this._w ? this._w * (compact ? 1 : 0.6) : 420) - 40), H = compact ? 170 : 200;
    const pL = 38, pR = 4, pT = 8, pB = 20, pw = W - pL - pR, ph = H - pT - pB;
    const all = [...D, ...U, ...Dm].filter((v) => v != null);
    const raw = Math.max(1, ...all), stp = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((s) => raw / s <= 5) || 2000, mx = Math.ceil(raw / stp) * stp;
    const X = (i) => pL + (i / (n - 1)) * pw, Y = (v) => pT + ph - (v / mx) * ph;
    let g = "";
    for (let v = 0; v <= mx; v += stp) g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,${v ? 0.1 : 0.3})"/><text x="${pL - 4}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
    for (let i = 0; i < n; i++) { const d = new Date(t0 + i * bms); if (d.getMinutes() === 0 && d.getHours() % (compact ? 6 : 4) === 0) g += `<text x="${X(i)}" y="${H - 5}" text-anchor="middle">${String(d.getHours()).padStart(2, "0")}:00</text>`; }
    const path = (a) => { let p = "", on = false; a.forEach((v, i) => { if (v == null) { on = false; return; } p += `${on ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)} `; on = true; }); return p; };
    /* Flaeche je zusammenhaengendem Abschnitt - Luecken bleiben leer */
    const area = (a, col, op) => { let d = "", i = 0; while (i < n) { if (a[i] == null) { i++; continue; } let e = i; while (e < n && a[e] != null) e++;
      for (let q = i; q < e; q++) d += `${q === i ? "M" : "L"}${X(q).toFixed(1)},${Y(a[q]).toFixed(1)} `;
      d += `L${X(e - 1).toFixed(1)},${Y(0)} L${X(i).toFixed(1)},${Y(0)} Z `; i = e; }
      return d ? `<path d="${d}" fill="${col}" fill-opacity="${op}"/>` : ""; };
    g += area(Dm, C.down, 0.08) + area(D, C.down, 0.22) + `<path d="${path(D)}" fill="none" stroke="${C.down}" stroke-width="1.8"/>`;
    g += area(U, C.up, 0.18) + `<path d="${path(U)}" fill="none" stroke="${C.up}" stroke-width="1.6"/>`;
    g += `<line class="cx" x1="0" x2="0" y1="${pT}" y2="${pT + ph}" stroke="#000080" stroke-dasharray="3,3" style="display:none"/><rect class="hit" x="${pL}" y="${pT}" width="${pw}" height="${ph}" fill="transparent"/>`;
    const avg = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    box.innerHTML = `<div class="kl" style="text-align:center;margin-bottom:4px">Durchsatz ${c.hours} h · Mbit/s</div>
      <div class="chartw"><svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg><div class="tip"></div></div>
      <div class="legend"><span><i style="background:${C.down}"></i>Download Ø ${fmtRs(avg(D))} · Spitze ${fmtRs(Math.max(0, ...Dm.filter((v) => v != null)))}</span><span><i style="background:${C.up}"></i>Upload Ø ${fmtRs(avg(U))}</span></div>`;
    const svg = box.querySelector("svg"), tip = box.querySelector(".tip"), cx = box.querySelector(".cx"), hit = box.querySelector(".hit");
    const move = (ev) => {
      const r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(n - 1, Math.round(((((ev.clientX - r.left) / r.width) * W - pL) / pw) * (n - 1))));
      cx.setAttribute("x1", X(i)); cx.setAttribute("x2", X(i)); cx.style.display = "";
      if (D[i] == null && U[i] == null) { tip.style.display = "none"; return; }
      tip.innerHTML = `<b>${hhmm(new Date(t0 + i * bms))}</b><div><i style="background:${C.down}"></i>⬇ ${fmtR(D[i])} (Spitze ${fmtR(Dm[i])})</div><div><i style="background:${C.up}"></i>⬆ ${fmtR(U[i])}</div>`;
      tip.style.display = "block"; const left = (X(i) / W) * r.width;
      tip.style.left = (left > r.width / 2 ? Math.max(4, left - tip.offsetWidth - 10) : left + 10) + "px"; tip.style.top = "8px";
    };
    hit.addEventListener("pointermove", move); hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", () => { tip.style.display = "none"; cx.style.display = "none"; });
  }
  getCardSize() { return 5; }
}

/* ===================================================================== */
/* net-topology                                                           */
/* ===================================================================== */
const P = (n, sfx = "") => `sensor.tp_link_smart_switch_port_${n}_bandwidth${sfx}`;
const TOPO = {
  name: "Internet", icon: "mdi:web", status: "",
  children: [{ name: "Router", icon: "mdi:router-network", port: P(1), port_label: "P01",
    children: [{ name: "Hauptswitch", sub: "Switch 16 Port", icon: "mdi:switch", switch: true,
      children: [
        { name: "Home Assistant", icon: "mdi:home-assistant", port: P(2), port_label: "P02" },
        { name: "DB-Server", icon: "mdi:database", port: P(5), port_label: "P05" },
        { name: "NVR", icon: "mdi:cctv", port: P(3), port_label: "P03" },
        { name: "Sigenergy", icon: "mdi:home-battery", port: P(15), port_label: "P15" },
        { name: "Speicher 2", icon: "mdi:home-battery-outline", port: P(10), port_label: "P10" },
        { name: "Stromzähler", icon: "mdi:meter-electric", port: P(11), port_label: "P11" },
        { name: "PV-Zähler", icon: "mdi:solar-power", port: P(13), port_label: "P13" },
        { name: "Repeater", icon: "mdi:wifi", port: P(14), port_label: "P14" },
        { name: "Glasfaser 2", icon: "mdi:wan", port: P(16), port_label: "P16" },
        { name: "Glasfaser 3", sub: "Switch 5 Port", icon: "mdi:switch", switch: true, port: P(4), port_label: "P04",
          children: [
            { name: "Repeater", icon: "mdi:wifi", port: P(2, "_3"), port_label: "P02" },
            { name: "Glasfaser 1", sub: "Switch 5 Port", icon: "mdi:switch", switch: true, port: P(5, "_3"), port_label: "P05",
              children: [
                { name: "Ecowitt", icon: "mdi:weather-partly-rainy", port: P(1, "_2"), port_label: "P01" },
                { name: "Repeater", icon: "mdi:wifi", port: P(3, "_2"), port_label: "P03" },
                { name: "TV", icon: "mdi:television", port: P(4, "_2"), port_label: "P04" },
              ] },
          ] },
      ] }] }],
};
class NetTopology extends NetBase {
  static get defaults() { return { tree: TOPO, scale: 100, hide_idle: false }; }
  static get throttle() { return 2500; }
  static get css() {
    return `
    ul { list-style:none; margin:0; padding-left:20px; position:relative; }
    ul.root { padding-left:0; }
    li { position:relative; padding-left:16px; margin:2px 0; }
    ul.root > li { padding-left:0; }
    li::before { content:""; position:absolute; left:0; top:-2px; height:calc(1.05em + 12px); width:14px;
      border-left:2px solid var(--lc, rgba(0,0,0,.2)); border-bottom:2px solid var(--lc, rgba(0,0,0,.2)); border-bottom-left-radius:8px; }
    li::after { content:""; position:absolute; left:0; top:0; bottom:-4px; border-left:2px solid rgba(0,0,0,.2); }
    li:last-child::after { display:none; }
    ul.root > li::before, ul.root > li::after { display:none; }
    .nd { display:grid; grid-template-columns: 26px 1fr auto; align-items:center; gap:8px; padding:5px 8px; border-radius:10px;
      background: rgba(255,255,255,0.18); border:1px solid rgba(255,255,255,0.25); }
    .nd.sw { background: rgba(255,255,255,0.32); }
    .nd.dn { background: rgba(255,205,205,0.55); }
    .nd.idle { opacity:.62; }
    .nd ha-icon { --mdc-icon-size:20px; color:#000080; }
    .nd .nm { font-size:13px; font-weight:600; line-height:1.15; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .nd .nm small { font-weight:400; opacity:.65; font-size:11px; margin-left:4px; }
    .nd .r { text-align:right; font-size:12px; white-space:nowrap; }
    .nd .r b { font-size:13px; font-variant-numeric: tabular-nums; }
    .chip { display:inline-block; font-size:10px; font-weight:700; padding:1px 6px; border-radius:8px; margin-left:4px; color:#fff; vertical-align:1px; }
    .flow { position:absolute; left:0; top:-2px; width:2px; height:calc(1.05em + 12px); overflow:hidden; }
    .flow::before { content:""; position:absolute; left:0; width:2px; height:8px; border-radius:2px; background: var(--lc); animation: nflow var(--sp,2s) linear infinite; }
    @keyframes nflow { from { top:-8px } to { top:100% } }
    .bar { grid-column: 2 / 4; height:3px; border-radius:2px; background: rgba(0,0,0,0.08); overflow:hidden; margin-top:-2px; }
    .bar i { display:block; height:100%; border-radius:2px; }
    .sum { display:flex; justify-content:center; gap:8px; flex-wrap:wrap; margin-top:10px; }
    `;
  }
  _node(n, h, c, stat) {
    const p = n.port ? port(h, n.port) : null;
    let cls = "", lc = "rgba(0,0,0,.25)", right = "", flow = "", bar = "";
    if (n.status) {
      const on = st(h, n.status) && h.states[n.status].state === "on";
      right = `<span class="dot ${on ? "live" : ""}" style="background:${on ? C.ok : C.bad}"></span>`;
      if (!on) cls = "dn";
    }
    if (n.port) {
      stat.n++;
      if (!p || p.na) { cls = "dn"; right = `<span class="kl">kein Wert</span>`; stat.bad.push(n.name); }
      else if (!p.up) { cls = "dn"; lc = C.bad; right = `<b style="color:#a11a1a">Link down</b>`; stat.bad.push(n.name); }
      else {
        const t = p.total || 0, pct = (t / (c.scale || 100)) * 100;
        lc = p.speed >= 1000 ? C.g1 : C.m100;
        if (t < 0.05) cls = "idle";
        if (p.err) stat.err.push(`${n.name} (${p.err})`);
        stat.sum += t; stat.up++;
        right = `<b>${fmtRs(t)}</b> <span class="kl">Mbit/s</span><span class="chip" style="background:${lc}">${p.speed >= 1000 ? "1G" : p.speed + "M"}</span>${p.err ? `<span class="chip" style="background:${C.bad}" title="Fehlerhafte Pakete">${p.err}</span>` : ""}`;
        if (t >= 0.05) flow = `<span class="flow" style="--lc:${lc};--sp:${Math.max(0.5, Math.min(3, 2.5 / Math.sqrt(t + 0.1))).toFixed(2)}s"></span>`;
        bar = `<div class="bar"><i style="width:${Math.min(100, Math.max(t > 0.05 ? 2 : 0, pct)).toFixed(1)}%;background:${loadCol(pct)}"></i></div>`;
        if (p.speed < 1000 && n.switch) stat.slow.push(n.name);
      }
    }
    if (c.hide_idle && cls === "idle" && !(n.children || []).length) return "";
    const kids = (n.children || []).map((k) => this._node(k, h, c, stat)).join("");
    const title = p && p.up ? `title="${n.port_label || ""} · ${p.link} · ⬇ ${fmtRs(p.rx)} / ⬆ ${fmtRs(p.tx)} Mbit/s"` : "";
    return `<li style="--lc:${lc}">${flow}<div class="nd ${n.switch ? "sw" : ""} ${cls}" ${title}><ha-icon icon="${n.icon || "mdi:lan"}"></ha-icon>
      <span class="nm">${n.name}${n.port_label ? `<small>${n.port_label}</small>` : ""}${n.sub ? `<small>${n.sub}</small>` : ""}</span><span class="r">${right}</span>${bar}</div>
      ${kids ? `<ul>${kids}</ul>` : ""}</li>`;
  }
  update() {
    const h = this._hass, c = this._config, stat = { n: 0, up: 0, sum: 0, bad: [], err: [], slow: [] };
    const tree = this._node(c.tree, h, c, stat);
    const pills = [];
    pills.push(`<span class="pill ${stat.bad.length ? "bad" : "ok"}"><ha-icon icon="mdi:lan-${stat.bad.length ? "disconnect" : "connect"}"></ha-icon>${stat.up} von ${stat.n} Links aktiv</span>`);
    if (stat.bad.length) pills.push(`<span class="pill bad"><ha-icon icon="mdi:alert-outline"></ha-icon>down: ${stat.bad.join(", ")}</span>`);
    if (stat.err.length) pills.push(`<span class="pill warn"><ha-icon icon="mdi:alert-circle-outline"></ha-icon>Paketfehler: ${stat.err.join(", ")}</span>`);
    if (stat.slow.length) pills.push(`<span class="pill warn"><ha-icon icon="mdi:speedometer-slow"></ha-icon>nur 100M: ${stat.slow.join(", ")}</span>`);
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:lan"></ha-icon>Netzwerk-Topologie</div>
      <ul class="root">${tree}</ul>
      <div class="sum">${pills.join("")}</div>
      <div class="sub">Linienfarbe: grün 1 Gbit · gelb 100 Mbit · rot down · Lauflicht = Verkehr · Wert = rx+tx am Switch-Port</div>`;
  }
  getCardSize() { return 9; }
}

/* ===================================================================== */
/* net-switch                                                             */
/* ===================================================================== */
const SW16 = { name: "Hauptswitch", model: "TL-SG1016DE · 16-Port Gigabit Easy Smart", internet: "",
  ports: ["Fritzbox", "Home Assistant", "NVR", "Glasfaser 3", "DB-Server", "", "", "", "", "Speicher 2", "Stromzähler", "", "PV-Zähler", "Repeater", "Sigenergy", "Glasfaser 2"]
    .map((name, i) => ({ name, entity: P(i + 1) })) };
class NetSwitch extends NetBase {
  static get defaults() { return JSON.parse(JSON.stringify(SW16)); }
  static get throttle() { return 2500; }
  static get css() {
    return `
    .panel { background: linear-gradient(180deg, #3a3f4b, #23262e); border-radius:12px; padding:10px 12px 8px; box-shadow: inset 0 1px 0 rgba(255,255,255,.15), 0 6px 18px -8px rgba(0,0,0,.6); color:#fff; }
    .ph { display:flex; justify-content:space-between; align-items:center; font-size:11px; letter-spacing:1px; opacity:.85; margin-bottom:8px; }
    .ph b { letter-spacing:0; font-size:12px; }
    .rows { display:grid; grid-template-columns: repeat(var(--cols), 1fr); gap:6px; }
    .pt { position:relative; display:flex; flex-direction:column; align-items:center; gap:3px; cursor:default; }
    .rows.zz { grid-template-columns: repeat(var(--half), 1fr) 8px repeat(var(--half), 1fr); grid-auto-flow: dense; row-gap:2px; }
    .rows.zz .pt.bot { flex-direction:column-reverse; }
    .jack { width:100%; max-width:38px; aspect-ratio: 1 / 0.82; border-radius:4px; background:#0d0f13; position:relative; box-shadow: inset 0 2px 4px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.08); }
    .jack::after { content:""; position:absolute; left:30%; right:30%; bottom:0; height:22%; background:#23262e; border-radius:2px 2px 0 0; }
    .led { position:absolute; top:3px; width:6px; height:4px; border-radius:1px; background:#333; }
    .led.l { left:4px; } .led.r { right:4px; }
    .led.on { box-shadow: 0 0 6px var(--lc); background: var(--lc); }
    .led.act { animation: nblink var(--sp, 1s) steps(2, start) infinite; }
    @keyframes nblink { to { opacity:.25 } }
    .pn { font-size:10px; opacity:.8; font-variant-numeric: tabular-nums; }
    .pv { font-size:10px; font-weight:700; font-variant-numeric: tabular-nums; min-height:12px; }
    .list { margin-top:10px; padding:4px 10px; }
    .it { display:grid; grid-template-columns: 30px 1fr 74px 74px; gap:8px; align-items:center; padding:5px 0; font-size:12px; }
    .compact .it { grid-template-columns: 26px 1fr 64px 64px; gap:6px; }
    .it + .it { border-top:1px solid rgba(0,0,0,0.06); }
    .it .no { font-weight:700; opacity:.6; font-variant-numeric: tabular-nums; }
    .it .nm { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .it .nm small { font-weight:400; opacity:.6; margin-left:4px; }
    .it .v { text-align:right; font-variant-numeric: tabular-nums; }
    .it .v b { display:block; font-size:13px; }
    .it.h { font-size:10px; opacity:.6; padding:2px 0; } .it.h span { text-align:right; }
    .kp { display:grid; grid-template-columns: repeat(4,1fr); gap:6px; margin-top:8px; }
    .compact .kp { grid-template-columns: 1fr 1fr; }
    `;
  }
  update() {
    const h = this._hass, c = this._config, ports = c.ports || [];
    const info = ports.map((p) => ({ ...p, s: port(h, p.entity) }));
    const n = info.length, cols = this._compact() ? Math.min(n, 8) : Math.min(n, n > 8 ? Math.ceil(n / 2) : n);
    // Zickzack wie am Geraet: oben ungerade, unten gerade Ports, Bloecke zu je 4 Spalten
    const zz = c.layout === "zigzag" || ((c.layout || "auto") === "auto" && n > 8 && n % 2 === 0);
    const colsZ = Math.ceil(n / 2), half = Math.ceil(colsZ / 2);
    const place = (i) => { if (!zz) return ""; const col = Math.floor(i / 2) + 1; return `grid-column:${col + (col > half ? 1 : 0)};grid-row:${(i % 2) + 1}`; };
    const jack = (p, i) => {
      const s = p.s, up = s && s.up, lc = !s ? C.off : !up ? "#333" : s.speed >= 1000 ? "#39d353" : "#ffb300";
      const t = s ? s.total || 0 : 0, act = up && t > 0.05;
      const tip = `P${String(i + 1).padStart(2, "0")} ${p.name || "frei"} · ${s ? s.link : "kein Sensor"}${up ? ` · ⬇ ${fmtRs(s.rx)} ⬆ ${fmtRs(s.tx)} Mbit/s` : ""}${s && s.err ? ` · ${s.err} Fehler` : ""}`;
      return `<div class="pt${zz && i % 2 ? " bot" : ""}" style="${place(i)}" title="${tip}"><span class="pn">${i + 1}</span><div class="jack"><span class="led l ${up ? "on" : ""}" style="--lc:${lc}"></span>
        <span class="led r ${act ? "on act" : ""}" style="--lc:#39d353;--sp:${Math.max(0.15, Math.min(1.2, 1 / Math.sqrt(t + 0.01))).toFixed(2)}s"></span></div>
        <span class="pv" style="color:${s && s.err ? "#ff8a80" : "#fff"}">${up ? (t >= 0.05 ? fmtRs(t) : "·") : ""}</span></div>`;
    };
    const used = info.map((p, i) => ({ ...p, i })).filter((p) => p.name || (p.s && p.s.up));
    const rows = used.map((p) => {
      const s = p.s, up = s && s.up;
      return `<div class="it"><span class="no">P${String(p.i + 1).padStart(2, "0")}</span>
        <span class="nm">${p.name || "unbenannt"}<small>${s ? (up ? (s.speed >= 1000 ? "1G" : s.speed + "M") : "down") : "–"}</small></span>
        <span class="v" style="color:${C.down}"><b>${up ? fmtRs(s.rx) : "–"}</b></span><span class="v" style="color:${C.up}"><b>${up ? fmtRs(s.tx) : "–"}</b></span></div>`;
    }).join("");
    const upN = info.filter((p) => p.s && p.s.up).length, sum = info.reduce((a, p) => a + ((p.s && p.s.up && p.s.total) || 0), 0);
    const errs = info.reduce((a, p) => a + ((p.s && p.s.err) || 0), 0);
    const downNamed = info.filter((p) => p.name && p.s && !p.s.up).map((p) => p.name);
    const top = [...info].filter((p) => p.s && p.s.up).sort((a, b) => (b.s.total || 0) - (a.s.total || 0))[0];
    const inet = c.internet ? st(h, c.internet) : null;
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:switch"></ha-icon>${c.name}</div>
      <div class="panel"><div class="ph"><span>${(c.model || "").toUpperCase()}</span><b>${upN}/${n} Link</b></div>
        <div class="rows${zz ? " zz" : ""}" style="--cols:${cols};--half:${half}">${info.map(jack).join("")}</div></div>
      <div class="kp">
        <div class="inner box"><span class="kl">Last gesamt</span><span class="kv num">${fmtRs(sum)}</span><span class="kl" style="font-size:10px">Mbit/s rx+tx</span></div>
        <div class="inner box"><span class="kl">Top-Port</span><span class="kv" style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${top ? top.name || "P" + (info.indexOf(top) + 1) : "–"}</span><span class="kl num" style="font-size:10px">${top ? fmtRs(top.s.total) + " Mbit/s" : ""}</span></div>
        <div class="inner box"><span class="kl">Paketfehler</span><span class="kv num" style="color:${errs ? "#a11a1a" : "#1b6b1b"}">${errs}</span><span class="kl" style="font-size:10px">Zähler seit Switch-Start</span></div>
        <div class="inner box"><span class="kl">Status</span><span class="kv" style="font-size:14px;color:${downNamed.length ? "#a11a1a" : "#1b6b1b"}">${downNamed.length ? downNamed.length + " belegt, aber down" : "alles verbunden"}</span><span class="kl" style="font-size:10px">${inet ? "Internetzugang " + (inet.state === "on" ? "erlaubt" : "gesperrt") : ""}</span></div>
      </div>
      ${rows ? `<div class="inner list"><div class="it h"><span></span><span style="text-align:left">Belegung</span><span>⬇ rx</span><span>⬆ tx</span></div>${rows}</div>` : ""}
      ${downNamed.length ? `<div class="pills" style="margin-top:8px;justify-content:center"><span class="pill bad"><ha-icon icon="mdi:lan-disconnect"></ha-icon>${downNamed.join(", ")}</span></div>` : ""}
      <div class="sub">LED links: Link (grün 1G · gelb 100M) · LED rechts blinkt bei Verkehr · Mbit/s aus Switch-Sicht</div>`;
  }
  getCardSize() { return 7; }
}

/* ===================================================================== */
/* net-fritz                                                              */
/* ===================================================================== */
const FRITZ = [
  { name: "Router", sub: "Gateway · Keller", icon: "mdi:router-network", status: "" },
  { name: "Router 2", sub: "Mesh", icon: "mdi:router-wireless", uptime: "",
    temp: "", restart: "" },
  { name: "Router 3", sub: "Mesh", icon: "mdi:router-wireless", tracker: "" },
  { name: "Repeater 1", sub: "Wohnzimmer", icon: "mdi:wifi", uptime: "", restart: "", rotation: true },
  { name: "Repeater 2", sub: "Flur", icon: "mdi:wifi", uptime: "", restart: "", rotation: true },
  { name: "Repeater 3", sub: "Garten", icon: "mdi:wifi", uptime: "", restart: "",
    tracker: "", rotation: true },
];
class NetFritz extends NetBase {
  static get defaults() { return { devices: FRITZ, rotation_time: "02:00" }; }
  static get throttle() { return 10000; }
  static get css() {
    return `
    .dv { display:grid; grid-template-columns: 30px 1fr auto; gap:4px 10px; align-items:center; padding:9px 12px; }
    .dv + .dv { margin-top:6px; }
    .dv > ha-icon { --mdc-icon-size:24px; color:#000080; grid-row: span 2; }
    .dn { font-size:14px; font-weight:700; } .dn small { font-weight:400; opacity:.65; margin-left:6px; font-size:12px; }
    .ds { font-size:12px; opacity:.8; grid-column: 2 / 4; display:flex; flex-wrap:wrap; gap:4px 12px; }
    .dr { text-align:right; font-size:12px; display:flex; align-items:center; gap:6px; justify-content:flex-end; }
    .rot { margin-top:10px; padding:10px 12px; display:flex; align-items:center; gap:10px; }
    .rot ha-icon { --mdc-icon-size:24px; color:#000080; }
    .seq { display:flex; gap:4px; margin-top:4px; }
    .seq span { font-size:11px; padding:2px 8px; border-radius:8px; background: rgba(0,0,0,0.06); }
    .seq span.nx { background:#000080; color:#fff; font-weight:700; }
    `;
  }
  update() {
    const h = this._hass, c = this._config, D = c.devices || [];
    const rows = D.map((d) => {
      let ok = null, info = [];
      if (d.status) { ok = st(h, d.status) && h.states[d.status].state === "on"; info.push(ok ? `online seit ${since(h.states[d.status].last_changed)}` : "WAN getrennt"); }
      if (d.uptime) { const u = st(h, d.uptime); const valid = u && !["unavailable", "unknown"].includes(u.state); if (ok == null) ok = !!valid; info.push(valid ? `läuft seit ${since(u.state)}` : "keine Betriebszeit"); }
      if (d.tracker) { const t = st(h, d.tracker); const home = t && t.state === "home"; if (ok == null || !d.uptime) ok = home && (ok !== false);
        if (t) { const a = t.attributes; info.push(home ? `${a.connection_type || "verbunden"}${a.connected_to ? " → " + a.connected_to : ""}${a.ssid ? " · " + a.ssid : ""}` : "nicht erreichbar"); if (a.ip) info.push(a.ip); } }
      const tmp = d.temp ? num(h, d.temp) : null;
      if (tmp != null) info.push(`CPU ${fmtN(tmp, 0)} °C`);
      if (d.restart) { const r = st(h, d.restart); if (r && !isNaN(Date.parse(r.state))) info.push(`letzter Neustart ${new Date(r.state).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })} ${hhmm(new Date(r.state))}`); }
      const col = ok == null ? C.off : ok ? C.ok : C.bad;
      return `<div class="inner dv"><ha-icon icon="${d.icon || "mdi:router-wireless"}"></ha-icon>
        <span class="dn">${d.name}<small>${d.sub || ""}</small></span>
        <span class="dr"><span class="dot ${ok ? "live" : ""}" style="background:${col}"></span>${ok == null ? "–" : ok ? "ok" : "Störung"}</span>
        <span class="ds">${info.map((x) => `<span>${x}</span>`).join("")}</span></div>`;
    }).join("");
    // Rotation: der Repeater mit dem aeltesten Neustart ist als naechstes dran
    const rot = D.filter((d) => d.rotation && d.restart).map((d) => ({ d, t: Date.parse((st(h, d.restart) || {}).state) })).filter((x) => !isNaN(x.t));
    let rotHtml = "";
    if (rot.length) {
      const order = [...rot].sort((a, b) => a.t - b.t), next = order[0];
      const [hh, mm] = String(c.rotation_time || "02:00").split(":").map(Number), nt = new Date(); nt.setHours(hh, mm || 0, 0, 0); if (nt <= new Date()) nt.setDate(nt.getDate() + 1);
      const day = nt.toDateString() === new Date().toDateString() ? "heute" : "morgen";
      rotHtml = `<div class="inner rot"><ha-icon icon="mdi:restart"></ha-icon><div><div class="kl">Nächster Rotations-Neustart · ${day} ${hhmm(nt)}</div>
        <div class="kv" style="font-size:16px">${next.d.name} <span class="kl">${next.d.sub || ""}</span></div>
        <div class="seq">${order.map((x, i) => `<span class="${i === 0 ? "nx" : ""}">${x.d.name.replace(/^Repeater\s*/, "")}</span>`).join("")}</div></div></div>`;
    }
    this.box.innerHTML = `<div class="title"><ha-icon icon="mdi:router-wireless"></ha-icon>FRITZ! Geräte & Mesh</div>${rows}${rotHtml}
      <div class="sub">Rotation: der Repeater mit dem ältesten Neustart ist als Nächster dran</div>`;
  }
  getCardSize() { return 7; }
}

const ENT = { entity: {} }, ENTS = { entity: { multiple: true } }, TXT = { text: {} }, ICON = { icon: {} }, BOOL = { boolean: {} };
const NUM = (min, max, step = 1) => ({ number: { min, max, step, mode: "box" } });
const OBJ = { object: {} };
const f = (name, label, selector) => ({ name, label, selector });
const SCHEMA = {
  "net-wan": { fields: [f("name", "Name Gateway", TXT), f("wan", "WAN-Status", ENT), f("ip", "Externe IP", ENT), f("download", "Download-Rate", ENT), f("upload", "Upload-Rate", ENT),
    f("line_down", "Leitung Download (Mbit/s)", NUM(1, 10000)), f("line_up", "Leitung Upload (Mbit/s)", NUM(1, 10000)),
    f("today_down", "Volumen heute ⬇", ENT), f("today_up", "Volumen heute ⬆", ENT), f("lan_total", "LAN-Last (Ports)", ENTS),
    f("devices", "Geräte im Netz zählen (Router-Tracker)", BOOL), f("hours", "Verlauf (Stunden)", NUM(1, 168))] },
  "net-topology": { fields: [f("scale", "Lastbalken voll bei (Mbit/s)", NUM(1, 10000)), f("hide_idle", "Endgeräte ohne Verkehr ausblenden", BOOL),
    f("tree", "Baum (YAML: name, icon, port, port_label, sub, switch, status, children)", OBJ)] },
  "net-switch": { fields: [f("name", "Name", TXT), f("model", "Modell", TXT),
    f("layout", "Port-Anordnung", { select: { mode: "dropdown", options: [{ value: "auto", label: "Automatisch" }, { value: "zigzag", label: "Wie am Gerät (oben ungerade, unten gerade)" }, { value: "linear", label: "Fortlaufend" }] } }), f("internet", "Internetzugang-Schalter (optional)", ENT)],
    lists: [{ key: "ports", title: "Ports (Reihenfolge = Portnummer)", add: "Port hinzufügen", fields: [f("name", "Belegung (leer = frei)", TXT), f("entity", "Bandbreiten-Sensor", ENT)],
      blank: () => ({ name: "", entity: "" }) }] },
  "net-fritz": { fields: [f("rotation_time", "Uhrzeit Rotations-Neustart (HH:MM)", TXT)],
    lists: [{ key: "devices", title: "Geräte", add: "Gerät hinzufügen", fields: [f("name", "Name", TXT), f("sub", "Ort", TXT), f("icon", "Icon", ICON),
      f("status", "Online-Status (binary_sensor)", ENT), f("uptime", "Betriebszeit", ENT), f("tracker", "Device-Tracker", ENT), f("temp", "Temperatur", ENT),
      f("restart", "Neustart-Button", ENT), f("rotation", "Teil der Neustart-Rotation", BOOL)], blank: () => ({ name: "Neu", icon: "mdi:wifi" }) }] },
};

const LBL = { "net-wan": "Netzwerk: Internet", "net-topology": "Netzwerk: Topologie", "net-switch": "Netzwerk: Switch", "net-fritz": "Netzwerk: FRITZ! Geräte" };
const KL = { "net-wan": NetWan, "net-topology": NetTopology, "net-switch": NetSwitch, "net-fritz": NetFritz };
for (const [type, K] of Object.entries(KL)) {
  const S = SCHEMA[type];
  const fields = [...S.fields, ...(S.lists || []).map((L) => f(L.key, `${L.title} (YAML-Liste)`, OBJ))];
  REG.modules[type] = K;
  REG.editors[type] = { label: LBL[type], group: "Netzwerk", groupIcon: "mdi:lan", fields, blank: () => ({ type }) };
}
/* Feldnamen der Listen (Geräte, Ports) für den Auto-Editor des Atlas */
REG.labels = REG.labels || {};
for (const [type, S] of Object.entries(SCHEMA)) { const m = {}; for (const L of S.lists || []) for (const x of L.fields) m[x.name] = x.label; REG.labels[type] = { ...(REG.labels[type] || {}), ...m }; }
REG.ver = (REG.ver || 0) + 1;

customElements.whenDefined("energie-atlas").then(() => {
  const P = customElements.get("energie-atlas").prototype;
  if (P.__regHook) return;
  const d = Object.getOwnPropertyDescriptor(P, "hass");
  if (!d || !d.set) return;
  P.__regHook = true;
  Object.defineProperty(P, "hass", {
    configurable: true, get: d.get,
    set(h) {
      const v = REG.ver || 0;
      if (this._config && this._regV !== v) {
        this._regV = v;
        if ((this._config.modules || []).some((m) => m && REG.modules[m.type])) { this._hass = h; this._build(); return; }
      }
      d.set.call(this, h);
    },
  });
});
})();

/* ===== energie-atlas-backup ===== */
/* energie-atlas-backup – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const COMPACT_W = 560;
const BC = { db: "#000080", ha: "#ffa600", rest: "#9e9e9e" };
const DEF = { entity: "", warn_free_gb: 50, max_alter_db_h: 26, max_alter_ha_h: 50, max_alter_spiegel_h: 40, warn_temp_c: 55, warn_wear: 20 };
const fmt = (v, d = 0) => (v == null || isNaN(v) ? "–" : Number(v).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d }));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const size = (b) => { if (b == null || isNaN(b)) return "–"; const g = b / 1e9; return g >= 100 ? fmt(g, 0) + " GB" : g >= 1 ? fmt(g, 1) + " GB" : fmt(b / 1e6, 0) + " MB"; };
const age = (ms) => { if (ms == null) return "–"; const h = (Date.now() - ms) / 3600e3; return h < 1 ? `vor ${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `vor ${Math.round(h)} h` : `vor ${Math.round(h / 24)} Tagen`; };
const day = (ms) => { const d = new Date(ms); return `${d.getDate()}.${d.getMonth() + 1}.`; };
const key = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
function dbSets(files) {
  const m = {};
  files.forEach((f) => {
    const mt = f.f.match(/(\d{4})-(\d{2})-(\d{2})/);
    const k = mt ? `${mt[1]}-${+mt[2] - 1}-${+mt[3]}` : key(f.t * 1000);
    const s = (m[k] = m[k] || { t: 0, size: 0, dump: false, glob: false, conf: false });
    s.t = Math.max(s.t, f.t * 1000); s.size += f.s;
    if (f.f.endsWith(".dump")) s.dump = true; else if (f.f.endsWith(".sql")) s.glob = true; else if (f.f.endsWith(".tar.gz")) s.conf = true;
  });
  return Object.values(m).sort((a, b) => b.t - a.t);
}
function haDaysOf(files) {
  const m = {};
  files.forEach((f) => { const k = key(f.t * 1000); const s = (m[k] = m[k] || { t: 0, n: 0, size: 0 }); s.t = Math.max(s.t, f.t * 1000); s.n++; s.size += f.s; });
  return Object.values(m).sort((a, b) => b.t - a.t);
}
function smartRow(s, name, c, errs) {
  if (!s) return `<div class="smart neutral"><span><ha-icon icon="mdi:heart-pulse"></ha-icon>SMART: noch keine Daten</span></div>`;
  const bad = s.ok === false, sec = (s.realloc || 0) + (s.pending || 0);
  const hot = s.temp != null && s.temp >= c.warn_temp_c, worn = s.wear != null && s.wear <= c.warn_wear;
  if (bad) errs.push(`${name}: SMART meldet FEHLER`);
  if (sec) errs.push(`${name}: ${s.realloc || 0} umverteilte / ${s.pending || 0} schwebende Sektoren`);
  if (hot) errs.push(`${name}: ${s.temp} °C`);
  if (worn) errs.push(`${name}: SSD-Lebensdauer nur noch ${s.wear} %`);
  const old = s.t ? (Date.now() / 1000 - s.t) / 3600 : null;
  const it = (icon, txt, cls, tip) => `<span class="${cls || ""}" title="${esc(tip || "")}"><ha-icon icon="${icon}"></ha-icon>${txt}</span>`;
  return `<div class="smart">${it(bad ? "mdi:heart-broken" : "mdi:heart-pulse", bad ? "SMART FEHLER" : "SMART gesund", bad ? "bad" : "good", "SMART-Gesamtstatus" + (s.model ? " · " + s.model : ""))}
    ${it("mdi:timer-outline", `${fmt(s.h)} h`, "", `Betriebsstunden · ${fmt((s.h || 0) / 24, 0)} Tage`)}
    ${s.temp != null ? it("mdi:thermometer", `${s.temp} °C`, hot ? "bad" : "", "Temperatur") : ""}
    ${it("mdi:grid", sec ? `${s.realloc || 0} / ${s.pending || 0} Sektoren` : "0 defekte Sektoren", sec ? "bad" : "good", "Sektoren umverteilt / schwebend")}
    ${s.wear != null ? it("mdi:battery-heart-variant", `Lebensdauer ${s.wear} %`, worn ? "bad" : s.wear <= 50 ? "warnc" : "good", "SSD-Restlebensdauer laut Controller (100 % = neu)") : ""}
    ${old != null && old > 3 ? it("mdi:clock-alert-outline", `SMART vor ${fmt(old, 0)} h`, "neutral", "Letzte SMART-Abfrage (HDD schlief)") : ""}</div>`;
}
const STYLE = `
  :host { display:block; }
  .glass { color:#000; box-sizing:border-box; font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); cursor:pointer; }
  .title { display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:600; margin-bottom:10px; }
  .title ha-icon { --mdc-icon-size:20px; color:#000080; }
  .banner { display:flex; align-items:flex-start; gap:8px; border-radius:10px; padding:8px 12px; margin-bottom:12px; font-size:13px; font-weight:600; }
  .banner.ok { background: rgba(27,122,27,0.10); color:#1b7a1b; }
  .banner.alarm { background: rgba(198,40,40,0.16); color:#a11a1a; }
  .banner ha-icon { --mdc-icon-size:20px; flex:none; }
  .drives { display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:10px; }
  .drive { background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.10); border-radius:12px; padding:12px; min-width:0; }
  .dhead { display:flex; align-items:center; gap:8px; }
  .dhead ha-icon { --mdc-icon-size:26px; color:#000080; }
  .dname { font-size:15px; font-weight:700; }
  .dmnt { font-size:11px; opacity:.6; }
  .pill { margin-left:auto; font-size:11px; font-weight:700; border-radius:9px; padding:2px 9px; white-space:nowrap; }
  .pill.on { background:rgba(27,122,27,0.12); color:#1b7a1b; }
  .pill.off { background:rgba(198,40,40,0.16); color:#a11a1a; }
  .cap { display:flex; height:12px; border-radius:6px; overflow:hidden; background:rgba(0,0,0,0.08); margin:10px 0 4px; }
  .cap > div { height:100%; }
  .legend { display:flex; flex-wrap:wrap; gap:4px 12px; font-size:11px; }
  .legend span { display:inline-flex; align-items:center; gap:5px; }
  .legend i { width:10px; height:10px; border-radius:2px; display:inline-block; }
  .legend b { font-variant-numeric: tabular-nums; }
  .cat { margin-top:12px; }
  .cat h4 { margin:0 0 4px 0; font-size:13px; font-weight:600; display:flex; align-items:center; gap:6px; }
  .cat h4 ha-icon { --mdc-icon-size:17px; }
  .cat h4 .r { margin-left:auto; font-weight:400; font-size:11px; opacity:.8; white-space:nowrap; }
  .meta { font-size:11px; opacity:.85; margin-bottom:6px; }
  .chips { display:flex; flex-wrap:wrap; gap:4px; }
  .chip { font-size:11px; border-radius:8px; padding:2px 7px; font-variant-numeric: tabular-nums; white-space:nowrap; }
  .chip.ok { background:rgba(0,0,128,0.10); color:#000080; }
  .chip.ha { background:rgba(255,166,0,0.18); color:#8a5a00; }
  .chip.warn { background:rgba(198,40,40,0.16); color:#a11a1a; font-weight:700; }
  .chip.newest { font-weight:700; outline:1.5px solid currentColor; }
  .good { color:#1b7a1b; } .bad { color:#a11a1a; } .neutral { opacity:.6; }
  .smart { display:flex; flex-wrap:wrap; gap:4px 12px; align-items:center; font-size:11px; margin-top:10px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.07); }
  .smart span { display:inline-flex; align-items:center; gap:4px; font-variant-numeric: tabular-nums; white-space:nowrap; }
  .smart ha-icon { --mdc-icon-size:14px; }
  .warnc { color:#a35200; }
  .off-msg { font-size:13px; padding:16px 0 6px; text-align:center; color:#a11a1a; }
  .sub { font-size:11px; opacity:.6; text-align:center; margin-top:10px; }
  .err { color:#a11a1a; font-size:13px; }
  .compact .drives { grid-template-columns: 1fr; }
  .compact .drive { padding:10px; }
`;

class Drives {
  constructor(c, el) {
    this._config = { ...DEF, ...(c || {}) };
    this.el = el;
    this.shadowRoot = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="glass"><div class="sub">Lade…</div></div>`;
    this.shadowRoot.addEventListener("click", (ev) => {
      ev.stopPropagation();
      el.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: this._config.entity }, bubbles: true, composed: true }));
    });
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver((e) => { const w = Math.round(e[0].contentRect.width); if (w > 0 && Math.abs(w - (this._w || 0)) > 16) { this._w = w; this._render(); } });
      this._ro.observe(el);
    }
  }
  set hass(h) {
    if (!this.el.isConnected && this._seen) { if (this._ro) this._ro.disconnect(); return; }
    if (this.el.isConnected) this._seen = true;
    const st = h.states[this._config.entity], sig = st ? st.last_updated : "none";
    this._hass = h;
    if (sig !== this._sig || Date.now() - (this._last || 0) > 60000) { this._sig = sig; this._render(); }
  }
  _render() {
    if (!this._hass) return;
    this._last = Date.now();
    const box = this.shadowRoot.querySelector(".glass"), compact = (this._w || this.el.clientWidth || 800) < COMPACT_W;
    box.classList.toggle("compact", compact);
    try { box.innerHTML = this._html(compact); } catch (e) { box.innerHTML = `<div class="err">Fehler: ${esc(e.message || e)}</div>`; }
  }
  _html(compact) {
    const c = this._config, st = this._hass.states[c.entity];
    if (!st) return `<div class="err">Sensor ${esc(c.entity)} nicht gefunden.</div>`;
    const drives = st.attributes.laufwerke;
    if (!Array.isArray(drives)) return `<div class="err">Keine Daten vom Server (Sensor: ${esc(st.state)}).</div>`;
    const errs = [];
    const dataAge = st.attributes.ts ? (Date.now() / 1000 - st.attributes.ts) / 3600 : null;
    if (dataAge != null && dataAge > 1) errs.push(`Daten vom Server ${fmt(dataAge, 0)} h alt`);
    const panels = drives.map((d, idx) => {
      if (!d.online) {
        errs.push(`${d.name} nicht eingehängt`);
        return `<div class="drive"><div class="dhead"><ha-icon icon="mdi:harddisk-remove"></ha-icon>
          <div><div class="dname">${esc(d.name)}</div><div class="dmnt">${esc(d.mount)}</div></div>
          <span class="pill off">offline</span></div><div class="off-msg">Laufwerk nicht eingehängt – keine Backups erreichbar</div></div>`;
      }
      const files = d.dateien || [], dbF = files.filter((f) => f.o === "db-server"), haF = files.filter((f) => f.o === "ha");
      const dbB = dbF.reduce((a, f) => a + f.s, 0), haB = haF.reduce((a, f) => a + f.s, 0), rest = Math.max(0, d.used - dbB - haB);
      const pct = (v) => (d.total > 0 ? (v / d.total) * 100 : 0).toFixed(2);
      const freeGb = d.free / 1e9;
      if (freeGb < c.warn_free_gb) errs.push(`${d.name}: nur noch ${fmt(freeGb, 0)} GB frei`);
      const sets = dbSets(dbF), dbNew = sets.length ? sets[0].t : null;
      const maxDb = idx === 0 ? c.max_alter_db_h : c.max_alter_spiegel_h;
      const dbOld = dbNew == null || (Date.now() - dbNew) / 3600e3 > maxDb;
      if (dbOld) errs.push(`${d.name}: kein aktueller DB-Dump`);
      const incomplete = sets.filter((s) => !(s.dump && s.glob && s.conf)).length;
      const dbChips = sets.map((s, i) => {
        const full = s.dump && s.glob && s.conf, n = [s.dump, s.glob, s.conf].filter(Boolean).length;
        return `<span class="chip ${full ? "ok" : "warn"}${i === 0 ? " newest" : ""}" title="${new Date(s.t).toLocaleString("de-DE")} · ${size(s.size)}${full ? "" : ` · nur ${n} von 3 Dateien`}">${day(s.t)}${full ? "" : ` ${n}/3`}</span>`;
      }).join("");
      const haDays = haDaysOf(haF), haNew = haF.length ? Math.max(...haF.map((f) => f.t * 1000)) : null;
      const haOld = haNew == null || (Date.now() - haNew) / 3600e3 > c.max_alter_ha_h;
      if (haOld) errs.push(`${d.name}: kein aktuelles HA-Backup`);
      const haChips = haDays.map((s, i) => `<span class="chip ha${i === 0 ? " newest" : ""}" title="${new Date(s.t).toLocaleString("de-DE")} · ${size(s.size)}">${day(s.t)}${s.n > 1 ? ` ×${s.n}` : ""}</span>`).join("");
      const span = (arr) => (arr.length > 1 ? `${day(arr[arr.length - 1].t)} – ${day(arr[0].t)}` : arr.length ? day(arr[0].t) : "–");
      return `<div class="drive">
        <div class="dhead"><ha-icon icon="mdi:harddisk"></ha-icon>
          <div><div class="dname">${esc(d.name)}</div><div class="dmnt">${esc(d.mount)}${idx === 1 ? " · Spiegel" : ""}</div></div>
          <span class="pill on">${size(d.free)} frei</span></div>
        <div class="cap">
          <div style="width:${pct(dbB)}%;background:${BC.db}" title="DB-Server ${size(dbB)}"></div>
          <div style="width:${pct(haB)}%;background:${BC.ha}" title="HA-Backups ${size(haB)}"></div>
          <div style="width:${pct(rest)}%;background:${BC.rest}" title="Sonstiges ${size(rest)}"></div>
        </div>
        <div class="legend">
          <span><i style="background:${BC.db}"></i>DB <b>${size(dbB)}</b></span>
          <span><i style="background:${BC.ha}"></i>HA <b>${size(haB)}</b></span>
          ${rest > 1e8 ? `<span><i style="background:${BC.rest}"></i>Sonstiges <b>${size(rest)}</b></span>` : ""}
          <span><i style="background:rgba(0,0,0,0.08)"></i>von <b>${size(d.total)}</b> · ${fmt((d.used / d.total) * 100, 0)} % belegt</span>
        </div>
        <div class="cat">
          <h4><ha-icon icon="mdi:database" style="color:${BC.db}"></ha-icon>DB-Server
            <span class="r">${sets.length} ${sets.length === 1 ? "Satz" : "Sätze"} · ${span(sets)}</span></h4>
          <div class="meta">Neuester: <span class="${dbOld ? "bad" : "good"}">${age(dbNew)}</span>${incomplete ? ` · <span class="bad">${incomplete} unvollständig</span>` : compact ? "" : " · Dump + Rollen + Config"}</div>
          <div class="chips">${dbChips || '<span class="neutral" style="font-size:11px">keine</span>'}</div>
        </div>
        <div class="cat">
          <h4><ha-icon icon="mdi:home-assistant" style="color:${BC.ha}"></ha-icon>Home Assistant
            <span class="r">${haF.length} ${haF.length === 1 ? "Backup" : "Backups"} · ${span(haDays)}</span></h4>
          <div class="meta">Neuestes: <span class="${haOld ? "bad" : "good"}">${age(haNew)}</span>${haF.length ? ` · Ø ${size(haB / haF.length)}` : ""}</div>
          <div class="chips">${haChips || '<span class="neutral" style="font-size:11px">keine</span>'}</div>
        </div>
        ${smartRow(d.smart, d.name, c, errs)}
      </div>`;
    }).join("");
    const sy = st.attributes.system;
    const sysPanel = sy && sy.total ? `<div class="drive"><div class="dhead"><ha-icon icon="mdi:database-cog"></ha-icon>
        <div><div class="dname">${esc(sy.name || "System")}</div><div class="dmnt">${esc(sy.mount || "/")} · Datenbank + System</div></div>
        <span class="pill on">${size(sy.free)} frei</span></div>
      <div class="cap"><div style="width:${((sy.used / sy.total) * 100).toFixed(2)}%;background:${BC.db}" title="belegt ${size(sy.used)}"></div></div>
      <div class="legend"><span><i style="background:${BC.db}"></i>belegt <b>${size(sy.used)}</b></span>
        <span><i style="background:rgba(0,0,0,0.08)"></i>von <b>${size(sy.total)}</b> · ${fmt((sy.used / sy.total) * 100, 0)} % belegt</span></div>
      ${smartRow(sy.smart, sy.name || "System", c, errs)}</div>` : "";
    const sp = st.attributes.log_spiegel || "";
    if (drives.length > 1 && drives[1].online && sp && !sp.startsWith("Spiegel OK")) errs.push(`Spiegel: ${sp}`);
    const banner = errs.length
      ? `<div class="banner alarm"><ha-icon icon="mdi:alert"></ha-icon><div>${errs.map(esc).join("<br>")}</div></div>`
      : `<div class="banner ok"><ha-icon icon="mdi:shield-check"></ha-icon><div>Alle Backups aktuell${compact ? "" : " – beide Laufwerke eingehängt, DB-Dump und HA-Backup frisch"}</div></div>`;
    return `<div class="title"><ha-icon icon="mdi:harddisk"></ha-icon>Backup-Laufwerke</div>${banner}
      <div class="drives">${panels}${sysPanel}</div>
      <div class="sub">${sp && !compact ? esc(sp) + " · " : ""}Stand ${st.attributes.ts ? new Date(st.attributes.ts * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–"} · Chip = Backup-Tag, Maus drüber zeigt Uhrzeit und Größe</div>`;
  }
}

const N = (name, label, min, max, step) => ({ name, label, selector: { number: { min, max, step, mode: "box" } } });
REG.modules["backup-drives"] = Drives;
REG.editors["backup-drives"] = {
  label: "Server: Backup-Laufwerke", group: "Server", groupIcon: "mdi:server",
  fields: [{ name: "entity", label: "Status-Sensor (JSON)", selector: { entity: { domain: "sensor" } } },
    N("warn_free_gb", "Warnen unter … GB frei", 5, 500, 5), N("max_alter_db_h", "DB-Dump höchstens … h alt", 6, 168, 1),
    N("max_alter_ha_h", "HA-Backup höchstens … h alt", 6, 336, 1), N("max_alter_spiegel_h", "Spiegel (HDD 2) höchstens … h alt", 6, 168, 1),
    N("warn_temp_c", "SMART: warnen ab … °C", 30, 80, 1), N("warn_wear", "SMART: SSD-Lebensdauer warnen unter … %", 1, 100, 1)],
  blank: () => ({ type: "backup-drives" }),
};
REG.ver = (REG.ver || 0) + 1;

customElements.whenDefined("energie-atlas").then(() => {
  const P = customElements.get("energie-atlas").prototype;
  if (P.__regHook) return;
  const d = Object.getOwnPropertyDescriptor(P, "hass");
  if (!d || !d.set) return;
  P.__regHook = true;
  Object.defineProperty(P, "hass", {
    configurable: true, get: d.get,
    set(h) {
      const v = REG.ver || 0;
      if (this._config && this._regV !== v) {
        this._regV = v;
        if ((this._config.modules || []).some((m) => m && REG.modules[m.type])) { this._hass = h; this._build(); return; }
      }
      d.set.call(this, h);
    },
  });
});
})();

/* ===== energie-atlas-finanzen ===== */
/* energie-atlas-finanzen – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const COL = { out: "#b22222", inc: "#228b22", acc: "#000080", warn: "#b86e00" };
const TYP = {
  rechnung: { l: "Rechnung", p: "RE", s: -1, act: "Bezahlt" },
  abo: { l: "Dauerzahlung", p: "DA", s: -1, act: "Bezahlt" },
  einnahme: { l: "Einnahme", p: "EI", s: 1, act: "Erhalten" },
};
const IV = {
  einmalig: ["einmalig", 0], woche: ["wöchentlich", 52 / 12], monat: ["monatlich", 1],
  quartal: ["vierteljährlich", 1 / 3], halbjahr: ["halbjährlich", 1 / 6], jahr: ["jährlich", 1 / 12],
};
const COMPACT_W = 620;
const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pd = (s) => { if (!s) return null; const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return y ? new Date(y, m - 1, d) : null; };
const today = () => iso(new Date());
const de = (s) => { const d = pd(s); return d ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}` : "–"; };
const fmt = (v, d = 2) => Number(v || 0).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = (v, signed) => (v == null || isNaN(v) ? "–" : `${signed && v > 0 ? "+" : signed && v < 0 ? "−" : ""}${fmt(Math.abs(signed ? v : v))} €`);
const days = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
const addIv = (s, iv, tag) => {
  const d = pd(s); if (!d) return null;
  if (iv === "woche") { d.setDate(d.getDate() + 7); return iso(d); }
  const m = { monat: 1, quartal: 3, halbjahr: 6, jahr: 12 }[iv]; if (!m) return null;
  const t = new Date(d.getFullYear(), d.getMonth() + m, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(Number(tag) || d.getDate(), last));
  return iso(t);
};
const monthly = (e) => (e.done ? 0 : (IV[e.iv] ? IV[e.iv][1] : 0) * e.betrag);
function* occ(e, to) {
  if (e.done || !e.due) return;
  let d = e.due, n = 0;
  while (d && d <= to && n < 500) {
    if (e.ende && d > e.ende) break;
    yield d;
    if (e.iv === "einmalig") break;
    d = addIv(d, e.iv, e.tag); n++;
  }
}

/* ---------- Speicher (eine Instanz je To-do-Liste, von allen Modulen geteilt) ---------- */
const STORES = {};
const parse = (it) => {
  let m = {};
  try { m = JSON.parse(it.description || "{}") || {}; } catch (e) { m = { notiz: it.description || "" }; }
  return {
    uid: it.uid, name: it.summary || "", done: it.status === "completed", due: it.due ? String(it.due).slice(0, 10) : null,
    typ: TYP[m.typ] ? m.typ : "rechnung", betrag: Math.abs(Number(m.betrag) || 0), iv: IV[m.iv] ? m.iv : "einmalig",
    tag: m.tag || null, ende: m.ende || null, kat: m.kat || "", partner: m.partner || "", ref: m.ref || "",
    notiz: m.notiz || "", ls: !!m.ls, az: m.az || "", hist: Array.isArray(m.hist) ? m.hist : [],
  };
};
const meta = (e) => JSON.stringify({ v: 1, typ: e.typ, betrag: Math.round(e.betrag * 100) / 100, iv: e.iv, tag: e.tag || null,
  ende: e.ende || null, kat: e.kat, partner: e.partner, ref: e.ref, notiz: e.notiz, ls: !!e.ls, az: e.az, hist: (e.hist || []).slice(0, 24) });
const getStore = (ent) => (STORES[ent] = STORES[ent] || { ent, items: null, err: null, ver: 0, subs: new Set(), at: 0, loading: null, stamp: null });
async function load(s, hass, force) {
  if (s.loading) return s.loading;
  const st = hass.states[s.ent], stamp = st ? st.last_updated : null;
  if (!force && s.items && stamp === s.stamp && Date.now() - s.at < 60e3) return;
  s.loading = (async () => {
    try {
      if (!st) throw new Error(`${s.ent} nicht gefunden`);
      const r = await hass.callWS({ type: "todo/item/list", entity_id: s.ent });
      s.items = (r.items || []).map(parse); s.err = null;
    } catch (e) { s.err = e.message || String(e); }
    s.at = Date.now(); s.stamp = stamp; s.ver++; s.loading = null;
    s.subs.forEach((f) => { try { f(); } catch (e) { /* Modul weg */ } });
  })();
  return s.loading;
}
const nextAz = (s, typ) => {
  const y = new Date().getFullYear(), p = TYP[typ].p;
  let mx = 0;
  for (const e of s.items || []) { const m = /-(\d{4})-(\d+)$/.exec(e.az || ""); if (m && Number(m[1]) === y) mx = Math.max(mx, Number(m[2])); }
  return `${p}-${y}-${String(mx + 1).padStart(4, "0")}`;
};
async function save(hass, s, e, isNew) {
  const data = { description: meta(e) };
  if (e.due) data.due_date = e.due;
  if (isNew) { data.item = e.name; await hass.callService("todo", "add_item", data, { entity_id: s.ent }); }
  else {
    data.item = e.uid; data.rename = e.name; data.status = e.done ? "completed" : "needs_action";
    await hass.callService("todo", "update_item", data, { entity_id: s.ent });
  }
  await load(s, hass, true);
}
async function remove(hass, s, e) {
  await hass.callService("todo", "remove_item", { item: e.uid }, { entity_id: s.ent });
  await load(s, hass, true);
}
async function book(hass, s, e0) {
  const e = { ...e0, hist: [...e0.hist] };
  e.hist.unshift({ d: today(), f: e.due, b: e.betrag });
  if (e.iv === "einmalig") e.done = true;
  else { const n = addIv(e.due || today(), e.iv, e.tag); if (!n || (e.ende && n > e.ende)) e.done = true; else e.due = n; }
  await save(hass, s, e, false);
}
async function unbook(hass, s, e0) {
  const e = { ...e0, hist: [...e0.hist] }, h = e.hist.shift();
  if (!h) return;
  if (h.f) e.due = h.f;
  e.done = false;
  await save(hass, s, e, false);
}

/* ---------- gemeinsames Aussehen ---------- */
const CSS = `
  :host { display:block; }
  .glass { color:#000; box-sizing:border-box; font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
  .title { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px; padding-bottom:6px; border-bottom:2px solid rgba(0,0,128,0.55); }
  .title .t { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }
  .title ha-icon { --mdc-icon-size:20px; color:#000080; }
  .title .meta { font-size:11px; opacity:.6; font-family: ui-monospace, "SF Mono", Consolas, monospace; white-space:nowrap; }
  .inner { background: rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.10); border-radius:12px; }
  .mono, .num { font-family: ui-monospace, "SF Mono", Consolas, "Roboto Mono", monospace; font-variant-numeric: tabular-nums; }
  .num { text-align:right; white-space:nowrap; }
  .out { color:${COL.out}; } .inc { color:${COL.inc}; } .warn { color:${COL.warn}; }
  .sub { font-size:11px; opacity:.6; margin-top:8px; }
  .err { color:#a11a1a; font-size:13px; padding:6px 0; }
  .load, .empty { opacity:.6; font-size:13px; text-align:center; padding:14px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { font-size:10.5px; font-weight:600; text-transform:uppercase; letter-spacing:.07em; opacity:.6; text-align:left; padding:4px 6px; border-bottom:1px solid rgba(0,0,0,0.25); white-space:nowrap; }
  th.num { text-align:right; }
  td { padding:7px 6px; border-bottom:1px solid rgba(0,0,0,0.08); vertical-align:middle; }
  tr.off td { opacity:.5; }
  .az { font-size:11.5px; opacity:.75; white-space:nowrap; }
  .nm { font-weight:600; }
  .pt { font-size:11.5px; opacity:.65; }
  .stamp { display:inline-block; border:1.5px solid currentColor; border-radius:3px; padding:0 5px; font-size:9.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; transform: rotate(-3deg); white-space:nowrap; }
  .chip { display:inline-block; font-size:10.5px; padding:1px 7px; border-radius:10px; background:rgba(0,0,128,0.08); white-space:nowrap; }
  .btn { border:1px solid rgba(0,0,128,0.35); background:rgba(255,255,255,0.6); color:#000080; border-radius:8px; padding:5px 10px; font:inherit; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap; }
  .btn:hover { background:rgba(255,255,255,0.9); }
  .btn.pri { background:#000080; color:#fff; border-color:#000080; }
  .btn.del { color:${COL.out}; border-color:rgba(178,34,34,0.45); }
  .btn.del.arm { background:${COL.out}; color:#fff; }
  .btn[disabled] { opacity:.5; cursor:default; }
  .seg { display:inline-flex; border:1px solid rgba(0,0,128,0.3); border-radius:8px; overflow:hidden; }
  .seg button { border:0; background:rgba(255,255,255,0.5); padding:5px 10px; font:inherit; font-size:12px; cursor:pointer; color:#000; }
  .seg button + button { border-left:1px solid rgba(0,0,128,0.2); }
  .seg button.on { background:#000080; color:#fff; }
  input, select, textarea { font:inherit; font-size:13px; padding:6px 8px; border-radius:8px; border:1px solid rgba(0,0,0,0.2); background:rgba(255,255,255,0.75); color:#000; box-sizing:border-box; width:100%; }
  textarea { min-height:54px; resize:vertical; }
  input:focus, select:focus, textarea:focus { outline:2px solid rgba(0,0,128,0.35); outline-offset:0; }
  .form { display:grid; grid-template-columns: repeat(4, 1fr); gap:10px 12px; }
  .compact .form { grid-template-columns: 1fr 1fr; }
  .f { display:flex; flex-direction:column; gap:3px; min-width:0; }
  .f.w2 { grid-column: span 2; } .f.w4 { grid-column: 1 / -1; }
  .f > label { font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; opacity:.65; }
  .f.chk { flex-direction:row; align-items:center; gap:8px; } .f.chk input { width:auto; }
  .bar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; justify-content:flex-end; margin-top:10px; }
  .msg { font-size:12px; margin-right:auto; }
`;

class Base {
  static get defaults() { return { entity: "todo.finanzen" }; }
  static get css() { return ""; }
  static get throttle() { return 5000; }
  constructor(c, el) {
    this._config = { ...JSON.parse(JSON.stringify(this.constructor.defaults)), ...(c || {}) };
    this.el = el;
    this.shadowRoot = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${CSS}${this.constructor.css}</style><div class="glass"><div class="load">Lade Akten…</div></div>`;
    this._rv = -1;
    const stop = (ev) => { const p = ev.composedPath()[0]; if (p && /^(INPUT|TEXTAREA|SELECT)$/.test(p.tagName)) ev.stopPropagation(); };
    this.shadowRoot.addEventListener("keydown", stop);
    this.shadowRoot.addEventListener("keyup", stop);
    this.shadowRoot.addEventListener("click", (ev) => {
      const n = ev.composedPath().find((x) => x.dataset && (x.dataset.act || x.dataset.entity));
      if (!n) return;
      ev.stopPropagation();
      if (n.dataset.act) this.act(n.dataset.act, n.dataset.uid, n, ev);
      else this.el.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: n.dataset.entity }, bubbles: true, composed: true }));
    });
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver((e) => {
        const w = Math.round(e[0].contentRect.width);
        if (w > 0 && Math.abs(w - (this._w || 0)) > 12) { const was = this._compact(); this._w = w; if (was !== this._compact()) this._paint(true); }
      });
      this._ro.observe(el);
    }
  }
  _compact() { return (this._w || this.el.clientWidth || 800) < COMPACT_W; }
  _width() { return Math.max(300, Math.min(1600, this._w || this.el.clientWidth || 600)); }
  get box() { return this.shadowRoot.querySelector(".glass"); }
  get store() { return getStore(this._config.entity || "todo.finanzen"); }
  set hass(h) {
    if (this.el.isConnected) this._seen = true; else if (this._seen) { if (this._ro) this._ro.disconnect(); this.store.subs.delete(this._sub); return; }
    this._hass = h;
    const s = this.store;
    if (!this._sub) { this._sub = () => this._paint(false); s.subs.add(this._sub); }
    if (!this._last || Date.now() - this._last > this.constructor.throttle) { this._last = Date.now(); load(s, h, false); }
    if (this._rv !== s.ver) this._paint(false);
  }
  _paint(force) {
    const s = this.store;
    if (!this._hass) return;
    if (!force && this._rv === s.ver) return;
    this._rv = s.ver;
    this.box.classList.toggle("compact", this._compact());
    if (s.err && !s.items) { this.box.innerHTML = `<div class="err">Speicher nicht lesbar: ${esc(s.err)}</div>`; return; }
    if (!s.items) return;
    try { this.render(s.items); } catch (e) { this.box.innerHTML = `<div class="err">Fehler: ${esc(e.message || e)}</div>`; }
  }
  async run(fn, btn) {
    if (btn) btn.disabled = true;
    try { await fn(); } catch (e) { this.toast(`Fehler: ${e.message || e}`, true); } finally { if (btn && btn.isConnected) btn.disabled = false; }
  }
  toast(t, bad) { const m = this.shadowRoot.querySelector(".msg"); if (m) { m.textContent = t; m.style.color = bad ? COL.out : COL.inc; } }
  head(icon, text, metaTxt) {
    return `<div class="title"><span class="t"><ha-icon icon="${icon}"></ha-icon>${esc(text)}</span><span class="meta">${esc(metaTxt || `Stand ${de(today())}`)}</span></div>`;
  }
  find(uid) { return (this.store.items || []).find((e) => e.uid === uid); }
  act() {}
  render() {}
}

/* ---------- Formular (Neuer Vorgang + Bearbeiten im Journal) ---------- */
const formHTML = (e, cats, isNew) => {
  const o = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}"${k === cur ? " selected" : ""}>${esc(Array.isArray(v) ? v[0] : v.l)}</option>`).join("");
  return `<div class="form">
    <div class="f w2"><label>Bezeichnung *</label><input name="name" value="${esc(e.name)}" placeholder="z. B. Kfz-Versicherung"></div>
    <div class="f"><label>Vorgangsart</label><select name="typ">${o(TYP, e.typ)}</select></div>
    <div class="f"><label>Betrag in € *</label><input name="betrag" class="mono" inputmode="decimal" value="${e.betrag ? fmt(e.betrag) : ""}" placeholder="0,00"></div>
    <div class="f"><label>Turnus</label><select name="iv">${o(IV, e.iv)}</select></div>
    <div class="f"><label>${isNew ? "Erstfälligkeit *" : "Nächste Fälligkeit *"}</label><input name="due" type="date" value="${esc(e.due || today())}"></div>
    <div class="f"><label>Laufzeit bis</label><input name="ende" type="date" value="${esc(e.ende || "")}"></div>
    <div class="f"><label>Kategorie</label><input name="kat" list="fin-kats" value="${esc(e.kat)}" placeholder="z. B. Versicherung"><datalist id="fin-kats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></div>
    <div class="f w2"><label>Zahlungspartner</label><input name="partner" value="${esc(e.partner)}" placeholder="Firma / Person"></div>
    <div class="f w2"><label>Referenz / Vertrags- / Rechnungsnr.</label><input name="ref" class="mono" value="${esc(e.ref)}"></div>
    <div class="f w4"><label>Vermerk</label><textarea name="notiz">${esc(e.notiz)}</textarea></div>
    <div class="f chk w2"><input type="checkbox" name="ls"${e.ls ? " checked" : ""} id="ls"><label for="ls">Lastschrift / Dauerauftrag (läuft automatisch)</label></div>
    ${isNew ? "" : `<div class="f chk w2"><input type="checkbox" name="done"${e.done ? " checked" : ""} id="dn"><label for="dn">Erledigt / archiviert</label></div>`}
  </div>`;
};
const readForm = (root, base) => {
  const v = (n) => { const x = root.querySelector(`[name="${n}"]`); return x ? (x.type === "checkbox" ? x.checked : x.value.trim()) : undefined; };
  const betrag = Number(String(v("betrag") || "").replace(/\./g, "").replace(",", "."));
  const e = { ...base, name: v("name"), typ: v("typ"), betrag: Math.abs(betrag), iv: v("iv"), due: v("due"), ende: v("ende") || null,
    kat: v("kat"), partner: v("partner"), ref: v("ref"), notiz: v("notiz"), ls: v("ls") };
  const dn = v("done"); if (dn !== undefined) e.done = dn;
  if (!e.name) return [null, "Bezeichnung fehlt."];
  if (!betrag || isNaN(betrag)) return [null, "Betrag fehlt oder ist ungültig."];
  if (!e.due) return [null, "Fälligkeit fehlt."];
  if (e.ende && e.ende < e.due) return [null, "Laufzeitende liegt vor der Fälligkeit."];
  e.tag = e.iv === "einmalig" ? null : (base.tag && base.due === e.due ? base.tag : pd(e.due).getDate());
  return [e, null];
};
const catsOf = (items) => [...new Set(items.map((e) => e.kat).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));

/* ---------- fin-kpi ---------- */
class Kpi extends Base {
  static get css() {
    return `.k { display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; }
    .compact .k { grid-template-columns: 1fr 1fr; }
    .c { padding:10px 12px; } .c .l { font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; opacity:.65; }
    .c .v { font-size:22px; font-weight:700; margin-top:2px; } .compact .c .v { font-size:18px; }
    .c .s { font-size:11.5px; opacity:.7; margin-top:2px; }`;
  }
  render(items) {
    const t = today(), d30 = iso(new Date(Date.now() + 30 * 864e5)), d365 = iso(new Date(Date.now() + 365 * 864e5));
    const act = items.filter((e) => !e.done);
    let fixOut = 0, fixIn = 0, odN = 0, odS = 0, o30 = 0, i30 = 0, y12 = 0, nOpen = 0, sOpen = 0;
    for (const e of act) {
      const sg = TYP[e.typ].s, m = monthly(e);
      if (sg < 0) fixOut += m; else fixIn += m;
      if (e.due && e.due < t) { odN++; odS += sg * e.betrag; }
      if (e.iv === "einmalig" && sg < 0) { nOpen++; sOpen += e.betrag; }
      for (const d of occ(e, d30)) { if (sg < 0) o30 += e.betrag; else i30 += e.betrag; }
      if (sg < 0) for (const d of occ(e, d365)) y12 += e.betrag;
    }
    const sal = fixIn - fixOut;
    const tile = (l, v, cls, s) => `<div class="inner c"><div class="l">${l}</div><div class="v num ${cls}" style="text-align:left">${v}</div><div class="s">${s}</div></div>`;
    this.box.innerHTML = this.head("mdi:scale-balance", this._config.title || "Finanzübersicht", `${act.length} aktive Vorgänge · Stand ${de(t)}`) + `<div class="k">
      ${tile("Fixkosten je Monat", eur(fixOut), "out", "Dauerzahlungen + wiederkehrende Rechnungen")}
      ${tile("Regelm. Einnahmen je Monat", eur(fixIn), "inc", "auf den Monat umgerechnet")}
      ${tile("Saldo je Monat", eur(sal, true), sal >= 0 ? "inc" : "out", "Einnahmen − Fixkosten")}
      ${tile("Fällig nächste 30 Tage", eur(o30), "out", `Eingänge erwartet: ${eur(i30)}`)}
      ${tile("Überfällig", odN ? `${odN} · ${eur(Math.abs(odS))}` : "keine", odN ? "warn" : "inc", odN ? "Fälligkeit überschritten, nicht gebucht" : "alles fristgerecht")}
      ${tile("Belastung 12 Monate", eur(y12), "out", `offene Einzelrechnungen: ${nOpen} · ${eur(sOpen)}`)}
    </div>`;
  }
}

/* ---------- fin-due ---------- */
class Due extends Base {
  static get defaults() { return { entity: "todo.finanzen", days: 30 }; }
  render(items) {
    const t = today(), n = Number(this._config.days) || 30, to = iso(new Date(Date.now() + n * 864e5)), cp = this._compact();
    const rows = items.filter((e) => !e.done && e.due && e.due <= to).sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name));
    let sOut = 0, sIn = 0;
    const tr = rows.map((e) => {
      const T = TYP[e.typ], dd = days(t, e.due), sg = T.s;
      if (sg < 0) sOut += e.betrag; else sIn += e.betrag;
      const st = dd < 0 ? `<span class="stamp warn">überfällig ${-dd} T</span>` : dd === 0 ? `<span class="stamp out">heute</span>` : `<span class="pt">in ${dd} T</span>`;
      return `<tr><td class="mono" style="white-space:nowrap">${de(e.due)}<br>${st}</td>
        ${cp ? "" : `<td class="mono az">${esc(e.az)}</td>`}
        <td><div class="nm">${esc(e.name)}</div><div class="pt">${esc([e.partner, IV[e.iv][0], e.ls ? "Lastschrift" : ""].filter(Boolean).join(" · "))}</div></td>
        <td class="num ${sg < 0 ? "out" : "inc"}">${eur(sg * e.betrag, true)}</td>
        <td style="text-align:right"><button class="btn${e.ls ? "" : " pri"}" data-act="book" data-uid="${esc(e.uid)}" title="Buchen: ${e.iv === "einmalig" ? "Vorgang wird erledigt" : "Fälligkeit rückt " + IV[e.iv][0] + " weiter"}">${T.act}</button></td></tr>`;
    }).join("");
    this.box.innerHTML = this.head("mdi:calendar-clock", this._config.title || `Fälligkeiten · ${n} Tage`, `${rows.length} Posten`) +
      (rows.length ? `<table><thead><tr><th>Fällig</th>${cp ? "" : "<th>Az.</th>"}<th>Vorgang</th><th class="num">Betrag</th><th></th></tr></thead><tbody>${tr}</tbody>
      <tfoot><tr><td colspan="${cp ? 2 : 3}" style="font-weight:600;border:0">Summe Zeitraum</td><td class="num" style="border:0"><span class="out">${eur(-sOut, true)}</span><br><span class="inc">${eur(sIn, true)}</span></td><td style="border:0"></td></tr></tfoot></table>`
      : `<div class="empty">Keine Fälligkeiten in den nächsten ${n} Tagen.</div>`) + `<div class="bar"><span class="msg"></span></div>`;
  }
  act(a, uid, btn) {
    const e = this.find(uid); if (!e || a !== "book") return;
    this.run(async () => { await book(this._hass, this.store, e); this.toast(`${e.az || e.name} gebucht.`); }, btn);
  }
}

/* ---------- fin-plan ---------- */
class Plan extends Base {
  static get defaults() { return { entity: "todo.finanzen", months: 12 }; }
  static get css() { return `svg { display:block; } svg text { fill:#000; font-size:11px; } .lg { display:flex; justify-content:center; gap:14px; font-size:12px; margin-top:6px; } .lg i { display:inline-block; width:11px; height:9px; border-radius:2px; margin-right:5px; }`; }
  render(items) {
    const cnt = Number(this._config.months) || 12, now = new Date(), t = today();
    const ms = Array.from({ length: cnt }, (_, i) => new Date(now.getFullYear(), now.getMonth() + i, 1));
    const end = iso(new Date(now.getFullYear(), now.getMonth() + cnt, 0));
    const O = new Array(cnt).fill(0), I = new Array(cnt).fill(0);
    for (const e of items) for (const d of occ(e, end)) {
      const dd = pd(d < t ? t : d); const k = (dd.getFullYear() - now.getFullYear()) * 12 + dd.getMonth() - now.getMonth();
      if (k < 0 || k >= cnt) continue;
      if (TYP[e.typ].s < 0) O[k] += e.betrag; else I[k] += e.betrag;
    }
    const W = this._width(), cp = this._compact(), H = cp ? 200 : 230, pL = 52, pR = 6, pT = 10, pB = 34, pw = W - pL - pR, ph = H - pT - pB;
    const mx = Math.max(50, ...O, ...I), unit = mx > 5000 ? 1000 : mx > 2000 ? 500 : mx > 800 ? 200 : mx > 300 ? 100 : 50, top = Math.ceil(mx / unit) * unit;
    const Y = (v) => pT + ph - (v / top) * ph, step = pw / cnt, bw = step * 0.36;
    let g = "";
    for (let v = 0; v <= top + 0.1; v += unit) g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,${v ? 0.08 : 0.3})"/><text x="${pL - 5}" y="${Y(v) + 4}" text-anchor="end">${fmt(v, 0)}</text>`;
    ms.forEach((m, i) => {
      const x = pL + step * i + step * 0.12, sal = I[i] - O[i];
      g += `<rect x="${x.toFixed(1)}" y="${Y(O[i]).toFixed(1)}" width="${bw.toFixed(1)}" height="${(Y(0) - Y(O[i])).toFixed(1)}" rx="2" fill="${COL.out}" fill-opacity=".85"><title>${MON[m.getMonth()]} ${m.getFullYear()} Ausgaben: ${eur(O[i])}</title></rect>`;
      g += `<rect x="${(x + bw + 2).toFixed(1)}" y="${Y(I[i]).toFixed(1)}" width="${bw.toFixed(1)}" height="${(Y(0) - Y(I[i])).toFixed(1)}" rx="2" fill="${COL.inc}" fill-opacity=".85"><title>${MON[m.getMonth()]} ${m.getFullYear()} Einnahmen: ${eur(I[i])}</title></rect>`;
      g += `<text x="${pL + step * i + step / 2}" y="${H - 18}" text-anchor="middle">${cp && step < 34 ? MON[m.getMonth()].charAt(0) : MON[m.getMonth()]}</text>`;
      if (!cp || step > 40) g += `<text x="${pL + step * i + step / 2}" y="${H - 4}" text-anchor="middle" style="font-size:10px;fill:${sal >= 0 ? COL.inc : COL.out}">${sal >= 0 ? "+" : "−"}${fmt(Math.abs(sal), 0)}</text>`;
    });
    const so = O.reduce((a, b) => a + b, 0), si = I.reduce((a, b) => a + b, 0);
    this.box.innerHTML = this.head("mdi:chart-bar", this._config.title || `Zahlungsplan · ${cnt} Monate`, `Saldo ${eur(si - so, true)}`) +
      `<svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg><div class="lg"><span><i style="background:${COL.out}"></i>Ausgaben ${eur(so)}</span><span><i style="background:${COL.inc}"></i>Einnahmen ${eur(si)}</span></div>
      <div class="sub">Vorausschau aus Turnus und Fälligkeit aktiver Vorgänge; Überfälliges zählt im laufenden Monat. Untere Zahl = Monatssaldo in €.</div>`;
  }
}

/* ---------- fin-cats ---------- */
class Cats extends Base {
  static get css() { return `.r { display:grid; grid-template-columns: minmax(90px, 30%) 1fr auto; gap:8px; align-items:center; padding:5px 0; border-bottom:1px solid rgba(0,0,0,0.07); font-size:13px; }
    .bw { height:9px; border-radius:5px; background:rgba(0,0,0,0.07); overflow:hidden; } .bw i { display:block; height:100%; background:${COL.out}; border-radius:5px; }`; }
  render(items) {
    const m = {};
    for (const e of items) if (!e.done && TYP[e.typ].s < 0) { const k = e.kat || "ohne Kategorie"; m[k] = (m[k] || 0) + monthly(e); }
    const rows = Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]), tot = rows.reduce((a, [, v]) => a + v, 0), mx = rows.length ? rows[0][1] : 1;
    this.box.innerHTML = this.head("mdi:folder-table-outline", this._config.title || "Fixkosten nach Kategorie", `je Monat ${eur(tot)}`) +
      (rows.length ? rows.map(([k, v]) => `<div class="r"><span>${esc(k)}</span><span class="bw"><i style="width:${((v / mx) * 100).toFixed(1)}%"></i></span><span class="num">${eur(v)} <span class="pt">${fmt((v / tot) * 100, 0)} %</span></span></div>`).join("")
        : `<div class="empty">Noch keine wiederkehrenden Ausgaben erfasst.</div>`) + `<div class="sub">Nur wiederkehrende Ausgaben, auf den Monat umgerechnet.</div>`;
  }
}

/* ---------- fin-form ---------- */
class Form extends Base {
  static get throttle() { return 15000; }
  render(items) {
    if (this.box.querySelector(".form")) { const dl = this.box.querySelector("#fin-kats"); if (dl) dl.innerHTML = catsOf(items).map((c) => `<option value="${esc(c)}">`).join(""); return; }
    this.box.innerHTML = this.head("mdi:file-document-edit-outline", this._config.title || "Neuer Vorgang", "Erfassung") +
      formHTML({ typ: "rechnung", iv: "einmalig", name: "", betrag: 0, due: today(), kat: "", partner: "", ref: "", notiz: "", ls: false }, catsOf(items), true) +
      `<div class="bar"><span class="msg"></span><button class="btn" data-act="reset">Leeren</button><button class="btn pri" data-act="save">Vorgang anlegen</button></div>`;
  }
  act(a, uid, btn) {
    if (a === "reset") { this.box.innerHTML = ""; this._paint(true); return; }
    if (a !== "save") return;
    const [e, err] = readForm(this.box, { hist: [], done: false });
    if (err) { this.toast(err, true); return; }
    e.az = nextAz(this.store, e.typ);
    this.run(async () => { await save(this._hass, this.store, e, true); this.box.innerHTML = ""; this._paint(true); this.toast(`Erfasst unter Az. ${e.az}.`); }, btn);
  }
}

/* ---------- fin-journal ---------- */
class Journal extends Base {
  static get css() { return `.tools { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px; } .tools input { max-width:240px; }
    tr.ed > td { background:rgba(0,0,128,0.04); } .acts { display:flex; gap:6px; justify-content:flex-end; flex-wrap:wrap; }
    .hist { font-size:11.5px; opacity:.75; margin-top:8px; }`; }
  constructor(c, el) { super(c, el); this._f = { typ: "alle", st: "aktiv", q: "" }; this._ed = null; }
  render(items) {
    if (!this.box.querySelector(".tools")) {
      const seg = (k, opts) => `<div class="seg" data-k="${k}">${opts.map(([v, l]) => `<button data-act="f:${k}:${v}" class="${this._f[k] === v ? "on" : ""}">${l}</button>`).join("")}</div>`;
      this.box.innerHTML = this.head("mdi:book-open-variant", this._config.title || "Journal", "") +
        `<div class="tools">${seg("typ", [["alle", "Alle"], ["rechnung", "Rechnungen"], ["abo", "Dauerzahlungen"], ["einnahme", "Einnahmen"]])}
        ${seg("st", [["aktiv", "Aktiv"], ["erledigt", "Erledigt"], ["alle", "Alle"]])}<input type="search" placeholder="Suchen: Name, Partner, Az., Kategorie" value="${esc(this._f.q)}"></div>
        <div class="tb"></div><div class="bar"><span class="msg"></span></div>`;
      this.box.querySelector('input[type="search"]').addEventListener("input", (ev) => { this._f.q = ev.target.value; this._editLock = false; this._table(); });
    }
    this._table();
  }
  _table() {
    const items = this.store.items || [], f = this._f, q = f.q.toLowerCase(), cp = this._compact();
    const list = items.filter((e) => (f.typ === "alle" || e.typ === f.typ) && (f.st === "alle" || (f.st === "aktiv") === !e.done) &&
      (!q || [e.name, e.partner, e.az, e.kat, e.ref, e.notiz].join(" ").toLowerCase().includes(q)))
      .sort((a, b) => (a.done - b.done) || String(a.due || "9").localeCompare(String(b.due || "9")) || a.name.localeCompare(b.name));
    const cols = cp ? 4 : 7;
    const rows = list.map((e) => {
      const T = TYP[e.typ], sg = T.s;
      let r = `<tr class="${e.done ? "off" : ""}${this._ed === e.uid ? " ed" : ""}">
        ${cp ? "" : `<td class="mono az">${esc(e.az || "—")}</td>`}
        <td><div class="nm">${esc(e.name)}</div><div class="pt">${esc([e.partner, e.kat].filter(Boolean).join(" · "))}</div></td>
        ${cp ? "" : `<td><span class="chip">${T.l}</span></td><td class="pt">${IV[e.iv][0]}${e.ende ? `<br>bis ${de(e.ende)}` : ""}</td>`}
        <td class="num ${sg < 0 ? "out" : "inc"}">${eur(sg * e.betrag, true)}</td>
        <td class="mono" style="white-space:nowrap">${e.done ? '<span class="stamp inc">erledigt</span>' : de(e.due)}</td>
        <td><div class="acts"><button class="btn" data-act="edit" data-uid="${esc(e.uid)}">${this._ed === e.uid ? "Schließen" : "Bearbeiten"}</button>
          <button class="btn del" data-act="del" data-uid="${esc(e.uid)}">Löschen</button></div></td></tr>`;
      if (this._ed === e.uid) {
        r += `<tr class="ed"><td colspan="${cols}"><div class="edit" data-uid="${esc(e.uid)}">${formHTML(e, catsOf(items), false)}
          ${e.hist.length ? `<div class="hist">Buchungen: ${e.hist.slice(0, 6).map((h) => `${de(h.d)} (${eur(h.b)}${h.f ? ", fällig " + de(h.f) : ""})`).join(" · ")}${e.hist.length > 6 ? " …" : ""}</div>` : ""}
          <div class="bar">${e.hist.length ? `<button class="btn" data-act="unbook" data-uid="${esc(e.uid)}">Letzte Buchung zurücknehmen</button>` : ""}
          ${!e.done ? `<button class="btn" data-act="book" data-uid="${esc(e.uid)}">${T.act} buchen</button>` : ""}
          <button class="btn" data-act="edit" data-uid="${esc(e.uid)}">Abbrechen</button><button class="btn pri" data-act="save" data-uid="${esc(e.uid)}">Änderungen speichern</button></div></div></td></tr>`;
      }
      return r;
    }).join("");
    const tb = this.box.querySelector(".tb");
    const keepEd = this._ed && tb.querySelector(`.edit[data-uid="${CSS_ESC(this._ed)}"]`) && this._editLock;
    if (keepEd) return; /* offenes Formular nicht durch Neuladen ueberschreiben */
    tb.innerHTML = list.length ? `<table><thead><tr>${cp ? "" : "<th>Az.</th>"}<th>Vorgang</th>${cp ? "" : "<th>Art</th><th>Turnus</th>"}<th class="num">Betrag</th><th>Fällig</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty">Keine Vorgänge für diese Auswahl.</div>`;
    this.box.querySelector(".title .meta").textContent = `${list.length} von ${items.length} Vorgängen`;
    this._editLock = !!this._ed;
  }
  act(a, uid, btn) {
    if (a.startsWith("f:")) {
      const [, k, v] = a.split(":"); this._f[k] = v;
      this.box.querySelectorAll(`.seg[data-k="${k}"] button`).forEach((b) => b.classList.toggle("on", b.dataset.act === a));
      this._editLock = false; this._table(); return;
    }
    const e = this.find(uid); if (!e) return;
    if (a === "edit") { this._ed = this._ed === uid ? null : uid; this._editLock = false; this._table(); return; }
    if (a === "del") {
      if (!btn.classList.contains("arm")) { btn.classList.add("arm"); btn.textContent = "Wirklich löschen?"; setTimeout(() => { if (btn.isConnected) { btn.classList.remove("arm"); btn.textContent = "Löschen"; } }, 4000); return; }
      this.run(async () => { if (this._ed === uid) this._ed = null; this._editLock = false; await remove(this._hass, this.store, e); this.toast(`${e.az || e.name} gelöscht.`); }, btn);
      return;
    }
    if (a === "book" || a === "unbook") {
      this.run(async () => { this._editLock = false; await (a === "book" ? book : unbook)(this._hass, this.store, e); this.toast(`${e.az || e.name}: ${a === "book" ? "gebucht" : "letzte Buchung zurückgenommen"}.`); }, btn);
      return;
    }
    if (a === "save") {
      const root = this.box.querySelector(`.edit[data-uid="${CSS_ESC(uid)}"]`);
      const [n, err] = readForm(root, e);
      if (err) { this.toast(err, true); return; }
      if (n.typ !== e.typ && e.az && e.az.slice(0, 2) !== TYP[n.typ].p) n.az = nextAz(this.store, n.typ);
      this.run(async () => { this._ed = null; this._editLock = false; await save(this._hass, this.store, n, false); this.toast(`${n.az || n.name} gespeichert.`); }, btn);
    }
  }
}
const CSS_ESC = (s) => (window.CSS && window.CSS.escape ? window.CSS.escape(s) : String(s).replace(/"/g, '\\"'));

/* ======================= Anmeldung beim Atlas ======================= */
const ENT = { name: "entity", label: "Speicher (To-do-Liste)", selector: { entity: { domain: "todo" } } };
const T = (name, label) => ({ name, label, selector: { text: {} } });
const N = (name, label, min, max) => ({ name, label, selector: { number: { min, max, step: 1, mode: "box" } } });
const LIST = [
  ["fin-kpi", Kpi, "Finanzen: Kennzahlen", [ENT, T("title", "Titel")]],
  ["fin-due", Due, "Finanzen: Fälligkeiten", [ENT, T("title", "Titel"), N("days", "Vorschau (Tage)", 1, 365)]],
  ["fin-plan", Plan, "Finanzen: Zahlungsplan", [ENT, T("title", "Titel"), N("months", "Monate", 3, 36)]],
  ["fin-cats", Cats, "Finanzen: Kategorien", [ENT, T("title", "Titel")]],
  ["fin-journal", Journal, "Finanzen: Journal (bearbeiten/löschen)", [ENT, T("title", "Titel")]],
  ["fin-form", Form, "Finanzen: Neuer Vorgang", [ENT, T("title", "Titel")]],
];
for (const [type, K, label, fields] of LIST) { REG.modules[type] = K; REG.editors[type] = { label, fields, blank: () => ({ type, entity: "todo.finanzen" }) }; }
REG.ver = (REG.ver || 0) + 1;

customElements.whenDefined("energie-atlas").then(() => {
  const P = customElements.get("energie-atlas").prototype;
  if (P.__regHook) return;
  const d = Object.getOwnPropertyDescriptor(P, "hass");
  if (!d || !d.set) return;
  P.__regHook = true;
  Object.defineProperty(P, "hass", {
    configurable: true,
    get: d.get,
    set(h) {
      const v = REG.ver || 0;
      if (this._config && this._regV !== v) {
        this._regV = v;
        if ((this._config.modules || []).some((m) => m && REG.modules[m.type])) { this._hass = h; this._build(); return; }
      }
      d.set.call(this, h);
    },
  });
});
})();

/* ===== energie-atlas-allround ===== */
/* energie-atlas-allround – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
if (!REG.reg) REG.reg = (type, K, ed) => { REG.modules[type] = K; REG.editors[type] = ed; REG.ver = (REG.ver || 0) + 1; };

/* ---------------- Helfer ---------------- */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nf = (x, d) => { if (x === "" || x == null) return d; const v = Number(x); return isNaN(v) ? d : v; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const S = (h, id) => (h && id ? h.states[id] : null);
const num = (h, id) => { const s = S(h, id); if (!s) return null; const v = parseFloat(s.state); return isNaN(v) ? null : v; };
const unitOf = (h, id, u) => (u != null && u !== "" ? u : (S(h, id) && S(h, id).attributes.unit_of_measurement) || "");
const fmt = (v, d) => (v == null || isNaN(v) ? "–" : Number(v).toLocaleString("de-DE", d == null ? { maximumFractionDigits: 1 } : { minimumFractionDigits: d, maximumFractionDigits: d }));
/* W -> kW ab 1200, sonst Zahl mit Einheit */
const fmtU = (v, u, d) => {
  if (v == null || isNaN(v)) return { t: "–", u: u || "" };
  if (u === "W" && Math.abs(v) >= 1200) return { t: fmt(v / 1000, 2), u: "kW" };
  return { t: fmt(v, d == null ? (Math.abs(v) >= 100 ? 0 : 1) : d), u: u || "" };
};
const BAD = ["unavailable", "unknown", "none", ""];
const stTxt = (h, id) => { const s = S(h, id); if (!s) return null; return BAD.includes(String(s.state).toLowerCase()) ? null : s.state; };
/* Wert einer Entitaet fertig formatiert: Zahl mit Einheit, sonst Zustandstext, sonst "–" */
const fmtEnt = (h, id, unit, dec) => { const v = num(h, id); return v != null ? fmtU(v, unitOf(h, id, unit), dec) : { t: stTxt(h, id) ?? "–", u: "" }; };
/* wie fmtEnt, aber Zahl mit umgedrehtem Vorzeichen, wenn inv gesetzt (Zustandstexte bleiben) */
const fmtEntI = (h, id, unit, dec, inv) => { const v = inv ? num(h, id) : null; return v != null ? fmtU(-v, unitOf(h, id, unit), dec) : fmtEnt(h, id, unit, dec); };
const cut = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s; };
/* alle Entitaets-IDs aus einer Modul-Konfiguration (fuer den Aenderungs-Filter) */
const entIds = (o, out = new Set()) => { if (typeof o === "string") { if (/^[a-z_]+\.[a-z0-9_]+$/.test(o)) out.add(o); } else if (o && typeof o === "object") for (const k in o) entIds(o[k], out); return out; };
const pt = (cx, cy, r, a) => { const t = (a * Math.PI) / 180; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; };
const P2 = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
const arc = (cx, cy, r, a0, a1) => {
  if (Math.abs(a1 - a0) < 0.05) return "";
  const sw = a1 > a0 ? 1 : 0, big = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M${P2(pt(cx, cy, r, a0))}A${r},${r} 0 ${big} ${sw} ${P2(pt(cx, cy, r, a1))}`;
};
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const TR = "rgba(0,0,0,0.10)";
const DEF = ["#000080", "#ffa600", "#6a1b9a", "#43a047", "#1e6fd9", "#b22222", "#00897b", "#8d6e63"];
const ACTIVE = ["on", "true", "home", "open", "heat", "heating", "läuft", "an", "ein", "ok", "running", "online", "connected"];
const isOn = (s) => { if (s == null) return false; const v = parseFloat(s); if (!isNaN(v)) return v > 0; return ACTIVE.includes(String(s).toLowerCase()); };
/* Pumpe: enger als isOn - "online"/"connected" heisst nicht, dass sie laeuft */
const PUMP_ON = ["on", "true", "running", "läuft", "an", "ein", "heat", "heating"];
const pumpOn = (s) => { if (s == null) return false; const v = parseFloat(s); if (!isNaN(v)) return v > 0; return PUMP_ON.includes(String(s).toLowerCase()); };
/* Einheiten umrechnen (W/kW/MW, Wh/kWh/MWh); null = nicht umrechenbar, wird dann gemeldet statt falsch addiert */
const UF = { w: ["P", 1], kw: ["P", 1e3], mw: ["P", 1e6], wh: ["E", 1], kwh: ["E", 1e3], mwh: ["E", 1e6] };
const conv = (v, from, to) => { if (v == null) return null; if (!from || !to || from === to) return v; const a = UF[String(from).toLowerCase()], b = UF[String(to).toLowerCase()]; return a && b && a[0] === b[0] ? (v * a[1]) / b[1] : null; };
/* "on=#22c55e, off=#64748b" -> Map (Kleinbuchstaben) */
const parseColors = (txt) => {
  const m = {};
  if (Array.isArray(txt)) { for (const x of txt) if (x && x.state != null) m[String(x.state).toLowerCase()] = x.color; return m; }
  String(txt || "").split(/[,;\n]/).forEach((p) => { const i = p.indexOf("="); if (i > 0) m[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim(); });
  return m;
};
/* "> 0", "!= off", "== on", "on" ... -> true/false; leer = immer zeigen */
const showIf = (expr, state) => {
  if (expr == null || String(expr).trim() === "") return true;
  const m = /^\s*(==|!=|>=|<=|>|<|=)?\s*([\s\S]*?)\s*$/.exec(String(expr));
  if (!m) return true;
  const op = m[1] || "==", rhs = m[2];
  const st = state == null ? "unavailable" : String(state).toLowerCase(), rl = rhs.toLowerCase();
  /* nicht verfuegbar: nur zeigen, wenn genau danach gefragt wird (z.B. "== unavailable"), sonst ausblenden */
  if (BAD.includes(st)) return BAD.includes(rl) ? (op === "!=" ? st !== rl : st === rl) : false;
  /* Zahl rechts: hoechstens ein Dezimaltrenner, Einheit dahinter erlaubt ("10 W"); "10.0.1" bleibt Text */
  const rn = /^-?\d+([.,]\d+)?(\s*[^\d\s.,].*)?$/.test(rhs), a = parseFloat(state), b = parseFloat(rhs.replace(",", "."));
  if (rn && isNaN(a) && op !== "==" && op !== "=" && op !== "!=") return false;
  const nb = rn && !isNaN(a) && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(String(state).trim());
  const L = nb ? a : st, R = nb ? b : rl;
  switch (op) { case ">": return L > R; case "<": return L < R; case ">=": return L >= R; case "<=": return L <= R; case "!=": return L != R; default: return L == R; } // eslint-disable-line eqeqeq
};
/* Tempo-Stufen fuer Fluss-Animation: 0 = steht, sonst Sekunden je Durchlauf (quantisiert, damit nicht staendig neu gezeichnet wird) */
const speed = (ratio) => { const r = clamp(Math.abs(ratio), 0, 1); if (r < 0.01) return 0; const lv = Math.ceil(r * 8); return +(3.6 / lv).toFixed(2); };

const CSS = `
  :host { display:block; }
  .w { color:#000; box-sizing:border-box; font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); position:relative; }
  .title { display:flex; align-items:center; justify-content:center; gap:8px; font-size:15px; font-weight:600; margin-bottom:10px; }
  .title ha-icon { --mdc-icon-size:20px; color:#000080; }
  .inner, .tile { background: rgba(255,255,255,var(--ea-kachel,0.1)); border:1px solid rgba(255,255,255,var(--ea-krand,0.2)); border-radius:12px; box-sizing:border-box; }
  .num { font-variant-numeric: tabular-nums; }
  .err { color:#a11a1a; font-size:13px; } .ld { opacity:.6; font-size:13px; text-align:center; padding:12px; }
  .ent { cursor:pointer; }
  svg text { font-family:inherit; }
  @keyframes dash { to { stroke-dashoffset: -24; } }
  @keyframes shim { to { stroke-dashoffset: -48; } }
  @keyframes dashr { to { stroke-dashoffset: 24; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  .fl { animation: dash var(--d,2s) linear infinite; } .fl.r { animation-name: dashr; }
  .shim { animation: shim var(--d,3s) linear infinite; }
  @media (prefers-reduced-motion: reduce) { .fl, .shim, .imp { animation: none !important; } }
`;

/* ---------------- Basis ---------------- */
class Base {
  static get defaults() { return {}; }
  static get css() { return ""; }
  static get throttle() { return 1500; }
  constructor(c, el) {
    this.c = { ...clone(this.constructor.defaults), ...(c || {}) };
    this.el = el;
    this.sr = el.shadowRoot || el.attachShadow({ mode: "open" });
    this.sr.innerHTML = `<style>${CSS}${this.constructor.css}</style><div class="w"><div class="ld">Lade…</div></div>`;
    this.box = this.sr.querySelector(".w");
    this._sig = null;
    this._ids = [...entIds(this.c)];
    this._gid = `ea${Math.random().toString(36).slice(2, 8)}`;
    this.sr.addEventListener("click", (ev) => {
      const n = ev.composedPath().find((x) => x.dataset && (x.dataset.ent || x.dataset.tog));
      if (!n) return;
      ev.stopPropagation();
      if (n.dataset.tog) { if (this.h) this.h.callService("homeassistant", "toggle", { entity_id: n.dataset.tog }); return; }
      this.el.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: n.dataset.ent }, bubbles: true, composed: true }));
    });
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver((e) => {
        const w = Math.round(e[0].contentRect.width);
        if (w > 0 && Math.abs(w - (this._w || 0)) > 8) { this._w = w; this._sig = null; if (this.h) this._draw(); }
      });
      this._ro.observe(el);
    }
  }
  /* echte Breite (keine Obergrenze): Fluss-Raster und Baum setzen HTML-Knoten in px auf ein SVG - beide muessen dieselbe Breite haben */
  get W() { return Math.max(260, Math.min(6000, this._w || this.el.clientWidth || 600)); }
  set hass(h) {
    if (this._gone) return;
    const now = Date.now();
    /* nur neu rechnen, wenn sich eine eigene Entitaet geaendert hat (HA tauscht das State-Objekt bei jeder Aenderung) - spaetestens jede Minute trotzdem */
    if (this.h && this._last && now - this._last < 60e3 && this._ids.every((id) => !h.states || h.states[id] === this.h.states[id])) { this.h = h; return; }
    this.h = h;
    const T = this.constructor.throttle;
    if (this._last && now - this._last < T) {
      if (!this._tm) this._tm = setTimeout(() => { this._tm = null; if (!this._gone && !document.hidden) { this._last = Date.now(); this._draw(); } }, T - (now - this._last) + 20);
      return;
    }
    this._last = now;
    this._draw();
  }
  _draw() {
    try {
      const html = this.render(this.h);
      if (html != null && html !== this._sig) { this._sig = html; this.box.innerHTML = html; if (this.after) this.after(); }
    } catch (e) { this._sig = null; this.box.innerHTML = `<div class="err">Fehler: ${esc(e.message || e)}</div>`; }
  }
  onDisconnect() { this._gone = true; if (this._tm) clearTimeout(this._tm); if (this._ro) this._ro.disconnect(); }
  /* Klickziel: tap_action */
  tap(entity, action) {
    if (!entity || action === "none") return "";
    return action === "toggle" ? ` data-tog="${esc(entity)}"` : ` data-ent="${esc(entity)}"`;
  }
}

/* ===================== allround-kacheln ===================== */
const GAUGES = [["none", "keine (Icon + Wert)"], ["center-arc", "Nullpunkt-Bogen (−/+)"], ["center-bar", "Nullpunkt-Balken (−/+)"],
  ["dual-arc", "Doppel-Ring (2 Werte)"], ["led-arc", "LED-Bogen (Segmente)"], ["led-bar", "LED-Balken (Segmente)"],
  ["compass", "Kompass 360°"], ["needle", "Tachonadel mit Skala"]];
class Tiles extends Base {
  static get defaults() { return { columns: 3, tiles: [{ name: "Wert", icon: "mdi:information-outline", entity: "", gauge: "none" }] }; }
  static get css() {
    return `
    .grid { display:grid; gap:8px; }
    .tile { min-height:70px; padding:6px 6px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px; min-width:0; text-align:center;
      backdrop-filter: blur(var(--ea-blur,10px)); -webkit-backdrop-filter: blur(var(--ea-blur,10px)); }
    .tile[data-ent], .tile[data-tog] { cursor:pointer; }
    .tile ha-icon { --mdc-icon-size:22px; }
    .tn { font-size:11px; line-height:1.25; opacity:.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
    .tv { font-size:16px; line-height:1.25; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
    .tv small, .sub small { font-size:11px; font-weight:400; opacity:.65; margin-left:2px; }
    .sub { font-size:11px; opacity:.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
    .tile svg { display:block; width:100%; max-height:120px; }
    .bar { width:100%; padding:2px 2px 0; box-sizing:border-box; }
    .mm { display:flex; justify-content:space-between; width:100%; font-size:10px; opacity:.55; padding:0 4px; box-sizing:border-box; }
    `;
  }
  render(h) {
    const c = this.c, cols = clamp(Math.round(nf(c.columns, 3)), 1, 8);
    const parts = (c.tiles || []).map((t) => this.tile(h, t)).filter((x) => x);
    if (!parts.length) return `<div class="ld">Keine Kachel sichtbar</div>`;
    return `<div class="grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${parts.join("")}</div>`;
  }
  tile(h, t) {
    const s = S(h, t.entity), raw = s ? s.state : null, v0 = num(h, t.entity), v = v0 != null && t.invert ? -v0 : v0;
    /* "Nur zeigen wenn" prueft den angezeigten (ggf. umgedrehten) Wert */
    if (!showIf(t.show_if, v0 != null && t.invert ? String(v) : raw)) return "";
    const dec = t.decimals === "" || t.decimals == null ? null : Number(t.decimals);
    const unit = unitOf(h, t.entity, t.unit), sc = parseColors(t.state_colors);
    const stCol = raw != null ? sc[String(raw).toLowerCase()] : null;
    const base = t.color || "#000080", col = stCol || base;
    const valTxt = v != null ? fmtU(v, unit, dec) : { t: stTxt(h, t.entity) == null ? "–" : String(raw), u: "" };
    let sub = "";
    if (t.sub_entity) { const f = fmtEntI(h, t.sub_entity, t.sub_unit, t.sub_decimals === "" || t.sub_decimals == null ? null : Number(t.sub_decimals), t.sub_invert);
      sub = `<div class="sub num">${esc(f.t)}<small>${esc(f.u)}</small></div>`; }
    const kd = t.deckkraft === "" || t.deckkraft == null ? "" : ` style="--ea-kachel:${clamp(Number(t.deckkraft), 0, 100) / 100}"`;
    const nm = `<div class="tn">${esc(t.name || (s && s.attributes.friendly_name) || t.entity || "")}</div>`;
    const val = `<div class="tv num" style="color:${v == null && !stCol ? "#000" : col}">${esc(valTxt.t)}<small>${esc(valTxt.u)}</small></div>`;
    const g = t.gauge || "none";
    let body;
    if (g === "none") body = `<ha-icon icon="${esc(t.icon || (s && s.attributes.icon) || "mdi:information-outline")}" style="color:${col}"></ha-icon>${nm}${val}${sub}`;
    else body = this.gauge(h, t, g, v, col, valTxt, nm, sub);
    return `<div class="tile"${this.tap(t.entity, t.tap_action || "more-info")} title="${esc(t.name || t.entity || "")}"${kd}>${body}</div>`;
  }
  gauge(h, t, g, v, col, vt, nm, sub) {
    const ok = v != null, neg = t.neg_color || "#22c55e";
    const vtxt = (fill) => `<text x="60" text-anchor="middle" class="num" style="font-size:17px;font-weight:700;fill:${fill}"`;
    const ut = (y) => `<text x="60" y="${y}" text-anchor="middle" style="font-size:9px;opacity:.6">${esc(vt.u)}</text>`;
    if (g === "center-arc" || g === "center-bar") {
      const mn = nf(t.min, -5000), mx = nf(t.max, 5000);
      const r = !ok ? 0 : v >= 0 ? clamp(v / (mx > 0 ? mx : 1), 0, 1) : -clamp(v / (mn < 0 ? mn : -1), 0, 1);
      const fc = r < 0 ? neg : col;
      if (g === "center-arc") {
        const cx = 60, cy = 62, R = 48;
        const fill = r === 0 ? "" : `<path d="${arc(cx, cy, R, 270, 270 + 90 * r)}" stroke="${fc}" stroke-width="10" fill="none" stroke-linecap="round"/>`;
        return `<svg viewBox="0 0 120 70"><path d="${arc(cx, cy, R, 180, 360)}" stroke="${TR}" stroke-width="10" fill="none" stroke-linecap="round"/>${fill}
          <line x1="${cx}" y1="${cy - R - 8}" x2="${cx}" y2="${cy - R + 8}" stroke="#000" stroke-opacity=".35" stroke-width="1.5"/>
          ${vtxt(ok ? fc : "#9e9e9e")} y="${cy - 8}">${esc(vt.t)}</text>${ut(cy + 4)}</svg>
          <div class="mm num"><span>${fmt(mn, 0)}</span><span>0</span><span>${fmt(mx, 0)}</span></div>${nm}${sub}`;
      }
      const w = Math.abs(r) * 50;
      return `<div class="tv num" style="color:${ok ? fc : "#9e9e9e"}">${esc(vt.t)}<small>${esc(vt.u)}</small></div>
        <svg class="bar" viewBox="0 0 100 12" preserveAspectRatio="none"><rect x="0" y="3" width="100" height="6" rx="3" fill="${TR}"/>
        ${w > 0 ? `<rect x="${r < 0 ? 50 - w : 50}" y="3" width="${w}" height="6" rx="2" fill="${fc}"/>` : ""}
        <rect x="49.6" y="0" width="0.8" height="12" fill="#000" fill-opacity=".45"/></svg>
        <div class="mm num"><span>${fmt(mn, 0)}</span><span>0</span><span>${fmt(mx, 0)}</span></div>${nm}${sub}`;
    }
    if (g === "dual-arc") {
      const mn = nf(t.min, 0), mx = nf(t.max, 100), p = ok ? clamp((v - mn) / (mx - mn || 1), 0, 1) : 0;
      const v2r = num(h, t.entity2), v2 = v2r != null && t.invert2 ? -v2r : v2r, mn2 = nf(t.min2, 0), mx2 = nf(t.max2, 100), p2 = v2 != null ? clamp((v2 - mn2) / (mx2 - mn2 || 1), 0, 1) : 0, c2 = t.color2 || "#a855f7";
      const f2 = fmtEntI(h, t.entity2, t.unit2, null, t.invert2);
      const cx = 60, cy = 56, a0 = 135;
      return `<svg viewBox="0 0 120 102">
        <path d="${arc(cx, cy, 46, a0, a0 + 270)}" stroke="${TR}" stroke-width="8" fill="none" stroke-linecap="round"/>
        ${p > 0 ? `<path d="${arc(cx, cy, 46, a0, a0 + 270 * p)}" stroke="${col}" stroke-width="8" fill="none" stroke-linecap="round"/>` : ""}
        <path d="${arc(cx, cy, 34, a0, a0 + 270)}" stroke="${TR}" stroke-width="6" fill="none" stroke-linecap="round"/>
        ${p2 > 0 ? `<path d="${arc(cx, cy, 34, a0, a0 + 270 * p2)}" stroke="${c2}" stroke-width="6" fill="none" stroke-linecap="round"/>` : ""}
        ${vtxt(ok ? "#000" : "#9e9e9e")} y="${cy + 2}">${esc(vt.t)}</text>${ut(cy + 13)}
        <text x="${cx}" y="${cy + 30}" text-anchor="middle" class="num" style="font-size:10px;font-weight:600;fill:${c2}">${esc(f2.t)} ${esc(f2.u)}</text></svg>${nm}${sub}`;
    }
    if (g === "led-arc" || g === "led-bar") {
      const mn = nf(t.min, 0), mx = nf(t.max, 100), N = clamp(Math.round(nf(t.steps, 12)), 2, 60);
      const p = ok ? clamp((v - mn) / (mx - mn || 1), 0, 1) : 0, lit = Math.round(p * N);
      if (g === "led-arc") {
        const cx = 60, cy = 58, R = 44, a0 = 135, span = 270, L = (Math.PI * R * span) / 180, seg = L / N;
        const da = `${(seg * 0.72).toFixed(2)} ${(seg * 0.28).toFixed(2)}`;
        return `<svg viewBox="0 0 120 104"><path d="${arc(cx, cy, R, a0, a0 + span)}" stroke="${TR}" stroke-width="10" fill="none" stroke-dasharray="${da}"/>
          ${lit > 0 ? `<path d="${arc(cx, cy, R, a0, a0 + (span * lit) / N)}" stroke="${col}" stroke-width="10" fill="none" stroke-dasharray="${da}"/>` : ""}
          ${vtxt(ok ? "#000" : "#9e9e9e")} y="${cy + 6}">${esc(vt.t)}</text>${ut(cy + 19)}</svg>
          <div class="mm num"><span>${fmt(mn, 0)}</span><span>${fmt(mx, 0)}</span></div>${nm}${sub}`;
      }
      const seg = 100 / N, da = `${(seg * 0.75).toFixed(3)} ${(seg * 0.25).toFixed(3)}`;
      return `<div class="tv num" style="color:${ok ? col : "#9e9e9e"}">${esc(vt.t)}<small>${esc(vt.u)}</small></div>
        <svg class="bar" viewBox="0 0 100 10" preserveAspectRatio="none"><line x1="0" y1="5" x2="100" y2="5" stroke="${TR}" stroke-width="8" stroke-dasharray="${da}"/>
        ${lit > 0 ? `<line x1="0" y1="5" x2="${((100 * lit) / N).toFixed(3)}" y2="5" stroke="${col}" stroke-width="8" stroke-dasharray="${da}"/>` : ""}</svg>
        <div class="mm num"><span>${fmt(mn, 0)}</span><span>${fmt(mx, 0)}</span></div>${nm}${sub}`;
    }
    if (g === "compass") {
      const cx = 60, cy = 56, R = 42, a = ok ? ((v % 360) + 360) % 360 : null;
      const lab = [["N", 0], ["O", 90], ["S", 180], ["W", 270]].map(([l, d]) => { const p = pt(cx, cy, R - 12, d - 90); return `<text x="${p[0].toFixed(1)}" y="${(p[1] + 3.5).toFixed(1)}" text-anchor="middle" style="font-size:10px;font-weight:${l === "N" ? 700 : 400};opacity:.7">${l}</text>`; }).join("");
      const ticks = Array.from({ length: 36 }, (_, i) => { const a0 = i * 10 - 90, p1 = pt(cx, cy, R, a0), p2 = pt(cx, cy, R - (i % 9 === 0 ? 6 : 3), a0); return `<line x1="${p1[0].toFixed(1)}" y1="${p1[1].toFixed(1)}" x2="${p2[0].toFixed(1)}" y2="${p2[1].toFixed(1)}" stroke="#000" stroke-opacity=".3" stroke-width="1"/>`; }).join("");
      let mk = "";
      if (a != null) { const tip = pt(cx, cy, R + 2, a - 90), l = pt(cx, cy, R - 9, a - 90 - 7), r = pt(cx, cy, R - 9, a - 90 + 7), tail = pt(cx, cy, 10, a + 90);
        mk = `<polygon points="${P2(tip)} ${P2(l)} ${P2(r)}" fill="${col}"/><line x1="${tail[0].toFixed(1)}" y1="${tail[1].toFixed(1)}" x2="${pt(cx, cy, R - 10, a - 90).map((x) => x.toFixed(1)).join('" y2="')}" stroke="${col}" stroke-width="2" stroke-linecap="round" opacity=".55"/>`; }
      return `<svg viewBox="0 0 120 104"><circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${TR}" stroke-width="6"/>${ticks}${lab}${mk}
        <text x="${cx}" y="${cy + 4}" text-anchor="middle" class="num" style="font-size:12px;font-weight:700">${a == null ? "–" : fmt(a, 0) + "°"}</text></svg>${nm}${sub}`;
    }
    if (g === "needle") {
      const mn = nf(t.min, 0), mx = nf(t.max, 100), p = ok ? clamp((v - mn) / (mx - mn || 1), 0, 1) : 0, cx = 60, cy = 58, R = 44, a0 = 135;
      const ticks = Array.from({ length: 11 }, (_, i) => { const a = a0 + i * 27, big = i % 5 === 0, p1 = pt(cx, cy, R, a), p2 = pt(cx, cy, R - (big ? 9 : 5), a);
        return `<line x1="${p1[0].toFixed(1)}" y1="${p1[1].toFixed(1)}" x2="${p2[0].toFixed(1)}" y2="${p2[1].toFixed(1)}" stroke="#000" stroke-opacity="${big ? 0.6 : 0.35}" stroke-width="${big ? 1.6 : 1}"/>`; }).join("");
      const pl = pt(cx, cy, R + 8, a0), pr = pt(cx, cy, R + 8, a0 + 270), tip = pt(cx, cy, R - 6, a0 + 270 * p), back = pt(cx, cy, 8, a0 + 270 * p + 180);
      return `<svg viewBox="0 0 120 104"><path d="${arc(cx, cy, R + 3, a0, a0 + 270)}" stroke="${TR}" stroke-width="3" fill="none"/>
        ${ok && p > 0 ? `<path d="${arc(cx, cy, R + 3, a0, a0 + 270 * p)}" stroke="${col}" stroke-width="3" fill="none"/>` : ""}${ticks}
        <text x="${pl[0].toFixed(1)}" y="${(pl[1] + 6).toFixed(1)}" text-anchor="middle" style="font-size:8px;opacity:.6">${fmt(mn, 0)}</text>
        <text x="${pr[0].toFixed(1)}" y="${(pr[1] + 6).toFixed(1)}" text-anchor="middle" style="font-size:8px;opacity:.6">${fmt(mx, 0)}</text>
        ${ok ? `<line x1="${back[0].toFixed(1)}" y1="${back[1].toFixed(1)}" x2="${tip[0].toFixed(1)}" y2="${tip[1].toFixed(1)}" stroke="#222" stroke-width="2.4" stroke-linecap="round"/>` : ""}
        <circle cx="${cx}" cy="${cy}" r="4" fill="#222"/>${vtxt(ok ? col : "#9e9e9e")} y="${cy + 30}">${esc(vt.t)}</text>${ut(cy + 41)}</svg>${nm}${sub}`;
    }
    return `<div class="err">Unbekannte Gauge: ${esc(g)}</div>`;
  }
}

/* ===================== sankey ===================== */
class Sankey extends Base {
  static get defaults() {
    return { name: "", hub_name: "", unit: "", decimals: "", height: 220, show_balance: true, balance_tolerance: 3,
      sources: [{ name: "Solar", entity: "", color: "#e0a000" }, { name: "Netz", entity: "", color: "#b22222" }],
      targets: [{ name: "Haus", entity: "", color: "#000080" }, { name: "Speicher", entity: "", color: "#1e6fd9" }] };
  }
  static get css() { return `.sk { padding:6px; } .sk svg { display:block; width:100%; } .sk .bal { text-align:center; font-size:11px; opacity:.7; margin-top:2px; } .sk .bal.warn { color:#b26a00; opacity:1; font-weight:600; }`; }
  render(h) {
    const c = this.c, W = this.W - 14, nMax = Math.max((c.sources || []).length, (c.targets || []).length), H = Math.max(clamp(nf(c.height, 220), 100, 800), nMax * 30 + 24);
    const src = (c.sources || []).filter((x) => x && x.entity), tgt = (c.targets || []).filter((x) => x && x.entity);
    if (!src.length || !tgt.length) return `<div class="inner sk"><div class="ld">Quellen und Verbraucher eintragen</div></div>`;
    const u = unitOf(h, src[0].entity, c.unit), dec = c.decimals === "" || c.decimals == null ? null : Number(c.decimals);
    const bad = [];
    const miss = [];
    const val = (e) => { const v = num(h, e.entity); if (v == null) { miss.push(e.name || e.entity); return null; } const x = conv(v, unitOf(h, e.entity), u); if (x == null) { bad.push(e.name || e.entity); return null; } return Math.max(0, x); };
    const sv = src.map(val), tv = tgt.map(val);
    const sumS = sv.reduce((a, b) => a + (b || 0), 0), sumT = tv.reduce((a, b) => a + (b || 0), 0), tot = Math.max(sumS, sumT, 1e-9);
    const txtW = (arr, vals) => Math.max(...arr.map((e, i) => { const f = fmtU(vals[i], u, dec); return Math.max(String(e.name || e.entity).length * 7, (f.t.length + f.u.length + 9) * 6); })) + 10;
    const nodeW = 10, gap = 8, wl = clamp(txtW(src, sv), 50, W * 0.3), wr = clamp(txtW(tgt, tv), 50, W * 0.3), x0 = wl, x1 = W - wr - nodeW, xm = (x0 + x1) / 2;
    const hub = !!(c.hub_name && String(c.hub_name).trim());
    const avail = (n) => H - 24 - gap * (n - 1);
    const scale = Math.max(0, Math.min(avail(src.length), avail(tgt.length))) / tot;
    const col = (e, i) => e.color || DEF[i % DEF.length];
    /* jeder Knoten bekommt mindestens Platz fuer seine zwei Textzeilen; reicht die Hoehe nicht, waechst das Bild */
    let yEnd = 0;
    const stack = (vals) => { let y = 12; let pc = -1e9; const out = vals.map((v) => { const hh = Math.max(2, (v || 0) * scale); y = Math.max(y, pc + 28 - hh / 2); const r = { y, h: hh }; pc = y + hh / 2; y += hh + gap; return r; }); yEnd = Math.max(yEnd, y); return out; };
    const Ls = stack(sv), Lt = stack(tv), HV = Math.max(H, yEnd + 4);
    const band = (xa, ya, xb, yb, w, color, k) => {
      if (w < 0.6) return "";
      const mx = (xa + xb) / 2, d = `M${xa.toFixed(1)},${ya.toFixed(1)} C${mx.toFixed(1)},${ya.toFixed(1)} ${mx.toFixed(1)},${yb.toFixed(1)} ${xb.toFixed(1)},${yb.toFixed(1)}`;
      return `<path d="${d}" stroke="${color}" stroke-opacity=".38" stroke-width="${w.toFixed(1)}" fill="none"/>
        <path class="shim" d="${d}" stroke="#fff" stroke-opacity=".45" stroke-width="${clamp(w * 0.25, 1, 4).toFixed(1)}" fill="none" stroke-linecap="round" stroke-dasharray="14 34" style="--d:${(1.6 + (k % 4) * 0.25).toFixed(2)}s"/>`;
    };
    let bands = "";
    if (hub) {
      const hubH = tot * scale, hubY = Math.max(16, (HV - hubH) / 2);   // Platz fuer die Beschriftung darueber
      let ys = hubY;
      src.forEach((e, i) => { const w = (sv[i] || 0) * scale; bands += band(x0 + nodeW, Ls[i].y + w / 2, xm, ys + w / 2, w, col(e, i), i); ys += w; });
      let yt = hubY;
      tgt.forEach((e, i) => { const w = (tv[i] || 0) * scale; bands += band(xm + nodeW, yt + w / 2, x1, Lt[i].y + w / 2, w, col(e, i), i + 3); yt += w; });
      bands += `<rect x="${xm}" y="${hubY.toFixed(1)}" width="${nodeW}" height="${Math.max(2, hubH).toFixed(1)}" rx="3" fill="#000080" fill-opacity=".7"/>
        <text x="${(xm + nodeW / 2).toFixed(1)}" y="${(hubY - 4).toFixed(1)}" text-anchor="middle" style="font-size:11px;font-weight:600">${esc(c.hub_name)}</text>`;
    } else {
      /* ohne Knoten: jede Quelle anteilig auf alle Verbraucher */
      const off = tgt.map(() => 0), so = src.map(() => 0);
      src.forEach((e, i) => tgt.forEach((t, j) => {
        const f = ((sv[i] || 0) * (tv[j] || 0)) / tot, w = f * scale;
        bands += band(x0 + nodeW, Ls[i].y + so[i] + w / 2, x1, Lt[j].y + off[j] + w / 2, w, col(e, i), i + j);
        so[i] += w; off[j] += w;
      }));
    }
    const node = (x, L, e, i, v, right) => {
      const f = fmtU(v, u, dec), pc = v == null ? "" : ` · ${fmt((v / tot) * 100, 0)} %`;
      const tx = right ? x + nodeW + 6 : x - 6, an = right ? "start" : "end", cy = L.y + L.h / 2, nm = cut(e.name || e.entity, Math.floor(((right ? wr : wl) - 10) / 7));
      return `<g data-ent="${esc(e.entity)}" class="ent"><rect x="${x}" y="${L.y.toFixed(1)}" width="${nodeW}" height="${L.h.toFixed(1)}" rx="3" fill="${col(e, i)}"/>
        <text x="${tx}" y="${(cy - 2).toFixed(1)}" text-anchor="${an}" style="font-size:12px;font-weight:600"><title>${esc(e.name || e.entity)}</title>${esc(nm)}</text>
        <text x="${tx}" y="${(cy + 11).toFixed(1)}" text-anchor="${an}" class="num" style="font-size:11px;opacity:.75">${esc(f.t)} ${esc(f.u)}${pc}</text></g>`;
    };
    /* Bilanz: Summen beider Seiten, Differenz ab balance_tolerance % hervorgehoben */
    const fs = fmtU(sumS, u, dec), ft = fmtU(sumT, u, dec), fd = fmtU(Math.abs(sumS - sumT), u, dec), diff = Math.abs(sumS - sumT) > (tot * nf(c.balance_tolerance, 3)) / 100;
    const bal = `<div class="bal${diff || bad.length || miss.length ? " warn" : ""}">${miss.length ? `unvollständig, fehlt: ${esc(miss.join(", "))} · ` : ""}Quellen ${esc(fs.t)} ${esc(fs.u)} · Verbraucher ${esc(ft.t)} ${esc(ft.u)}${diff ? ` · ${sumS > sumT ? "nicht zugeordnet" : "Quelle fehlt"} ${esc(fd.t)} ${esc(fd.u)}` : ""}${bad.length ? ` · Einheit passt nicht: ${esc(bad.join(", "))}` : ""}</div>`;
    const nodes = src.map((e, i) => node(x0, Ls[i], e, i, sv[i], false)).join("") + tgt.map((e, i) => node(x1, Lt[i], e, i, tv[i], true)).join("");
    return `<div class="inner sk">${c.name ? `<div class="title">${esc(c.name)}</div>` : ""}<svg viewBox="0 0 ${W} ${HV}" height="${HV}">${bands}${nodes}</svg>${c.show_balance === false && !bad.length && !miss.length ? "" : bal}</div>`;
  }
}

/* ===================== flow-grid ===================== */
const POS = [["tl", "oben links"], ["tc", "oben Mitte"], ["tr", "oben rechts"], ["ml", "Mitte links"], ["c", "Mitte"], ["mr", "Mitte rechts"],
  ["bl", "unten links"], ["bc", "unten Mitte"], ["br", "unten rechts"]];
const PXY = { tl: [0, 0], tc: [1, 0], tr: [2, 0], ml: [0, 1], c: [1, 1], mr: [2, 1], bl: [0, 2], bc: [1, 2], br: [2, 2] };
class FlowGrid extends Base {
  static get defaults() {
    return { name: "", height: 300, max: 5000, invert_all: false, link_values: true,
      nodes: [{ id: "pv", name: "Solar", icon: "mdi:solar-power", entity: "", pos: "tl", color: "#e0a000" },
        { id: "haus", name: "Haus", icon: "mdi:home", entity: "", pos: "c", color: "#000080" },
        { id: "netz", name: "Netz", icon: "mdi:transmission-tower", entity: "", pos: "tr", color: "#b22222" }],
      links: [{ from: "pv", to: "haus", entity: "", color: "#e0a000", invert: false }, { from: "netz", to: "haus", entity: "", color: "#b22222", invert: false }] };
  }
  static get css() {
    return `
    .fg { position:relative; padding:0; }
    .fg svg { position:absolute; inset:0; width:100%; height:100%; }
    .nd { position:absolute; transform:translate(-50%,-50%); width:var(--nd,84px); min-height:0; padding:6px 4px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;
      background: rgba(255,255,255,calc(var(--ea-kachel,0.1) + 0.25)); border:2px solid var(--nc,#000080); border-radius:50%; box-sizing:border-box; aspect-ratio:1; }
    .nd ha-icon { --mdc-icon-size:22px; color:var(--nc,#000080); }
    .nd .n { font-size:10px; opacity:.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:calc(var(--nd,84px) - 8px); }
    .nd .v { font-size:12px; font-weight:700; white-space:nowrap; }
    `;
  }
  render(h) {
    const c = this.c, W = this.W, H = clamp(nf(c.height, 300), 160, 900), mx = Math.max(1, nf(c.max, 5000));
    const nodes = (c.nodes || []).filter((n) => n && n.id), byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    /* Knotengroesse folgt der Kartengroesse; Mittelpunkte mit festem Randabstand, damit kein Kreis abgeschnitten wird */
    const R = clamp(Math.min(W / 8, (H - 20) / 6), 20, 42), pad = R + 6; /* 3 Reihen passen ohne Ueberlappung uebereinander */
    const xy = (n) => { const p = PXY[n.pos] || PXY.c; return [pad + ((W - 2 * pad) * p[0]) / 2, pad + ((H - 2 * pad) * p[1]) / 2]; };
    let svg = "";
    (c.links || []).forEach((l, i) => {
      const a = byId[l.from], b = byId[l.to];
      if (!a || !b) return;
      let v = num(h, l.entity);
      const roh = v;   // Beschriftung zeigt den echten Sensorwert, invert dreht nur die Laufrichtung
      /* invert_all dreht alle Verbindungen; invert je Verbindung dreht sie (nochmals) - beides gesetzt = wieder normal */
      if (v != null && !!l.invert !== !!c.invert_all) v = -v;
      const [ax, ay] = xy(a), [bx, by] = xy(b), dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1;
      const sx = ax + (dx / d) * R, sy = ay + (dy / d) * R, ex = bx - (dx / d) * R, ey = by - (dy / d) * R;
      const color = l.color || DEF[i % DEF.length], lmax = nf(l.max, mx);
      const sp = v == null ? 0 : speed(v / lmax), path = `M${sx.toFixed(1)},${sy.toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)}`;
      svg += `<path d="${path}" stroke="${color}" stroke-opacity=".22" stroke-width="4" fill="none" stroke-linecap="round"/>`;
      if (sp) svg += `<path class="fl${v < 0 ? " r" : ""}" d="${path}" stroke="${color}" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="0.1 11.9" style="--d:${sp}s"/>`;
      if (l.entity && c.link_values !== false && !l.hide_value) { const f = fmtU(roh, unitOf(h, l.entity, l.unit), null), mxp = (sx + ex) / 2, myp = (sy + ey) / 2;
        svg += `<g data-ent="${esc(l.entity)}" class="ent"><rect x="${(mxp - 30).toFixed(1)}" y="${(myp - 9).toFixed(1)}" width="60" height="16" rx="8" fill="#fff" fill-opacity=".7"/>
          <text x="${mxp.toFixed(1)}" y="${(myp + 3).toFixed(1)}" text-anchor="middle" class="num" style="font-size:10px;font-weight:600;fill:${v == null ? "#9e9e9e" : color}">${esc(f.t)} ${esc(f.u)}</text></g>`; }
    });
    const nd = nodes.map((n, i) => {
      const nv = n.invert ? num(h, n.entity) : null;   // Vorzeichen umdrehen: nur bei Zahlen, Zustandstexte bleiben
      const [x, y] = xy(n), f = !n.entity ? null : nv != null ? fmtU(-nv, unitOf(h, n.entity, n.unit), null) : fmtEnt(h, n.entity, n.unit, null);
      return `<div class="nd"${n.entity ? ` data-ent="${esc(n.entity)}"` : ""} style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;--nd:${Math.round(2 * R)}px;--nc:${n.color || DEF[i % DEF.length]};cursor:${n.entity ? "pointer" : "default"}">
        <ha-icon icon="${esc(n.icon || "mdi:circle-outline")}"></ha-icon><div class="n">${esc(n.name || n.id)}</div>${f ? `<div class="v num">${esc(f.t)} ${esc(f.u)}</div>` : ""}</div>`;
    }).join("");
    return `${c.name ? `<div class="title">${esc(c.name)}</div>` : ""}<div class="inner fg" style="height:${H}px"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${svg}</svg>${nd}</div>`;
  }
}

/* ===================== stacked-area ===================== */
class Stacked extends Base {
  static get defaults() {
    return { name: "", hours: 24, height: 160, unit: "", decimals: "",
      series: [{ name: "A", entity: "", color: "#e0a000" }, { name: "B", entity: "", color: "#1e6fd9" }] };
  }
  static get throttle() { return 5000; }
  static get css() {
    return `
    .sa { padding:8px 8px 6px; position:relative; }
    .sa .hd { display:flex; justify-content:space-between; align-items:baseline; font-size:14px; font-weight:600; margin-bottom:4px; }
    .sa .hd span { font-size:12px; font-weight:400; opacity:.7; }
    .sa svg { display:block; width:100%; }
    .lg { display:flex; justify-content:center; gap:14px; flex-wrap:wrap; font-size:12px; margin-top:6px; }
    .lg i { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:5px; }
    .tt { position:absolute; pointer-events:none; background:rgba(255,255,255,.92); border:1px solid rgba(0,0,0,.15); border-radius:8px; padding:5px 8px; font-size:11px;
      white-space:nowrap; box-shadow:0 2px 6px rgba(0,0,0,.15); display:none; z-index:2; }
    .tt b { display:block; margin-bottom:2px; } .tt i { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:4px; }
    .sx { position:absolute; top:28px; bottom:30px; width:1px; background:rgba(0,0,0,.4); pointer-events:none; display:none; }
    `;
  }
  async fetch() {
    if (this._loading || !this.h) return;
    this._loading = true;
    try {
      const c = this.c, ser = (c.series || []).filter((s) => s && s.entity), ids = [...new Set(ser.map((s) => s.entity))];
      const hrs = clamp(nf(c.hours, 24), 1, 24 * 14), t1 = Date.now(), t0 = t1 - hrs * 3600e3, step = 5 * 60e3;
      /* HA rechnet die Statistik gleich in die Einheit der ersten Reihe um (W/kW bzw. Wh/kWh) */
      const u0 = unitOf(this.h, ser[0] && ser[0].entity, c.unit), fam = UF[String(u0).toLowerCase()], units = fam ? { [fam[0] === "P" ? "power" : "energy"]: u0 } : undefined;
      const res = ids.length ? await this.h.callWS({ type: "recorder/statistics_during_period", start_time: new Date(t0).toISOString(),
        end_time: new Date(t1).toISOString(), statistic_ids: ids, period: "5minute", types: ["mean", "change"], ...(units ? { units } : {}) }) : {};
      const n = Math.floor((t1 - t0) / step), t0r = Math.floor(t0 / step) * step;
      const grid = ser.map((s) => { const arr = new Array(n).fill(null);
        for (const r of (res[s.entity] || [])) { const k = Math.floor((r.start - t0r) / step); const v = r.mean != null ? r.mean : r.change; /* Leistung: Mittelwert; Zaehler: Verbrauch je 5 Min - nie der Zaehlerstand */ if (k >= 0 && k < n && v != null) arr[k] = v; }
        return arr; });
      this.data = { t0: t0r, step, n, grid, at: Date.now() };
      this.err = null;
    } catch (e) { this.err = e.message || String(e); this._errAt = Date.now(); }
    this._loading = false;
    if (this._gone) return;   // Board inzwischen verlassen: nicht mehr zeichnen
    this._sig = null; this._draw();
  }
  render(h) {
    const c = this.c;
    if ((!this.data && (!this._errAt || Date.now() - this._errAt > 60e3)) || (this.data && Date.now() - this.data.at > 5 * 60e3)) this.fetch();
    if (this.err) return `<div class="inner sa"><div class="err">${esc(this.err)}</div></div>`;
    if (!this.data) return `<div class="inner sa"><div class="ld">Lade Verlauf…</div></div>`;
    const ser = (c.series || []).filter((s) => s && s.entity), d = this.data, W = this.W - 16, H = clamp(nf(c.height, 160), 60, 600);
    const u = unitOf(h, ser[0] && ser[0].entity, c.unit), dec = c.decimals === "" || c.decimals == null ? null : Number(c.decimals);
    /* kumulieren; fehlt eine Reihe in einem Abschnitt, bleibt der ganze Abschnitt eine Luecke */
    const cum = [], tot = new Array(d.n).fill(null), us = ser.map((s) => unitOf(h, s.entity)), bi = us.map((x) => conv(1, x, u) == null), badU = ser.filter((s, i) => bi[i]).map((s) => s.name || s.entity);
    for (let k = 0; k < d.n; k++) {
      let ok = true, acc = 0; const col = [];
      for (let i = 0; i < ser.length; i++) { const v = bi[i] ? null : d.grid[i][k]; if (v == null) { ok = false; break; } acc += Math.max(0, v); col.push(acc); }
      cum.push(ok ? col : null); if (ok) tot[k] = acc;
    }
    const maxV = Math.max(1e-9, ...tot.filter((x) => x != null));
    const X = (k) => (k / Math.max(1, d.n - 1)) * W, Y = (v) => H - (v / maxV) * (H - 6);
    let areas = "";
    for (let i = ser.length - 1; i >= 0; i--) {
      let path = "", seg = [];
      const flush = () => { if (seg.length > 1) { const top = seg.map(([k]) => `${X(k).toFixed(1)},${Y(cum[k][i]).toFixed(1)}`), bot = seg.slice().reverse().map(([k]) => `${X(k).toFixed(1)},${Y(i ? cum[k][i - 1] : 0).toFixed(1)}`);
        path += `M${top.join("L")}L${bot.join("L")}Z`; } seg = []; };
      for (let k = 0; k < d.n; k++) { if (cum[k]) seg.push([k]); else flush(); }
      flush();
      areas += `<path d="${path}" fill="${ser[i].color || DEF[i % DEF.length]}" fill-opacity=".55" stroke="${ser[i].color || DEF[i % DEF.length]}" stroke-width="1"/>`;
    }
    let line = "", run = [];
    const fl = () => { if (run.length > 1) line += `M${run.join("L")}`; run = []; };
    for (let k = 0; k < d.n; k++) { if (tot[k] != null) run.push(`${X(k).toFixed(1)},${Y(tot[k]).toFixed(1)}`); else fl(); }
    fl();
    const last = [...tot].reverse().find((x) => x != null), lf = fmtU(last, u, dec), mf = fmtU(maxV, u, dec);
    const hrs = nf(c.hours, 24);
    this._view = { ser, d, cum, tot, W, u, dec, X, us };
    return `<div class="inner sa"><div class="hd">${esc(c.name || "")}<span>${badU.length ? `<b style="color:#b26a00">Einheit passt nicht: ${esc(badU.join(", "))}</b> · ` : ""}jetzt ${esc(lf.t)} ${esc(lf.u)} · max ${esc(mf.t)} ${esc(mf.u)} · ${hrs} h</span></div>
      <svg viewBox="0 0 ${W} ${H}" height="${H}">${areas}<path d="${line}" stroke="#000" stroke-width="1.6" fill="none"/></svg>
      <div class="lg">${ser.map((s, i) => `<span class="ent" data-ent="${esc(s.entity)}"><i style="background:${s.color || DEF[i % DEF.length]}"></i>${esc(s.name || s.entity)}</span>`).join("")}<span><i style="background:#000"></i>Summe</span></div>
      <div class="sx"></div><div class="tt"></div></div>`;
  }
  after() {
    const svg = this.sr.querySelector(".sa svg"), tt = this.sr.querySelector(".tt"), sx = this.sr.querySelector(".sx"), wrap = this.sr.querySelector(".sa");
    if (!svg || !this._view) return;
    const hide = () => { tt.style.display = "none"; sx.style.display = "none"; lastK = -1; };
    svg.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") hide(); });
    /* Handy: kein mouseleave - Tooltip nach dem Tippen von selbst wieder ausblenden */
    let tHide = null;
    svg.addEventListener("pointerup", (ev) => { if (ev.pointerType !== "mouse") { clearTimeout(tHide); tHide = setTimeout(hide, 3000); } });
    let lastK = -1;
    const mv = (ev) => {
      const v = this._view, r = svg.getBoundingClientRect(), fx = (ev.clientX - r.left) / r.width, k = clamp(Math.round(fx * (v.d.n - 1)), 0, v.d.n - 1);
      const wr = wrap.getBoundingClientRect(), x = ev.clientX - wr.left;
      sx.style.display = "block"; sx.style.left = `${x}px`;
      if (k === lastK) return;
      lastK = k;
      const t = new Date(v.d.t0 + k * v.d.step);
      const rows = v.ser.map((s, i) => { const g = v.d.grid[i][k], f = fmtU(g == null ? null : Math.max(0, g), v.u, v.dec); return `<div><i style="background:${s.color || DEF[i % DEF.length]}"></i>${esc(s.name || s.entity)}: ${esc(f.t)} ${esc(f.u)}</div>`; }).join("");
      const tf = fmtU(v.tot[k], v.u, v.dec);
      tt.innerHTML = `<b>${t.toLocaleString("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</b>${rows}<div style="margin-top:2px;font-weight:700">Summe: ${v.tot[k] == null ? "Lücke" : `${esc(tf.t)} ${esc(tf.u)}`}</div>`;
      tt.style.display = "block";
      const tw = tt.offsetWidth, L = x > wr.width / 2 ? x - tw - 10 : x + 10;
      tt.style.left = `${clamp(L, 4, Math.max(4, wr.width - tw - 4))}px`; tt.style.top = `${((wrap.querySelector(".hd") || {}).offsetHeight || 22) + 10}px`;
    };
    /* Pointer-Events: Maus, Stift und Finger gleich behandeln */
    svg.style.touchAction = "pan-y";   // senkrechtes Wischen scrollt die Seite weiter, waagerecht zeigt den Tooltip
    svg.addEventListener("pointermove", mv);
    svg.addEventListener("pointerdown", mv);
  }
}

/* ===================== hydronic-flow ===================== */
class Hydronic extends Base {
  static get defaults() {
    return { name: "", generator_name: "Therme", generator_icon: "mdi:water-boiler", generator_entity: "",
      consumer_name: "Heizkörper", consumer_icon: "mdi:radiator", consumer_entity: "",
      supply_temp: "", return_temp: "", supply_entity: "", return_entity: "", buffer_name: "Puffer", buffer_entity: "", pump_entity: "",
      supply_color: "#e53935", return_color: "#1e88e5", height: 200 };
  }
  static get css() {
    return `
    .hy { padding:6px; position:relative; }
    .hy svg { display:block; width:100%; }
    .imp { transform-box: fill-box; transform-origin: center; animation: spin 1.1s linear infinite; }
    `;
  }
  render(h) {
    const c = this.c, W = this.W - 14, H = clamp(nf(c.height, 200), 140, 500);
    const pumpS = c.pump_entity ? (S(h, c.pump_entity) || {}).state : null, pumpBad = !!c.pump_entity && (pumpS == null || BAD.includes(String(pumpS).toLowerCase())), run = c.pump_entity ? !pumpBad && pumpOn(pumpS) : true;
    const tS = num(h, c.supply_temp), tR = num(h, c.return_temp), sC = c.supply_color || "#e53935", rC = c.return_color || "#1e88e5";
    const bx = 14, bw = clamp(W * 0.2, 56, 140), bh = H * 0.62, by = (H - bh) / 2, cx2 = W - 14 - bw;
    const ySup = by + bh * 0.22, yRet = by + bh * 0.78, x0 = bx + bw, x1 = cx2;
    const box = (x, nm, icon, ent, col) => {
      const v = ent ? fmtEnt(h, ent, "", null) : null;
      return `<g${ent ? ` data-ent="${esc(ent)}" class="ent"` : ""}><rect x="${x}" y="${by}" width="${bw}" height="${bh}" rx="12" fill="#fff" fill-opacity=".35" stroke="${col}" stroke-opacity=".5"/>
        <foreignObject x="${x}" y="${by + bh * 0.18}" width="${bw}" height="34"><div xmlns="http://www.w3.org/1999/xhtml" style="text-align:center"><ha-icon icon="${esc(icon)}" style="--mdc-icon-size:28px;color:${col}"></ha-icon></div></foreignObject>
        <text x="${x + bw / 2}" y="${by + bh * 0.62}" text-anchor="middle" style="font-size:12px;font-weight:600">${esc(nm)}</text>
        ${v ? `<text x="${x + bw / 2}" y="${by + bh * 0.62 + 15}" text-anchor="middle" class="num" style="font-size:11px;opacity:.75">${esc(v.t)} ${esc(v.u)}</text>` : ""}</g>`;
    };
    const pipe = (xa, xb, y, col, dirRight) => `<path d="M${xa},${y} L${xb},${y}" stroke="${col}" stroke-width="8" stroke-opacity=".3" stroke-linecap="round" fill="none"/>
      ${run ? `<path class="fl" d="M${xa},${y} L${xb},${y}" stroke="${col}" stroke-width="4" stroke-linecap="round" fill="none" stroke-dasharray="6 6" style="--d:1.6s"/>` : ""}`;
    const badge = (x, y, t, col, extraEnt, ent) => {
      const f = fmtU(t, "°C", 1), ex = extraEnt ? fmtEnt(h, extraEnt, "", null) : null;
      const txt = `${f.t} °C${ex ? ` · ${ex.t} ${ex.u}` : ""}`, w = 10 + txt.length * 6.2;
      return `<g${ent ? ` data-ent="${esc(ent)}" class="ent"` : ""}><rect x="${(x - w / 2).toFixed(1)}" y="${y - 22}" width="${w.toFixed(1)}" height="17" rx="8.5" fill="${col}"/>
        <text x="${x}" y="${y - 10}" text-anchor="middle" class="num" style="font-size:11px;font-weight:700;fill:#fff">${esc(txt)}</text></g>`;
    };
    let mid = "", xa = x0, xb = x1;
    const hasBuf = !!c.buffer_entity;
    if (hasBuf) {
      const pw = clamp(W * 0.1, 30, 80), px = (x0 + x1) / 2 - pw / 2, py = ySup - 14, ph = yRet - ySup + 28, bt = num(h, c.buffer_entity);
      mid += `<g data-ent="${esc(c.buffer_entity)}" class="ent"><defs><linearGradient id="${this._gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sC}" stop-opacity=".55"/><stop offset="1" stop-color="${rC}" stop-opacity=".55"/></linearGradient></defs>
        <rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="${pw / 2}" fill="url(#${this._gid})" stroke="#000" stroke-opacity=".25"/>
        <text x="${px + pw / 2}" y="${py + ph / 2 - 2}" text-anchor="middle" style="font-size:10px;font-weight:600">${esc(c.buffer_name || "Puffer")}</text>
        <text x="${px + pw / 2}" y="${py + ph / 2 + 11}" text-anchor="middle" class="num" style="font-size:11px;font-weight:700">${bt == null ? "–" : fmt(bt, 1) + " °C"}</text></g>`;
      mid = pipe(x0, px, ySup, sC, true) + pipe(px + pw, x1, ySup, sC, true) + pipe(x1, px + pw, yRet, rC, false) + pipe(px, x0, yRet, rC, false) + mid;
      xa = px; xb = px + pw;
    } else mid = pipe(x0, x1, ySup, sC, true) + pipe(x1, x0, yRet, rC, false);
    const pr = clamp(W / 30, 9, 13), pX = hasBuf ? (x1 + xb) / 2 : (x0 + x1) / 2 + (x1 - x0) * 0.22;
    const pump = `<g${c.pump_entity ? ` data-ent="${esc(c.pump_entity)}" class="ent"` : ""}><circle cx="${pX}" cy="${yRet}" r="${pr}" fill="#fff" stroke="${rC}" stroke-width="2"/>
      <g class="${run ? "imp" : ""}">${[0, 120, 240].map((a) => { const p = pt(pX, yRet, pr - 3, a); return `<path d="M${pX},${yRet} Q${P2(pt(pX, yRet, pr - 4, a - 35))} ${P2(p)}" stroke="${rC}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`; }).join("")}</g>
      <text x="${pX}" y="${yRet + pr + 13}" text-anchor="middle" style="font-size:10px;opacity:.7">Pumpe ${c.pump_entity ? (pumpBad ? "?" : run ? "läuft" : "aus") : ""}</text></g>`;
    const sX = hasBuf ? (x0 + xa) / 2 : (x0 + x1) / 2, rX = hasBuf ? (x0 + xa) / 2 : (x0 + x1) / 2 - (x1 - x0) * 0.18;
    const spread = !hasBuf && (c.supply_temp || c.return_temp) ? `<text x="${(x0 + x1) / 2}" y="${(ySup + yRet) / 2 + 4}" text-anchor="middle" class="num" style="font-size:11px;opacity:.65">Spreizung ${tS != null && tR != null ? fmt(tS - tR, 1) : "–"} K</text>` : "";
    return `<div class="inner hy">${c.name ? `<div class="title">${esc(c.name)}</div>` : ""}<svg viewBox="0 0 ${W} ${H}" height="${H}">
      ${mid}${box(bx, c.generator_name, c.generator_icon || "mdi:water-boiler", c.generator_entity, sC)}${box(cx2, c.consumer_name, c.consumer_icon || "mdi:radiator", c.consumer_entity, rC)}
      ${badge(sX, ySup, tS, sC, c.supply_entity, c.supply_temp)}${badge(rX, yRet + 30, tR, rC, c.return_entity, c.return_temp)}${pump}${spread}</svg></div>`;
  }
}

/* ===================== tree-flow ===================== */
class Tree extends Base {
  static get defaults() {
    return { name: "", max: 3000, warn_above: "", unit: "",
      root: { name: "Hausanschluss", icon: "mdi:home-lightning-bolt", entity: "", status: "" },
      branches: [{ name: "Zweig 1", icon: "mdi:power-socket-de", entity: "", status: "", warn_above: "", leaves: [] }] };
  }
  static get css() {
    return `
    .tr { position:relative; }
    .tr svg { position:absolute; inset:0; width:100%; height:100%; }
    .tn2 { position:absolute; transform:translateY(-50%); display:flex; align-items:center; gap:6px; padding:5px 8px; min-width:0; box-sizing:border-box;
      background: rgba(255,255,255,calc(var(--ea-kachel,0.1) + 0.25)); border:1px solid rgba(0,0,0,.12); border-radius:10px; }
    .tn2 ha-icon { --mdc-icon-size:20px; color:#000080; flex:none; }
    .tn2 .t { min-width:0; } .tn2 .n { font-size:11px; opacity:.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .tn2 .v { font-size:12px; font-weight:700; white-space:nowrap; }
    .tn2 .d { width:8px; height:8px; border-radius:50%; flex:none; margin-left:auto; }
    `;
  }
  render(h) {
    const c = this.c, W = this.W, mx = Math.max(1, nf(c.max, 3000)), rt = c.root || {};
    const br = (c.branches || []).filter((b) => b), leafCount = br.reduce((a, b) => a + Math.max(1, (b.leaves || []).length), 0);
    const three = br.some((b) => (b.leaves || []).length), rowH = 46, H = Math.max(rowH * 2, (three ? leafCount : br.length) * rowH + 12);
    const cols = three ? 3 : 2, cw = W / cols, nw = Math.min(170, cw - 26);
    const xs = [8, cw + 8, 2 * cw + 8];
    const val = (n) => num(h, n.entity);
    const stCol = (n) => { if (!n.status) return null; const s = S(h, n.status); if (!s || BAD.includes(String(s.state).toLowerCase())) return "#9e9e9e"; return isOn(s.state) ? "#43a047" : "#db4437"; };
    const nodeHtml = (n, x, y) => {
      const f = n.entity ? fmtEnt(h, n.entity, c.unit, null) : { t: "", u: "" }, sc = stCol(n);
      return `<div class="tn2"${n.entity ? ` data-ent="${esc(n.entity)}"` : ""} style="cursor:${n.entity ? "pointer" : "default"};left:${x}px;top:${y}px;width:${nw}px">
        <ha-icon icon="${esc(n.icon || "mdi:circle-medium")}"></ha-icon><div class="t"><div class="n">${esc(n.name || n.entity || "")}</div>${f.t ? `<div class="v num">${esc(f.t)} ${esc(f.u)}</div>` : ""}</div>
        ${sc ? `<i class="d" style="background:${sc}" title="${esc(n.status)}"></i>` : ""}</div>`;
    };
    const link = (x1, y1, x2, y2, n) => {
      const v = val(n), warn = nf(n.warn_above, nf(c.warn_above, null)), w = v == null ? 1.5 : 1.5 + clamp(Math.abs(v) / mx, 0, 1) * 9;
      const col = v == null ? "#9e9e9e" : warn != null && Math.abs(v) > warn ? "#db4437" : warn != null && Math.abs(v) > warn * 0.8 ? "#ffa600" : "#000080";
      const mxp = (x1 + x2) / 2;
      return `<path d="M${x1},${y1} C${mxp},${y1} ${mxp},${y2} ${x2},${y2}" stroke="${col}" stroke-opacity=".55" stroke-width="${w.toFixed(1)}" fill="none" stroke-linecap="round"/>`;
    };
    let y = 6, nodes = "", lines = "";
    const by = [];
    br.forEach((b) => {
      const n = three ? Math.max(1, (b.leaves || []).length) : 1, top = y; y += n * rowH;
      const cy = (top + y) / 2; by.push(cy);
      nodes += nodeHtml(b, xs[1], cy);
      (b.leaves || []).forEach((l, j) => { const ly = top + rowH * (j + 0.5); nodes += nodeHtml(l, xs[2], ly); lines += link(xs[1] + nw, cy, xs[2], ly, l); });
    });
    const ry = H / 2;
    nodes = nodeHtml(rt, xs[0], ry) + nodes;
    br.forEach((b, i) => { lines += link(xs[0] + nw, ry, xs[1], by[i], b); });
    return `${c.name ? `<div class="title">${esc(c.name)}</div>` : ""}<div class="inner tr" style="height:${H}px"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${lines}</svg>${nodes}</div>`;
  }
}

/* ======================= Editor ======================= */
const f = (name, label, selector) => ({ name, label, selector });
const ENT = { entity: {} }, TXT = { text: {} }, ICON = { icon: {} }, BOOL = { boolean: {} }, COLOR = { text: { type: "color" } };
const ANY = { number: { mode: "box", step: "any" } }, NUM = (min, max) => ({ number: { min, max, step: 1, mode: "box" } });
const SEL = (opts) => ({ select: { mode: "dropdown", options: opts.map(([value, label]) => ({ value, label })) } });
const TAP = SEL([["more-info", "Details öffnen"], ["toggle", "Umschalten"], ["none", "nichts"]]);
const TILE_F = [f("name", "Name", TXT), f("icon", "Icon", ICON), f("entity", "Entität", ENT), f("invert", "Vorzeichen umdrehen", BOOL), f("gauge", "Gauge-Art", SEL(GAUGES)),
  f("min", "Minimum (Nullpunkt-Gauges: negativ, z.B. -5000)", ANY), f("max", "Maximum", ANY), f("decimals", "Nachkommastellen (leer = automatisch)", NUM(0, 6)),
  f("unit", "Einheit (leer = von der Entität)", TXT), f("color", "Farbe", COLOR), f("neg_color", "Farbe negativ (Nullpunkt-Gauges)", COLOR),
  f("steps", "LED-Segmente (Standard 12)", NUM(2, 60)),
  f("entity2", "Doppel-Ring: zweite Entität (innen)", ENT), f("min2", "Doppel-Ring: Minimum innen", ANY), f("max2", "Doppel-Ring: Maximum innen", ANY), f("color2", "Doppel-Ring: Farbe innen", COLOR), f("unit2", "Doppel-Ring: Einheit innen (leer = von der Entität)", TXT), f("invert2", "Doppel-Ring: Vorzeichen innen umdrehen", BOOL),
  f("sub_entity", "Zweitwert klein darunter", ENT), f("sub_unit", "Zweitwert: Einheit (leer = von der Entität)", TXT), f("sub_decimals", "Zweitwert: Nachkommastellen", NUM(0, 6)), f("sub_invert", "Zweitwert: Vorzeichen umdrehen", BOOL), f("tap_action", "Klick auf die Kachel", TAP),
  f("state_colors", "Zustandsfarben (z.B. on=#22c55e, off=#64748b, läuft=#22c55e)", TXT),
  f("show_if", "Nur zeigen wenn (z.B. > 0, != off, == on; leer = immer)", TXT), f("deckkraft", "Deckkraft dieser Kachel (%)", NUM(0, 100))];
const NODE_F = [f("name", "Name", TXT), f("entity", "Entität (Wert)", ENT), f("color", "Farbe", COLOR)];
const ED = {
  "allround-kacheln": { label: "Allrounder: Kacheln mit Gauges", base: [f("columns", "Kacheln pro Zeile", NUM(1, 8))],
    blank: () => ({ type: "allround-kacheln", columns: 3, tiles: [] }),
    lists: [{ key: "tiles", title: "Kacheln", add: "Kachel hinzufügen", fields: TILE_F,
      toForm: (r) => ({ gauge: "none", tap_action: "more-info", ...r }),
      mk: () => ({ name: "Neu", icon: "mdi:information-outline", entity: "", gauge: "none", tap_action: "more-info" }) }] },
  sankey: { label: "Allrounder: Sankey-Fluss", base: [f("name", "Titel", TXT), f("hub_name", "Zwischenknoten (leer = direkt Quelle → Verbraucher)", TXT),
    f("height", "Höhe (px)", NUM(100, 800)), f("unit", "Einheit (leer = von der Entität)", TXT), f("decimals", "Nachkommastellen", NUM(0, 4)),
    f("show_balance", "Bilanzzeile anzeigen (Summen + Differenz)", BOOL), f("balance_tolerance", "Differenz hervorheben ab (%)", NUM(0, 50))],
    blank: () => ({ type: "sankey", ...clone(Sankey.defaults), name: "Energiefluss", hub_name: "Hausnetz" }),
    lists: [{ key: "sources", title: "Quellen (links)", add: "Quelle hinzufügen", fields: NODE_F, mk: () => ({ name: "", entity: "", color: "#e0a000" }) },
      { key: "targets", title: "Verbraucher (rechts)", add: "Verbraucher hinzufügen", fields: NODE_F, mk: () => ({ name: "", entity: "", color: "#000080" }) }] },
  "flow-grid": { label: "Allrounder: Fluss-Raster", base: [f("name", "Titel", TXT), f("height", "Höhe (px)", NUM(160, 900)), f("max", "Volle Geschwindigkeit ab (Wert, Standard 5000)", ANY),
    f("invert_all", "Alle Laufrichtungen umdrehen (Sensoren mit umgekehrtem Vorzeichen)", BOOL),
    f("link_values", "Werte auf den Linien anzeigen", BOOL)],
    blank: () => ({ type: "flow-grid", ...clone(FlowGrid.defaults) }),
    lists: [{ key: "nodes", title: "Knoten", add: "Knoten hinzufügen",
      fields: [f("id", "Kürzel (für Verbindungen, z.B. pv)", TXT), f("name", "Name", TXT), f("icon", "Icon", ICON), f("entity", "Entität (Wert, optional)", ENT),
        f("pos", "Position", SEL(POS)), f("color", "Farbe", COLOR), f("unit", "Einheit (leer = von der Entität)", TXT),
        f("invert", "Vorzeichen umdrehen (angezeigter Wert)", BOOL)],
      mk: () => ({ id: "", name: "", icon: "mdi:circle-outline", entity: "", pos: "c", color: "#000080" }) },
    { key: "links", title: "Verbindungen", add: "Verbindung hinzufügen",
      fields: (m) => { const ids = (m.nodes || []).filter((n) => n && n.id).map((n) => [n.id, `${n.name || n.id} (${n.id})`]);
        return [f("from", "Von Knoten", ids.length ? SEL(ids) : TXT), f("to", "Zu Knoten", ids.length ? SEL(ids) : TXT), f("entity", "Entität (+ = von→zu, − = zurück)", ENT),
          f("color", "Farbe", COLOR), f("invert", "Laufrichtung umdrehen", BOOL), f("hide_value", "Wert auf dieser Linie ausblenden", BOOL), f("unit", "Einheit (leer = von der Entität)", TXT), f("max", "Volle Geschwindigkeit ab (leer = wie oben)", ANY)]; },
      label: (l) => (l.from && l.to ? `${l.from} → ${l.to}` : ""),
      mk: () => ({ from: "", to: "", entity: "", color: "#000080", invert: false }) }] },
  "stacked-area": { label: "Allrounder: Fläche gestapelt", base: [f("name", "Titel", TXT), f("hours", "Zeitraum (Stunden, 5-Min-Raster; HA hält diese Daten meist 10 Tage = 240 h)", NUM(1, 336)),
    f("height", "Höhe (px)", NUM(60, 600)), f("unit", "Einheit (leer = von der Entität)", TXT), f("decimals", "Nachkommastellen", NUM(0, 4))],
    blank: () => ({ type: "stacked-area", ...clone(Stacked.defaults), name: "Verlauf gestapelt" }),
    lists: [{ key: "series", title: "Reihen (unten → oben)", add: "Reihe hinzufügen", fields: NODE_F, mk: () => ({ name: "", entity: "", color: "#1e6fd9" }) }] },
  "hydronic-flow": { label: "Allrounder: Heiz-/Kühlkreis", blank: () => ({ type: "hydronic-flow", ...clone(Hydronic.defaults), name: "Heizkreis" }),
    base: [f("name", "Titel", TXT), f("generator_name", "Erzeuger: Name", TXT), f("generator_icon", "Erzeuger: Icon", ICON), f("generator_entity", "Erzeuger: Wert/Status", ENT),
      f("consumer_name", "Verbraucher: Name", TXT), f("consumer_icon", "Verbraucher: Icon", ICON), f("consumer_entity", "Verbraucher: Wert/Status", ENT),
      f("supply_temp", "Vorlauf: Temperatur", ENT), f("supply_entity", "Vorlauf: Zusatzwert (z.B. Durchfluss)", ENT),
      f("return_temp", "Rücklauf: Temperatur", ENT), f("return_entity", "Rücklauf: Zusatzwert", ENT),
      f("buffer_name", "Puffer: Name", TXT), f("buffer_entity", "Puffer: Temperatur (leer = kein Puffer)", ENT),
      f("pump_entity", "Pumpe (an / > 0 = läuft; leer = Fluss immer)", ENT),
      f("supply_color", "Farbe Vorlauf", COLOR), f("return_color", "Farbe Rücklauf", COLOR), f("height", "Höhe (px)", NUM(140, 500))], lists: [] },
  "tree-flow": { label: "Allrounder: Baum / Verteilung", blank: () => ({ type: "tree-flow", ...clone(Tree.defaults), name: "Verteilung" }),
    base: [f("name", "Titel", TXT), f("max", "Volle Linienstärke bei (Wert)", ANY), f("warn_above", "Warnfarbe ab (Wert, je Knoten überschreibbar)", ANY), f("unit", "Einheit (leer = von der Entität)", TXT)],
    obj: { key: "root", title: "Wurzel", fields: [f("name", "Name", TXT), f("icon", "Icon", ICON), f("entity", "Wert", ENT), f("status", "Status-Entität", ENT)] },
    lists: [{ key: "branches", title: "Zweige", add: "Zweig hinzufügen",
      fields: [f("name", "Name", TXT), f("icon", "Icon", ICON), f("entity", "Wert", ENT), f("status", "Status-Entität", ENT), f("warn_above", "Warnfarbe ab", ANY)],
      mk: () => ({ name: "", icon: "mdi:power-socket-de", entity: "", leaves: [] }),
      sub: { key: "leaves", title: "Blätter", add: "Blatt hinzufügen",
        fields: [f("name", "Name", TXT), f("icon", "Icon", ICON), f("entity", "Wert", ENT), f("status", "Status-Entität", ENT), f("warn_above", "Warnfarbe ab", ANY)],
        mk: () => ({ name: "", icon: "mdi:circle-medium", entity: "" }) } }] },
};
const GRUPPE = { "allround-kacheln": ["Basis", "mdi:puzzle-outline"], "stacked-area": ["Basis", "mdi:puzzle-outline"],
  sankey: ["Strom live", "mdi:flash"], "flow-grid": ["Strom live", "mdi:flash"], "tree-flow": ["Strom live", "mdi:flash"],
  "hydronic-flow": ["Heizung", "mdi:radiator"] };
const KLASSEN = { "allround-kacheln": Tiles, sankey: Sankey, "flow-grid": FlowGrid, "stacked-area": Stacked, "hydronic-flow": Hydronic, "tree-flow": Tree };
for (const [type, K] of Object.entries(KLASSEN)) {
  const e = ED[type];
  /* Einordnung im Editor bei den passenden Bereichen statt eigener Gruppe (Namen wie im Paket energie-atlas-gruppen) */
  const [grp, gi] = GRUPPE[type] || ["Basis", "mdi:puzzle-outline"];
  REG.reg(type, K, { label: e.label, fields: e.base, blank: e.blank, group: grp, groupIcon: gi });
}

const lbl = (L, o) => (L.label && L.label(o)) || (o && (o.name || o.id || o.entity)) || "";
customElements.whenDefined("energie-atlas-editor").then(() => {
  const P = customElements.get("energie-atlas-editor").prototype;
  if (P.__allroundEd || !P._modBody) return;
  P.__allroundEd = true;
  const orig = P._modBody;
  P._modBody = function (body, m, k0, t) {
    const spec = ED[m.type];
    if (!spec) return orig.call(this, body, m, k0, t);
    const K = KLASSEN[m.type], D = K.defaults;
    const base = [{ name: "half", label: "Halbe Breite (zwei nebeneinander)", selector: BOOL }, ...(spec.base || [])];
    body.appendChild(this._form(base, Object.fromEntries(base.map((x) => [x.name, m[x.name] ?? (x.name === "half" ? false : D[x.name] ?? "")])), (v) => {
      for (const x of base) { const y = v[x.name]; if (y === "" || y == null) delete m[x.name]; else m[x.name] = y; }
      this._emit();
    }));
    if (spec.obj) {
      const o = m[spec.obj.key] || (m[spec.obj.key] = clone(D[spec.obj.key] || {}));
      body.appendChild(this._el("sub", spec.obj.title));
      const box = this._el("item");
      box.appendChild(this._form(spec.obj.fields, { ...o }, (v) => { m[spec.obj.key] = { ...m[spec.obj.key], ...v }; this._emit(); }));
      body.appendChild(box);
    }
    const list = (parent, owner, L, kk) => {
      if (!Array.isArray(owner[L.key])) owner[L.key] = owner === m ? clone(D[L.key] || []) : [];
      const arr = owner[L.key];
      parent.appendChild(this._el("sub", L.title));
      arr.forEach((it, j) => {
        const key = `${kk}:${j}`;
        if (this._open[key] == null && !lbl(L, it)) this._open[key] = true;
        parent.appendChild(this._item(key, lbl(L, it) || "(noch leer)", arr, j, (b, tt) => {
          const fs = typeof L.fields === "function" ? L.fields(m) : L.fields;
          b.appendChild(this._form(fs, L.toForm ? L.toForm(it) : { ...it }, (v) => {
            const keep = L.sub ? arr[j][L.sub.key] : undefined;
            arr[j] = { ...arr[j], ...v };
            if (L.sub) arr[j][L.sub.key] = keep || [];
            tt.textContent = `${j + 1}. ${lbl(L, arr[j]) || "(noch leer)"}`; this._emit();
          }));
          if (L.sub) list(b, arr[j], L.sub, `${key}:${L.sub.key}`);
        }, null));
      });
      parent.appendChild(this._addBtn(L.add, () => { arr.push(L.mk()); this._open[`${kk}:${arr.length - 1}`] = true; this._rerender(); }));
    };
    for (const L of spec.lists || []) list(body, m, L, `${k0}:${L.key}`);
  };
});
})();

/* ===== energie-atlas-gruppen ===== */
/* energie-atlas-gruppen – Teil von Energie-Atlas */
(() => {
const REG = (window.energieAtlas = window.energieAtlas || { modules: {}, editors: {} });
const CORE = { "Kacheln": "tiles", "Gauges (Tempo-Punkte)": "gauges", "Gauges": "gauges", "Verlaufsgraph": "graph", "Tabelle": "matrix", "Batterien": "batteries" };
const GROUPS = [
  [/^(tiles|gauges|graph|matrix|batteries)$/, "Basis", "mdi:puzzle-outline"],
  [/^energie-/, "Strom live", "mdi:flash"],
  [/^(strom-|vertrag-|eingabe$)/, "Strom Jahr & Vertrag", "mdi:file-document-outline"],
  [/^wx-/, "Wetter", "mdi:weather-partly-cloudy"],
  [/^klima-/, "Temperaturen", "mdi:thermometer"],
  [/^zaehler-/, "Wasser & Gas", "mdi:water"],
  [/^aq-/, "Aquarium", "mdi:fishbowl-outline"],
];
/* Unterbereich -> Oberbereich (nur wenn der Oberbereich vorkommt, sonst bleibt der Bereich eigenstaendig) */
const PARENT = { "Wechselrichter": "Solar", "WR": "Solar", "Sigenergy": "Solar", "Marstek": "Solar",
  "Strom live": "Strom", "Strom Jahr & Vertrag": "Strom" };
/* Oberbereiche ohne eigene Knoepfe (entstehen nur, wenn ein Unterbereich vorkommt): Icon und Platz in der Liste */
const VIRT = { "Strom": ["mdi:lightning-bolt", 1] };
/* Zuordnung einzelner Module in eine andere Gruppe; diese Knoepfe behalten ihren vollen Namen (z.B. "Aquarium: Leistung") */
const MOVE = { "aq-power": ["Basis", "mdi:puzzle-outline"], "aq-week": ["Basis", "mdi:puzzle-outline"], "aq-heat": ["Heizung", "mdi:radiator"],
  "aq-hero": ["Basis", "mdi:puzzle-outline"], "aq-pump": ["Wasser & Gas", "mdi:water"] };
const CSS = `
  .grps { display:flex; flex-direction:column; gap:6px; }
  details.grp details.grp { margin-top:8px; background: rgba(0,0,0,0.02); }
  details.grp { border:1px solid var(--divider-color, #ddd); border-radius:10px; padding:0 10px; }
  details.grp[open] { padding-bottom:8px; }
  details.grp > summary { cursor:pointer; list-style:none; display:flex; align-items:center; gap:8px; padding:8px 0; font-weight:600; font-size:14px; }
  details.grp > summary::-webkit-details-marker { display:none; }
  details.grp > summary ha-icon { --mdc-icon-size:20px; }
  details.grp > summary .n { margin-left:auto; font-size:12px; font-weight:400; opacity:.6; }
  details.grp > summary .ch { --mdc-icon-size:18px; transition: transform .15s; }
  details.grp[open] > summary .ch { transform: rotate(180deg); }
  details.grp .adds { margin-top:2px; }
`;

function groupOf(type, label) {
  if (type && MOVE[type]) return MOVE[type];
  const e = type && REG.editors[type];
  if (e && e.group) return [e.group, e.groupIcon || "mdi:folder-outline"];
  for (const [re, name, icon] of GROUPS) if (type && re.test(type)) return [name, icon];
  const m = /^([^:]+):/.exec(label || "");
  return m ? [m[1].trim(), "mdi:folder-outline"] : ["Weitere", "mdi:dots-horizontal"];
}

customElements.whenDefined("energie-atlas-editor").then(() => {
  const P = customElements.get("energie-atlas-editor").prototype;
  if (P.__grpHook) return;
  P.__grpHook = true;
  const orig = P._render;
  P._render = function () {
    orig.call(this);
    const root = this.shadowRoot, adds = root && root.querySelector(".adds");
    if (!adds) return;
    const byLabel = { ...CORE };
    for (const [k, e] of Object.entries(REG.editors)) if (e && e.label) byLabel[e.label] = k;
    const order = [], map = {};
    for (const b of [...adds.querySelectorAll("button")]) {
      const label = b.textContent.trim(), type = byLabel[label];
      const [g, icon] = groupOf(type, label);
      if (!map[g]) { map[g] = { icon, btns: [] }; order.push(g); }
      /* "Aquarium: Status" -> "Status" im Bereich Aquarium */
      const short = label.replace(/^[^:]+:\s*/, "");
      const tn = [...b.childNodes].reverse().find((n) => n.nodeType === 3);
      if (tn && short !== label && !MOVE[type]) tn.textContent = short;
      b.title = label;
      map[g].btns.push(b);
    }
    for (const g of [...order]) { const p = PARENT[g]; if (p && !map[p] && VIRT[p]) { map[p] = { icon: VIRT[p][0], btns: [] }; order.push(p); } }
    const rank = (g) => { if (VIRT[g]) return VIRT[g][1]; const i = GROUPS.findIndex((x) => x[1] === g); return i < 0 ? 100 : i; };
    order.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "de"));
    this._grpOpen = this._grpOpen || {};
    const wrap = document.createElement("div");
    wrap.className = "grps";
    const st = document.createElement("style");
    st.textContent = CSS;
    wrap.appendChild(st);
    const kids = (g) => order.filter((x) => PARENT[x] === g);
    const mk = (g) => {
      const d = document.createElement("details");
      d.className = "grp";
      if (this._grpOpen[g]) d.open = true;
      const n = map[g].btns.length + kids(g).reduce((a, k) => a + map[k].btns.length, 0);
      const s = document.createElement("summary");
      s.innerHTML = `<ha-icon icon="${map[g].icon}"></ha-icon><span></span><span class="n">${n}</span><ha-icon class="ch" icon="mdi:chevron-down"></ha-icon>`;
      s.children[1].textContent = g;
      d.addEventListener("toggle", (ev) => { if (ev.target === d) this._grpOpen[g] = d.open; });
      const inner = document.createElement("div");
      inner.className = "adds";
      map[g].btns.forEach((b) => inner.appendChild(b));
      d.append(s, inner);
      for (const k of kids(g)) d.appendChild(mk(k));
      return d;
    };
    for (const g of order) {
      if (PARENT[g] && map[PARENT[g]]) continue;   // steht als Unterbereich in seinem Oberbereich
      wrap.appendChild(mk(g));
    }
    adds.replaceWith(wrap);
  };
});
})();
