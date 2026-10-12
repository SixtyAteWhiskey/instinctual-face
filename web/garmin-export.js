/**
 * Connect IQ source export. This module runs unchanged in browsers and Node.
 * Source is generated locally; compiling and signing require Garmin's SDK.
 */
import { DEVICES, isDeviceColor } from './devices.js';
import { analyzeElement, constrainElement, pixelRectangle } from './display-safety.js';
import { PRIMARY_GLYPHS, TINY_GLYPHS, captionStyle } from './pixel-font.js';
import { ELEMENT_TYPE_IDS } from './elements.js';
import { graphicDrawCalls, graphicsMethodsSource } from './graphics-elements.js';
import { metricExpression, metricPermissions, metricImports, metricSetupSource, metricMethodsSource, progressExpressions, unitNumberExpression, unitMethodsSource } from './garmin-metrics.js';
import { resolveUnits } from './units.js';

export const GARMIN_DEVICES = DEVICES;

const TYPES = new Set(ELEMENT_TYPE_IDS);
const encoder = new TextEncoder();

function xml(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function applicationName(value) {
  // Garmin's AppName resource rejects XML entity references, including &amp;.
  // Keep the complete editor title in design JSON; adapt only the launcher name.
  return String(value || 'Instinctual Face').replace(/&/g, 'and').replace(/[<>"']/g, '')
    .replace(/[\u0000-\u001f\ufffe\uffff]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Instinctual Face';
}

function monkeyString(value) {
  return '"' + String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
}

function integer(value, name, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 10000) {
    throw new TypeError(`Invalid ${name}: expected a finite device-space number.`);
  }
  return Math.round(value);
}

function appId(project) {
  const identity = String(project.id || project.name || 'Instinctual Face');
  const compact = identity.replace(/-/g, '');
  if (/^[a-f\d]{32}$/i.test(compact)) return compact.toLowerCase();
  // Stable identity when a design's id is not already a UUID. No Node crypto needed.
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].map(seed => {
    let hash = seed;
    for (const byte of encoder.encode(identity)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, '0');
  }).join('');
}

function foreground(color, device) {
  if (!isDeviceColor(color, device)) throw new TypeError('Invalid color for the selected Garmin display.');
  if (device.display === 'amoled') return `0x${color.slice(1).toUpperCase()}`;
  return color.toLowerCase() === '#111111' ? 'Graphics.COLOR_BLACK' : 'Graphics.COLOR_WHITE';
}

function valueExpression(element, device, units) {
  switch (element.type) {
    case 'time': return `timeText(clock, ${element.format === '12h'})`;
    case 'date': return `dateText(date, ${element.format === 'long'})`;
    case 'steps': return 'numberText(activity.steps, true)';
    case 'heart': return 'numberText(heartRate, false)';
    case 'battery': return 'batteryText(stats.battery)';
    case 'calories': return 'numberText(activity.calories, true)';
    case 'floors': return 'numberText(floors, false)';
    case 'distance': return unitNumberExpression('activity.distance', 'distance', units, 1, false, 100000);
    case 'text': return monkeyString(element.text);
    default: {
      const expression = metricExpression(element, device, units);
      if (expression === null) throw new TypeError(`Unsupported element type: ${element.type}`);
      return expression;
    }
  }
}

function drawElement(element, index, device, safetyMargin, units) {
  if (!element || !TYPES.has(element.type)) throw new TypeError(`Unsupported element type at index ${index}.`);
  if (element.visible === false) return '';
  const rawRectangle = { ...element, x: integer(element.x, 'x'), y: integer(element.y, 'y'),
    width: Math.max(1, integer(element.width, 'width')), height: Math.max(1, integer(element.height, 'height')) };
  const rectangle = safetyMargin ? pixelRectangle(constrainElement({ ...rawRectangle, x: element.x, y: element.y,
    width: Math.max(1, element.width), height: Math.max(1, element.height) }, device, { safetyMargin: true })) : rawRectangle;
  const { x, y, width, height } = rectangle;
  const size = Math.max(1, integer(element.fontSize, 'fontSize', 16));
  const lines = [`        // Layer ${index + 1}: ${element.type}`, `        dc.setColor(${foreground(element.color, device)}, Graphics.COLOR_TRANSPARENT);`];
  if (element.type === 'line') {
    lines.push(`        dc.fillRectangle(${x}, ${y}, ${width}, ${height});`);
  } else if (element.type === 'circle') {
    lines.push(`        dc.drawEllipse(${x + Math.floor(width / 2)}, ${y + Math.floor(height / 2)}, ${Math.max(1, Math.floor((width - 1) / 2))}, ${Math.max(1, Math.floor((height - 1) / 2))});`);
  } else if (['rectangle', 'progressBar', 'progressRing', 'icon'].includes(element.type)) {
    const expressions = ['progressBar', 'progressRing'].includes(element.type) ? progressExpressions(element.source ?? 'steps') : {};
    lines.push(graphicDrawCalls(element, rectangle, expressions));
  } else {
    const align = ['left', 'center', 'right'].includes(element.align) ? element.align : 'center';
    const textX = align === 'left' ? x : align === 'right' ? x + width : x + Math.floor(width / 2);
    const justify = `Graphics.TEXT_JUSTIFY_${align.toUpperCase()}`;
    // Use the same physical display constraints and circle font as the designer.
    const caption = captionStyle(element, device, units);
    const labelSize = integer(caption.fontSize, 'labelFontSize');
    const labelGap = integer(caption.gap, 'labelGap');
    if (labelSize < 5 || labelSize > device.maxFontSize) throw new TypeError('Invalid labelFontSize for the selected Garmin display.');
    if (labelGap < 0 || labelGap > 32) throw new TypeError('Invalid labelGap: expected 0 to 32 pixels.');
    const captionColor = foreground(caption.color, device);
    const captionAlign = ['left', 'center', 'right'].includes(caption.align) ? caption.align : 'center';
    const captionJustify = `Graphics.TEXT_JUSTIFY_${captionAlign.toUpperCase()}`;
    const pixelOnly = safetyMargin && analyzeElement(rectangle, device, { safetyMargin: true }).region === 'subscreen';
    lines.push(`        drawLabel(dc, ${textX}, ${x}, ${y}, ${width}, ${height}, ${size}, ${valueExpression(element, device, units)}, ${monkeyString(caption.text)}, ${justify}, ${element.type === 'time'}, ${pixelOnly}, ${labelSize}, ${captionColor}, ${captionJustify}, ${labelGap}, ${caption.padding});`);
  }
  return lines.join('\n');
}

function viewSource(project, device) {
  const elements = project.elements;
  const needsGraphics = elements.some(e => e.visible !== false && ['rectangle', 'progressBar', 'progressRing', 'icon'].includes(e.type));
  const amoled = device.display === 'amoled';
  const twelveHour = elements.find(e => e.visible !== false && e.type === 'time')?.format === '12h';
  const units = resolveUnits(project.settings?.units);
  return `// Generated by Instinctual Face. Target: ${device.id}, ${device.width} x ${device.height}.
// Circle bitmap text and safe display geometry match the browser designer.
// Other built-in Garmin fonts vary by device. Verify in Garmin's simulator.
using Toybox.ActivityMonitor;
using Toybox.Graphics;
using Toybox.Lang;
using Toybox.System;
using Toybox.Time;
using Toybox.Time.Gregorian;
using Toybox.WatchUi;
${metricImports(elements, device)}

class InstinctualFaceView extends WatchUi.WatchFace {
    var _labelScale = ${Math.max(1, Math.round(device.height / 176))};
    var _tinyGlyphs as Lang.Dictionary;
    var _pixelGlyphs as Lang.Dictionary;
${amoled ? '    var _sleeping = false;\n' : ''}

    function initialize() {
        WatchFace.initialize();
        _tinyGlyphs = { ${Object.entries(TINY_GLYPHS).map(([glyph, rows]) => `${monkeyString(glyph)} => [${rows.join(', ')}]`).join(', ')} };
        _pixelGlyphs = { ${Object.entries(PRIMARY_GLYPHS).map(([glyph, rows]) => `${monkeyString(glyph)} => [${rows.join(', ')}]`).join(', ')} };
    }

    function onUpdate(dc) {
${amoled ? '        if (_sleeping) { drawAlwaysOn(dc); return; }\n' : ''}
        // Redraw the entire display, including the physical subscreen.
        dc.clearClip();
        dc.setColor(${foreground(project.background, device)}, ${foreground(project.background, device)});
        dc.clear();
${metricSetupSource(elements, device)}
${elements.map((element, index) => drawElement(element, index, device, project.settings?.safetyMargin !== false, units)).filter(Boolean).join('\n\n')}
    }

${amoled ? `    function onEnterSleep() {
        _sleeping = true;
        WatchUi.requestUpdate();
    }

    function onExitSleep() {
        _sleeping = false;
        WatchUi.requestUpdate();
    }

    function drawAlwaysOn(dc) {
        // A separate dim time-only display; custom backgrounds never enter AOD.
        dc.clearClip();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();
        var clock = System.getClockTime();
        var width = dc.getWidth();
        var height = dc.getHeight();
        // Even a filled rectangle occupies less than 7% of a round screen.
        var boxWidth = (width * 0.45).toNumber();
        var boxHeight = (height * 0.12).toNumber();
        var x = ((width - boxWidth) / 2).toNumber() + (clock.min % 3 - 1) * 4;
        // Alternating disjoint rows avoids leaving any time pixel lit continuously.
        var y = (height * (clock.min % 2 == 0 ? 0.32 : 0.62)).toNumber();
        dc.setClip(x, y, boxWidth, boxHeight);
        dc.setColor(0x555555, Graphics.COLOR_TRANSPARENT);
        var value = timeText(clock, ${twelveHour});
        var font = closestFont(dc, boxHeight, true, boxHeight, boxWidth, value);
        if (font != null) {
            dc.drawText(x + boxWidth / 2, y + boxHeight / 2, font, value, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        } else {
            var fit = fitBitmap(value, boxHeight, boxWidth, boxHeight, false);
            drawBitmap(dc, x, y + ((boxHeight - fit[4]) / 2).toNumber(), fit, Graphics.TEXT_JUSTIFY_CENTER, false, boxWidth);
        }
        dc.clearClip();
    }

` : ''}

    function timeText(clock, twelveHour) {
        var hour = clock.hour;
        if (twelveHour) {
            hour = hour % 12;
            if (hour == 0) { hour = 12; }
        }
        return hour.format(twelveHour ? "%d" : "%02d") + ":" + clock.min.format("%02d");
    }

    function dateText(date, longFormat) {
        var months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
        var fullMonths = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
        var weekdays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
        if (longFormat) { return fullMonths[date.month - 1] + " " + date.day.toString(); }
        return weekdays[date.day_of_week - 1] + " " + date.day.toString() + " " + months[date.month - 1];
    }

    function numberText(value, groupThousands) {
        if (value == null) { return "--"; }
        var digits = value.toNumber().format("%d");
        if (!groupThousands) { return digits; }
        var sign = "";
        if (digits.substring(0, 1).equals("-")) { sign = "-"; digits = digits.substring(1, digits.length()); }
        var result = "";
        while (digits.length() > 3) {
            var split = digits.length() - 3;
            result = "," + digits.substring(split, digits.length()) + result;
            digits = digits.substring(0, split);
        }
        return sign + digits + result;
    }

    function batteryText(value) {
        if (value == null) { return "--"; }
        return numberText(value, false) + "%";
    }

    function latestHeartRate() {
        // A watch face reads recorded history; it does not start a sensor session.
        if (ActivityMonitor has :getHeartRateHistory) {
            var iterator = ActivityMonitor.getHeartRateHistory(1, true);
            var sample = iterator.next();
            if (sample != null && sample.heartRate != null && sample.heartRate != ActivityMonitor.INVALID_HR_SAMPLE) {
                return sample.heartRate;
            }
        }
        return null;
    }

${unitMethodsSource()}
${metricMethodsSource(elements, device, units)}
${needsGraphics ? graphicsMethodsSource() : ''}
    function closestFont(dc, target, numeric, maxHeight, maxWidth, value) {
        // Measure live text each update: values can grow without changing layers.
        // No retained value cache, so watch memory stays bounded over time.
        var choices = [Graphics.FONT_XTINY, Graphics.FONT_TINY, Graphics.FONT_SMALL, Graphics.FONT_MEDIUM, Graphics.FONT_LARGE];
        if (numeric) {
            choices.add(Graphics.FONT_NUMBER_MILD);
            choices.add(Graphics.FONT_NUMBER_MEDIUM);
            choices.add(Graphics.FONT_NUMBER_HOT);
            choices.add(Graphics.FONT_NUMBER_THAI_HOT);
        }
        var best = choices[0];
        var bestDistance = 10000;
        var found = false;
        for (var i = 0; i < choices.size(); i += 1) {
            var fontHeight = dc.getFontHeight(choices[i]);
            var fontWidth = dc.getTextWidthInPixels(value, choices[i]);
            var delta = fontHeight - target;
            if (delta < 0) { delta = -delta; }
            if (fontHeight <= maxHeight && fontWidth <= maxWidth && delta < bestDistance) {
                best = choices[i]; bestDistance = delta; found = true;
            }
        }
        // Never select a device font that would crop a live value.
        if (!found) { return null; }
        return best;
    }

    function fitBitmap(value, target, width, height, tiny) as Lang.Array {
        var columns = tiny ? 3 : 5;
        var rows = tiny ? 5 : 7;
        var glyphs = tiny ? _tinyGlyphs : _pixelGlyphs;
        var text = value.toUpper();
        if (text.length() > 120) { text = text.substring(0, 120); }
        var capacity = ((width + 1) / (columns + 1)).toNumber();
        if (capacity < 0) { capacity = 0; }
        if (text.length() > capacity) {
            if (capacity > 3) { text = text.substring(0, capacity - 3) + "..."; }
            else { text = "...".substring(0, capacity); }
        }
        var clean = "";
        for (var i = 0; i < text.length(); i += 1) {
            var key = text.substring(i, i + 1);
            clean += glyphs.hasKey(key) ? key : "?";
        }
        if (target < rows) { target = rows; }
        var scaleY = (target / rows).toNumber();
        var availableY = (height / rows).toNumber();
        if (scaleY > availableY) { scaleY = availableY; }
        var unitWidth = clean.length() * (columns + 1) - 1;
        if (unitWidth < 1 || scaleY < 1) { return ["", 0, 0, 0, 0]; }
        var scaleX = (width / unitWidth).toNumber();
        if (scaleX > scaleY) { scaleX = scaleY; }
        if (scaleX < 1) { return ["", 0, 0, 0, 0]; }
        return [clean, scaleX, scaleY, unitWidth * scaleX, rows * scaleY];
    }

    function drawLabel(dc, textX, x, y, width, height, size, value, label, justify, numeric, pixelOnly, captionSize, captionColor, captionJustify, captionGap, captionPadding) {
        dc.setClip(x, y, width, height);
        var available = height;
        var caption = null;
        var captionBudget = 0;
        // Reserve actual fitted caption pixels, its independent gap and padding.
        var captionHeight = height - 7 - captionGap - captionPadding;
        if (label.length() > 0 && captionHeight >= 5) {
            caption = fitBitmap(label, captionSize, width, captionHeight, true);
            if (caption[4] > 0) { captionBudget = caption[4] + captionGap + captionPadding; }
        }
        available -= captionBudget;
        var font = null;
        if (!pixelOnly) { font = closestFont(dc, size, numeric, available, width, value); }
        var primary = null;
        var primaryHeight;
        if (font == null) {
            // The circle always uses this original font, matching the designer.
            // Separate X/Y scales keep long readings tall while fitting their width.
            primary = fitBitmap(value, size, width, available, false);
            primaryHeight = primary[4];
        } else { primaryHeight = dc.getFontHeight(font); }
        var clusterHeight = primaryHeight + captionBudget;
        var top = y + ((height - clusterHeight) / 2).toNumber();
        if (font != null) { dc.drawText(textX, top, font, value, justify); }
        else { drawBitmap(dc, x, top, primary, justify, false, width); }
        if (caption != null && caption[4] > 0) {
            dc.setColor(captionColor, Graphics.COLOR_TRANSPARENT);
            drawBitmap(dc, x, top + primaryHeight + captionGap, caption, captionJustify, true, width);
        }
        dc.clearClip();
    }

    function drawBitmap(dc, x, y, fit as Lang.Array, justify, tiny, width) {
        if (fit[1] < 1 || fit[2] < 1) { return; }
        var text = fit[0];
        var scaleX = fit[1];
        var scaleY = fit[2];
        var glyphs = tiny ? _tinyGlyphs : _pixelGlyphs;
        var columns = tiny ? 3 : 5;
        var rowCount = tiny ? 5 : 7;
        // Anchor from the box's left edge: odd widths match the SVG cell origin.
        if (justify == Graphics.TEXT_JUSTIFY_CENTER) { x += ((width - fit[3]) / 2).toNumber(); }
        else if (justify == Graphics.TEXT_JUSTIFY_RIGHT) { x += width - fit[3]; }
        for (var letter = 0; letter < text.length(); letter += 1) {
            var rows = glyphs[text.substring(letter, letter + 1)] as Lang.Array;
            for (var row = 0; row < rowCount; row += 1) {
                for (var column = 0; column < columns; column += 1) {
                    if ((rows[row] & (1 << (columns - column - 1))) != 0) {
                        dc.fillRectangle(x + (letter * (columns + 1) + column) * scaleX, y + row * scaleY, scaleX, scaleY);
                    }
                }
            }
        }
    }
}
`;
}

/** Return a complete, all-text Connect IQ project. No signing key is included. */
export function generateGarminFiles(project) {
  if (!project || project.version !== 1 || !Array.isArray(project.elements)) {
    throw new TypeError('Expected an Instinctual Face version 1 project.');
  }
  if (!Object.hasOwn(GARMIN_DEVICES, project.device)) throw new TypeError('Unsupported Garmin device.');
  if (project.elements.length > 100) throw new TypeError('A watch face may contain at most 100 layers.');
  const device = GARMIN_DEVICES[project.device];
  const files = {
    'manifest.xml': `<?xml version="1.0" encoding="UTF-8"?>
<iq:manifest xmlns:iq="http://www.garmin.com/xml/connectiq" version="3">
  <iq:application id="${appId(project)}" type="watchface" name="@Strings.AppName" entry="InstinctualFaceApp" launcherIcon="@Drawables.LauncherIcon" minApiLevel="${device.minApiLevel}">
    <iq:products><iq:product id="${device.id}" /></iq:products>
    ${metricPermissions(project.elements, device).length ? `<iq:permissions>${metricPermissions(project.elements, device).map(permission => `<iq:uses-permission id="${permission}" />`).join('')}</iq:permissions>` : '<iq:permissions />'}
    <iq:languages><iq:language>eng</iq:language></iq:languages>
    <iq:barrels />
  </iq:application>
</iq:manifest>
`,
    'monkey.jungle': 'project.manifest = manifest.xml\nbase.sourcePath = source\nbase.resourcePath = resources\n',
    'source/InstinctualFaceApp.mc': `using Toybox.Application;
using Toybox.WatchUi;

class InstinctualFaceApp extends Application.AppBase {
    function initialize() { AppBase.initialize(); }
    function onStart(state) {}
    function onStop(state) {}
    function getInitialView() { return [new InstinctualFaceView()]; }
}
`,
    'source/InstinctualFaceView.mc': viewSource(project, device),
    'resources/strings/strings.xml': `<?xml version="1.0" encoding="UTF-8"?>\n<strings><string id="AppName">${xml(applicationName(project.name))}</string></strings>\n`,
    'resources/drawables/drawables.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<drawables><bitmap id="LauncherIcon" filename="launcher_icon.svg" dithering="none" /></drawables>\n',
    'resources/drawables/launcher_icon.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="${device.launcherIconSize}" height="${device.launcherIconSize}" viewBox="0 0 30 30"><rect width="30" height="30" fill="#000000"/><circle cx="15" cy="15" r="12" fill="none" stroke="#ffffff" stroke-width="2"/><path d="M15 7V15L21 18" fill="none" stroke="#ffffff" stroke-width="2"/></svg>\n`,
    'design.instinctual.json': JSON.stringify(project, null, 2) + '\n',
    'README.md': exportReadme(device),
  };
  return files;
}

function exportReadme(device) {
  return `# Instinctual Face — Connect IQ source

Target: ${device.name} (${device.id}), ${device.width} × ${device.height} device pixels, ${device.display === 'amoled' ? 'AMOLED color' : 'black and white MIP'}.

This archive contains source and resources. It is not a compiled watch app or an installable PRG.

## Build and preview

1. Install Garmin's Connect IQ SDK Manager and the Garmin Monkey C extension for Visual Studio Code: https://developer.garmin.com/connect-iq/connect-iq-basics/getting-started/
2. In SDK Manager, install an SDK and the ${device.id} device profile. Open this extracted folder in VS Code.
3. Run **Monkey C: Generate a Developer Key** (or select your existing RSA 4096-bit signing key), then **Monkey C: Verify Installation**.
4. Open a source .mc file and choose **Run Without Debugging**. Select ${device.id} to preview in Garmin's simulator.
5. Run **Monkey C: Build for Device**, select ${device.id}, and select an output folder. Copy the generated PRG to your connected watch's GARMIN/APPS folder, then disconnect and select the face.

Garmin's simulator and sideload instructions: https://developer.garmin.com/connect-iq/connect-iq-basics/your-first-app/

For the SDK command line, after configuring its bin directory on PATH:

\`\`\`sh
mkdir -p bin
monkeyc -f monkey.jungle -d ${device.id} -o bin/InstinctualFace.prg -y /path/to/developer_key.der
connectiq
monkeydo bin/InstinctualFace.prg ${device.id}
\`\`\`

## Rendering and data

- The generated face reads selected time, activity, recorded health/sensor history, battery/status, user profile, cached Garmin weather and supported native complications. Missing permissions, stale or unavailable readings, unsupported firmware fields, and missing complications show --. It requests only the permissions needed by visible layers. Heart rate and sensor metrics use recorded history rather than starting live sensor sessions.
- Distances use kilometers, altitude meters, pressure hPa, temperature Celsius, wind km/h, weight kilograms, and race pace minutes per kilometer. Weather depends on Garmin's cached phone-supplied forecast. Configured sleep/wake times are user schedule settings, not recorded sleep duration. Body Battery, stress and pulse oxygen show the latest recorded sample. Sleep score, training status, race predictions, next event, weekly run/cycle distance and other native complications require a compatible newer device/firmware; unavailable metrics show --.
- Garmin controls watch-face updates, typically once per minute during low power. This source redraws the whole display and adds no timers or animations.
${device.display === 'amoled' ? '- AMOLED sleep uses a separate dim gray, time-only display on pure black. The clipped time region occupies less than 7% of a round display and alternates between separated rows each minute to reduce persistent lit pixels. Your active color design returns after a wake gesture. Verify always-on behavior on the selected hardware.\n' : ''}${device.hybrid ? '- Crossover has physical analog hands. Keep important text away from positions the hands cover and verify it on the actual watch.\n' : ''}${device.sharedProfile ? '- Garmin uses the instinct3solar45mm SDK profile for both Instinct 3 Solar case sizes.\n' : ''}
- Safety margins default to enabled. The designer and export fit layer rectangles inside the physical display and circular window, including its opaque bezel. Turning safety margins off preserves the original coordinates and allows deliberate placement over masked pixels.
- Captions use an original 3 × 5 pixel font, with independently editable text, size, color, alignment and gap. Empty caption text hides it. The circular window uses an original 5 × 7 pixel primary font in both the designer and watch, with separate horizontal and vertical scaling so larger readings remain visible. Elsewhere the watch measures each live value and chooses a built-in font that fits both dimensions, falling back to the original font if no native font fits. The fitted caption, gap and padding reserve actual pixels; default captions retain the previous nine scaled pixel budget. Extremely long text is shortened with dots; unsupported characters in the compact font show a question mark. Boxes shorter than seven pixels cannot show readable primary text. Verify other native fonts in Garmin's simulator because they vary by device.
- Rectangles, fixed original icons, progress bars and rings are drawn locally. Progress goals use the watch's step/floor goals, battery 100%, or app targets of 2,000 kcal / 10 km unless overridden. They add no resource downloads or permissions beyond their selected data source.
- Unit preferences are compiled into each reading and its default caption: temperature, distance/pace, elevation, wind speed, pressure, weight and profile height can be selected independently. Custom captions retain their wording. Existing designs default to metric. Daily distance is read in centimeters, weekly distance/visibility in meters, pressure in Pascals, weight in grams and height in centimeters before display conversion. Distance progress goals remain stored in kilometers so changing display units preserves progress.
- Coordinates are in device pixels. The Instinct 2S Connect IQ canvas is 163 × 156, as listed by Garmin, which differs from its marketed panel resolution.
- Only visible layers render. Editor settings and layer locks are preserved in design.instinctual.json, but do not affect watch operation.
- Changing a design's id changes the exported app id. Keep both that id and your private developer key when publishing updates to an existing app.

Official device reference: https://developer.garmin.com/connect-iq/compatible-devices/
Official drawing APIs: https://developer.garmin.com/connect-iq/api-docs/Toybox/Graphics/Dc.html
Official activity APIs: https://developer.garmin.com/connect-iq/api-docs/Toybox/ActivityMonitor.html

Store distribution is a separate Garmin developer submission step: https://developer.garmin.com/connect-iq/submit-an-app/
`;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concatenate(parts) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

/** Create an ordinary UTF-8, stored ZIP with CRCs and a central directory. */
export function createSourceZip(project) {
  const files = generateGarminFiles(project);
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const name = encoder.encode(path);
    const data = encoder.encode(content);
    const checksum = crc32(data);
    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 flag; compression method remains STORE.
    lv.setUint16(12, 33, true); // DOS date 1980-01-01, deterministic archive.
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    localParts.push(local, name, data);

    const central = new Uint8Array(46);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(14, 33, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const central = concatenate(centralParts);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, Object.keys(files).length, true);
  ev.setUint16(10, Object.keys(files).length, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, offset, true);
  return concatenate([...localParts, central, end]);
}
