/* Kundli calculation logic ported from the Python kundli package.
   Works with the swisseph-wasm wrapper (lib/src/swisseph.js). */

export const SIGNS = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
];

export const SIGN_LORDS = [
  "Mars", "Venus", "Mercury", "Moon", "Sun", "Mercury",
  "Venus", "Mars", "Jupiter", "Saturn", "Saturn", "Jupiter",
];

export const NAKSHATRAS = [
  "Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra",
  "Punarvasu", "Pushya", "Ashlesha", "Magha", "Purva Phalguni",
  "Uttara Phalguni", "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha",
  "Jyeshtha", "Mula", "Purva Ashadha", "Uttara Ashadha", "Shravana",
  "Dhanishta", "Shatabhisha", "Purva Bhadrapada", "Uttara Bhadrapada",
  "Revati",
];

export const PLANET_ORDER = [
  "Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn",
  "Rahu", "Ketu",
];

export const VARGAS = [1, 2, 3, 4, 7, 9, 10, 12, 16, 20, 24, 27, 30, 40, 45, 60];

export const VARGA_NAMES = {
  1: "Rashi", 2: "Hora", 3: "Drekkana", 4: "Chaturthamsha",
  7: "Saptamsha", 9: "Navamsha", 10: "Dashamsha", 12: "Dwadashamsha",
  16: "Shodashamsha", 20: "Vimshamsha", 24: "Chaturvimshamsha",
  27: "Saptavimshamsha", 30: "Trimshamsha", 40: "Khavedamsha",
  45: "Akshavedamsha", 60: "Shashtiamsha",
};

export const DISCLAIMER =
  "Use only this chart data. Do not recalculate. Dasha dates are ending dates.";

const YEAR_DAYS = 365.2425;
const DAY_MS = 86400000;

/* ---------- number helpers (match Python rounding) ---------- */

function pyRound(value, digits = 0) {
  const factor = Math.pow(10, digits);
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let result;
  if (diff > 0.5) result = floor + 1;
  else if (diff < 0.5) result = floor;
  else result = floor % 2 === 0 ? floor : floor + 1;
  return result / factor;
}

function mod360(value) {
  return ((value % 360) + 360) % 360;
}

/* ---------- timezone helpers (IANA via Intl) ---------- */

function tzOffsetMinutes(date, zone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hour12: false, era: "short",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = {};
  for (const part of dtf.formatToParts(date)) parts[part.type] = part.value;
  let year = Number(parts.year);
  if (parts.era === "BC") year = 1 - year;
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(year, Number(parts.month) - 1, Number(parts.day),
    hour, Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - date.getTime()) / 60000);
}

