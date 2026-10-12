/** Trusted Connect IQ readers. No template can supply a reader or source code. */
import { conversion, resolveUnits } from './units.js';

const field = (object, name) => `(${object} != null && (${object} has :${name}) ? ${object}.${name} : null)`;
const activity = name => field('activity', name);
const stats = name => field('stats', name);
const profile = name => field('profile', name);
const weather = name => field('weather', name);
const read = (expression, ...needs) => ({ expression, needs });
const number = expression => `numberText(${expression}, false)`;
const decimal = (expression, places = 1, divisor = 1) => `scaledText(${expression}, ${Number.isInteger(divisor) ? `${divisor}.0` : divisor}, ${places})`;
const sensor = kind => `latestSensor(${JSON.stringify(kind)})`;
const native = name => `nativeComplication(${JSON.stringify(name)})`;
const weekdays = 'weekdayText(date.day_of_week)';

const READERS = Object.freeze({
  seconds: read('clock.sec.format("%02d")', 'clock'),
  weekday: read(weekdays, 'date'), day: read(number('date.day'), 'date'),
  month: read('monthText(date.month)', 'date'), year: read(number('date.year'), 'date'),
  weekdayDay: read(`${weekdays} + " " + date.day.toString()`, 'date'),
  utcTime: read('utcTimeText()', 'clock'), utcOffset: read('utcOffsetText()', 'clock'),
  stepGoal: read(`numberText(${activity('stepGoal')}, true)`, 'activity'),
  stepProgress: read(`percentText(${activity('steps')}, ${activity('stepGoal')})`, 'activity'),
  floorsGoal: read(number(activity('floorsClimbedGoal')), 'activity'),
  floorsProgress: read(`percentText(${activity('floorsClimbed')}, ${activity('floorsClimbedGoal')})`, 'activity'),
  floorsDescended: read(number(activity('floorsDescended')), 'activity'),
  ascent: read(number(activity('metersClimbed')), 'activity'), descent: read(number(activity('metersDescended')), 'activity'),
  moveBar: read(number(activity('moveBarLevel')), 'activity'),
  intensityMinutes: read('activeMinutesText(activity, false, "total")', 'activity'),
  intensityWeek: read('activeMinutesText(activity, true, "total")', 'activity'),
  intensityGoal: read(number(activity('activeMinutesWeekGoal')), 'activity'),
  intensityProgress: read(`activeProgressText(activity, ${activity('activeMinutesWeekGoal')})`, 'activity'),
  moderateMinutes: read('activeMinutesText(activity, false, "moderate")', 'activity'),
  vigorousMinutes: read('activeMinutesText(activity, false, "vigorous")', 'activity'),
  respiration: read(decimal(activity('respirationRate')), 'activity'),
  recovery: read(number(activity('timeToRecovery')), 'activity'),
  bodyBattery: read(number(sensor('bodyBattery')), 'sensor'),
  stress: read(number(sensor('stress')), 'sensor'),
  pulseOx: read(`validPercentText(${sensor('pulseOx')})`, 'sensor'),
  altitude: read(`numberText(${sensor('altitude')}, true)`, 'sensor'),
  pressure: read(decimal(sensor('pressure'), 0, 100), 'sensor'),
  sensorTemperature: read(decimal(sensor('sensorTemperature')), 'sensor'),
  restingHeart: read(number(profile('restingHeartRate')), 'profile'),
  averageRestingHeart: read(number(profile('averageRestingHeartRate')), 'profile'),
  vo2Running: read(number(profile('vo2maxRunning')), 'profile'),
  vo2Cycling: read(number(profile('vo2maxCycling')), 'profile'),
  weight: read(decimal(profile('weight'), 1, 1000), 'profile'),
  userHeight: read(number(profile('height')), 'profile'),
  sleepTime: read(`configuredTimeText(${profile('sleepTime')})`, 'profile'),
  wakeTime: read(`configuredTimeText(${profile('wakeTime')})`, 'profile'),
  batteryDays: read(decimal(stats('batteryInDays')), 'stats'),
  charging: read(`flagText(${stats('charging')}, "YES", "NO")`, 'stats'),
  solar: read(`validPercentText(${stats('solarIntensity')})`, 'stats'),
  notifications: read(number(field('settings', 'notificationCount')), 'settings'),
  alarms: read(number(field('settings', 'alarmCount')), 'settings'),
  phone: read(`flagText(${field('settings', 'phoneConnected')}, "ON", "OFF")`, 'settings'),
  dnd: read(`flagText(${field('settings', 'doNotDisturb')}, "ON", "OFF")`, 'settings'),
  temperature: read(decimal(weather('temperature'), 0), 'weather'),
  feelsLike: read(decimal(weather('feelsLikeTemperature'), 0), 'weather'),
  temperatureHigh: read(decimal(weather('highTemperature'), 0), 'weather'),
  temperatureLow: read(decimal(weather('lowTemperature'), 0), 'weather'),
  temperatureRange: read(`temperatureRangeText(${weather('highTemperature')}, ${weather('lowTemperature')})`, 'weather'),
  weather: read(`weatherText(${weather('condition')})`, 'weather'),
  rain: read(`validPercentText(${weather('precipitationChance')})`, 'weather'),
  humidity: read(`validPercentText(${weather('relativeHumidity')})`, 'weather'),
  windSpeed: read(decimal(weather('windSpeed'), 0, 1 / 3.6), 'weather'),
  windDirection: read(number(weather('windBearing')), 'weather'),
  weatherAge: read(`weatherAgeText(${weather('observationTime')})`, 'weather'),
  sunrise: read('sunText(weather, true)', 'weather', 'sun'),
  sunset: read('sunText(weather, false)', 'weather', 'sun'),
  uvIndex: read(decimal(weather('uvIndex')), 'weather'),
  cloudCover: read(`validPercentText(${weather('cloudCover')})`, 'weather'),
  dewPoint: read(decimal(weather('dewPoint'), 0), 'weather'),
  visibility: read(decimal(weather('visibility'), 1, 1000), 'weather'),
  weatherPressure: read(decimal(weather('pressure'), 0, 100), 'weather'),
  forecast1: read('forecastWeatherText(forecasts, 1)', 'forecast'),
  forecast2: read('forecastWeatherText(forecasts, 2)', 'forecast'),
  forecast3: read('forecastWeatherText(forecasts, 3)', 'forecast'),
  nextEvent: read(`stringText(${native('nextEvent')})`, 'complications'),
  weeklyRun: read(decimal(native('weeklyRun'), 1, 1000), 'complications'),
  weeklyBike: read(decimal(native('weeklyBike'), 1, 1000), 'complications'),
  trainingStatus: read(`stringText(${native('trainingStatus')})`, 'complications'),
  race5k: read(`durationText(${native('race5k')})`, 'complications'),
  race10k: read(`durationText(${native('race10k')})`, 'complications'),
  raceHalf: read(`durationText(${native('raceHalf')})`, 'complications'),
  raceMarathon: read(`durationText(${native('raceMarathon')})`, 'complications'),
  racePace5k: read(`paceText(${native('racePace5k')})`, 'complications'),
  racePace10k: read(`paceText(${native('racePace10k')})`, 'complications'),
  racePaceHalf: read(`paceText(${native('racePaceHalf')})`, 'complications'),
  racePaceMarathon: read(`paceText(${native('racePaceMarathon')})`, 'complications'),
  wheelchairPushes: read(number(native('wheelchairPushes')), 'complications'),
  lastGolfScore: read(`stringText(${native('lastGolfScore')})`, 'complications'),
  sleepScore: read(number(native('sleepScore')), 'complications'),
});

