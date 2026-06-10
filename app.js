import SwissEph from "./lib/src/swisseph.js";
import { generateKundli, buildAiText, buildJson, isValidTimezone } from "./kundli.js";

const $ = (id) => document.getElementById(id);

const DEFAULT_LOCATION = {
  display_name: "New Delhi, Delhi, India",
  latitude: 28.6139,
  longitude: 77.209,
  timezone_name: "Asia/Kolkata",
};

let selectedLocation = { ...DEFAULT_LOCATION };
let swe = null;
let chart = null;
let textOutput = "";
let jsonOutput = "";

/* ---------- service worker ---------- */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/* ---------- timezone datalist ---------- */
try {
  const list = $("tzlist");
  for (const zone of Intl.supportedValuesOf("timeZone")) {
    const opt = document.createElement("option");
    opt.value = zone;
    list.appendChild(opt);
  }
} catch { /* older browsers */ }

/* ---------- manual location fields ---------- */
function syncManualFields() {
  $("mPlace").value = selectedLocation.display_name;
  $("mTz").value = selectedLocation.timezone_name;
  $("mLat").value = selectedLocation.latitude;
  $("mLon").value = selectedLocation.longitude;
}
syncManualFields();

function showPlaceBanner(text, kind = "ok") {
  const banner = $("placeBanner");
  banner.textContent = text;
  banner.className = `banner ${kind}`;
}

/* ---------- place search (Nominatim + tz-lookup) ---------- */
let searchTimer = null;
let searchSeq = 0;

$("place").addEventListener("input", () => {
  clearTimeout(searchTimer);
  const query = $("place").value.trim();
  if (query.length < 3) {
    $("suggestions").innerHTML = "";
    return;
  }
  searchTimer = setTimeout(() => searchPlaces(query), 450);
});

async function searchPlaces(query) {
  const seq = ++searchSeq;
  try {
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=" +
      encodeURIComponent(query);
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const results = await response.json();
    if (seq !== searchSeq) return;
    const box = $("suggestions");
    box.innerHTML = "";
    if (!results.length) {
      showPlaceBanner("No matching place found. Add the state or country.", "warn");
      return;
    }
    for (const item of results) {
      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = item.display_name;
      btn.addEventListener("click", () => {
        let zone = "UTC";
        try { zone = tzlookup(lat, lon); } catch { /* keep UTC */ }
        selectedLocation = {
          display_name: item.display_name,
          latitude: lat,
          longitude: lon,
          timezone_name: zone,
        };
        syncManualFields();
        box.innerHTML = "";
        $("place").value = item.display_name.split(",")[0];
        showPlaceBanner(`${item.display_name} · ${zone}`, "ok");
      });
      box.appendChild(btn);
    }
  } catch (err) {
    if (seq !== searchSeq) return;
    showPlaceBanner(
      "Place search unavailable (offline?). Use Advanced: manual location.", "warn");
  }
}

/* ---------- generate ---------- */
function activeLocation() {
  if ($("manualToggle").checked) {
    return {
      display_name: $("mPlace").value.trim(),
      timezone_name: $("mTz").value.trim(),
      latitude: parseFloat($("mLat").value),
      longitude: parseFloat($("mLon").value),
    };
  }
  return selectedLocation;
}

