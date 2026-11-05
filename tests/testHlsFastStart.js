const assert = require('assert');
const { StreamSession } = require('../server/services/hlsSegmenter');

async function testFastStart() {
  console.log('Testing HLS Segmenter Fast-Start logic...');

  const session = new StreamSession('test_stream_1', 'http://dummy.invalid/live.ts');
  session.active = true;

  // Simulate segment 1 being created after 100ms
  setTimeout(() => {
    session.segments.set(1, { seq: 1, buffer: Buffer.from('test_segment_1'), duration: 1.2 });
    session._notifyListeners();
  }, 100);

  const start = Date.now();
  await session.waitForSegments(2, 3500);
  const elapsed = Date.now() - start;

  console.log(`waitForSegments unblocked in ${elapsed}ms (instead of 3500ms timeout)`);
  assert(elapsed < 1000, `Expected fast-start under 1000ms, got ${elapsed}ms`);
  assert(session.segments.size === 1, 'Expected 1 segment ready');

  console.log('PASS: Fast-Start successfully unblocked with 1 segment without waiting 3500ms!');
}

testFastStart().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
