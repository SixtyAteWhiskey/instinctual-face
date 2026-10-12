/** Trusted element catalog. Templates contain data; they cannot add new types. */
function definition(name, label, sample, group, defaults, graphic = false, metadata = {}) {
  return Object.freeze({ name, label, sample, group, kind: graphic ? metadata.kind ?? 'shape' : 'text', graphic,
    minApi: '3.2.7', permission: '', note: '', ...metadata, defaults: Object.freeze(defaults) });
}

const metric = (name, label, sample, group, metadata = {}) => definition(name, label, sample, group,
  { width: 76, height: 32, fontSize: 20, label: true }, false, metadata);

export const ELEMENT_GROUPS = Object.freeze([
  { id: 'time', name: 'Time & date' }, { id: 'activity', name: 'Daily activity' },
  { id: 'health', name: 'Health & recovery' }, { id: 'device', name: 'Watch & connections' },
  { id: 'weather', name: 'Weather' }, { id: 'training', name: 'Training & events' },
  { id: 'design', name: 'Shapes & design' },
].map(Object.freeze));

export const PROGRESS_SOURCES = Object.freeze(['steps', 'battery', 'floors', 'calories', 'distance']);
export const ICON_NAMES = Object.freeze(['heart', 'battery', 'steps', 'sun', 'moon', 'cloud', 'rain', 'mountain', 'notification', 'phone', 'bluetooth']);