function setProgress(text) {
  const el = $("progress");
  if (text) {
    el.textContent = text;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function showError(text) {
  const el = $("error");
  if (text) {
    el.textContent = text;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

async function ensureEngine() {
  if (swe) return swe;
  setProgress("Loading Swiss Ephemeris (first run downloads ~13 MB, then cached)...");
  const instance = new SwissEph();
  await instance.initSwissEph();
  swe = instance;
  return swe;
}

$("generateBtn").addEventListener("click", async () => {
  showError("");
  const location = activeLocation();
  if (!location.display_name || Number.isNaN(location.latitude) ||
      Number.isNaN(location.longitude)) {
    showError("Select a birth place from the suggestions, or fill the manual location.");
    return;
  }
  if (!isValidTimezone(location.timezone_name)) {
    showError(`Unknown IANA timezone: ${location.timezone_name}`);
    return;
  }
  if (!$("bdate").value || !$("btime").value) {
    showError("Enter the birth date and time.");
    return;
  }
  $("generateBtn").disabled = true;
  try {
    await ensureEngine();
    setProgress("Calculating chart, vargas, dashas, and transits...");
    await new Promise((resolve) => setTimeout(resolve, 30));
    chart = generateKundli(swe, {
      name: $("name").value.trim() || "Unnamed",
      birthDate: $("bdate").value,
      birthTime: $("btime").value,
      timezoneName: location.timezone_name,
      latitude: location.latitude,
      longitude: location.longitude,
      place: location.display_name,
    });
    textOutput = buildAiText(chart);
    jsonOutput = buildJson(chart);
    renderResults();
    $("inputView").classList.add("hidden");
    $("resultView").classList.remove("hidden");
    window.scrollTo(0, 0);
  } catch (err) {
    showError(`Could not calculate chart: ${err.message || err}`);
  } finally {
    setProgress("");
    $("generateBtn").disabled = false;
  }
});

$("backBtn").addEventListener("click", () => {
  $("resultView").classList.add("hidden");
  $("inputView").classList.remove("hidden");
  window.scrollTo(0, 0);
});

/* ---------- results rendering ---------- */
function tableHtml(headers, rows) {
  const head = headers.map((h) => `<th>${h}</th>`).join("");
  const body = rows.map((row) =>
    `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function dms(value) {
  const d = Math.floor(value);
  const m = Math.floor((value - d) * 60);
  return `${d}°${String(m).padStart(2, "0")}'`;
}

function renderResults() {
  const birth = chart.birth_details;
  const asc = chart.ascendant;
  $("resultTitle").textContent =
    `${birth.name} · ${birth.birth_date}, ${birth.birth_time.slice(0, 5)}`;
  $("resultSub").textContent =
    `${birth.place.split(",")[0]} · Lagna: ${asc.sign} ${dms(asc.degree)} · ` +
    `${asc.nakshatra.name} P${asc.nakshatra.pada}`;

  $("planetsBox").innerHTML = tableHtml(
    ["Planet", "Sign", "Deg", "Nakshatra", "Pada", "House", "Motion"],
    Object.entries(chart.planetary_positions).map(([name, row]) => [
      name, row.sign, dms(row.degree), row.nakshatra.name,
      row.nakshatra.pada, row.house, row.retrograde ? "R" : "D",
    ])) +
    `<p class="summarysub" style="margin:10px 0 4px">Bhava Chalit</p>` +
    tableHtml(["Planet", "Rashi house", "Bhava house", "Sign"],
      chart.bhava_chalit.map((row) => [row.planet, row.rashi_house, row.bhava_house, row.sign]));

  const vargaSelect = document.createElement("select");
  for (const [code, varga] of Object.entries(chart.divisional_charts)) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = `${code} – ${varga.name}`;
    vargaSelect.appendChild(opt);
  }
  const vargaTable = document.createElement("div");
  vargaTable.className = "tablewrap";
  const renderVarga = () => {
    const varga = chart.divisional_charts[vargaSelect.value];
    vargaTable.innerHTML = tableHtml(["Body", "Sign", "Deg", "House"],
      Object.entries(varga.placements).map(([body, p]) =>
        [body, p.sign, dms(p.degree), p.house]));
  };
  vargaSelect.addEventListener("change", renderVarga);
  const vargasBox = $("vargasBox");
  vargasBox.innerHTML = "";
  vargasBox.appendChild(vargaSelect);
  vargasBox.appendChild(vargaTable);
  renderVarga();

  const dashaSelect = document.createElement("select");
  for (const key of Object.keys(chart.dashas)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    dashaSelect.appendChild(opt);
  }
  const dashaInfo = document.createElement("div");
  const renderDasha = () => {
    const data = chart.dashas[dashaSelect.value];
    const current = data.current && Object.keys(data.current).length
      ? Object.entries(data.current)
          .filter(([k]) => !k.endsWith("_ends"))
          .map(([k, v]) => `${k}: ${v}`).join(" · ")
      : "—";
    dashaInfo.innerHTML =
      `<p class="note">${data.method}${data.note ? "<br>" + data.note : ""}</p>` +
      `<p class="summarysub" style="margin:8px 0"><strong>Current:</strong> ${current}</p>` +
      `<div class="tablewrap">` +
      tableHtml(["Lord / Sign", "Starts", "Ends"],
        data.periods.map((p) => [p.lord, p.start.slice(0, 10), p.end.slice(0, 10)])) +
      `</div>`;
  };
  dashaSelect.addEventListener("change", renderDasha);
  const dashasBox = $("dashasBox");
  dashasBox.innerHTML = "";
  dashasBox.appendChild(dashaSelect);
  dashasBox.appendChild(dashaInfo);
  renderDasha();

  const sav = chart.ashtakavarga.sarvashtakavarga.scores_by_sign;
  $("ashtakaBox").innerHTML =
    `<p class="summarysub" style="margin:8px 0 4px">Sarvashtakavarga (total ${chart.ashtakavarga.sarvashtakavarga.total})</p>` +
    tableHtml(["Sign", "Score"], Object.entries(sav)) +
    `<p class="note">Bhinna Ashtakavarga totals: ` +
    Object.entries(chart.ashtakavarga.bhinna_ashtakavarga)
      .map(([p, d]) => `${p}=${d.total}`).join(", ") +
    `. Full tables are in the TXT/JSON export.</p>`;

  $("transitsBox").innerHTML =
    `<p class="note">Calculated at ${chart.current_transits.calculated_at_utc}</p>` +
    tableHtml(["Planet", "Sign", "Deg", "Nakshatra", "From Lagna", "From Moon", "Motion"],
      chart.current_transits.positions.map((row) => [
        row.planet, row.sign, dms(row.degree),
        `${row.nakshatra.name} P${row.nakshatra.pada}`,
        `H${row.house_from_natal_lagna}`, `H${row.house_from_natal_moon}`,
        row.retrograde ? "R" : "D",
      ]));

  $("aiText").value = textOutput;
}

/* ---------- copy / share / download ---------- */
$("copyBtn").addEventListener("click", async () => {
  let copied = false;
  try {
    await navigator.clipboard.writeText(textOutput);
    copied = true;
  } catch {
    const area = $("aiText");
    area.focus();
    area.select();
    copied = document.execCommand("copy");
  }
  const btn = $("copyBtn");
  btn.textContent = copied ? "✓ Copied — paste into any AI chat" : "Copy failed — use AI text preview";
  setTimeout(() => { btn.textContent = "⧉ Copy AI text"; }, 2500);
});

$("shareBtn").addEventListener("click", async () => {
  if (navigator.share) {
    try { await navigator.share({ text: textOutput }); } catch { /* cancelled */ }
  } else {
    $("copyBtn").click();
  }
});

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

$("dlTxtBtn").addEventListener("click", () =>
  download("kundli_ai_export.txt", textOutput, "text/plain"));
$("dlJsonBtn").addEventListener("click", () =>
  download("kundli_ai_export.json", jsonOutput, "application/json"));
