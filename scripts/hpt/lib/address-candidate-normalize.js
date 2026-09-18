'use strict';

const substitutions = {
  STREET: 'ST', ST: 'ST', AVENUE: 'AVE', AVE: 'AVE', ROAD: 'RD', RD: 'RD',
  DRIVE: 'DR', DR: 'DR', WEST: 'W', W: 'W', EAST: 'E', E: 'E',
  NORTH: 'N', N: 'N', SOUTH: 'S', S: 'S',
};

function compactStreet(value) {
  return String(value || '').toUpperCase()
    .replace(/\b(STREET|ST|AVENUE|AVE|ROAD|RD|DRIVE|DR|WEST|W|EAST|E|NORTH|N|SOUTH|S)\b/g,
      match => substitutions[match])
    .replace(/[^A-Z0-9]/g, '');
}

function compactSiteStreet(value) {
  return compactStreet(String(value || '').replace(/\b(?:SUITE|STE|UNIT|ROOM|RM|FLOOR|FL|BUILDING|BLDG)\b.*$/i, ''));
}

function addressHasZip(value, zip) {
  if (!/^\d{5}$/.test(String(zip || ''))) return false;
  return [...String(value || '').matchAll(/\b(\d{5})(?:[- ]?\d{4})?\b/g)]
    .some(match => match[1] === zip);
}

module.exports = { compactStreet, compactSiteStreet, addressHasZip };