const DEFINITIONS = {
  time: definition('Time', 'TIME', '10:09', 'time', { width: 144, height: 46, fontSize: 44, label: false, format: '24h' }),
  date: definition('Date', 'DATE', 'SUN 11 OCT', 'time', { width: 100, height: 20, fontSize: 14, label: false, format: 'short' }),
  steps: definition('Steps', 'STEPS', '8,462', 'activity', { width: 76, height: 32, fontSize: 20, label: true }),
  heart: definition('Heart rate', 'BPM', '68', 'health', { width: 44, height: 36, fontSize: 22, label: true }),
  battery: definition('Battery', 'BATTERY', '82%', 'device', { width: 54, height: 30, fontSize: 18, label: true }),
  calories: definition('Calories', 'KCAL', '1,248', 'activity', { width: 68, height: 32, fontSize: 20, label: true }),
  floors: definition('Floors', 'FLOORS', '12', 'activity', { width: 58, height: 32, fontSize: 20, label: true }),
  distance: definition('Distance', 'KM', '5.2', 'activity', { width: 64, height: 32, fontSize: 20, label: true }),
  seconds: metric('Seconds', 'SEC', '09', 'time'),
  weekday: metric('Weekday', 'DAY', 'SUN', 'time'),
  day: metric('Day of month', 'DATE', '11', 'time'),
  month: metric('Month', 'MONTH', 'OCT', 'time'),
  year: metric('Year', 'YEAR', '2026', 'time'),
  utcTime: metric('UTC time', 'UTC', '16:09', 'time'),
  utcOffset: metric('UTC offset', 'UTC OFFSET', '-6', 'time'),
  stepGoal: metric('Step goal', 'STEP GOAL', '10,000', 'activity'),
  stepProgress: metric('Step progress', 'STEPS %', '85%', 'activity'),
  floorsGoal: metric('Floors goal', 'FLOOR GOAL', '10', 'activity'),
  floorsProgress: metric('Floors progress', 'FLOORS %', '120%', 'activity'),
  floorsDescended: metric('Floors descended', 'DOWN', '8', 'activity'),
  ascent: metric('Daily ascent', 'ASCENT M', '145', 'activity'),
  descent: metric('Daily descent', 'DESCENT M', '130', 'activity'),
  moveBar: metric('Move bar', 'MOVE', '2', 'activity'),
  intensityMinutes: metric('Intensity minutes today', 'ACTIVE MIN', '32', 'activity'),
  intensityWeek: metric('Intensity minutes this week', 'WEEK MIN', '185', 'activity'),
  intensityGoal: metric('Weekly intensity goal', 'WEEK GOAL', '150', 'activity'),
  intensityProgress: metric('Weekly intensity progress', 'WEEK %', '123%', 'activity'),
  moderateMinutes: metric('Moderate minutes today', 'MOD MIN', '24', 'activity'),
  vigorousMinutes: metric('Vigorous minutes today', 'VIG MIN', '4', 'activity'),
  respiration: metric('Respiration rate', 'BREATHS', '16.0', 'health'),
  recovery: metric('Recovery time', 'RECOVERY H', '12', 'health'),
  bodyBattery: metric('Body Battery', 'BODY BATT', '74', 'health', { permission: 'SensorHistory' }),
  stress: metric('Stress', 'STRESS', '24', 'health', { permission: 'SensorHistory' }),
  pulseOx: metric('Pulse oxygen', 'SPO2', '98%', 'health', { permission: 'SensorHistory' }),
  altitude: metric('Altitude', 'ALTITUDE M', '1,650', 'health', { permission: 'Sensor' }),
  pressure: metric('Barometric pressure', 'PRESSURE', '1013', 'health', { permission: 'Sensor' }),
  sensorTemperature: metric('Watch sensor temperature', 'SENSOR C', '29.0', 'health', { permission: 'Sensor', note: 'Watch temperature includes body heat; use weather temperature for outdoor conditions.' }),
  restingHeart: metric('Resting heart rate', 'REST BPM', '52', 'health', { permission: 'UserProfile' }),
  averageRestingHeart: metric('Average resting heart rate', 'AVG REST', '54', 'health', { permission: 'UserProfile' }),
  vo2Running: metric('Running VO2 max', 'RUN VO2', '48', 'health', { permission: 'UserProfile' }),
  vo2Cycling: metric('Cycling VO2 max', 'BIKE VO2', '46', 'health', { permission: 'UserProfile' }),
  batteryDays: metric('Estimated battery life', 'BATT DAYS', '22.5', 'device'),
  charging: metric('Charging state', 'CHARGING', 'NO', 'device'),
  solar: metric('Solar intensity', 'SOLAR', '35%', 'device', { note: 'Available on supported Solar hardware; other watches show --.' }),
  notifications: metric('Notification count', 'NOTICES', '3', 'device'),
  alarms: metric('Alarm count', 'ALARMS', '1', 'device'),
  phone: metric('Phone connection', 'PHONE', 'ON', 'device'),
  dnd: metric('Do not disturb', 'DND', 'OFF', 'device'),
  temperature: metric('Weather temperature', 'TEMP C', '18', 'weather'),
  feelsLike: metric('Feels-like temperature', 'FEELS C', '17', 'weather'),
  temperatureHigh: metric('Forecast high', 'HIGH C', '22', 'weather'),
  temperatureLow: metric('Forecast low', 'LOW C', '9', 'weather'),
  weather: metric('Weather conditions', 'WEATHER', 'CLEAR', 'weather'),
  rain: metric('Rain probability', 'RAIN %', '20%', 'weather'),
  humidity: metric('Humidity', 'HUMIDITY', '56%', 'weather'),
  windSpeed: metric('Wind speed', 'WIND KMH', '12', 'weather'),
  windDirection: metric('Wind direction', 'WIND DEG', '225', 'weather'),
  weatherAge: metric('Weather age', 'WEATHER MIN', '8', 'weather'),
  sunrise: metric('Sunrise', 'SUNRISE', '07:04', 'weather'),
  sunset: metric('Sunset', 'SUNSET', '18:24', 'weather'),
  uvIndex: metric('UV index', 'UV', '3', 'weather'),
  cloudCover: metric('Cloud cover', 'CLOUD %', '35%', 'weather'),
  dewPoint: metric('Dew point', 'DEW C', '9', 'weather'),
  visibility: metric('Visibility', 'VISIBILITY', '16', 'weather'),
  weatherPressure: metric('Weather pressure', 'WX PRESS', '1013', 'weather'),
  nextEvent: metric('Next calendar event', 'NEXT EVENT', '15:00', 'training'),
  weeklyRun: metric('Weekly running distance', 'RUN KM', '24.8', 'training'),
  weeklyBike: metric('Weekly cycling distance', 'BIKE KM', '82.5', 'training'),
  trainingStatus: metric('Training status', 'TRAINING', 'PRODUCTIVE', 'training'),
  race5k: metric('5K prediction', '5K', '24:10', 'training'),
  race10k: metric('10K prediction', '10K', '50:20', 'training'),
  raceHalf: metric('Half marathon prediction', 'HALF', '1:52:00', 'training'),
  raceMarathon: metric('Marathon prediction', 'MARATHON', '3:58:00', 'training'),
  sleepScore: metric('Sleep score', 'SLEEP', '84', 'health'),
  weight: metric('Profile weight', 'WEIGHT KG', '72.5', 'health', { permission: 'UserProfile' }),
  userHeight: metric('Profile height', 'HEIGHT CM', '178', 'health', { permission: 'UserProfile' }),
  sleepTime: metric('Configured sleep time', 'SLEEP TIME', '23:00', 'time', { permission: 'UserProfile' }),
  wakeTime: metric('Configured wake time', 'WAKE TIME', '07:00', 'time', { permission: 'UserProfile' }),
  wheelchairPushes: metric('Wheelchair pushes', 'PUSHES', '1,246', 'activity', { note: 'Requires wheelchair-mode hardware and recorded push data; unsupported watches show --.' }),
  lastGolfScore: metric('Last golf score', 'GOLF', '+4', 'training'),
  temperatureRange: metric('Forecast temperature range', 'LOW/HIGH C', '9 / 22', 'weather'),
  weekdayDay: metric('Weekday and date', 'DAY DATE', 'SUN 11', 'time'),
  forecast1: metric('Tomorrow’s conditions', 'TOMORROW', 'CLEAR', 'weather'),
  forecast2: metric('Conditions in two days', 'DAY 2', 'CLOUDY', 'weather'),
  forecast3: metric('Conditions in three days', 'DAY 3', 'RAIN', 'weather'),
  racePace5k: metric('5K predicted pace', '5K MIN/KM', '4:50', 'training'),
  racePace10k: metric('10K predicted pace', '10K MIN/KM', '5:02', 'training'),
  racePaceHalf: metric('Half marathon predicted pace', 'HALF MIN/KM', '5:18', 'training'),
  racePaceMarathon: metric('Marathon predicted pace', 'MAR MIN/KM', '5:38', 'training'),
  text: definition('Custom text', '', 'YOUR TEXT', 'design', { width: 100, height: 24, fontSize: 16, label: false, text: 'YOUR TEXT' }),
  line: definition('Divider', '', '', 'design', { width: 100, height: 2, fontSize: 12, label: false }, true),
  circle: definition('Circle', '', '', 'design', { width: 36, height: 36, fontSize: 12, label: false }, true),
  rectangle: definition('Rectangle', '', '', 'design', { width: 80, height: 30, fontSize: 12, label: false, filled: false, strokeWidth: 1, cornerRadius: 0 }, true),
  progressBar: definition('Progress bar', '', '', 'design', { width: 96, height: 10, fontSize: 12, label: false, source: 'steps', goal: 0, strokeWidth: 1 }, true),
  progressRing: definition('Progress ring', '', '', 'design', { width: 48, height: 48, fontSize: 12, label: false, source: 'steps', goal: 0, strokeWidth: 3 }, true),
  icon: definition('Icon', '', '', 'design', { width: 20, height: 20, fontSize: 12, label: false, icon: 'heart' }, true),
};

