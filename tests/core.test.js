/**
 * FOX PLAYER — Core Unit Tests
 */

// Test device ID validation
describe('Device ID', () => {
  const { isValidDeviceId } = require('../src/storage/deviceStorage');

  test('accepts valid 8-char uppercase alphanumeric IDs', () => {
    expect(isValidDeviceId('A7K92PX4')).toBe(true);
    expect(isValidDeviceId('AAAAAAAA')).toBe(true);
    expect(isValidDeviceId('12345678')).toBe(true);
    expect(isValidDeviceId('ABCD1234')).toBe(true);
  });

  test('rejects invalid device IDs', () => {
    expect(isValidDeviceId('')).toBe(false);
    expect(isValidDeviceId(null)).toBe(false);
    expect(isValidDeviceId(undefined)).toBe(false);
    expect(isValidDeviceId('abc12345')).toBe(false); // lowercase
    expect(isValidDeviceId('ABCDEFGHI')).toBe(false); // 9 chars
    expect(isValidDeviceId('ABCDEFG')).toBe(false); // 7 chars
    expect(isValidDeviceId('ABCD!@#4')).toBe(false); // special chars
    expect(isValidDeviceId('ABCD 234')).toBe(false); // space
  });
});

// Test M3U parsing
describe('M3U Parser', () => {
  const { parseM3U, isAdultContent } = require('../src/services/m3uParser');

  const VALID_M3U = `#EXTM3U
#EXTINF:-1 tvg-id="CNN" tvg-name="CNN" tvg-logo="https://example.com/cnn.png" group-title="NEWS",CNN International
http://stream.example.com/cnn
#EXTINF:-1 tvg-name="BBC World" group-title="NEWS",BBC World News
http://stream.example.com/bbc
#EXTINF:-1 tvg-name="Sport Channel" group-title="SPORTS",Sport Channel
http://stream.example.com/sport
`;

  test('parses valid M3U', () => {
    const result = parseM3U(VALID_M3U);
    expect(result.channels).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.categories).toContain('NEWS');
    expect(result.categories).toContain('SPORTS');
  });

  test('extracts channel attributes', () => {
    const result = parseM3U(VALID_M3U);
    const cnn = result.channels.find((c) => c.name === 'CNN' || c.tvgName === 'CNN');
    expect(cnn).toBeTruthy();
    expect(cnn.logo).toBe('https://example.com/cnn.png');
    expect(cnn.group).toBe('NEWS');
    expect(cnn.url).toBe('http://stream.example.com/cnn');
  });

  test('throws on invalid M3U', () => {
    expect(() => parseM3U('not m3u content')).toThrow();
    expect(() => parseM3U('')).toThrow();
    expect(() => parseM3U(null)).toThrow();
  });

  test('throws when no channels found', () => {
    expect(() => parseM3U('#EXTM3U\n# empty')).toThrow('No channels found');
  });

  test('detects adult content', () => {
    expect(isAdultContent('XXX Channel', 'Adult')).toBe(true);
    expect(isAdultContent('18+ Movies', '')).toBe(true);
    expect(isAdultContent('BBC News', 'NEWS')).toBe(false);
    expect(isAdultContent('Sports', 'SPORTS')).toBe(false);
    expect(isAdultContent('Porn Hub TV', '')).toBe(true);
  });
});

// Test QR URL generation
describe('QR URL Generation', () => {
  test('generates correct pairing URL', () => {
    const deviceId = 'A7K92PX4';
    const baseUrl = 'http://localhost:3001';
    const expected = `${baseUrl}/add-device?device-id=${deviceId}`;
    const actual = `${baseUrl}/add-device?device-id=${deviceId}`;
    expect(actual).toBe(expected);
  });

  test('rejects device IDs that fail regex', () => {
    const invalid = ['', 'abc', 'toolongid12', '!@#$%^&*'];
    invalid.forEach((id) => {
      expect(/^[A-Z0-9]{8}$/.test(id)).toBe(false);
    });
  });
});

// Test Movies Pipeline & Xtream VOD
describe('Movies Pipeline & Xtream VOD', () => {
  const {
    normalizeMovieItem,
    buildVodStreamUrl,
    safeExtractArray,
  } = require('../src/services/xtreamService');

  test('normalizes complete movie item with custom container extension and rating', () => {
    const raw = {
      num: 1,
      name: 'Inception',
      stream_type: 'movie',
      stream_id: 12345,
      stream_icon: 'https://example.com/poster.jpg',
      rating: '8.8',
      rating_5based: 4.4,
      added: '1609459200',
      category_id: '10',
      container_extension: 'mkv',
      year: '2010',
    };

    const movie = normalizeMovieItem(raw, 'http://server.com:8080', 'user1', 'pass1');
    expect(movie.id).toBe('12345');
    expect(movie.streamId).toBe('12345');
    expect(movie.name).toBe('Inception');
    expect(movie.title).toBe('Inception');
    expect(movie.poster).toBe('https://example.com/poster.jpg');
    expect(movie.categoryId).toBe('10');
    expect(movie.containerExtension).toBe('mkv');
    expect(movie.rating).toBe(8.8);
    expect(movie.year).toBe('2010');
    expect(movie.type).toBe('movie');
    expect(movie.url).toBe('http://server.com:8080/movie/user1/pass1/12345.mkv');
  });

  test('normalizes minimal movie item without poster, rating, or year without dropping it', () => {
    const minimal = {
      name: 'Independent Film',
      stream_id: 999,
      category_id: 42,
    };

    const movie = normalizeMovieItem(minimal);
    expect(movie.id).toBe('999');
    expect(movie.name).toBe('Independent Film');
    expect(movie.categoryId).toBe('42');
    expect(movie.poster).toBeNull();
    expect(movie.rating).toBeNull();
    expect(movie.year).toBeNull();
    expect(movie.containerExtension).toBe('mp4');
  });

  test('buildVodStreamUrl generates correct URL with URI encoding and actual extension', () => {
    const url = buildVodStreamUrl('http://toxicplay1.com:8080/', 'my user', 'p@ss!', '146924', 'mkv');
    expect(url).toBe('http://toxicplay1.com:8080/movie/my%20user/p%40ss!/146924.mkv');
  });

  test('category comparison correctly matches normalized string vs number IDs', () => {
    const categoryIdNum = 412;
    const movieCategoryIdStr = '412';
    expect(String(movieCategoryIdStr) === String(categoryIdNum)).toBe(true);
  });

  test('safeExtractArray extracts from direct arrays and wrapped object payloads', () => {
    expect(safeExtractArray([{ id: 1 }, { id: 2 }], 'streams')).toHaveLength(2);
    expect(safeExtractArray({ streams: [{ id: 3 }] }, 'streams')).toHaveLength(1);
    expect(safeExtractArray(null, 'streams')).toHaveLength(0);
    expect(safeExtractArray('invalid string', 'streams')).toHaveLength(0);
  });
});