const NATIVE_TYPES = Object.freeze({ nextEvent: 'CALENDAR_EVENTS', weeklyRun: 'WEEKLY_RUN_DISTANCE', weeklyBike: 'WEEKLY_BIKE_DISTANCE',
  trainingStatus: 'TRAINING_STATUS', race5k: 'RACE_PREDICTOR_5K', race10k: 'RACE_PREDICTOR_10K', raceHalf: 'RACE_PREDICTOR_HALF_MARATHON',
  raceMarathon: 'RACE_PREDICTOR_MARATHON', racePace5k: 'RACE_PACE_PREDICTOR_5K', racePace10k: 'RACE_PACE_PREDICTOR_10K',
  racePaceHalf: 'RACE_PACE_PREDICTOR_HALF_MARATHON', racePaceMarathon: 'RACE_PACE_PREDICTOR_MARATHON',
  wheelchairPushes: 'WHEELCHAIR_PUSHES', lastGolfScore: 'LAST_GOLF_ROUND_SCORE', sleepScore: 'SLEEP_SCORE' });

export function supportsComplications(device) {
  return ['instinct3solar45mm', 'instinct3amoled45mm', 'instinct3amoled50mm', 'instincte40mm', 'instincte45mm', 'instinctcrossoveramoled'].includes(device.id);
}

