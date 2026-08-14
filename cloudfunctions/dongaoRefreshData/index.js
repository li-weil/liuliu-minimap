const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const TIDE_SITE_CODE = 'T154';
const WEATHERCN_API_HOST = process.env.WEATHERCN_API_HOST || 'openapi.weathercn.com';
const WEATHERCN_LOCATION_KEY = process.env.WEATHERCN_LOCATION_KEY || '';
const WEATHERCN_LANGUAGE = process.env.WEATHERCN_LANGUAGE || 'zh-cn';
const DONGAO_COORDINATE_SYSTEM = String(process.env.DONGAO_COORDINATE_SYSTEM || 'gcj02').toLowerCase();
const DONGAO_COORDINATE = {
  latitude: Number(process.env.DONGAO_LATITUDE || 22.01927),
  longitude: Number(process.env.DONGAO_LONGITUDE || 113.712927),
};
const TIDE_API_URL = 'https://mds.nmdis.org.cn/service/rdata/front/knowledge/chaoxidata/list';

function requestText(urlString, options = {}) {
  const url = new URL(urlString);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            const error = new Error(`http_${res.statusCode}`);
            error.statusCode = res.statusCode;
            error.bodySnippet = String(data || '').slice(0, 240);
            reject(error);
            return;
          }
          resolve(data);
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(options.timeoutMs || 15000, () => req.destroy(new Error('timeout')));
    if (options.body) req.write(options.body);
    req.end();
  });
}

function requestJson(urlString, options = {}) {
  return requestText(urlString, options).then((text) => {
    try {
      return JSON.parse(text || '{}');
    } catch (err) {
      err.message = `json_parse_failed: ${err.message}`;
      err.bodySnippet = String(text || '').slice(0, 240);
      throw err;
    }
  });
}

function getWeatherApiKey() {
  const key = process.env.WEATHERCN_API_KEY || '';
  if (!key) throw new Error('missing_weathercn_api_key');
  return key;
}

