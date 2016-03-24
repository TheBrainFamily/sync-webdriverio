// A wrapped webdriverio with synchronous API using fibers.

var webdriverio = require('webdriverio');
var getImplementedCommands = require('webdriverio/build/lib/helpers/getImplementedCommands');
var _ = require('underscore');
var fs = require('fs');
var path = require('path');
var Fiber = require('fibers');
var Future = require('fibers/future');
var Promise = require('meteor-promise');
Promise.Fiber = Fiber;
var wrapAsync = require('xolvio-fiber-utils').wrapAsync;
var wrapCommand = require('wdio-sync').wrapCommand;
var wrapAsyncObject = require('xolvio-fiber-utils').wrapAsyncObject;

var commandNames = _.keys(getImplementedCommands());

var wrapAsyncForWebdriver = function (fn, context) {
  return wrapCommand(fn.bind(context), fn.name, _.noop, _.noop);
};

var webdriverioWithSync = _.clone(webdriverio);

webdriverioWithSync.wrapAsync = wrapAsync;
webdriverioWithSync.wrapAsyncObject = wrapAsyncObject;

webdriverioWithSync.remote = function (options) {
  var syncByDefault = !(options && options.sync === false);

  var remote = webdriverio.remote.apply(webdriverio, arguments);
  var remoteWrapper;

  // Run condition function in fiber
  var waitUntil = remote.waitUntil;
  remote.waitUntil = function (condition/*, arguments */) {
    var args = _.toArray(arguments);
    args[0] = Promise.async(condition.bind(remoteWrapper));

    return waitUntil.apply(remote, args);
  };

  remoteWrapper = wrapAsyncObject(remote, commandNames, {
    syncByDefault: syncByDefault,
    wrapAsync: wrapAsyncForWebdriver
  });

  // Wrap async added commands
  var addCommand = remote.addCommand;
  remote.addCommand = function (fnName, fn, forceOverwrite) {
    var result = addCommand.call(
      remote, fnName, Promise.async(fn.bind(remoteWrapper)), forceOverwrite);
    var commandWrapper = wrapAsyncObject(remote, [fnName], {
      syncByDefault: syncByDefault,
      wrapAsync: wrapAsyncForWebdriver
    });
    _.extend(remoteWrapper, _.omit(commandWrapper, '_original'));

    return result;
  };

  _.forEach([
    'addCommand',
    'transferPromiseness',
    'on', 'once', 'emit', 'removeListener', 'removeAllListeners'
  ], function (methodName) {
    remoteWrapper[methodName] = remote[methodName].bind(remote);
  });

  return remoteWrapper;
};

module.exports = webdriverioWithSync;