const doubleLiteral = value => `${Number.isInteger(value) ? `${value}.0` : value}d`;

/** Garmin readers use documented raw units; normalize exactly once before display. */
export function unitNumberExpression(expression, category, units, places, group = false, rawDivisor = 1) {
  const { factor, offset } = conversion(category, units);
  const nonnegative = ['distance', 'speed', 'weight', 'height'].includes(category);
  return `unitNumberText(${expression}, ${doubleLiteral(factor / rawDivisor)}, ${doubleLiteral(offset)}, ${places}, ${group}, ${nonnegative})`;
}

function convertedMetricExpression(type, units) {
  const selected = resolveUnits(units);
  const temperatureFields = { sensorTemperature: sensor('sensorTemperature'), temperature: weather('temperature'),
    feelsLike: weather('feelsLikeTemperature'), temperatureHigh: weather('highTemperature'), temperatureLow: weather('lowTemperature'), dewPoint: weather('dewPoint') };
  if (Object.hasOwn(temperatureFields, type)) return unitNumberExpression(temperatureFields[type], 'temperature', selected, type === 'sensorTemperature' ? 1 : 0);
  if (['altitude', 'ascent', 'descent'].includes(type)) return unitNumberExpression(type === 'altitude' ? sensor('altitude') : activity(type === 'ascent' ? 'metersClimbed' : 'metersDescended'), 'elevation', selected, 0, true);
  if (['pressure', 'weatherPressure'].includes(type)) return unitNumberExpression(type === 'pressure' ? sensor('pressure') : weather('pressure'), 'pressure', selected,
    selected.pressure === 'inhg' ? 2 : selected.pressure === 'mmhg' ? 1 : 0, false, 100);
  if (type === 'windSpeed') return unitNumberExpression(weather('windSpeed'), 'speed', selected, selected.speed === 'kmh' ? 0 : 1, false, 1 / 3.6);
  if (type === 'visibility') return unitNumberExpression(weather('visibility'), 'distance', selected, 1, false, 1000);
  if (['weeklyRun', 'weeklyBike'].includes(type)) return unitNumberExpression(native(type), 'distance', selected, 1, false, 1000);
  if (type === 'weight') return unitNumberExpression(profile('weight'), 'weight', selected, 1, false, 1000);
  if (type === 'userHeight') return selected.height === 'ftin' ? `unitHeightText(${profile('height')})` : unitNumberExpression(profile('height'), 'height', selected, 0);
  if (['racePace5k', 'racePace10k', 'racePaceHalf', 'racePaceMarathon'].includes(type)) return `unitPaceText(${native(type)}, ${selected.distance === 'mi' ? '1609.344d' : '1000.0d'})`;
  return null;
}

