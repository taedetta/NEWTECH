'use strict';

const assert = require('assert');

const calls = [];
const fakePool = {
  async query(sql, params) {
    calls.push({ sql, params });
    if (/SELECT \* FROM locations/.test(sql)) {
      return { rows: [{ id: 1, code: 'KPSK', name: 'New River Valley (Dublin, VA)', is_default: true }] };
    }
    if (/SELECT id FROM locations/.test(sql)) {
      return { rows: [{ id: 1 }] };
    }
    if (/INSERT INTO locations \(code, name, timezone, weather_station, is_default\)/.test(sql)) {
      return { rows: [{ id: 2, code: params[0], name: params[1], is_default: params[4] }] };
    }
    return { rows: [] };
  },
};

require.cache[require.resolve('../db/index')] = {
  id: require.resolve('../db/index'),
  filename: require.resolve('../db/index'),
  loaded: true,
  exports: fakePool,
};

const locationsDb = require('../db/locations');

async function main() {
  console.log('Locations DB smoke test');

  const locations = await locationsDb.listLocations();
  assert.strictEqual(locations[0].code, 'KPSK');
  assert.match(calls[0].sql, /CREATE TABLE IF NOT EXISTS locations/);
  assert.match(calls[0].sql, /INSERT INTO locations \(code, name, weather_station, is_default\)/);
  assert.match(calls[1].sql, /SELECT \* FROM locations/);
  console.log('  OK listLocations ensures table before select');

  const defaultId = await locationsDb.getDefaultLocationId();
  assert.strictEqual(defaultId, 1);
  console.log('  OK getDefaultLocationId works after ensure');

  const created = await locationsDb.createLocation({
    code: 'kabc',
    name: 'Test Base',
    timezone: 'America/Chicago',
    weather_station: 'KABC',
    is_default: true,
  });
  assert.strictEqual(created.code, 'KABC');
  assert(calls.some((call) => /UPDATE locations SET is_default = false/.test(call.sql)));
  console.log('  OK createLocation uppercases code and clears prior default');

  console.log('All locations DB smoke tests passed');
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
