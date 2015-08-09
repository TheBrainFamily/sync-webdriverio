// A wrapped webdriverio with synchronous API using fibers.

var webdriverio = require('webdriverio');
var _ = require('underscore');
var fs = require('fs');
var path = require('path');
var Fiber = require('fibers');
var Future = require('fibers/future');
var Promise = require('meteor-promise');
Promise.Fiber = Fiber;
var wrapAsync = require('@xolvio/fiber-utils').wrapAsync;
var wrapAsyncObject = require('@xolvio/fiber-utils').wrapAsyncObject;

var wrapAsyncForWebdriver = function (fn, context) {
  return wrapAsync(fn, context, {supportCallback: false});
};

var webdriverioWithSync = _.clone(webdriverio);

webdriverioWithSync.wrapAsync = wrapAsync;
webdriverioWithSync.wrapAsyncObject = wrapAsyncObject;

webdriverioWithSync.remote = function (options) {
  var syncByDefault = !(options && options.sync === false);

  var remote = webdriverio.remote.apply(webdriverio, arguments);

  // Run condition function in fiber
  var waitUntil = remote.waitUntil;
  remote.waitUntil = function (condition/*, arguments */) {
    arguments[0] = Promise.async(condition);

    return waitUntil.apply(this, arguments);
  }

  // Wrap async all core commands
  var webdriverioPath = path.dirname(require.resolve('webdriverio'));
  var commandNames = _.chain(['protocol', 'commands'])
    .map(function(commandType) {
      var dir = path.resolve(webdriverioPath, path.join('lib', commandType));
      var files = fs.readdirSync(dir);
      return files.map(function(filename) {
        return filename.slice(0, -3);
      });
    })
    .flatten(true)
    .uniq()
    .value();

  var remoteWrapper = wrapAsyncObject(remote, commandNames, {
    syncByDefault: syncByDefault,
    wrapAsync: wrapAsyncForWebdriver
  });

  // Wrap async added commands
  var addCommand = remote.addCommand;
  remote.addCommand = function (fnName, fn, forceOverwrite) {
    var result = addCommand.apply(this, arguments);
    var commandWrapper = wrapAsyncObject(remote, [fnName], {
      syncByDefault: syncByDefault,
      wrapAsync: wrapAsyncForWebdriver
    });
    _.defaults(remote, commandWrapper);
    _.defaults(remoteWrapper, commandWrapper);

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