export function metricExpression(element, device, units) {
  const reader = READERS[element.type];
  if (!reader) return null;
  return reader.needs.includes('complications') && !supportsComplications(device) ? '"--"' : convertedMetricExpression(element.type, units) ?? reader.expression;
}

export function metricDependencies(elements, device) {
  const result = new Set();
  for (const element of elements.filter(element => element.visible !== false)) {
    const reader = READERS[element.type];
    for (const need of reader?.needs ?? []) if (need !== 'complications' || supportsComplications(device)) result.add(need);
    if (element.type === 'time') result.add('clock');
    if (element.type === 'date') result.add('date');
    if (['steps', 'calories', 'floors', 'distance'].includes(element.type)) result.add('activity');
    if (element.type === 'heart') result.add('heart');
    if (element.type === 'battery') result.add('stats');
    if (['progressBar', 'progressRing'].includes(element.type)) result.add(element.source === 'battery' ? 'stats' : 'activity');
  }
  return result;
}

export function metricPermissions(elements, device) {
  const needs = metricDependencies(elements, device);
  return ['sensor', 'profile', 'sun', 'complications'].filter(key => needs.has(key))
    .map(key => ({ sensor: 'SensorHistory', profile: 'UserProfile', sun: 'Positioning', complications: 'ComplicationSubscriber' })[key]);
}

export function metricImports(elements, device) {
  const needs = metricDependencies(elements, device);
  return ['sensor', 'profile', 'weather', 'complications'].filter(key => needs.has(key))
    .map(key => `using Toybox.${({ sensor: 'SensorHistory', profile: 'UserProfile', weather: 'Weather', complications: 'Complications' })[key]};`)
    .concat(needs.has('forecast') && !needs.has('weather') ? ['using Toybox.Weather;'] : []).join('\n');
}

export function metricSetupSource(elements, device) {
  const needs = metricDependencies(elements, device);
  return [needs.has('clock') ? '        var clock = System.getClockTime();' : '',
    needs.has('date') ? '        var date = Gregorian.info(Time.now(), Time.FORMAT_SHORT);' : '',
    needs.has('activity') ? '        var activity = ActivityMonitor.getInfo();' : '',
    needs.has('stats') ? '        var stats = System.getSystemStats();' : '',
    needs.has('heart') ? '        var heartRate = latestHeartRate();' : '',
    elements.some(e => e.visible !== false && e.type === 'floors') ? '        var floors = null;\n        if (activity has :floorsClimbed) { floors = activity.floorsClimbed; }' : '',
    needs.has('settings') ? '        var settings = System.getDeviceSettings();' : '',
    needs.has('profile') ? '        var profile = cachedProfile();' : '',
    needs.has('weather') ? '        var weather = cachedWeather();' : '',
    needs.has('forecast') ? '        var forecasts = cachedForecasts();' : '',
  ].filter(Boolean).join('\n');
}

export function progressExpressions(source) {
  const sources = { steps: { valueExpression: activity('steps'), goalExpression: activity('stepGoal') },
    floors: { valueExpression: activity('floorsClimbed'), goalExpression: activity('floorsClimbedGoal') },
    battery: { valueExpression: stats('battery'), goalExpression: '100' },
    calories: { valueExpression: activity('calories'), goalExpression: '2000' },
    distance: { valueExpression: `(activity != null && (activity has :distance) && activity.distance != null ? activity.distance / 100000.0 : null)`, goalExpression: '10' } };
  if (!Object.hasOwn(sources, source)) throw new Error('Unsupported progress source.');
  return sources[source];
}

