# Element library and captions

Use **Elements → Search elements** to find watch-face data or a graphic. Groups can be collapsed. Drag a card onto the face or click to add it. Each data element has its own number/value style and optional caption.

## Style captions independently

Select an element and use **Number / value** for the live reading's font, alignment, and color. Under **Caption**, independently set:

- Caption text, such as `PULSE` instead of `BPM`, or `POWER` instead of `BATTERY`.
- Caption size and the gap below the value.
- Caption alignment and color.

An empty caption or **Show caption** switched off hides it. **Reset caption style** restores its default words and size, with alignment and color following the value. Resizing the element box scales the primary reading; it preserves an explicitly chosen caption size. Changing watch models scales the caption size and gap with the design and converts caption colors for MIP.

Compact captions use an original 3×5 pixel alphabet with digits and punctuation. Sizes advance in five-pixel increments; limited box space can reduce the rendered size. A hint in Properties reports when a caption is reduced or shortened. Enlarge the box or shorten the wording to show more. The circular window uses the same pixel renderer and safety geometry in the browser and generated Garmin source.

## Choose measurement units

Open **Units** above the canvas, or **Change units** in a measurement element's Properties. Choose **Metric preset**, **US / imperial preset**, or mix individual preferences, then **Apply units**. Cancel leaves the current preferences in place. Each face stores its own choices; saved designs, JSON/source exports, and share codes carry them between instances and watch models.

| Measurement | Choices | Applies to |
| --- | --- | --- |
| Temperature | Celsius / Fahrenheit | Current weather, feels-like, highs/lows/range, dew point, watch sensor temperature |
| Distance & pace | Kilometers / miles | Daily distance, weekly run/cycle distance, visibility, predicted pace |
| Elevation & ascent | Meters / feet | Altitude, daily ascent and descent |
| Wind speed | km/h, mph, knots, m/s | Wind speed |
| Pressure | hPa, inHg, mmHg | Barometric and weather pressure |
| Weight | Kilograms / pounds | Profile weight |
| Profile height | Centimeters / feet and inches | Profile height |

The live reading and automatic caption update together, such as `18 / TEMP C` becoming `64 / TEMP F`. Explicit custom captions remain literal; edit their wording if it includes a unit you want to change. Old designs retain metric defaults. Missing values stay `--`, including a missing side of a temperature range.

**Sample data** accepts the selected display units, including `5'10"` for feet/inches and `m:ss` for pace. Untouched sample inputs preserve their full underlying values when the form is reopened or submitted. Distance progress goals also use the selected input units, while preserving their physical target when preferences change. The automatic distance goal remains 10 km (about 6.2 miles).

