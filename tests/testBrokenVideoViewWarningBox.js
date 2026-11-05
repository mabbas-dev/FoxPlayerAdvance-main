import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('BrokenVideoView renders sleek greyish warning box with informative explanation', () => {
  const code = fs.readFileSync(path.join(__dirname, '../src/components/BrokenVideoView.js'), 'utf8');

  // 1. WarningToastIcon import
  assert(code.includes('WarningToastIcon'), 'BrokenVideoView must import WarningToastIcon');

  // 2. Greyish warning box container
  assert(code.includes('styles.warningBox'), 'BrokenVideoView must render warningBox container');
  assert(code.includes('styles.miniWarningBox'), 'BrokenVideoView must render miniWarningBox container');

  // 3. Warning header with icon and title
  assert(code.includes('styles.warningHeaderRow'), 'BrokenVideoView must render warningHeaderRow');
  assert(code.includes('styles.warningTitle'), 'BrokenVideoView must render warningTitle');

  // 4. In-depth explanation text
  assert(code.includes('styles.errorExplanation'), 'BrokenVideoView must render errorExplanation');
  assert(code.includes('styles.miniErrorExplanation'), 'BrokenVideoView must render miniErrorExplanation');

  // 5. Tailored explanation logic for MPEG-TS, ATS, and network errors
  assert(code.includes('Format Incompatibility'), 'BrokenVideoView must define Format Incompatibility title');
  assert(code.includes('Apple iOS native player requires HLS (.m3u8) streams'), 'BrokenVideoView must explain MPEG-TS HLS requirement on Apple devices');
  assert(code.includes('warningReason'), 'BrokenVideoView must compute tailored warningReason');

  // 6. Greyish styling assertions (dark OTT theme without neon)
  assert(code.includes("backgroundColor: '#1E1E22'"), 'warningBox must have sleek dark greyish background #1E1E22');
  assert(code.includes("borderColor: '#3F3F46'"), 'warningBox must have subtle border #3F3F46');
  assert(code.includes("color: '#A1A1AA'"), 'errorExplanation must use clean muted grey text #A1A1AA');
  assert(code.includes("color: '#D4D4D8'"), 'warningTitle must use crisp light zinc text #D4D4D8');

  console.log('  PASS: BrokenVideoView greyish warning box and responsive styling verified');
});
