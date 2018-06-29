/*jslint indent: 2, maxlen: 80, continue: false, unparam: false, node: true */
/* -*- tab-width: 2 -*- */
'use strict';

var makeOven = require('./oven'), ovenOpt = {}, oven,
  hostname = require('os').hostname(), fs = require('fs'),
  steam = require('steam'),
  startRepl = require('repl').start, repl = {};


ovenOpt.defaultSentryFileName = (process.env.HOME
  + '/.config/valve/steam/sentry-files/'
  + process.env.STEAM_USER + '@' + hostname.toLowerCase()
  + '.json');

oven = makeOven(ovenOpt);

oven.logEvents('process', process, [
  'uncaughtException',
  'unhandledRejection',
]);
repl.ignoreUndefined = true;

(function () {
  var term = process.env.STEAM_OVEN_TERM;
  if (term === 'auto') { return; }
  repl.terminal = (term !== 'no');
}());

oven.sentry.loadKeyFile().then(function () {
  console.log('Sentry file hash:',
    oven.sentry.sharedSecretHash().toString('hex'));
}, function (err) {
  console.error('Failed to read sentry file:', err);
});

console.log('Start REPL:');
repl = startRepl(repl);
Object.assign(repl.context, {
  coal: oven.coal,
  env: process.env,
  evLog: oven.eventLog,
  fire: oven.fire,
  login: oven.login,
  oven: oven,
  reconnect: function () { oven.funnel.connect(); },
  sentry: oven.sentry,
  steam: steam,
});