/** Match browser rounding (half away from zero), decimal padding and unit carries. */
export function unitMethodsSource() {
  return `
    function unitNumberText(value, factor, offset, places, groupThousands, nonnegative) {
        // Check before adding the Fahrenheit offset: missing never becomes 32 F.
        if (value == null) { return "--"; }
        var converted = value.toDouble() * factor + offset;
        if (nonnegative && converted < 0) { converted = 0.0d; }
        var scale = places == 2 ? 100 : places == 1 ? 10 : 1;
        var magnitude = converted < 0 ? -converted : converted;
        // Integer formatting avoids device-specific Float.format tie rounding.
        var rounded = (magnitude * scale + 0.5d + 0.000000001d).toNumber();
        var whole = (rounded / scale).toNumber();
        var text = numberText(whole, groupThousands);
        if (places > 0) { text += "." + (rounded % scale).format(places == 2 ? "%02d" : "%d"); }
        return converted < 0 && rounded != 0 ? "-" + text : text;
    }

    function unitHeightText(centimeters) {
        if (centimeters == null) { return "--"; }
        if (centimeters < 0) { centimeters = 0; }
        // Round total inches first so 5 feet 11.5 inches carries to 6 feet.
        var inches = (centimeters.toDouble() / 2.54d + 0.5d + 0.000000001d).toNumber();
        return (inches / 12).toNumber().toString() + "'" + (inches % 12).toString() + "\\\"";
    }

    function unitPaceText(speed, distanceMeters) {
        if (speed == null || speed <= 0) { return "--"; }
        // Garmin predicts pace as meters/second; round seconds before splitting.
        var seconds = (distanceMeters / speed.toDouble() + 0.5d + 0.000000001d).toNumber();
        var minutes = (seconds / 60).toNumber();
        return minutes.toString() + ":" + (seconds % 60).format("%02d");
    }
`;
}

const WEATHER_NAMES = ['CLEAR', 'PARTLY CLOUDY', 'MOSTLY CLOUDY', 'RAIN', 'SNOW', 'WINDY', 'THUNDER', 'WINTRY MIX', 'FOG', 'HAZY', 'HAIL', 'SHOWERS', 'THUNDER', 'PRECIPITATION', 'LIGHT RAIN', 'HEAVY RAIN', 'LIGHT SNOW', 'HEAVY SNOW', 'RAIN/SNOW', 'RAIN/SNOW', 'CLOUDY', 'RAIN/SNOW', 'PARTLY CLEAR', 'MOSTLY CLEAR', 'LIGHT SHOWERS', 'SHOWERS', 'HEAVY SHOWERS', 'CHANCE SHOWERS', 'CHANCE THUNDER', 'MIST', 'DUST', 'DRIZZLE', 'TORNADO', 'SMOKE', 'ICE', 'SAND', 'SQUALL', 'SANDSTORM', 'VOLCANIC ASH', 'HAZE', 'FAIR', 'HURRICANE', 'TROPICAL STORM', 'CHANCE SNOW', 'CHANCE RAIN/SNOW', 'CHANCE RAIN', 'CHANCE SNOW', 'CHANCE RAIN/SNOW', 'FLURRIES', 'FREEZING RAIN', 'SLEET', 'ICE/SNOW', 'THIN CLOUDS', 'UNKNOWN'];