const complicationTypes = new Set(['nextEvent', 'weeklyRun', 'weeklyBike', 'trainingStatus', 'race5k', 'race10k', 'raceHalf', 'raceMarathon', 'racePace5k', 'racePace10k', 'racePaceHalf', 'racePaceMarathon', 'wheelchairPushes', 'lastGolfScore', 'sleepScore']);
const historyTypes = new Set(['bodyBattery', 'stress', 'pulseOx', 'altitude', 'pressure', 'sensorTemperature']);
const apiVersions = new Map([
  ['phone', '1.1.0'], ['alarms', '1.2.0'], ['notifications', '1.2.0'], ['dnd', '2.1.0'],
  ...['floors', 'floorsGoal', 'floorsProgress', 'floorsDescended', 'ascent', 'descent', 'intensityMinutes', 'intensityWeek', 'intensityGoal', 'intensityProgress', 'moderateMinutes', 'vigorousMinutes', 'altitude', 'pressure', 'sensorTemperature'].map(id => [id, '2.1.0']),
  ['charging', '3.0.0'], ['solar', '3.2.0'], ['pulseOx', '3.2.0'], ['averageRestingHeart', '3.2.0'],
  ...['batteryDays', 'respiration', 'recovery', 'bodyBattery', 'stress', 'vo2Running', 'vo2Cycling', 'sunrise', 'sunset'].map(id => [id, '3.3.0']),
  ...['uvIndex', 'cloudCover', 'dewPoint', 'visibility', 'weatherPressure'].map(id => [id, '5.1.0']),
  ['wheelchairPushes', '4.2.3'], ['lastGolfScore', '5.0.0'], ['sleepScore', '6.0.2'],
]);