function buildWeatherCnUrl(pathname, query = {}) {
  const url = new URL(`https://${WEATHERCN_API_HOST}${pathname}`);
  Object.keys(query).forEach((key) => {
    const value = query[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function formatClock(isoString) {
  const match = String(isoString || '').match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : '';
}

function valueOfMetric(node) {
  if (!node) return null;
  if (node.Metric && node.Metric.Value !== undefined) return Number(node.Metric.Value);
  if (node.Value !== undefined) return Number(node.Value);
  return null;
}

function unitOfMetric(node) {
  if (!node) return '';
  if (node.Metric && node.Metric.Unit) return node.Metric.Unit;
  return node.Unit || '';
}

function tempValue(node) {
  const value = valueOfMetric(node);
  return Number.isFinite(value) ? value : null;
}

function normalizeIcon(icon) {
  if (icon === undefined || icon === null || icon === '') return '';
  return String(icon).padStart(2, '0');
}

function normalizeLiquid(node) {
  const value = valueOfMetric(node);
  if (!Number.isFinite(value)) return '';
  const unit = unitOfMetric(node) || 'mm';
  return `${value}${unit}`;
}

function transformLat(x, y) {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  ret += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  ret += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  return ret;
}

function transformLng(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  ret += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  ret += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  return ret;
}

function wgs84ToGcj02(latitude, longitude) {
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  let dLat = transformLat(longitude - 105.0, latitude - 35.0);
  let dLng = transformLng(longitude - 105.0, latitude - 35.0);
  const radLat = latitude / 180.0 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return {
    latitude: latitude + dLat,
    longitude: longitude + dLng,
  };
}

async function fetchWeatherLocation() {
  if (WEATHERCN_LOCATION_KEY) return { Key: WEATHERCN_LOCATION_KEY, LocalizedName: '东澳岛' };

  const gcj = DONGAO_COORDINATE_SYSTEM === 'wgs84'
    ? wgs84ToGcj02(DONGAO_COORDINATE.latitude, DONGAO_COORDINATE.longitude)
    : DONGAO_COORDINATE;
  const q = `${gcj.latitude.toFixed(6)},${gcj.longitude.toFixed(6)}`;
  const url = buildWeatherCnUrl('/locations/v1/cities/geoposition/search.json', {
    q,
    apikey: getWeatherApiKey(),
    language: WEATHERCN_LANGUAGE,
    details: true,
  });
  const location = await requestJson(url, {
    headers: { Accept: 'application/json' },
  });
  if (!location || !location.Key) {
    const error = new Error('weathercn_location_not_found');
    error.bodySnippet = JSON.stringify(location || {}).slice(0, 240);
    throw error;
  }
  return location;
}

async function fetchWeatherCnJson(pathname, query = {}) {
  const url = buildWeatherCnUrl(pathname, {
    apikey: getWeatherApiKey(),
    language: WEATHERCN_LANGUAGE,
    ...query,
  });
  const data = await requestJson(url, {
    headers: { Accept: 'application/json' },
  });
  const code = data && (data.Code || data.code || data.StatusCode || data.statusCode);
  const message = data && (data.Message || data.message || data.Msg || data.msg);
  if (code && String(code) !== '200' && String(code) !== '0') {
    const error = new Error(`weathercn_api_${code}${message ? `_${message}` : ''}`);
    error.bodySnippet = JSON.stringify(data).slice(0, 240);
    throw error;
  }
  if (message && /unauthorized|无权限/i.test(String(message))) {
    const error = new Error(`weathercn_api_unauthorized_${message}`);
    error.bodySnippet = JSON.stringify(data).slice(0, 240);
    throw error;
  }
  return data;
}

function normalizeRealtimeWeather(rows, dailyForecast) {
  const row = Array.isArray(rows) ? rows[0] : rows;
  const firstDay = Array.isArray(dailyForecast) ? dailyForecast[0] : null;
  const result = {};
  if (row) {
    result.date = row.LocalObservationDateTime || '';
    result.current_temp = tempValue(row.Temperature);
    result.current_weather = row.WeatherText || '';
    result.weather_icon = normalizeIcon(row.WeatherIcon);
    result.weather_icon_text = row.WeatherText || '';
    result.is_daytime = row.IsDayTime;
    result.uv = row.UVIndexText || '';
    result.cloud_cover = row.CloudCover;
    result.precip_1h = normalizeLiquid(row.Precip1hr);
  }
  if (firstDay && firstDay.Sun) {
    result.sunrise = formatClock(firstDay.Sun.Rise);
    result.sunset = formatClock(firstDay.Sun.Set);
  } else if (firstDay) {
    result.sunrise = firstDay.sunrise || '';
    result.sunset = firstDay.sunset || '';
  }
  return result;
}

function normalizeDailyForecast(daily) {
  const days = daily && Array.isArray(daily.DailyForecasts) ? daily.DailyForecasts : [];
  return days.map((day) => {
    const min = tempValue(day.Temperature && day.Temperature.Minimum);
    const max = tempValue(day.Temperature && day.Temperature.Maximum);
    const dayWeather = day.Day && (day.Day.IconPhrase || day.Day.ShortPhrase || day.Day.LongPhrase);
    const nightWeather = day.Night && (day.Night.IconPhrase || day.Night.ShortPhrase || day.Night.LongPhrase);
    return {
      date: day.Date || '',
      weather: dayWeather || nightWeather || '',
      day_weather: dayWeather || '',
      night_weather: nightWeather || '',
      weather_icon: normalizeIcon(day.Day && day.Day.Icon),
      temp_range: Number.isFinite(min) && Number.isFinite(max) ? `${min}~${max}°C` : '',
      sunrise: formatClock(day.Sun && day.Sun.Rise),
      sunset: formatClock(day.Sun && day.Sun.Set),
      precipitation_probability: day.Day && day.Day.PrecipitationProbability,
    };
  });
}

function normalizeHourlyForecast(hourlyRows) {
  const rows = Array.isArray(hourlyRows) ? hourlyRows : [];
  return rows.map((row) => {
    const totalLiquid = normalizeLiquid(row.TotalLiquid || row.Rain);
    return {
      datetime: row.DateTime || '',
      time: formatClock(row.DateTime),
      temp: tempValue(row.Temperature),
      weather: row.IconPhrase || '',
      weather_icon: normalizeIcon(row.WeatherIcon),
      precipitation_probability: row.PrecipitationProbability,
      rain_probability: row.RainProbability,
      precipitation: totalLiquid,
      cloud_cover: row.CloudCover,
      is_daylight: row.IsDaylight,
    };
  });
}

function getChinaHour() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCHours();
}

function selectCurrentHourlyForecast(hourlyForecast) {
  const currentHour = getChinaHour();
  return (hourlyForecast || []).find((row) => {
    const match = String(row.datetime || row.time || '').match(/T(\d{2}):|^(\d{2}):/);
    const hour = match ? Number(match[1] || match[2]) : null;
    return hour === currentHour;
  }) || (hourlyForecast || [])[0] || null;
}

async function fetchWeather() {
  const location = await fetchWeatherLocation();
  const locationKey = location.Key;
  const [current, daily, hourly] = await Promise.all([
    fetchWeatherCnJson(`/currentconditions/v1/${locationKey}.json`, { details: true }),
    fetchWeatherCnJson(`/forecasts/v1/daily/5day/${locationKey}.json`, { details: true, metric: true }),
    fetchWeatherCnJson(`/forecasts/v1/hourly/24hour/${locationKey}.json`, { details: true, metric: true }),
  ]);
  const dailyForecast = normalizeDailyForecast(daily);
  const hourlyForecast = normalizeHourlyForecast(hourly);
  if (!hourlyForecast.length) {
    const error = new Error('weathercn_hourly_no_data');
    error.bodySnippet = JSON.stringify(hourly || {}).slice(0, 240);
    throw error;
  }
  return {
    source: 'https://openapi.weathercn.com',
    provider: '华风爱科',
    location: location.LocalizedName || location.EnglishName || '东澳岛',
    location_key: locationKey,
    coordinate: {
      input: {
        ...DONGAO_COORDINATE,
        system: DONGAO_COORDINATE_SYSTEM,
      },
      weathercn_query: DONGAO_COORDINATE_SYSTEM === 'wgs84'
        ? wgs84ToGcj02(DONGAO_COORDINATE.latitude, DONGAO_COORDINATE.longitude)
        : DONGAO_COORDINATE,
    },
    scraped_at: new Date().toISOString(),
    realtime: normalizeRealtimeWeather(current, dailyForecast),
    daily_forecast: dailyForecast,
    hourly_forecast: hourlyForecast,
  };
}

function getChinaDateString() {
  const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const y = chinaNow.getUTCFullYear();
  const m = String(chinaNow.getUTCMonth() + 1).padStart(2, '0');
  const d = String(chinaNow.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function fetchTide() {
  const dateStr = getChinaDateString();
  const text = await requestText(TIDE_API_URL, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Content-Type': 'application/json;charset=UTF-8',
      Referer: 'https://mds.nmdis.org.cn/pages/tidalCurrent.html',
    },
    body: JSON.stringify({ serchdate: dateStr, sitecode: TIDE_SITE_CODE }),
  });
  const response = JSON.parse(text || '{}');
  if (!response.success || !Array.isArray(response.data) || !response.data.length) {
    throw new Error(`tide_no_data_${dateStr}`);
  }
  const raw = response.data[0];
  const fd = raw.filedata || {};
  const tideTable = [];
  for (let i = 0; i < 4; i += 1) {
    const time = fd[`cs${i}`];
    const heightCm = fd[`cg${i}`];
    if (time && heightCm !== undefined && heightCm !== null) {
      tideTable.push({
        time,
        height_cm: Number(heightCm),
        height_m: Math.round((Number(heightCm) / 100) * 100) / 100,
      });
    }
  }
  const hourly = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const heightCm = fd[`a${hour}`];
    if (heightCm !== undefined && heightCm !== null) {
      hourly.push({
        hour,
        height_cm: Number(heightCm),
        height_m: Math.round((Number(heightCm) / 100) * 100) / 100,
      });
    }
  }
  return {
    source: 'https://mds.nmdis.org.cn/pages/tidalCurrent.html',
    provider: '国家海洋信息中心',
    location: raw.title || '东澳岛',
    sitecode: raw.sitecode || TIDE_SITE_CODE,
    date: raw.serchdate || dateStr,
    scraped_at: new Date().toISOString(),
    coordinate: String(raw.coordinate || '').trim(),
    benchmark: raw.benchmark || '',
    timezone: raw.timearea || '',
    tide_table: tideTable,
    hourly,
  };
}

async function uploadJson(cloudPath, data) {
  const fileContent = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
  await cloud.uploadFile({ cloudPath, fileContent });
}

exports.main = async () => {
  const startedAt = new Date().toISOString();
  console.log(`[dongaoRefreshData] start: ${startedAt}`);
  const results = {
    ok: true,
    startedAt,
    finishedAt: '',
    weather: null,
    tide: null,
    errors: [],
  };

  try {
    const weather = await fetchWeather();
    await uploadJson('dongao-data/weather.json', weather);
    results.weather = {
      ok: true,
      provider: weather.provider,
      source: weather.source,
      location: weather.location,
      locationKey: weather.location_key,
      hourlyCount: weather.hourly_forecast.length,
      dailyCount: weather.daily_forecast.length,
      realtime: {
        weather: weather.realtime.current_weather,
        temp: weather.realtime.current_temp,
        sunrise: weather.realtime.sunrise,
        sunset: weather.realtime.sunset,
      },
      currentHourForecast: selectCurrentHourlyForecast(weather.hourly_forecast),
      scrapedAt: weather.scraped_at,
    };
  } catch (err) {
    console.error('[dongaoRefreshData] weather failed:', err);
    results.ok = false;
    results.errors.push({
      type: 'weather',
      message: err.message || String(err),
      statusCode: err.statusCode || null,
      bodySnippet: err.bodySnippet || '',
    });
  }

  try {
    const tide = await fetchTide();
    await uploadJson('dongao-data/tide.json', tide);
    results.tide = {
      ok: true,
      hourlyCount: tide.hourly.length,
      tideTableCount: tide.tide_table.length,
      date: tide.date,
      scrapedAt: tide.scraped_at,
    };
  } catch (err) {
    console.error('[dongaoRefreshData] tide failed:', err);
    results.ok = false;
    results.errors.push({ type: 'tide', message: err.message || String(err) });
  }

  results.finishedAt = new Date().toISOString();
  return results;
};