export function metricMethodsSource(elements, device, units) {
  const needs = metricDependencies(elements, device);
  const selected = new Set(elements.filter(e => e.visible !== false).map(e => e.type));
  if (![...selected].some(type => READERS[type])) return '';
  const sensorReaders = { bodyBattery: 'getBodyBatteryHistory', stress: 'getStressHistory', pulseOx: 'getOxygenSaturationHistory',
    altitude: 'getElevationHistory', pressure: 'getPressureHistory', sensorTemperature: 'getTemperatureHistory' };
  return `
    function scaledText(value, divisor, places) {
        if (value == null) { return "--"; }
        var scaled = value / divisor;
        if (places == 0) { return scaled.format("%.0f"); }
        return scaled.format("%.1f");
    }

    function stringText(value) { return value == null ? "--" : value.toString(); }

    function flagText(value, yes, no) { return value == null ? "--" : value ? yes : no; }

    function validPercentText(value) {
        if (value == null || value < 0 || value > 100) { return "--"; }
        return value.format("%.0f") + "%";
    }

    function percentText(value, goal) {
        if (value == null || goal == null || goal <= 0) { return "--"; }
        return (value * 100.0 / goal).format("%.0f") + "%";
    }

    function durationText(value) {
        if (value == null || value < 0) { return "--"; }
        var seconds = value.toNumber();
        var hours = (seconds / 3600).toNumber();
        var minutes = ((seconds % 3600) / 60).toNumber();
        var remainder = seconds % 60;
        return hours > 0 ? hours.toString() + ":" + minutes.format("%02d") + ":" + remainder.format("%02d") : minutes.toString() + ":" + remainder.format("%02d");
    }

    function paceText(speed) { return speed == null || speed <= 0 ? "--" : durationText(1000.0 / speed); }

    function configuredTimeText(duration) {
        if (duration == null) { return "--"; }
        var seconds = duration.value();
        return ((seconds / 3600) % 24).toNumber().format("%02d") + ":" + ((seconds % 3600) / 60).toNumber().format("%02d");
    }

    function utcTimeText() {
        var utc = Gregorian.utcInfo(Time.now(), Time.FORMAT_SHORT);
        return utc.hour.format("%02d") + ":" + utc.min.format("%02d");
    }

    function utcOffsetText() {
        // Interpret the local wall time as UTC to include today's DST offset.
        var now = Time.now();
        var local = Gregorian.info(now, Time.FORMAT_SHORT);
        var wallTime = Gregorian.moment({ :year => local.year, :month => local.month, :day => local.day, :hour => local.hour, :minute => local.min, :second => local.sec });
        return scaledText(wallTime.value() - now.value(), 3600.0, 1);
    }

    function weekdayText(day) { return ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][day - 1]; }
    function monthText(month) { return ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][month - 1]; }

    function activeMinutesText(info, weekly, kind) {
        var minutes = null;
        if (info != null && weekly && (info has :activeMinutesWeek)) { minutes = info.activeMinutesWeek; }
        else if (info != null && !weekly && (info has :activeMinutesDay)) { minutes = info.activeMinutesDay; }
        if (minutes == null) { return "--"; }
        if (kind.equals("moderate") && (minutes has :moderate)) { return numberText(minutes.moderate, false); }
        if (kind.equals("vigorous") && (minutes has :vigorous)) { return numberText(minutes.vigorous, false); }
        if (minutes has :total) { return numberText(minutes.total, false); }
        return "--";
    }

    function activeProgressText(info, goal) {
        if (info == null || !(info has :activeMinutesWeek) || info.activeMinutesWeek == null) { return "--"; }
        var minutes = info.activeMinutesWeek;
        return (minutes has :total) ? percentText(minutes.total, goal) : "--";
    }
${needs.has('sensor') ? `
    function latestSensor(kind) {
        if (!(Toybox has :SensorHistory)) { return null; }
        var iterator = null;
        try {
${Object.entries(sensorReaders).filter(([kind]) => selected.has(kind)).map(([kind, method]) => `            if (kind.equals("${kind}") && (SensorHistory has :${method})) { iterator = SensorHistory.${method}({ :period => 1, :order => SensorHistory.ORDER_NEWEST_FIRST }); }`).join('\n')}
            if (iterator == null) { return null; }
            var sample = iterator.next();
            if (sample == null || sample.data == null) { return null; }
            if ((kind.equals("bodyBattery") || kind.equals("stress") || kind.equals("pulseOx")) && (sample.data < 0 || sample.data > 100)) { return null; }
            return sample.data;
        } catch (error) { return null; }
    }
` : ''}${needs.has('profile') ? `
    function cachedProfile() {
        if (Toybox has :UserProfile) {
            try { if (UserProfile has :getProfile) { return UserProfile.getProfile(); } } catch (error) {}
        }
        return null;
    }
` : ''}${needs.has('weather') ? `
    function cachedWeather() {
        if (Toybox has :Weather) {
            try { if (Weather has :getCurrentConditions) { return Weather.getCurrentConditions(); } } catch (error) {}
        }
        return null;
    }

    function weatherAgeText(moment) {
        if (moment == null) { return "--"; }
        var seconds = Time.now().value() - moment.value();
        return seconds < 0 ? "--" : numberText((seconds / 60).toNumber(), false);
    }

    function temperatureRangeText(high, low) { return ${unitNumberExpression('low', 'temperature', units, 0)} + " / " + ${unitNumberExpression('high', 'temperature', units, 0)}; }
` : ''}${needs.has('sun') ? `
    function sunText(conditions, sunrise) {
        if (conditions == null || !(conditions has :observationLocationPosition) || conditions.observationLocationPosition == null) { return "--"; }
        var location = conditions.observationLocationPosition;
        var moment = null;
        try {
            if (sunrise && (Weather has :getSunrise)) { moment = Weather.getSunrise(location, Time.now()); }
            else if (!sunrise && (Weather has :getSunset)) { moment = Weather.getSunset(location, Time.now()); }
        } catch (error) { return "--"; }
        if (moment == null) { return "--"; }
        var time = Gregorian.info(moment, Time.FORMAT_SHORT);
        return time.hour.format("%02d") + ":" + time.min.format("%02d");
    }
` : ''}${needs.has('forecast') ? `
    function cachedForecasts() as Lang.Array or Null {
        if (Toybox has :Weather) {
            try { if (Weather has :getDailyForecast) { return Weather.getDailyForecast(); } } catch (error) {}
        }
        return null;
    }

    function forecastWeatherText(forecasts as Lang.Array or Null, day) {
        if (forecasts == null) { return "--"; }
        // Compare civil dates, not 24-hour windows across daylight-saving changes.
        var today = civilDateNumber(Time.now());
        // Forecast arrays are small, but scan only a fixed bound.
        for (var i = 0; i < forecasts.size() && i < 10; i += 1) {
            var forecast = forecasts[i];
            if (forecast == null || !(forecast has :forecastTime) || forecast.forecastTime == null) { continue; }
            if (civilDateNumber(forecast.forecastTime) - today == day * 86400) { return (forecast has :condition) ? weatherText(forecast.condition) : "--"; }
        }
        return "--";
    }

    function civilDateNumber(moment) {
        var date = Gregorian.info(moment, Time.FORMAT_SHORT);
        return Gregorian.moment({ :year => date.year, :month => date.month, :day => date.day, :hour => 0, :minute => 0, :second => 0 }).value();
    }
` : ''}${needs.has('weather') || needs.has('forecast') ? `
    function weatherText(condition) {
        if (condition == null) { return "--"; }
        switch (condition.toNumber()) {
${WEATHER_NAMES.map((name, i) => `            case ${i}: return "${i === 53 ? '--' : name}";`).join('\n')}
        }
        return "--";
    }
` : ''}${needs.has('complications') ? `
    function nativeComplication(kind) {
        if (!(Toybox has :Complications)) { return null; }
        try {
            if (!(Complications has :getComplication)) { return null; }
            var id = null;
${Object.entries(NATIVE_TYPES).filter(([kind]) => selected.has(kind)).map(([kind, type]) => `            if (kind.equals("${kind}") && (Complications has :COMPLICATION_TYPE_${type})) { id = new Complications.Id(Complications.COMPLICATION_TYPE_${type}); }`).join('\n')}
            if (id == null) { return null; }
            var data = Complications.getComplication(id);
            return data == null ? null : data.value;
        } catch (error) { return null; }
    }
` : ''}`;
}
