#!/usr/bin/env node
// HookMaster — Conflict Watchdog
// Event: ConfigChange
//
// Self-contained: no imports from HookMaster source.
// Reads ~/.claude/settings.json and .claude/settings.json,
// checks for conflicting hook IDs, and outputs a warning if found.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Known conflict data (mirrors src/conflict-detector.js) ────

const CONFLICT_GROUPS = [
  {
    ids: ['auto-format', 'auto-lint', 'import-sorter'],
    reason:
      'These hooks all fire on PostToolUse (Write|Edit|MultiEdit) and write to the ' +
      'same file simultaneously — a race condition that corrupts files.',
    combos: [
      {
        id: 'combo-format-and-lint',
        replaces: ['auto-format', 'auto-lint'],
        description: 'Format → Lint (sequential, no race)',
      },
      {
        id: 'combo-quality-suite',
        replaces: ['auto-format', 'auto-lint', 'import-sorter'],
        description: 'Format → Sort Imports → Lint (sequential, no race)',
      },
    ],
  },
];

const PAIRED_HOOKS = [
  {
    hooks: ['time-tracker', 'time-tracker-end'],
    message:
      'time-tracker (SessionStart) should always be paired with time-tracker-end (SessionEnd).',
  },
];

// ── Read installed hook IDs from a settings file ──────────────

function readInstalledIds(settingsPath) {
  const ids = new Set();
  if (!fs.existsSync(settingsPath)) return ids;

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (e) {
    return ids;
  }

  if (!settings.hooks) return ids;

  for (const matcherGroups of Object.values(settings.hooks)) {
    if (!Array.isArray(matcherGroups)) continue;
    for (const group of matcherGroups) {
      for (const handler of (group.hooks || [])) {
        if (handler.type === 'command' && typeof handler.command === 'string') {
          const match = handler.command.match(/hookmaster[/\\]([^/\\]+)[/\\]/);
          if (match) ids.add(match[1]);
        }
      }
    }
  }

  return ids;
}

// ── Collect all installed IDs (global + local) ────────────────

const globalPath = path.join(os.homedir(), '.claude', 'settings.json');
const localPath = path.join(process.cwd(), '.claude', 'settings.json');

const globalIds = readInstalledIds(globalPath);
const localIds = readInstalledIds(localPath);
const allIds = new Set([...globalIds, ...localIds]);

if (allIds.size === 0) process.exit(0);

// ── Detect conflicts ──────────────────────────────────────────

const warnings = [];

for (const group of CONFLICT_GROUPS) {
  const installed = group.ids.filter(id => allIds.has(id));
  if (installed.length >= 2) {
    const relevantCombos = group.combos.filter(c =>
      c.replaces.every(r => installed.includes(r)),
    );
    warnings.push({ type: 'conflict', hooks: installed, reason: group.reason, combos: relevantCombos });
  }
}

for (const pair of PAIRED_HOOKS) {
  for (const hookId of pair.hooks) {
    const partnerId = pair.hooks.find(h => h !== hookId);
    if (allIds.has(hookId) && !allIds.has(partnerId)) {
      warnings.push({ type: 'missing-pair', installed: hookId, missing: partnerId, message: pair.message });
    }
  }
}

if (warnings.length === 0) process.exit(0);

// ── Output warning ────────────────────────────────────────────

console.log('⚠️  HOOKMASTER CONFLICT DETECTED');
console.log('');

for (const w of warnings) {
  if (w.type === 'conflict') {
    console.log(`🔴 Race condition: ${w.hooks.join(' + ')}`);
    console.log(`   ${w.reason}`);
    if (w.combos.length > 0) {
      console.log('   Suggested replacements:');
      for (const combo of w.combos) {
        console.log(`   • ${combo.id} — ${combo.description}`);
      }
    }
    console.log('');
  } else if (w.type === 'missing-pair') {
    console.log(`🟡 Missing pair: ${w.installed} installed but ${w.missing} is not`);
    console.log(`   ${w.message}`);
    console.log('');
  }
}

console.log('Run /hook-analysis in Claude Code to review and fix conflicts interactively.');

process.exit(0);