Conversions run locally in the preview and generated watch source. Garmin provides [weather](https://developer.garmin.com/connect-iq/api-docs/Toybox/Weather/CurrentConditions.html) and [sensor history](https://developer.garmin.com/connect-iq/api-docs/Toybox/SensorHistory.html) in canonical API units; [profile](https://developer.garmin.com/connect-iq/api-docs/Toybox/UserProfile/Profile.html) weight is grams and height is centimeters. These values are normalized once before applying the face's preferences. No unit choice can supply executable expressions.

## Watch-face data and compatibility

The catalog covers the public data readers available to Connect IQ watch faces on Instinct devices, rather than enabling continuous sensors or arbitrary third-party code. Readings come from daily activity totals, recorded health history, cached weather, user profile settings, device status, and supported native complications. Sources:

- [ActivityMonitor.Info](https://developer.garmin.com/connect-iq/api-docs/Toybox/ActivityMonitor/Info.html) and [ActiveMinutes](https://developer.garmin.com/connect-iq/api-docs/Toybox/ActivityMonitor/ActiveMinutes.html).
- [SensorHistory](https://developer.garmin.com/connect-iq/api-docs/Toybox/SensorHistory.html) for recorded Body Battery, stress, oxygen, pressure, temperature, and altitude.
- [UserProfile.Profile](https://developer.garmin.com/connect-iq/api-docs/Toybox/UserProfile/Profile.html).
- [System.Stats](https://developer.garmin.com/connect-iq/api-docs/Toybox/System/Stats.html) and [DeviceSettings](https://developer.garmin.com/connect-iq/api-docs/Toybox/System/DeviceSettings.html).
- [Weather](https://developer.garmin.com/connect-iq/api-docs/Toybox/Weather.html) and [CurrentConditions](https://developer.garmin.com/connect-iq/api-docs/Toybox/Weather/CurrentConditions.html).
- [Native complications](https://developer.garmin.com/connect-iq/api-docs/Toybox/Complications.html) and [permission and availability rules](https://developer.garmin.com/connect-iq/articles/core-topics/Complications.html).

Garmin's native complication module supports Instinct 3 Solar/AMOLED, E, and Crossover AMOLED among this application's targets. The original Crossover and Instinct 2 family use the older public readers. Some metrics require newer firmware, supported sensors, or synced data; Sleep Score's native complication starts at Connect IQ API 6.0.2. Calendar events, training status, race predictions, and other native-only complications display `--` when unavailable. Body Battery and stress use bounded recorded history and are available on supported older Instinct profiles too.

Weather requires Garmin Connect to have supplied a cached observation. Sunrise/sunset use its cached location; the watch face does not start GPS acquisition. Watch sensor temperature includes body heat and differs from outdoor weather temperature. Seconds follow Garmin's watch-face update lifecycle; they do not animate continuously during low-power minute updates.

The generated manifest requests only the permissions needed by visible elements. Unsupported APIs, absent samples, and unavailable complications are guarded and display `--`. Preview samples are simulated and never embedded as watch readings. **Sample data** includes fields used by the current design. Numeric readings have an **Unavailable** toggle; added text fields accept `--`.

Garmin's public watch-face APIs do not expose every native glance. No documented reader for HRV status, training readiness/load, hydration totals, or sleep duration/stages was found in the checked SDK/API catalog. Activity-only live speed, GPS tracking, power, and cadence listeners are outside the watch-face runtime. Native golf score and wheelchair pushes are optional complications; their presence on the Garmin API does not guarantee availability on an Instinct.

Garmin enforces a time limit for each redraw. The full 96-element catalog passed Solar simulator execution in batches of 12; a deliberately overlapping 96-layer design exceeded that limit. Keep designs compact and verify larger layouts in the simulator.

## Graphics

Divider, outline circle, filled/outlined rounded rectangle, progress bar, progress ring, and eleven original bitmap icons are included. Progress widgets can display steps, battery, floors, calories, or distance. Goal `0` selects the automatic goal: the watch's step/floor goal, battery 100%, 2,000 calories, or 10 km. A positive goal overrides the activity target. Empty progress is an outline; missing data leaves the track empty. Values over the goal fill the widget completely.

Templates remain strictly validated data. Caption text, metric IDs, progress sources, icon names, and numeric styling fields are constrained; no template can introduce code, remote assets, permission strings, or arbitrary API expressions. SHA-256 share checksums detect corruption and identify content; they do not authenticate authors.


## Complete catalog (96 elements)

The captions and samples below show the metric defaults. Supported measurement fields follow the selected unit preferences.

### Time & date

| Element | Default caption | Preview sample | Requirements |
| --- | --- | --- | --- |
| Time | TIME | 10:09 | — |
| Date | DATE | SUN 11 OCT | — |
| Seconds | SEC | 09 | — |
| Weekday | DAY | SUN | — |
| Day of month | DATE | 11 | — |
| Month | MONTH | OCT | — |
| Year | YEAR | 2026 | — |
| UTC time | UTC | 16:09 | — |
| UTC offset | UTC OFFSET | -6 | — |
| Configured sleep time | SLEEP TIME | 23:00 | Availability depends on watch sensors and recorded data. Missing values show --. |
| Configured wake time | WAKE TIME | 07:00 | Availability depends on watch sensors and recorded data. Missing values show --. |
| Weekday and date | DAY DATE | SUN 11 | — |

### Daily activity

| Element | Default caption | Preview sample | Requirements |
| --- | --- | --- | --- |
| Steps | STEPS | 8,462 | — |
| Calories | KCAL | 1,248 | — |
| Floors | FLOORS | 12 | — |
| Distance | KM | 5.2 | — |
| Step goal | STEP GOAL | 10,000 | — |
| Step progress | STEPS % | 85% | — |
| Floors goal | FLOOR GOAL | 10 | — |
| Floors progress | FLOORS % | 120% | — |
| Floors descended | DOWN | 8 | — |
| Daily ascent | ASCENT M | 145 | — |
| Daily descent | DESCENT M | 130 | — |
| Move bar | MOVE | 2 | — |
| Intensity minutes today | ACTIVE MIN | 32 | — |
| Intensity minutes this week | WEEK MIN | 185 | — |
| Weekly intensity goal | WEEK GOAL | 150 | — |
| Weekly intensity progress | WEEK % | 123% | — |
| Moderate minutes today | MOD MIN | 24 | — |
| Vigorous minutes today | VIG MIN | 4 | — |
| Wheelchair pushes | PUSHES | 1,246 | Requires wheelchair-mode hardware and recorded push data; unsupported watches show --. Native complication; available only on supporting models and firmware. Legacy Instinct 2, 2S, 2X and Crossover show --. |

### Health & recovery

| Element | Default caption | Preview sample | Requirements |
| --- | --- | --- | --- |
| Heart rate | BPM | 68 | — |
| Respiration rate | BREATHS | 16.0 | — |
| Recovery time | RECOVERY H | 12 | — |
| Body Battery | BODY BATT | 74 | Availability depends on watch sensors and recorded data. Missing values show --. |
| Stress | STRESS | 24 | Availability depends on watch sensors and recorded data. Missing values show --. |
| Pulse oxygen | SPO2 | 98% | Needs a recorded pulse-oxygen sample; missing data shows --. |
| Altitude | ALTITUDE M | 1,650 | Availability depends on watch sensors and recorded data. Missing values show --. |
| Barometric pressure | PRESSURE | 1013 | Availability depends on watch sensors and recorded data. Missing values show --. |
| Watch sensor temperature | SENSOR C | 29.0 | Watch temperature includes body heat; use weather temperature for outdoor conditions. |
| Resting heart rate | REST BPM | 52 | Resting heart rate configured in the Garmin user profile. |
| Average resting heart rate | AVG REST | 54 | Average resting heart rate calculated from the last seven days. |
| Running VO2 max | RUN VO2 | 48 | Availability depends on watch sensors and recorded data. Missing values show --. |
| Cycling VO2 max | BIKE VO2 | 46 | Availability depends on watch sensors and recorded data. Missing values show --. |
| Sleep score | SLEEP | 84 | Native complication; available only on supporting models and firmware. Legacy Instinct 2, 2S, 2X and Crossover show --. |
| Profile weight | WEIGHT KG | 72.5 | Availability depends on watch sensors and recorded data. Missing values show --. |
| Profile height | HEIGHT CM | 178 | Availability depends on watch sensors and recorded data. Missing values show --. |

### Watch & connections

| Element | Default caption | Preview sample | Requirements |
| --- | --- | --- | --- |
| Battery | BATTERY | 82% | — |
| Estimated battery life | BATT DAYS | 22.5 | — |
| Charging state | CHARGING | NO | — |
| Solar intensity | SOLAR | 35% | Available on supported Solar hardware; other watches show --. |
| Notification count | NOTICES | 3 | — |
| Alarm count | ALARMS | 1 | — |
| Phone connection | PHONE | ON | — |
| Do not disturb | DND | OFF | — |

### Weather

| Element | Default caption | Preview sample | Requirements |
| --- | --- | --- | --- |
| Weather temperature | TEMP C | 18 | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Feels-like temperature | FEELS C | 17 | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Forecast high | HIGH C | 22 | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Forecast low | LOW C | 9 | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Weather conditions | WEATHER | CLEAR | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Rain probability | RAIN % | 20% | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Humidity | HUMIDITY | 56% | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Wind speed | WIND KMH | 12 | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Wind direction | WIND DEG | 225 | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Weather age | WEATHER MIN | 8 | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Sunrise | SUNRISE | 07:04 | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Sunset | SUNSET | 18:24 | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| UV index | UV | 3 | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Cloud cover | CLOUD % | 35% | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Dew point | DEW C | 9 | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Visibility | VISIBILITY | 16 | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Weather pressure | WX PRESS | 1013 | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Forecast temperature range | LOW/HIGH C | 9 / 22 | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Tomorrow’s conditions | TOMORROW | CLEAR | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Conditions in two days | DAY 2 | CLOUDY | Weather needs data from Garmin Connect. Missing or unsupported values show --. |
| Conditions in three days | DAY 3 | RAIN | Weather needs data from Garmin Connect. Missing or unsupported values show --. |

### Training & events

| Element | Default caption | Preview sample | Requirements |
| --- | --- | --- | --- |
| Next calendar event | NEXT EVENT | 15:00 | Native complication; available only on supporting models and firmware. Legacy Instinct 2, 2S, 2X and Crossover show --. |
| Weekly running distance | RUN KM | 24.8 | Native complication; available only on supporting models and firmware. Legacy Instinct 2, 2S, 2X and Crossover show --. |
| Weekly cycling distance | BIKE KM | 82.5 | Native complication; available only on supporting models and firmware. Legacy Instinct 2, 2S, 2X and Crossover show --. |
| Training status | TRAINING | PRODUCTIVE | Native complication; available only on supporting models and firmware. Legacy Instinct 2, 2S, 2X and Crossover show --. |
| 5K prediction | 5K | 24:10 | Native complication; available only on supporting models and firmware. Legacy Instinct 2, 2S, 2X and Crossover show --. |
| 10K prediction | 10K | 50:20 | Native complication; available only on supporting models and firmware. Legacy Instinct 2, 2S, 2X and Crossover show --. |
| Half marathon prediction | HALF | 1:52:00 | Native complication; available only on supporting models and firmware. Legacy Instinct 2, 2S, 2X and Crossover show --. |
| Marathon prediction | MARATHON | 3:58:00 | Native complication; available only on supporting models and firmware. Legacy Instinct 2, 2S, 2X and Crossover show --. |
| Last golf score | GOLF | +4 | Native complication; available only on supporting models and firmware. Legacy Instinct 2, 2S, 2X and Crossover show --. |
| 5K predicted pace | 5K MIN/KM | 4:50 | Native complication; available only on supporting models and firmware. Legacy Instinct 2, 2S, 2X and Crossover show --. |
| 10K predicted pace | 10K MIN/KM | 5:02 | Native complication; available only on supporting models and firmware. Legacy Instinct 2, 2S, 2X and Crossover show --. |
| Half marathon predicted pace | HALF MIN/KM | 5:18 | Native complication; available only on supporting models and firmware. Legacy Instinct 2, 2S, 2X and Crossover show --. |
| Marathon predicted pace | MAR MIN/KM | 5:38 | Native complication; available only on supporting models and firmware. Legacy Instinct 2, 2S, 2X and Crossover show --. |

### Shapes & design

| Element | Default caption | Preview sample | Requirements |
| --- | --- | --- | --- |
| Custom text | — | YOUR TEXT | — |
| Divider | — | — | — |
| Circle | — | — | — |
| Rectangle | — | — | — |
| Progress bar | — | — | — |
| Progress ring | — | — | — |
| Icon | — | — | — |