export function isValidTimezone(zone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function zonedToUtc(year, month, day, hour, minute, zone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = naive;
  for (let i = 0; i < 4; i += 1) {
    const offset = tzOffsetMinutes(new Date(guess), zone);
    const next = naive - offset * 60000;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

function isoUtcMs(ms) {
  const d = new Date(Math.floor(ms / 1000) * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`;
}

function isoLocal(utcDate, zone) {
  const offset = tzOffsetMinutes(utcDate, zone);
  const shifted = new Date(utcDate.getTime() + offset * 60000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-` +
    `${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:` +
    `${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/* ---------- core chart ---------- */

function julianDay(swe, utcDate) {
  const hour = utcDate.getUTCHours() + utcDate.getUTCMinutes() / 60 +
    (utcDate.getUTCSeconds() + utcDate.getUTCMilliseconds() / 1000) / 3600;
  return swe.julday(utcDate.getUTCFullYear(), utcDate.getUTCMonth() + 1,
    utcDate.getUTCDate(), hour);
}

function nakshatraOf(longitude) {
  const span = 360 / 27;
  const lon = mod360(longitude);
  const index = Math.floor(lon / span);
  const within = lon % span;
  return {
    index: index + 1,
    name: NAKSHATRAS[index],
    pada: Math.min(Math.floor(within / (span / 4)) + 1, 4),
    degree_in_nakshatra: pyRound(within, 6),
  };
}

function positionRecord(name, longitude, speed, ascSign) {
  const lon = mod360(longitude);
  const signIndex = Math.floor(lon / 30);
  return {
    name,
    longitude: pyRound(lon, 6),
    sign_index: signIndex,
    sign: SIGNS[signIndex],
    degree: pyRound(lon % 30, 6),
    nakshatra: nakshatraOf(lon),
    house: ((signIndex - ascSign + 12) % 12) + 1,
    retrograde: name === "Sun" || name === "Moon" ? false : speed < 0,
    speed: pyRound(speed, 8),
  };
}

function planetIds(swe) {
  return {
    Sun: swe.SE_SUN, Moon: swe.SE_MOON, Mars: swe.SE_MARS,
    Mercury: swe.SE_MERCURY, Jupiter: swe.SE_JUPITER, Venus: swe.SE_VENUS,
    Saturn: swe.SE_SATURN, Rahu: swe.SE_TRUE_NODE,
  };
}

function calcPositions(swe, jdUt, ascLongitude) {
  const flags = swe.SEFLG_SWIEPH | swe.SEFLG_SPEED | swe.SEFLG_SIDEREAL;
  const ascSign = Math.floor(ascLongitude / 30);
  const records = {};
  for (const [name, id] of Object.entries(planetIds(swe))) {
    const values = swe.calc_ut(jdUt, id, flags);
    records[name] = positionRecord(name, values[0], values[3], ascSign);
  }
  const rahu = records.Rahu;
  records.Ketu = positionRecord("Ketu", rahu.longitude + 180, rahu.speed, ascSign);
  const ordered = {};
  for (const name of PLANET_ORDER) ordered[name] = records[name];
  return ordered;
}

function houseForLongitude(longitude, cusps) {
  for (let index = 0; index < 12; index += 1) {
    const start = cusps[index];
    const end = cusps[(index + 1) % 12];
    const span = mod360(end - start);
    const offset = mod360(longitude - start);
    if (offset < span) return index + 1;
  }
  return 12;
}

function housesData(swe, jdUt, latitude, longitude) {
  const { cusps, ascmc } = swe.houses_ex(jdUt, swe.SEFLG_SIDEREAL, latitude, longitude, "P");
  const raw = cusps.length === 13 ? Array.from(cusps).slice(1, 13) : Array.from(cusps).slice(0, 12);
  const cuspList = raw.map(mod360);
  const data = {
    system: "Placidus sidereal cusps; whole-sign houses used for main placements",
    ascendant: pyRound(mod360(ascmc[0]), 6),
    midheaven: pyRound(mod360(ascmc[1]), 6),
    cusps: cuspList.map((value, index) => ({
      house: index + 1,
      longitude: pyRound(value, 6),
      sign: SIGNS[Math.floor(value / 30)],
      degree: pyRound(value % 30, 6),
    })),
  };
  return { data, ascLongitude: mod360(ascmc[0]) };
}

function bhavaChalit(positions, cusps) {
  const cuspValues = cusps.map((item) => item.longitude);
  return Object.entries(positions).map(([name, record]) => ({
    planet: name,
    rashi_house: record.house,
    bhava_house: houseForLongitude(record.longitude, cuspValues),
    sign: record.sign,
    degree: record.degree,
  }));
}

/* ---------- vargas ---------- */

function vargaPart(degreeInSign, divisions) {
  const width = 30 / divisions;
  const index = Math.min(Math.floor(degreeInSign / width), divisions - 1);
  return [index, ((degreeInSign - index * width) / width) * 30];
}

function trimshamsha(sign, degree) {
  const segments = sign % 2 === 0
    ? [[0, 5, 0], [5, 10, 10], [10, 18, 8], [18, 25, 2], [25, 30, 6]]
    : [[0, 5, 1], [5, 12, 5], [12, 20, 11], [20, 25, 9], [25, 30, 7]];
  for (const [start, end, outSign] of segments) {
    if ((start <= degree && degree < end) || degree === 30) {
      const normalized = ((degree - start) / (end - start)) * 30;
      return { sign_index: outSign, sign: SIGNS[outSign], degree: pyRound(normalized, 6) };
    }
  }
  throw new Error("Invalid degree for D30");
}

export function vargaPosition(longitude, division) {
  const lon = mod360(longitude);
  const sign = Math.floor(lon / 30);
  const degree = lon % 30;
  const [part, partDegree] = vargaPart(degree, division);
  let vargaDegree = partDegree;
  const modality = sign % 3;
  const element = sign % 4;
  let outSign;

  if (division === 1) {
    outSign = sign;
    vargaDegree = degree;
  } else if (division === 2) {
    outSign = sign % 2 === 0 ? [4, 3][part] : [3, 4][part];
  } else if (division === 3) {
    outSign = (sign + 4 * part) % 12;
  } else if (division === 4) {
    outSign = (sign + 3 * part) % 12;
  } else if (division === 7) {
    outSign = (sign + part + (sign % 2 === 0 ? 0 : 6)) % 12;
  } else if (division === 9) {
    outSign = (sign + [0, 8, 4][modality] + part) % 12;
  } else if (division === 10) {
    outSign = (sign + part + (sign % 2 === 0 ? 0 : 8)) % 12;
  } else if (division === 12) {
    outSign = (sign + part) % 12;
  } else if (division === 16) {
    outSign = ([0, 4, 8][modality] + part) % 12;
  } else if (division === 20) {
    outSign = ([0, 8, 4][modality] + part) % 12;
  } else if (division === 24) {
    outSign = ((sign % 2 === 0 ? 4 : 3) + part) % 12;
  } else if (division === 27) {
    outSign = ([0, 3, 6, 9][element] + part) % 12;
  } else if (division === 30) {
    return trimshamsha(sign, degree);
  } else if (division === 40) {
    outSign = ((sign % 2 === 0 ? 0 : 6) + part) % 12;
  } else if (division === 45) {
    outSign = ([0, 4, 8][modality] + part) % 12;
  } else if (division === 60) {
    outSign = (sign + part) % 12;
  } else {
    throw new Error(`Unsupported division: D${division}`);
  }

  return { sign_index: outSign, sign: SIGNS[outSign], degree: pyRound(vargaDegree, 6) };
}

export function buildDivisionalCharts(longitudes) {
  const charts = {};
  for (const division of VARGAS) {
    const placements = {};
    for (const [body, longitude] of Object.entries(longitudes)) {
      placements[body] = vargaPosition(longitude, division);
    }
    const ascSign = placements.Ascendant.sign_index;
    for (const placement of Object.values(placements)) {
      placement.house = ((placement.sign_index - ascSign + 12) % 12) + 1;
    }
    charts[`D${division}`] = {
      name: VARGA_NAMES[division],
      division,
      placements,
    };
  }
  return charts;
}

/* ---------- ashtakavarga ---------- */

const BAV_RULES = {
  Sun: {
    Sun: [1, 2, 4, 7, 8, 9, 10, 11], Moon: [3, 6, 10, 11],
    Mars: [1, 2, 4, 7, 8, 9, 10, 11], Mercury: [3, 5, 6, 9, 10, 11, 12],
    Jupiter: [5, 6, 9, 11], Venus: [6, 7, 12],
    Saturn: [1, 2, 4, 7, 8, 9, 10, 11], Ascendant: [3, 4, 6, 10, 11, 12],
  },
  Moon: {
    Sun: [3, 6, 7, 8, 10, 11], Moon: [1, 3, 6, 7, 10, 11],
    Mars: [2, 3, 5, 6, 9, 10, 11], Mercury: [1, 3, 4, 5, 7, 8, 10, 11],
    Jupiter: [1, 4, 7, 8, 10, 11, 12], Venus: [3, 4, 5, 7, 9, 10, 11],
    Saturn: [3, 5, 6, 11], Ascendant: [3, 6, 10, 11],
  },
  Mars: {
    Sun: [3, 5, 6, 10, 11], Moon: [3, 6, 11],
    Mars: [1, 2, 4, 7, 8, 10, 11], Mercury: [3, 5, 6, 11],
    Jupiter: [6, 10, 11, 12], Venus: [6, 8, 11, 12],
    Saturn: [1, 4, 7, 8, 9, 10, 11], Ascendant: [1, 3, 6, 10, 11],
  },
  Mercury: {
    Sun: [5, 6, 9, 11, 12], Moon: [2, 4, 6, 8, 10, 11],
    Mars: [1, 2, 4, 7, 8, 9, 10, 11], Mercury: [1, 3, 5, 6, 9, 10, 11, 12],
    Jupiter: [6, 8, 11, 12], Venus: [1, 2, 3, 4, 5, 8, 9, 11],
    Saturn: [1, 2, 4, 7, 8, 9, 10, 11], Ascendant: [1, 2, 4, 6, 8, 10, 11],
  },
  Jupiter: {
    Sun: [1, 2, 3, 4, 7, 8, 9, 10, 11], Moon: [2, 5, 7, 9, 11],
    Mars: [1, 2, 4, 7, 8, 10, 11], Mercury: [1, 2, 4, 5, 6, 9, 10, 11],
    Jupiter: [1, 2, 3, 4, 7, 8, 10, 11], Venus: [2, 5, 6, 9, 10, 11],
    Saturn: [3, 5, 6, 12], Ascendant: [1, 2, 4, 5, 6, 7, 9, 10, 11],
  },
  Venus: {
    Sun: [8, 11, 12], Moon: [1, 2, 3, 4, 5, 8, 9, 11, 12],
    Mars: [3, 5, 6, 9, 11, 12], Mercury: [3, 5, 6, 9, 11],
    Jupiter: [5, 8, 9, 10, 11], Venus: [1, 2, 3, 4, 5, 8, 9, 10, 11],
    Saturn: [3, 4, 5, 8, 9, 10, 11], Ascendant: [1, 2, 3, 4, 5, 8, 9, 11],
  },
  Saturn: {
    Sun: [1, 2, 4, 7, 8, 10, 11], Moon: [3, 6, 11],
    Mars: [3, 5, 6, 10, 11, 12], Mercury: [6, 8, 9, 10, 11, 12],
    Jupiter: [5, 6, 11, 12], Venus: [6, 11, 12],
    Saturn: [3, 5, 6, 11], Ascendant: [1, 3, 4, 6, 10, 11],
  },
};

export function calculateAshtakavarga(signPositions) {
  const bav = {};
  for (const [target, contributors] of Object.entries(BAV_RULES)) {
    const scores = new Array(12).fill(0);
    for (const [source, favorableHouses] of Object.entries(contributors)) {
      const sourceSign = signPositions[source];
      for (const house of favorableHouses) {
        scores[(sourceSign + house - 1) % 12] += 1;
      }
    }
    const bySign = {};
    SIGNS.forEach((sign, i) => { bySign[sign] = scores[i]; });
    bav[target] = { scores_by_sign: bySign, total: scores.reduce((a, b) => a + b, 0) };
  }
  const savScores = SIGNS.map((sign) =>
    Object.keys(BAV_RULES).reduce((sum, planet) => sum + bav[planet].scores_by_sign[sign], 0));
  const savBySign = {};
  SIGNS.forEach((sign, i) => { savBySign[sign] = savScores[i]; });
  return {
    bhinna_ashtakavarga: bav,
    sarvashtakavarga: {
      scores_by_sign: savBySign,
      total: savScores.reduce((a, b) => a + b, 0),
    },
    note: "Classical un-reduced Bhinna Ashtakavarga; no Trikona/Ekadhipatya reductions.",
  };
}

/* ---------- dashas ---------- */

const VIMSHOTTARI = [
  ["Ketu", 7], ["Venus", 20], ["Sun", 6], ["Moon", 10], ["Mars", 7],
  ["Rahu", 18], ["Jupiter", 16], ["Saturn", 19], ["Mercury", 17],
];

const YOGINI = [
  ["Mangala (Moon)", 1], ["Pingala (Sun)", 2], ["Dhanya (Jupiter)", 3],
  ["Bhramari (Mars)", 4], ["Bhadrika (Mercury)", 5], ["Ulka (Saturn)", 6],
  ["Siddha (Venus)", 7], ["Sankata (Rahu)", 8],
];

const ASHTOTTARI = [
  ["Sun", 6], ["Moon", 15], ["Mars", 8], ["Mercury", 17],
  ["Saturn", 10], ["Jupiter", 19], ["Rahu", 12], ["Venus", 21],
];

const KALACHAKRA_YEARS = [7, 16, 9, 21, 5, 9, 16, 7, 10, 4, 4, 10];

function yearsToMs(years) {
  return Math.round(years * YEAR_DAYS * DAY_MS * 1000) / 1000;
}

function period(name, startMs, endMs) {
  return { lord: name, start: isoUtcMs(startMs), end: isoUtcMs(endMs) };
}

function rotate(sequence, startIndex) {
  return sequence.slice(startIndex).concat(sequence.slice(0, startIndex));
}

function subperiods(startMs, endMs, sequence, startLord, depth) {
  const totalYears = sequence.reduce((sum, [, years]) => sum + years, 0);
  const startIndex = sequence.findIndex(([lord]) => lord === startLord);
  const ordered = rotate(sequence, startIndex);
  const duration = endMs - startMs;
  let cursor = startMs;
  const result = [];
  ordered.forEach(([lord, years], index) => {
    const subEnd = index === ordered.length - 1
      ? endMs
      : cursor + Math.round(duration * (years / totalYears) * 1000) / 1000;
    const item = period(lord, cursor, subEnd);
    if (depth > 1) item.pratyantar = subperiods(cursor, subEnd, sequence, lord, 1);
    result.push(item);
    cursor = subEnd;
  });
  return result;
}

export function nakshatraFraction(moonLongitude) {
  const span = 360 / 27;
  const lon = mod360(moonLongitude);
  const nakIndex = Math.floor(lon / span);
  const elapsed = (lon % span) / span;
  return [nakIndex, elapsed];
}

function cyclicDasha(birthMs, sequence, startingIndex, elapsedFraction, cycles = 1, includeSubperiods = true) {
  const totalYears = sequence.reduce((sum, [, years]) => sum + years, 0);
  const [firstLord, firstYears] = sequence[startingIndex];
  const firstFullMs = yearsToMs(firstYears);
  let cursor = birthMs - Math.round(firstFullMs * elapsedFraction * 1000) / 1000;
  const endLimit = birthMs + yearsToMs(totalYears * cycles);
  const ordered = rotate(sequence, startingIndex);
  const periods = [];
  let index = 0;
  while (cursor < endLimit) {
    const [lord, years] = ordered[index % ordered.length];
    const end = cursor + yearsToMs(years);
    const item = period(lord, cursor, end);
    if (includeSubperiods) item.antardasha = subperiods(cursor, end, sequence, lord, 2);
    periods.push(item);
    cursor = end;
    index += 1;
  }
  return { periods, total_cycle_years: totalYears, birth_period_lord: firstLord };
}

function findCurrent(periods, atMs) {
  const atIso = isoUtcMs(atMs);
  const current = {};
  for (const md of periods) {
    if (md.start <= atIso && atIso < md.end) {
      current.mahadasha = md.lord;
      current.mahadasha_ends = md.end;
      for (const ad of md.antardasha || []) {
        if (ad.start <= atIso && atIso < ad.end) {
          current.antardasha = ad.lord;
          current.antardasha_ends = ad.end;
          for (const pd of ad.pratyantar || []) {
            if (pd.start <= atIso && atIso < pd.end) {
              current.pratyantar = pd.lord;
              current.pratyantar_ends = pd.end;
              break;
            }
          }
          break;
        }
      }
      break;
    }
  }
  return current;
}

function vimshottariDasha(birthMs, moonLongitude, atMs) {
  const [nakIndex, elapsed] = nakshatraFraction(moonLongitude);
  const result = cyclicDasha(birthMs, VIMSHOTTARI, nakIndex % 9, elapsed);
  result.method = "Vimshottari 120-year cycle from Moon nakshatra";
  result.birth_nakshatra = NAKSHATRAS[nakIndex];
  result.current = findCurrent(result.periods, atMs);
  return result;
}

function yoginiDasha(birthMs, moonLongitude, atMs) {
  const [nakIndex, elapsed] = nakshatraFraction(moonLongitude);
  const startingIndex = (nakIndex + 3) % 8;
  const result = cyclicDasha(birthMs, YOGINI, startingIndex, elapsed, 2);
  result.method = "Yogini 36-year cycle; birth Yogini from nakshatra number + 3";
  result.current = findCurrent(result.periods, atMs);
  return result;
}

function ashtottariDasha(birthMs, moonLongitude, atMs) {
  const [nakIndex, elapsed] = nakshatraFraction(moonLongitude);
  const lordByNak = [
    6, 6, 7, 7, 7, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 3, 3,
    3, 4, 4, 4, 5, 5, 5, 6, 6,
  ];
  const startingIndex = lordByNak[nakIndex];
  const result = cyclicDasha(birthMs, ASHTOTTARI, startingIndex, elapsed);
  result.method = "Ashtottari 108-year cycle using standard nakshatra-lord allocation";
  result.current = findCurrent(result.periods, atMs);
  result.note = "Ashtottari applicability is conditional in classical practice; verify lineage rules.";
  return result;
}

function charaDasha(birthMs, ascSign, planetSigns, atMs) {
  const direction = ascSign % 2 === 0 ? 1 : -1;
  let cursor = birthMs;
  const periods = [];
  for (let offset = 0; offset < 12; offset += 1) {
    const sign = ((ascSign + direction * offset) % 12 + 12) % 12;
    const lord = SIGN_LORDS[sign];
    const lordSign = planetSigns[lord];
    const distance = (((lordSign - sign) * direction) % 12 + 12) % 12;
    const years = distance === 0 ? 12 : distance;
    const end = cursor + yearsToMs(years);
    periods.push({ ...period(SIGNS[sign], cursor, end), years, sign_lord: lord });
    cursor = end;
  }
  return {
    method: "Simplified Jaimini Chara sign-distance variant from Ascendant",
    periods,
    current: findCurrent(periods, atMs),
    note: "Chara Dasha rules vary by lineage; this variant excludes exaltation/debilitation adjustments and co-lord exceptions.",
  };
}

function kalachakraDasha(birthMs, moonLongitude, atMs) {
  const [nakIndex] = nakshatraFraction(moonLongitude);
  const moonD9 = vargaPosition(moonLongitude, 9).sign_index;
  const direction = nakIndex % 2 === 0 ? 1 : -1;
  let cursor = birthMs;
  const periods = [];
  for (let offset = 0; offset < 12; offset += 1) {
    const sign = ((moonD9 + direction * offset) % 12 + 12) % 12;
    const years = KALACHAKRA_YEARS[sign];
    const end = cursor + yearsToMs(years);
    periods.push({ ...period(SIGNS[sign], cursor, end), years });
    cursor = end;
  }
  return {
    method: "Simplified Kalachakra sign progression from Moon Navamsha",
    periods,
    current: findCurrent(periods, atMs),
    note: "Reference-only variant. Full Kalachakra Deha/Jeeva and manduka-gati rules are lineage-specific.",
  };
}

export function calculateDashas(birthMs, moonLongitude, ascSign, planetSigns, atMs) {
  return {
    vimshottari: vimshottariDasha(birthMs, moonLongitude, atMs),
    yogini: yoginiDasha(birthMs, moonLongitude, atMs),
    ashtottari: ashtottariDasha(birthMs, moonLongitude, atMs),
    chara_jaimini: charaDasha(birthMs, ascSign, planetSigns, atMs),
    kalachakra: kalachakraDasha(birthMs, moonLongitude, atMs),
  };
}

/* ---------- transits ---------- */

function transits(swe, atMs, natalAscSign, natalMoonSign) {
  const jdUt = julianDay(swe, new Date(atMs));
  const flags = swe.SEFLG_SWIEPH | swe.SEFLG_SPEED | swe.SEFLG_SIDEREAL;
  const rows = [];
  for (const [name, id] of Object.entries(planetIds(swe))) {
    const values = swe.calc_ut(jdUt, id, flags);
    const longitude = mod360(values[0]);
    const speed = values[3];
    const sign = Math.floor(longitude / 30);
    rows.push({
      planet: name,
      longitude: pyRound(longitude, 6),
      sign: SIGNS[sign],
      degree: pyRound(longitude % 30, 6),
      nakshatra: nakshatraOf(longitude),
      retrograde: name === "Sun" || name === "Moon" ? false : speed < 0,
      house_from_natal_lagna: ((sign - natalAscSign + 12) % 12) + 1,
      house_from_natal_moon: ((sign - natalMoonSign + 12) % 12) + 1,
    });
  }
  const rahu = rows.find((row) => row.planet === "Rahu");
  const ketuLongitude = mod360(rahu.longitude + 180);
  const ketuSign = Math.floor(ketuLongitude / 30);
  rows.push({
    planet: "Ketu",
    longitude: pyRound(ketuLongitude, 6),
    sign: SIGNS[ketuSign],
    degree: pyRound(ketuLongitude % 30, 6),
    nakshatra: nakshatraOf(ketuLongitude),
    retrograde: rahu.retrograde,
    house_from_natal_lagna: ((ketuSign - natalAscSign + 12) % 12) + 1,
    house_from_natal_moon: ((ketuSign - natalMoonSign + 12) % 12) + 1,
  });
  return { calculated_at_utc: isoUtcMs(atMs), positions: rows };
}

/* ---------- main entry ---------- */

export function generateKundli(swe, details, transitDate = null) {
  swe.set_sid_mode(1, 0, 0);
  const [year, month, day] = details.birthDate.split("-").map(Number);
  const [hour, minute] = details.birthTime.split(":").map(Number);
  if (!isValidTimezone(details.timezoneName)) {
    throw new Error(`Unknown IANA timezone: ${details.timezoneName}`);
  }
  const utcDate = zonedToUtc(year, month, day, hour, minute, details.timezoneName);
  const jdUt = julianDay(swe, utcDate);
  const { data: houses, ascLongitude } = housesData(swe, jdUt, details.latitude, details.longitude);
  const positions = calcPositions(swe, jdUt, ascLongitude);

  const ascSign = Math.floor(ascLongitude / 30);
  const ascRecord = positionRecord("Ascendant", ascLongitude, 0, ascSign);
  const longitudes = { Ascendant: ascLongitude };
  const signPositions = { Ascendant: ascSign };
  for (const [name, item] of Object.entries(positions)) {
    longitudes[name] = item.longitude;
    signPositions[name] = item.sign_index;
  }
  const atMs = (transitDate || new Date()).getTime();

  return {
    instruction: DISCLAIMER,
    metadata: {
      app: "Kundli AI Exporter",
      generated_at_utc: isoUtcMs(Date.now()),
      zodiac: "Sidereal",
      ayanamsa: "Lahiri",
      ayanamsa_degrees: pyRound(swe.get_ayanamsa_ut(jdUt), 6),
      node: "True Node",
      main_house_method: "Whole Sign",
      bhava_chalit_method: "Sidereal Placidus cusps",
    },
    birth_details: {
      name: details.name,
      birth_date: details.birthDate,
      birth_time: `${pad(hour)}:${pad(minute)}:00`,
      timezone_name: details.timezoneName,
      latitude: details.latitude,
      longitude: details.longitude,
      place: details.place || "",
      local_datetime: isoLocal(utcDate, details.timezoneName),
      utc_datetime: isoUtcMs(utcDate.getTime()),
      julian_day_ut: pyRound(jdUt, 8),
    },
    ascendant: ascRecord,
    houses,
    planetary_positions: positions,
    bhava_chalit: bhavaChalit(positions, houses.cusps),
    divisional_charts: buildDivisionalCharts(longitudes),
    ashtakavarga: calculateAshtakavarga(signPositions),
    dashas: calculateDashas(utcDate.getTime(), positions.Moon.longitude, ascSign, signPositions, atMs),
    current_transits: transits(swe, atMs, ascSign, positions.Moon.sign_index),
    calculation_notes: [
      "Swiss Ephemeris with sidereal Lahiri ayanamsa and true lunar node.",
      "Main chart houses are whole-sign; Bhava Chalit uses sidereal Placidus cusps.",
      "Varga mappings follow common Parashara conventions; D30 uses unequal portions.",
      "Chara/Jaimini and Kalachakra outputs are explicitly labeled variants because lineage rules differ.",
    ],
  };
}

/* ---------- exporters ---------- */

function degreeDms(value) {
  const degrees = Math.floor(value);
  const minutesFloat = (value - degrees) * 60;
  let minutes = Math.floor(minutesFloat);
  let seconds = Math.round(pyRound((minutesFloat - minutes) * 60));
  if (seconds === 60) {
    seconds = 0;
    minutes += 1;
  }
  return `${pad(degrees)}°${pad(minutes)}'${pad(seconds)}"`;
}

function dashaLines(name, data) {
  const lines = [`\n${name.toUpperCase()}`, `Method: ${data.method}`];
  if (data.note) lines.push(`Note: ${data.note}`);
  if (data.current && Object.keys(data.current).length) {
    lines.push("Current: " + JSON.stringify(data.current).replace(/","/g, '", "').replace(/":"/g, '": "'));
  }
  lines.push("Periods (ending dates):");
  for (const md of data.periods) {
    lines.push(`  ${md.lord}: ends ${md.end}`);
    for (const ad of md.antardasha || []) {
      lines.push(`    ${md.lord}/${ad.lord}: ends ${ad.end}`);
      for (const pd of ad.pratyantar || []) {
        lines.push(`      ${md.lord}/${ad.lord}/${pd.lord}: ends ${pd.end}`);
      }
    }
  }
  return lines;
}

export function buildAiText(chart) {
  const birth = chart.birth_details;
  const asc = chart.ascendant;
  const lines = [
    "KUNDLI AI EXPORT",
    DISCLAIMER,
    "",
    "CALCULATION BASIS",
    `Sidereal zodiac | Ayanamsa: ${chart.metadata.ayanamsa} ` +
    `(${chart.metadata.ayanamsa_degrees}°) | Node: ${chart.metadata.node}`,
    `Main houses: ${chart.metadata.main_house_method} | ` +
    `Bhava Chalit: ${chart.metadata.bhava_chalit_method}`,
    "",
    "BIRTH DETAILS",
    `Name: ${birth.name}`,
    `Place: ${birth.place}`,
    `Local datetime: ${birth.local_datetime}`,
    `UTC datetime: ${birth.utc_datetime}`,
    `Coordinates: ${birth.latitude}, ${birth.longitude}`,
    "",
    "ASCENDANT",
    `${asc.sign} ${degreeDms(asc.degree)} | Nakshatra: ` +
    `${asc.nakshatra.name} Pada ${asc.nakshatra.pada}`,
    "",
    "PLANETARY POSITIONS (D1 / WHOLE-SIGN HOUSES)",
  ];
  for (const [name, row] of Object.entries(chart.planetary_positions)) {
    const retro = row.retrograde ? "R" : "Direct";
    lines.push(
      `${name}: ${row.sign} ${degreeDms(row.degree)} | ` +
      `${row.nakshatra.name} Pada ${row.nakshatra.pada} | ` +
      `House ${row.house} | ${retro}`
    );
  }

  lines.push("", "HOUSE CUSPS (SIDEREAL PLACIDUS)");
  for (const cusp of chart.houses.cusps) {
    lines.push(`House ${cusp.house}: ${cusp.sign} ${degreeDms(cusp.degree)}`);
  }

  lines.push("", "BHAVA CHALIT");
  for (const row of chart.bhava_chalit) {
    lines.push(`${row.planet}: Rashi house ${row.rashi_house} -> Bhava house ${row.bhava_house}`);
  }

  lines.push("", "DIVISIONAL CHARTS (SIGN / HOUSE)");
  for (const [code, varga] of Object.entries(chart.divisional_charts)) {
    lines.push(`\n${code} ${varga.name}:`);
    const chunks = Object.entries(varga.placements).map(([body, placement]) =>
      `${body}=${placement.sign} ${degreeDms(placement.degree)} H${placement.house}`);
    lines.push(chunks.join(" | "));
  }

  lines.push("", "ASHTAKAVARGA");
  const sav = chart.ashtakavarga.sarvashtakavarga;
  lines.push("Sarvashtakavarga: " + Object.entries(sav.scores_by_sign)
    .map(([sign, score]) => `${sign}=${score}`).join(" | "));
  for (const [planet, data] of Object.entries(chart.ashtakavarga.bhinna_ashtakavarga)) {
    lines.push(`${planet} BAV: ` + Object.entries(data.scores_by_sign)
      .map(([sign, score]) => `${sign}=${score}`).join(" | "));
  }

  lines.push("", "DASHAS", "All dates below are ENDING dates.");
  for (const [name, dasha] of Object.entries(chart.dashas)) {
    lines.push(...dashaLines(name, dasha));
  }

  lines.push("", "CURRENT SIDEREAL TRANSITS");
  lines.push(`Calculated at UTC: ${chart.current_transits.calculated_at_utc}`);
  for (const row of chart.current_transits.positions) {
    const retro = row.retrograde ? " R" : "";
    lines.push(
      `${row.planet}: ${row.sign} ${degreeDms(row.degree)}${retro} | ` +
      `${row.nakshatra.name} P${row.nakshatra.pada} | ` +
      `H${row.house_from_natal_lagna} from Lagna | ` +
      `H${row.house_from_natal_moon} from Moon`
    );
  }

  lines.push(
    "",
    "ANALYSIS INSTRUCTION",
    DISCLAIMER,
    "Analyze the chart using the supplied placements, houses, vargas, dashas, " +
    "Ashtakavarga, and transits. State which supplied factors support each conclusion."
  );
  return lines.join("\n");
}

export function buildJson(chart) {
  return JSON.stringify(chart, null, 2);
}
