// A wrapped webdriverio with synchronous API using fibers.

var webdriverio = require('webdriverio');
var _ = require('underscore');
var fs = require('fs');
var path = require('path');
var Fiber = require('fibers');
var Future = require('fibers/future');
var Promise = require('meteor-promise');
Promise.Fiber = Fiber;
var wrapAsync = require('xolvio-fiber-utils').wrapAsync;
var wrapAsyncObject = require('xolvio-fiber-utils').wrapAsyncObject;

var wrapAsyncForWebdriver = function (fn, context) {
  return wrapAsync(fn, context, {supportCallback: false});
};

var webdriverioWithSync = _.clone(webdriverio);

var wws = _.extend(webdriverioWithSync, {
  wrapAsync: wrapAsync,
  wrapAsyncObject: wrapAsyncObject,
  index: 0,
  _instances: [],
  _wrappers: [],
  _remote: {},
  _commandNames: [],
  _syncByDefault: true,
  remoteWrapper: {}
});

webdriverioWithSync.multiremote = function (options) {
  wws.remote = webdriverio.multiremote.apply(webdriverio, arguments);

  webdriverioWithSync.configureRemote(options);

  Object.keys(options).forEach(function(browserName) {
    var browser = wws.remote.select(browserName);
    webdriverioWithSync.wrapAsyncBrowser(browser, wws.commandNames, wws.syncByDefault);
  });

  wws.remoteWrapper.instances = [];
  wws._wrappers.forEach(function(wrapper, index) {
    // if one of the multiremote instances, first one is the "shared" one
    if (index > 0) {
      wws.remoteWrapper.instances.push(wrapper);
    }
  });
  wws.remoteWrapper.init();

  return wws.remoteWrapper;
};

webdriverioWithSync.remote = function (options) {
  wws.remote = webdriverio.remote.apply(webdriverio, arguments);

  webdriverioWithSync.configureRemote(options);

  return wws.remoteWrapper;
};

webdriverioWithSync.wrapAsyncBrowser = function(browser, commandNames, syncByDefault) {
  wws._instances.push(browser);
  wws._instances[wws.index].index = wws.index;
  wws._wrappers.push(wrapAsyncObject(wws._instances[wws.index], commandNames, {
    syncByDefault: syncByDefault,
    wrapAsync: wrapAsyncForWebdriver
  }));

  // Wrap async added commands
  var remoteWrapper = _.last(wws._wrappers);
  wws._instances[wws.index]._addCommand = wws._instances[wws.index].addCommand;
  wws._instances[wws.index].addCommand = function(fnName, fn, forceOverwrite) {
    var result = wws._instances[this.index]._addCommand.call(wws._instances[wws.index], fnName, Promise.async(fn.bind(remoteWrapper)), forceOverwrite);
    var commandWrapper = wrapAsyncObject(wws._instances[this.index], [fnName], {
      syncByDefault: syncByDefault,
      wrapAsync: wrapAsyncForWebdriver
    });
    _.defaults(wws._wrappers[this.index], commandWrapper);

    return result;
  };

  _.forEach([
    'addCommand',
    'transferPromiseness',
    'on', 'once', 'emit', 'removeListener', 'removeAllListeners', 'select'
  ], function(methodName) {
    if (wws._instances[wws.index][methodName]) {
      wws._wrappers[wws.index][methodName] =
          wws._instances[wws.index][methodName]
              .bind(wws._instances[wws.index]);
    }
  });
  wws.index++;
};

webdriverioWithSync.configureRemote = function(options) {
  wws.syncByDefault = !(options && options.sync === false);

  // Run condition function in fiber
  var waitUntil = wws.remote.waitUntil;
  wws.remote.waitUntil = function (condition/*, arguments */) {
    arguments[0] = Promise.async(condition);

    return waitUntil.apply(wws.remote, arguments);
  };

  // Wrap async all core commands
  var webdriverioPath = path.dirname(require.resolve('webdriverio'));
  wws.commandNames = _.chain(['protocol', 'commands'])
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

  webdriverioWithSync.wrapAsyncBrowser(wws.remote, wws.commandNames, wws.syncByDefault);
  wws.remoteWrapper = wws._wrappers[0];
};

module.exports = webdriverioWithSync;
