'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeName } = require('../lib/util');

test('Latin accents do not split a hospital name into false tokens', () => {
  assert.equal(normalizeName('Doctors’ Center Hospital - Bayamón'),
    normalizeName('Doctors Center Hospital - BAYAMON'));
  assert.equal(normalizeName('HOSPITAL SAN FERNANDO DE LA CAROLINA'),
    normalizeName('Hospital San Fernando de la Carolina'));
  assert.notEqual(normalizeName('Doctors Center Hospital - Bayamón'),
    normalizeName('Doctors Center Hospital - Dorado'));
});