export const ELEMENT_DEFINITIONS = Object.freeze(Object.fromEntries(Object.entries(DEFINITIONS).map(([id, entry]) => {
  const metadata = { ...entry,
    minApi: apiVersions.get(id) ?? (complicationTypes.has(id) ? '4.2.0' : entry.group === 'weather' ? '3.2.0' : '1.0.0'),
    permission: historyTypes.has(id) ? 'SensorHistory' : complicationTypes.has(id) ? 'ComplicationSubscriber' : ['sunrise', 'sunset'].includes(id) ? 'Positioning' : entry.permission,
    kind: entry.graphic ? id : 'text',
  };
  if (complicationTypes.has(id)) metadata.note = `${entry.note ? `${entry.note} ` : ''}Native complication; available only on supporting models and firmware. Legacy Instinct 2, 2S, 2X and Crossover show --.`;
  if (id === 'pulseOx') metadata.note = 'Needs a recorded pulse-oxygen sample; missing data shows --.';
  if (id === 'restingHeart') metadata.note = 'Resting heart rate configured in the Garmin user profile.';
  if (id === 'averageRestingHeart') metadata.note = 'Average resting heart rate calculated from the last seven days.';
  return [id, Object.freeze(metadata)];
})));

export const ELEMENT_TYPE_IDS = Object.freeze(Object.keys(ELEMENT_DEFINITIONS));
export function isGraphicElement(type) { return ELEMENT_DEFINITIONS[type]?.graphic === true; }

/** Capabilities vary with firmware and sensors; generated readers are guarded. */
export function elementCompatibility(type, device) {
  const element = ELEMENT_DEFINITIONS[type];
  if (!element) return { available: false, note: 'This element is not supported.' };
  let note = element.note;
  if (element.group === 'weather') note ||= 'Weather needs data from Garmin Connect. Missing or unsupported values show --.';
  else if (element.group === 'training') note ||= 'Availability depends on watch features and synced Garmin data. Missing values show --.';
  else if (element.permission) note ||= 'Availability depends on watch sensors and recorded data. Missing values show --.';
  if (type === 'solar' && device?.display === 'amoled') note = 'Solar intensity is unavailable on AMOLED hardware; the watch shows --.';
  return { available: true, note };
}
