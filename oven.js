/*jslint indent: 2, maxlen: 80, continue: false, unparam: false, node: true */
/* -*- tab-width: 2 -*- */
'use strict';

var steam = require('steam'), cryptoLib = require('crypto'),
  stripBom = require('strip-bom'),
  Promise = require('bluebird'),
  promisedFs = require('nofs'),
  arSlc = Array.prototype.slice;


function sha1raw(buf) {
  return cryptoLib.createHash('sha1').update(buf).digest();
}


function buildOven(ovenOpt) {
  if (!ovenOpt) { ovenOpt = false; }
  var funnel = new steam.SteamClient(), oven = { eventLog: [] };
  oven.sha1raw = sha1raw;

  function logEvents(chan, evEmitter, evNames, refiners) {
    if (!evEmitter) { evEmitter = oven[chan]; }
    evNames.forEach(function (n) {
      var r = (refiners || false)[n];
      evEmitter.on(n, function () {
        var log, evt = { id: null, name: n, chan: chan, time: Date.now(),
          args: arSlc.call(arguments) };
        evt.id = oven.eventLog.length;
        oven.eventLog[evt.id] = evt;
        if (r) { log = r(evt); }
        if (log !== false) {
          console.log(chan, '!' + n + '#' + evt.id + '!',
            (log === undefined ? evt.args : log));
        }
      });
    });
  }
  oven.logEvents = logEvents;

  function attachEventEmitter(name, ee, evNames, refiners) {
    oven[name] = ee;
    logEvents(name, ee, evNames, refiners);
  }

  attachEventEmitter('funnel', funnel, [
    'connected',
    'error',
    'loggedOff',
    'logOnResponse',
    'message',
    'servers',
  ], {
    message: function (ev) {
      var log = { data: ev.args[0] }, rawBuf = ev.args[1];
      log = '[…]';
      //log.buf = '(' + rawBuf.length + ') ' + rawBuf.toString('base64');
      //log.cb = (ev.args[2] || false);
      //Object.assign(ev, log);
      //ev.args = [];
      ev.buf = rawBuf;
      return log;
    },
    servers: function (ev) { return 'n=' + ev.args[0].length; },
  });

  attachEventEmitter('fire', new steam.SteamUser(funnel), [
    'updateMachineAuth',
    'tradeOffers',
  ], {
    updateMachineAuth: function (ev) {
      //var logData = Object.assign({}, ev.args[0]), bytes = logData.bytes,
      //  cb = (ev.args[1] || false);
      //logData.bytes = bytes.toString('base64');
      //logData.sha1hex = sha1raw(bytes).toString('hex');
      function saveAndConfirm() { return oven.sentry.saveAndConfirm(ev); }
      ev.saveAndConfirm = saveAndConfirm;
      return '[…]';
    },
  });

  attachEventEmitter('coal', new steam.SteamFriends(funnel), [
    'chatEnter',
    'chatInvite',
    'chatMsg',
    'chatRoomInfo',
    'chatStateChange',
    'clanState',
    'friend',
    'friendMsg',
    'friendMsgEchoToSender',
    'group',
    'message',
    'personaState',
    'relationships',
  ]);

  oven.login = function login(opt) {
    if (typeof opt === 'string') { opt = { ac: opt }; }
    if (!opt) { opt = false; }
    var msg = {
      // https://github.com/seishun/node-steam/wiki/Protobufs#cmsgclientlogon
      account_name: (opt.username || opt.un || process.env.STEAM_USER),
      password: (opt.password || opt.pw || process.env.STEAM_PSWD),
    }, ac;
    (function () {
      if (!oven.sentry.key.sharedSecret) {
        if (!oven.sentry.filename) { return; }
        throw new Error('Sentry file is configured but its shared secret ' +
          'is not (yet?) loaded!');
      }
      msg.sha_sentryfile = oven.sentry.sharedSecretHash();
    }());
    ac = (opt.steamGuardCode || opt.ac);
    if (ac) { msg.auth_code = ac; }
    console.log('Gonna logon with', Object.keys(msg).map(function (key) {
      return key + '=…×' + msg[key].length;
    }).join(', '));
    oven.fire.logOn(msg);
  };

  oven.expectEventNamed = function (ev, name) {
    if (typeof ev === 'number') { ev = oven.eventLog[ev]; }
    if ((ev || false).name !== name) {
      throw new Error('Need an event named "' + name + '" or its ID!');
    }
    return ev;
  };

  function decideSentryFileName() {
    var fn = (process.env.STEAM_SENF
      || ovenOpt.defaultSentryFileName
      || null);
    if (fn === '.') { fn = null; }
    return fn;
  }

  oven.sentry = {
    filename: decideSentryFileName(),

    key: {
      remoteFilename: null,
      sharedSecret: null,
    },

    sharedSecretHash: function () {
      var keyBuf = oven.sentry.key.sharedSecret, hash = keyBuf.sha1buf;
      if (hash) { return hash; }
      hash = sha1raw(keyBuf);
      keyBuf.sha1buf = hash;
      return hash;
    },

    updateKey: function (updEvData) {
      var oldKey = (oven.sentry.key || false), buf, newKey,
        offset = updEvData.offset, copied;
      if (!Number.isFinite(offset)) {
        throw new Error('Expected a (finite) number as offset');
      }
      buf = Buffer.from(oldKey.sharedSecret);
      copied = updEvData.bytes.copy(buf, updEvData.offset);
      if (copied !== updEvData.cubtowrite) {
        throw new Error('Expected to write cubtowrite=' + updEvData.cubtowrite
          + ' bytes but wrote ' + copied);
      }
      newKey = Object.assign({}, oldKey, { sharedSecret: buf });
      return newKey;
    },

    loadKeyFile: function () {
      var fn = oven.sentry.filename;
      return promisedFs.readFile(fn, 'UTF-8').then(function (data) {
        data = stripBom(data);
        try {
          return JSON.parse(data);
        } catch (err) {
          err.inputData = data;
          throw err;
        }
      }).then(function (key) {
        var b64 = (key.sharedSecret_base64 || null);
        key.sharedSecret = (b64 && Buffer.from(b64, 'base64'));
        delete key.sharedSecret_base64;
        oven.sentry.key = key;
      }).then(null, function (err) {
        err.message = 'Failed to read senty file "' + fn + '": ' + err.message;
        throw err;
      });
    },

    saveAndConfirm: function (ev) {
      ev = oven.expectEventNamed(ev, 'updateMachineAuth');
      var confirm = ev.args[1], time = (ev.time || Date.now()),
        updEvData = ev.args[0],
        newKey = oven.sentry.updateKey(updEvData),
        remoteFn = updEvData.filename,
        tmpFn = oven.sentry.filename + '.upd-' + time + '.tmp';
      newKey.time = time;
      if (remoteFn) { newKey.remoteFilename = remoteFn; }
      return Promise.try(function () {
        var json = JSON.stringify(Object.assign({}, newKey, {
          sharedSecret: undefined,
          sharedSecret_base64: newKey.sharedSecret.toString('base64'),
        }), null, 2) + '\n';
        return promisedFs.writeFile(tmpFn, json);
      }).then(function () {
        return promisedFs.rename(tmpFn, oven.sentry.filename);
      }).then(function () {
        oven.sentry.key = newKey;
        var msg = { sha_file: oven.sentry.sharedSecretHash() };
        console.log('UMA confirm msg:', msg);
        return confirm(msg);
      });
    },
  };

  oven.funnel.connect();
  return oven;
}




module.exports = buildOven;
