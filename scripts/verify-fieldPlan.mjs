#!/usr/bin/env node
// verify-fieldPlan.mjs — spec-conformance checks for backend/lib/fieldPlan.js
// against docs/SCHEMA-AUTHORING-STANDARD.md §4–§5. No test runner in this repo;
// this is the harness. Exit 1 on any failure.
// Usage: node scripts/verify-fieldPlan.mjs

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildFieldPlan } = require('../backend/lib/fieldPlan.js');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
}
const keys = plan => plan.map(f => f.key);
const entry = (plan, key) => plan.find(f => f.key === key);

// The standard §7 worked example, exercised end to end.
const flight = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Flight Booking Request',
  required: ['tripType', 'origin', 'destination', 'departureDate', 'passengers'],
  properties: {
    bookingId: { type: 'string', format: 'uuid', 'x-source': 'system', description: 'Server-assigned booking reference. Never asked.' },
    tripType: { type: 'string', description: 'Whether the user is booking a one-way or round-trip flight.', enum: ['one-way', 'round-trip'], 'x-prompt': 'Is this a one-way or round-trip flight?', 'x-order': 1 },
    origin: { type: 'string', description: 'IATA code or city name for the departure location.', 'x-prompt': 'Where are you flying from?', 'x-hint': 'City name or airport code', 'x-order': 2 },
    seatClass: { type: 'string', description: 'Cabin class.', enum: ['economy', 'premium', 'business'], 'x-widget': 'radio', 'x-order': 3 },
    returnDate: { type: 'string', format: 'date', description: 'The date the user returns.', 'x-prompt': 'What date will you be returning?', 'x-depends-on': { field: 'tripType', equals: 'round-trip' }, 'x-order': 4 },
    homeAirport: { type: 'string', description: 'Preferred departure airport, pre-filled from profile.', 'x-source': 'db' },
    // Required but without x-order (lint would warn "all-or-nothing"; §5.2 still
    // defines the order: x-order group first, then remaining required).
    destination: { type: 'string', description: 'Arrival city.' },
    departureDate: { type: 'string', format: 'date', description: 'Departure date.' },
    passengers: { type: 'integer', description: 'Passenger count.' }
  }
};

console.log('\nworked example (standard §7)');
{
  const plan = buildFieldPlan(flight, {}, []);
  check('auto-assigned (uuid/x-source:system) and x-source:db are never asked',
    keys(plan).includes('bookingId') || keys(plan).includes('homeAirport'), false);
  check('x-order ascending drives the ask order',
    keys(plan), ['tripType', 'origin', 'seatClass', 'destination', 'departureDate', 'passengers']);
  check('x-prompt is verbatim', entry(plan, 'tripType').prompt, 'Is this a one-way or round-trip flight?');
  check('x-hint carried', entry(plan, 'origin').hint, 'City name or airport code');
  check('enum ≤5 default widget is radio (explicit here)', entry(plan, 'tripType').widget, 'radio');
  check('x-depends-on unsatisfied → field skipped this turn', keys(plan).includes('returnDate'), false);

  const rt = buildFieldPlan(flight, { tripType: 'round-trip' }, []);
  check('x-depends-on satisfied → field appears', keys(rt).includes('returnDate'), true);
  check('answered value marks field filled', entry(rt, 'tripType').filled, true);
  check('optional field is skippable, required is not',
    [entry(rt, 'seatClass').skippable, entry(rt, 'origin').skippable], [true, false]);
}

console.log('\nlegacy schema (no x-* anywhere) — §5.2 reduces to required-first');
{
  const legacy = {
    title: 'Legacy',
    required: ['name', 'active'],
    properties: {
      id: { type: 'string', format: 'uuid', description: 'Auto id.' },
      name: { type: 'string', description: 'The user name. More detail here.' },
      nick: { type: 'string', description: 'Optional nickname.' },
      active: { type: 'boolean', description: 'Whether active.' },
      kind: { type: 'string', enum: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], description: 'Seven options.' }
    }
  };
  const plan = buildFieldPlan(legacy, {}, []);
  check('required first (declaration order), then optional', keys(plan), ['name', 'active', 'nick', 'kind']);
  check('boolean defaults to yesno with Yes/No options',
    [entry(plan, 'active').widget, entry(plan, 'active').enumOptions], ['yesno', ['Yes', 'No']]);
  check('enum >5 defaults to dropdown', entry(plan, 'kind').widget, 'dropdown');
  check('first sentence of description is the prompt', entry(plan, 'name').prompt, 'The user name.');

  // §5.6 — the boolean-false quirk fix: false counts as an answer
  const answered = buildFieldPlan(legacy, { active: false }, []);
  check('explicit false is filled (never re-asked)', entry(answered, 'active').filled, true);

  // answered set is the other filled path (chip clicks / confirmed updates)
  const viaSet = buildFieldPlan(legacy, {}, ['name']);
  check('answered-set membership marks filled even with no value', entry(viaSet, 'name').filled, true);
}

console.log('\nchoices — §5.5');
{
  const s = {
    properties: {
      tags: { type: 'array', items: { enum: ['pro', 'basic'] }, description: 'Pick many.' },
      branch: { type: 'string', description: 'From the DB.', 'x-options-source': 'db', 'x-options-preview': ['Main'] }
    }
  };
  const plan = buildFieldPlan(s, {}, []);
  check('array+items.enum → checkbox, multiSelect, static options',
    [entry(plan, 'tags').widget, entry(plan, 'tags').multiSelect, entry(plan, 'tags').enumOptions],
    ['checkbox', true, ['pro', 'basic']]);
  check('x-options-source: db → no chips', entry(plan, 'branch').enumOptions, null);
}

console.log('\nconditionals — §5.4 legacy string form + if/then/else requiredness');
{
  const s = {
    required: ['tripType'],
    properties: {
      tripType: { type: 'string', enum: ['one-way', 'round-trip'], description: 'Trip kind.' },
      returnDate: { type: 'string', description: 'Return date.' },
      petName: { type: 'string', description: 'Pet name.', 'x-depends-on': 'hasPet' },
      hasPet: { type: 'boolean', description: 'Has a pet.' }
    },
    if: { properties: { tripType: { const: 'round-trip' } }, required: ['tripType'] },
    then: { required: ['returnDate'] }
  };
  const base = buildFieldPlan(s, {}, []);
  check('then-required field skipped while condition inactive', keys(base).includes('returnDate'), false);
  check('legacy bare-name depends-on (truthy) unsatisfied → skipped', keys(base).includes('petName'), false);

  const rt = buildFieldPlan(s, { tripType: 'round-trip' }, []);
  const rd = entry(rt, 'returnDate');
  check('active then → field asked and required', [Boolean(rd), rd?.required], [true, true]);

  const pet = buildFieldPlan(s, { hasPet: false }, []);
  check('explicit false does NOT satisfy truthy depends-on', keys(pet).includes('petName'), false);
  const petYes = buildFieldPlan(s, { hasPet: true }, []);
  check('truthy depends-on satisfied by true', keys(petYes).includes('petName'), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
